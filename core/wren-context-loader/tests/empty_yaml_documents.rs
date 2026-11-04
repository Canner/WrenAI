//! A project that wren reads (`yaml.safe_load(...) or {}`) must not be reported unparseable by
//! this loader. These pin the empty/null spellings of each project document, and that a genuinely
//! malformed `relationships.yml` still fails with its reason.

use std::fs;
use std::path::Path;

use wren_context_loader::{assemble, capability_catalog, read_project_dir, ProjectSources};

fn write(dir: &Path, rel: &str, contents: &str) {
    let path = dir.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, contents).unwrap();
}

fn sources_with(relationships: Option<&str>, extra: &[(&str, &str)]) -> ProjectSources {
    let dir = tempfile::tempdir().unwrap();
    write(
        dir.path(),
        "wren_project.yml",
        "schema_version: 5\nname: p\ncatalog: wren\nschema: public\ndata_source: duckdb\n",
    );
    write(
        dir.path(),
        "models/orders/metadata.yml",
        "name: orders\ntable_reference: { catalog: c, schema: s, table: orders }\nprimary_key: id\ncolumns:\n  - { name: id, type: INTEGER }\n",
    );
    if let Some(r) = relationships {
        write(dir.path(), "relationships.yml", r);
    }
    for (rel, contents) in extra {
        write(dir.path(), rel, contents);
    }
    read_project_dir(dir.path()).unwrap().unwrap()
}

fn relationship_count(sources: &ProjectSources) -> usize {
    let loaded = assemble(sources).expect("assemble");
    let from_manifest = loaded.manifest.relationships.len();
    let catalog = capability_catalog(sources);
    assert!(
        catalog.diagnostics.is_empty(),
        "catalog diagnostics: {:?}",
        catalog.diagnostics
    );
    assert_eq!(from_manifest, catalog.relationships.len());
    from_manifest
}

#[test]
fn bare_relationships_key_is_no_relationships() {
    assert_eq!(
        relationship_count(&sources_with(Some("relationships:\n"), &[])),
        0
    );
    assert_eq!(
        relationship_count(&sources_with(Some("relationships:"), &[])),
        0
    );
}

#[test]
fn empty_list_spellings_are_no_relationships() {
    for yml in ["relationships: []\n", "[]\n", "", "# nothing yet\n", "{}\n"] {
        assert_eq!(
            relationship_count(&sources_with(Some(yml), &[])),
            0,
            "{yml:?}"
        );
    }
}

#[test]
fn keyed_and_bare_lists_still_load() {
    let item = "  - name: r\n    models: [orders, orders]\n    join_type: MANY_TO_ONE\n    condition: \"orders.id = orders.id\"\n";
    assert_eq!(
        relationship_count(&sources_with(Some(&format!("relationships:\n{item}")), &[])),
        1
    );
    assert_eq!(
        relationship_count(&sources_with(
            Some(&item.replacen("  - ", "- ", 1).replace("\n    ", "\n  ")),
            &[]
        )),
        1
    );
}

#[test]
fn malformed_relationships_still_fail_with_a_reason() {
    for yml in [
        "relationships: 5\n",
        "relationships:\n  - just a string\n",
        "- 1\n- 2\n",
        "42\n",
        "relationship: []\n",
    ] {
        let sources = sources_with(Some(yml), &[]);
        let err = assemble(&sources)
            .err()
            .unwrap_or_else(|| panic!("{yml:?} must fail"));
        assert!(err.to_string().starts_with("relationships.yml: "), "{err}");
        let catalog = capability_catalog(&sources);
        assert!(
            catalog
                .diagnostics
                .iter()
                .any(|d| d.to_string().starts_with("relationships.yml: ")),
            "{yml:?}: {:?}",
            catalog.diagnostics
        );
    }
}

#[test]
fn empty_root_cubes_and_dashboards_yml_are_accepted() {
    for yml in ["", "# none\n"] {
        let sources = sources_with(None, &[("cubes.yml", yml), ("dashboards.yml", yml)]);
        assert!(assemble(&sources).is_ok(), "{yml:?}");
    }
}

#[test]
fn empty_cube_metadata_is_skipped_like_wren_does() {
    let sources = sources_with(None, &[("cubes/empty/metadata.yml", "# draft\n")]);
    assert!(assemble(&sources).is_ok());
    let catalog = capability_catalog(&sources);
    assert!(catalog.diagnostics.is_empty(), "{:?}", catalog.diagnostics);
    assert!(catalog.cubes.is_empty());
}

#[test]
fn empty_wren_project_yml_is_parseable() {
    let mut sources = sources_with(None, &[]);
    sources.wren_project_yml = "# placeholder\n".to_string();
    assert!(assemble(&sources).is_ok());
    assert!(capability_catalog(&sources).diagnostics.is_empty());
}

const DIRECTORY_CUBE: &str = "name: dir_cube\nbase_object: orders\nmeasures:\n  - { name: n, expression: \"COUNT(*)\", type: BIGINT }\ndimensions: []\ntime_dimensions: []\n";
const ROOT_CUBE: &str = "- name: root_cube\n  base_object: orders\n  measures: []\n  dimensions: []\n  time_dimensions: []\n";

fn cube_names(sources: &ProjectSources) -> (Vec<String>, Vec<String>) {
    let loaded = assemble(sources).expect("assemble");
    let manifest: Vec<String> = loaded
        .manifest
        .cubes
        .iter()
        .map(|c| c.name.clone())
        .collect();
    let catalog = capability_catalog(sources);
    assert!(catalog.diagnostics.is_empty(), "{:?}", catalog.diagnostics);
    (
        manifest,
        catalog.cubes.iter().map(|c| c.name.clone()).collect(),
    )
}

#[test]
fn per_cube_metadata_is_read_when_the_root_cubes_yml_has_no_entries() {
    for root in ["", "# none\n", "[]\n"] {
        let sources = sources_with(
            None,
            &[
                ("cubes.yml", root),
                ("cubes/dir_cube/metadata.yml", DIRECTORY_CUBE),
            ],
        );
        let expected = vec!["dir_cube".to_string()];
        assert_eq!(
            cube_names(&sources),
            (expected.clone(), expected),
            "root cubes.yml {root:?}"
        );
    }
}

#[test]
fn pure_project_sources_root_entries_win_over_per_cube_metadata_and_are_never_merged() {
    let mut sources = sources_with(None, &[]);
    sources.cubes_yml = Some(ROOT_CUBE.to_string());
    sources.cube_ymls = vec![DIRECTORY_CUBE.to_string()];
    let expected = vec!["root_cube".to_string()];
    assert_eq!(cube_names(&sources), (expected.clone(), expected));
}
