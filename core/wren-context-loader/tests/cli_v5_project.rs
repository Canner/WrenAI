//! Integration tests for the wren CLI (project schema_version 5) authored shape:
//! `relationships.yml` as a `relationships:` keyed mapping (the CLI both scaffolds and
//! *requires* this form — it silently loads 0 relationships from a bare list), join types
//! in SCREAMING_SNAKE_CASE, and per-cube `cubes/<name>/metadata.yml` files instead of a
//! root `cubes.yml`. The original bare-list + root-cubes shape is covered by the
//! `jaffle_wren` tests; this file guards that both generations of project load identically.

use std::fs;
use std::path::Path;

use warble::{Additivity, ContextLoader};
use wren_context_loader::{read_project_dir, MdlContext};

fn write(dir: &Path, rel: &str, contents: &str) {
    let path = dir.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, contents).unwrap();
}

/// A minimal schema_version-5 project: two models, keyed relationships (MANY_TO_ONE),
/// and a cube under `cubes/<name>/metadata.yml` — no root `cubes.yml`.
fn v5_project(dir: &Path) {
    write(
        dir,
        "wren_project.yml",
        "schema_version: 5\nname: v5demo\nversion: '1.0'\ncatalog: wren\nschema: public\ndata_source: duckdb\nprofile: v5demo\n",
    );
    write(
        dir,
        "models/customers/metadata.yml",
        r#"name: customers
table_reference: { catalog: demo, schema: main, table: customers }
primary_key: id
columns:
  - { name: id, type: INTEGER }
  - { name: email, type: VARCHAR }
"#,
    );
    write(
        dir,
        "models/orders/metadata.yml",
        r#"name: orders
table_reference: { catalog: demo, schema: main, table: orders }
primary_key: id
columns:
  - { name: id, type: INTEGER }
  - { name: customer_id, type: INTEGER }
  - { name: total, type: "DECIMAL(12,2)" }
  - { name: placed_at, type: TIMESTAMP }
"#,
    );
    write(
        dir,
        "relationships.yml",
        r#"relationships:
  - name: orders_customers
    models: [orders, customers]
    join_type: MANY_TO_ONE
    condition: "orders.customer_id = customers.id"
"#,
    );
    write(
        dir,
        "cubes/order_metrics/metadata.yml",
        r#"name: order_metrics
base_object: orders
measures:
  - { name: total_value, expression: "SUM(total)", type: DOUBLE }
  - { name: avg_value, expression: "AVG(total)", type: DOUBLE }
dimensions: []
time_dimensions:
  - { name: placed_at, expression: placed_at, type: TIMESTAMP }
"#,
    );
}

fn load(dir: &Path) -> MdlContext {
    let sources = read_project_dir(dir)
        .expect("read project dir")
        .expect("fixture is a wren project");
    MdlContext::try_from_sources(&sources).expect("fixture assembles into a valid manifest")
}

#[test]
fn keyed_relationships_are_loaded_not_silently_dropped() {
    let tmp = tempfile::tempdir().unwrap();
    v5_project(tmp.path());
    let ctx = load(tmp.path());

    let lineage = ctx.lineage();
    assert!(
        lineage.contains("rel:orders_customers"),
        "keyed `relationships:` form must load the relationship"
    );
    assert!(
        lineage
            .edges
            .iter()
            .any(|e| e.from == "model:orders" && e.to == "rel:orders_customers"),
        "relationship must produce lineage edges"
    );
}

#[test]
fn screaming_snake_case_join_type_is_accepted() {
    let tmp = tempfile::tempdir().unwrap();
    v5_project(tmp.path());
    // try_from_sources already fails on an invalid manifest; loading at all proves
    // MANY_TO_ONE deserialized into wren-core-base's JoinType.
    let ctx = load(tmp.path());
    assert!(ctx.is_parseable());
}

#[test]
fn cubes_directory_is_loaded_when_no_root_cubes_yml() {
    let tmp = tempfile::tempdir().unwrap();
    v5_project(tmp.path());
    let ctx = load(tmp.path());

    assert!(
        ctx.can_answer("metric_additive"),
        "the cube from cubes/<name>/metadata.yml makes additivity answerable"
    );
    assert_eq!(
        ctx.metric_additivity("total_value"),
        Some(Additivity::Additive)
    );
    assert_eq!(
        ctx.metric_additivity("avg_value"),
        Some(Additivity::NonAdditive)
    );
    assert!(ctx.lineage().contains("cube:order_metrics"));
}

#[test]
fn root_cubes_yml_wins_over_cubes_directory() {
    let tmp = tempfile::tempdir().unwrap();
    v5_project(tmp.path());
    // A root mirror that declares a *different* cube name: if both sources were merged,
    // the project would carry two cubes; precedence means only the root one loads.
    write(
        tmp.path(),
        "cubes.yml",
        r#"- name: root_metrics
  base_object: orders
  measures:
    - { name: root_total, expression: "SUM(total)", type: DOUBLE }
  dimensions: []
  time_dimensions: []
"#,
    );
    let ctx = load(tmp.path());

    assert!(ctx.lineage().contains("cube:root_metrics"));
    assert!(
        !ctx.lineage().contains("cube:order_metrics"),
        "cubes/ directory must be ignored when a root cubes.yml exists (no double-loading)"
    );
}

#[test]
fn bare_list_relationships_still_load() {
    let tmp = tempfile::tempdir().unwrap();
    v5_project(tmp.path());
    write(
        tmp.path(),
        "relationships.yml",
        r#"- name: orders_customers
  models: [orders, customers]
  join_type: many_to_one
  condition: "orders.customer_id = customers.id"
"#,
    );
    let ctx = load(tmp.path());
    assert!(ctx.lineage().contains("rel:orders_customers"));
}
