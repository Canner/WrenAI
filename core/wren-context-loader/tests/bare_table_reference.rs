//! Guards the `wren generate-mdl` CLI's file-backed-source authored shape: a model's
//! `table_reference` with only a `table` key — no `catalog`/`schema` at all — e.g.
//!
//! ```yaml
//! table_reference:
//!   table: /abs/path/to/file.parquet
//! ```
//!
//! `wren-core-base`'s custom `table_reference` serde module requires all three keys present on
//! the authored mapping (its inner `TableReference` struct has no `#[serde(default)]` on
//! `catalog`/`schema`, even though they're `Option<String>`), so passing this object through
//! unpadded is a hard "missing field `catalog`" deserialize error — surfaced upstream only as the
//! generic `mdl_parseable` precondition failure. `project::model_to_json` pads the missing keys
//! with JSON `null` before handoff; this test proves a project authored this way still loads.

use std::fs;
use std::path::Path;

use warble::ContextLoader;
use wren_context_loader::{assemble, read_project_dir, MdlContext};

fn write(dir: &Path, rel: &str, contents: &str) {
    let path = dir.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, contents).unwrap();
}

/// A minimal schema_version-2 (file-backed source) project: one model whose `table_reference`
/// carries only `table`, no `catalog`/`schema` — the exact shape `wren generate-mdl` emits for
/// duckdb/csv/local_file sources.
fn bare_tableref_project(dir: &Path) {
    write(
        dir,
        "wren_project.yml",
        "schema_version: 2\nname: filedemo\nversion: '1.0'\ncatalog: wren\nschema: public\ndata_source: local_file\n",
    );
    write(
        dir,
        "models/customers/metadata.yml",
        r#"name: customers
table_reference:
  table: /abs/path/to/customers.parquet
primary_key: customer_id
columns:
  - { name: customer_id, type: INTEGER }
  - { name: email, type: VARCHAR }
"#,
    );
}

#[test]
fn bare_table_key_table_reference_still_parses() {
    let tmp = tempfile::tempdir().unwrap();
    bare_tableref_project(tmp.path());

    let sources = read_project_dir(tmp.path())
        .expect("read project dir")
        .expect("fixture is a wren project");
    let ctx = MdlContext::try_from_sources(&sources)
        .expect("a table_reference with only `table` (no catalog/schema) must still assemble");

    let assembled = assemble(&sources).expect("assemble the original authored sources");
    let manifest = serde_json::to_value(&assembled.manifest).unwrap();
    assert_eq!(
        manifest["models"][0]["tableReference"]["table"],
        "/abs/path/to/customers.parquet"
    );
    assert!(manifest["models"][0]["tableReference"]["catalog"].is_null());
    assert!(manifest["models"][0]["tableReference"]["schema"].is_null());
    assert!(ctx.is_parseable());
    let model = ctx
        .model("customers")
        .expect("customers model must be present");
    assert!(model.columns.contains(&"customer_id".to_string()));
    assert!(model.columns.contains(&"email".to_string()));
}

/// A single-table project (e.g. a one-CSV onboarding) has no relationships, and the wren CLI
/// scaffolds a comment-only `relationships.yml` for it. That parses to YAML null, which matches
/// neither `RelationshipsDoc` variant (`Bare` sequence / `Keyed` mapping) — before the fix this
/// failed the whole project's assembly and surfaced only as the generic `mdl_parseable`
/// precondition failure. An empty/null relationships document must be treated as "no
/// relationships", not a hard parse error.
#[test]
fn empty_relationships_yml_is_treated_as_no_relationships() {
    let tmp = tempfile::tempdir().unwrap();
    bare_tableref_project(tmp.path());
    // Comment-only relationships.yml — exactly what the CLI writes for a project with no joins.
    write(
        tmp.path(),
        "relationships.yml",
        "# Relationships between models\n",
    );

    let sources = read_project_dir(tmp.path())
        .expect("read project dir")
        .expect("fixture is a wren project");
    let ctx = MdlContext::try_from_sources(&sources)
        .expect("a comment-only/empty relationships.yml must assemble as zero relationships");

    assert!(ctx.is_parseable());
    assert!(
        ctx.model("customers").is_some(),
        "the model must still load when relationships.yml is empty"
    );
}

#[test]
fn authored_cube_hierarchies_reach_the_manifest_in_key_order() {
    let tmp = tempfile::tempdir().unwrap();
    bare_tableref_project(tmp.path());
    write(
        tmp.path(),
        "cubes/order_metrics/metadata.yml",
        r#"name: order_metrics
base_object: customers
measures: []
dimensions:
  - { name: country, expression: country, type: VARCHAR }
  - { name: city, expression: city, type: VARCHAR }
time_dimensions: []
hierarchies:
  geography: [country, city]
  locality: [city]
"#,
    );
    write(
        tmp.path(),
        "cubes/no_hierarchy/metadata.yml",
        "name: no_hierarchy\nbase_object: customers\nmeasures: []\ndimensions: []\ntime_dimensions: []\n",
    );

    let sources = read_project_dir(tmp.path()).unwrap().unwrap();
    let assembled = assemble(&sources).unwrap();
    let manifest = serde_json::to_value(&assembled.manifest).unwrap();
    let cube = |name: &str| {
        manifest["cubes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|cube| cube["name"] == name)
            .unwrap()
    };
    assert_eq!(
        cube("order_metrics")["hierarchies"],
        serde_json::json!({ "geography": ["country", "city"], "locality": ["city"] })
    );
    assert_eq!(cube("no_hierarchy")["hierarchies"], serde_json::json!({}));
}
