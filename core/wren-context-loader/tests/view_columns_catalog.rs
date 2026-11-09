//! A view's `columns:` declaration reaches the catalog as authored (name, type, description), is
//! absent when not declared, and a declaration the loader cannot read in full is reported so a
//! host can refuse to run. Types remain author assertions: the loader does not execute or infer
//! the view statement's output schema.

use std::fs;
use std::path::Path;

use wren_context_loader::{
    assemble, capability_catalog, catalog_document, read_knowledge_rules, read_project_dir,
};

fn fixture(name: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

fn catalog_json(dir: &Path) -> serde_json::Value {
    let sources = read_project_dir(dir).unwrap().expect("a wren project");
    let catalog = capability_catalog(&sources)
        .with_knowledge_rules(read_knowledge_rules(dir).expect("read rules"));
    serde_json::from_str(&catalog_document(&catalog).unwrap()).unwrap()
}

fn copy_dir(from: &Path, to: &Path) {
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            fs::create_dir_all(&target).unwrap();
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

/// A copy of the fixture whose `paid_orders` metadata is `metadata`.
fn project_with_view_metadata(metadata: &str) -> tempfile::TempDir {
    let project = tempfile::tempdir().unwrap();
    copy_dir(&fixture("view-columns-wren"), project.path());
    fs::write(
        project.path().join("views/paid_orders/metadata.yml"),
        metadata,
    )
    .unwrap();
    project
}

fn view<'a>(doc: &'a serde_json::Value, name: &str) -> &'a serde_json::Value {
    doc["views"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["name"] == name)
        .unwrap()
}

#[test]
fn a_declared_view_lists_name_type_and_description_only() {
    let doc = catalog_json(&fixture("view-columns-wren"));
    assert_eq!(
        view(&doc, "paid_orders")["columns"],
        serde_json::json!([
            {"name": "order_id", "type": "INTEGER", "description": "The order's id."},
            {"name": "amount", "type": "DECIMAL(12,2)"},
        ])
    );
    assert!(doc.get("view_columns_invalid").is_none());
    assert!(doc.get("diagnostics").is_none());
    assert_eq!(doc["catalog_version"], 1);
}

#[test]
fn a_declared_view_column_type_is_an_author_assertion() {
    let project = project_with_view_metadata(
        "name: paid_orders\ncolumns:\n  - {name: order_id, type: VARCHAR}\n",
    );
    let doc = catalog_json(project.path());

    assert_eq!(
        view(&doc, "paid_orders")["columns"],
        serde_json::json!([{ "name": "order_id", "type": "VARCHAR" }]),
        "the catalog preserves the declaration rather than inferring the SELECT expression type"
    );
    assert!(doc.get("view_columns_invalid").is_none());
}

#[test]
fn a_view_without_columns_serializes_without_the_key() {
    let doc = catalog_json(&fixture("view-columns-wren"));
    assert!(view(&doc, "plain_orders").get("columns").is_none());
    for name in ["jaffle-wren", "denied-wren", "declared-wren"] {
        let doc = catalog_json(&fixture(name));
        assert!(doc.get("view_columns_invalid").is_none(), "{name}");
        for v in doc["views"].as_array().unwrap() {
            assert!(v.get("columns").is_none(), "{name}");
        }
    }
}

#[test]
fn the_loader_still_assembles_a_project_whose_views_declare_columns() {
    let sources = read_project_dir(&fixture("view-columns-wren"))
        .unwrap()
        .expect("a wren project");
    assemble(&sources).expect("columns: is ignored by the manifest assembly");
}

#[test]
fn every_malformed_declaration_is_a_diagnostic_and_the_catalog_is_marked_invalid() {
    let cases = [
        ("columns: order_id", "columns must be a list"),
        ("columns: null", "columns must be a list"),
        ("columns:", "columns must be a list"),
        (
            "columns: [order_id]",
            "columns[0]: must be a mapping with name and type",
        ),
        (
            "columns:\n  - {type: INTEGER}",
            "columns[0]: name must be a string matching ^[a-z0-9_]+$",
        ),
        (
            "columns:\n  - {name: 7, type: INTEGER}",
            "columns[0]: name must be a string matching ^[a-z0-9_]+$",
        ),
        (
            "columns:\n  - {name: Order-Id, type: INTEGER}",
            "columns[0]: name \"Order-Id\" must match ^[a-z0-9_]+$",
        ),
        (
            "columns:\n  - {name: ok, type: INTEGER}\n  - {name: '', type: INTEGER}",
            "columns[1]: name \"\" must match ^[a-z0-9_]+$",
        ),
        (
            "columns:\n  - {name: order_id}",
            "columns[0]: type must be a non-empty string",
        ),
        (
            "columns:\n  - {name: order_id, type: '  '}",
            "columns[0]: type must be a non-empty string",
        ),
        (
            "columns:\n  - {name: order_id, type: INTEGER, description: 5}",
            "columns[0]: description must be a string",
        ),
        (
            "columns:\n  - {name: order_id, type: INTEGER}\n  - {name: order_id, type: TEXT}",
            "columns[1]: duplicate column name \"order_id\"",
        ),
    ];
    for (body, expected) in cases {
        let project = project_with_view_metadata(&format!(
            "name: paid_orders\nproperties:\n  description: Orders that were paid.\n{body}\n"
        ));
        let doc = catalog_json(project.path());
        assert_eq!(doc["view_columns_invalid"], true, "{body}");
        assert_eq!(
            doc["diagnostics"],
            serde_json::json!([{
                "kind": "view_columns_invalid",
                "path": "views/paid_orders/metadata.yml",
                "entry": expected,
            }]),
            "{body}"
        );
        for v in doc["views"].as_array().unwrap() {
            assert!(v.get("columns").is_none(), "all or nothing: {body}");
        }
    }
}

#[test]
fn a_description_over_400_characters_is_invalid_and_exactly_400_is_not() {
    for (length, invalid) in [(400, false), (401, true)] {
        let text = "a".repeat(length);
        let project = project_with_view_metadata(&format!(
            "name: paid_orders\ncolumns:\n  - {{name: order_id, type: INTEGER, description: {text}}}\n"
        ));
        let doc = catalog_json(project.path());
        assert_eq!(
            doc.get("view_columns_invalid").is_some(),
            invalid,
            "{length}"
        );
        if invalid {
            let entry = doc["diagnostics"][0]["entry"].as_str().unwrap();
            assert_eq!(
                entry,
                "columns[0]: description is longer than 400 characters"
            );
            assert!(!entry.contains(&text));
        }
    }
}

#[test]
fn one_bad_view_clears_the_columns_of_every_view() {
    let project = project_with_view_metadata(
        "name: paid_orders\ncolumns:\n  - {name: order_id, type: INTEGER}\n",
    );
    let other = project.path().join("views/plain_orders/metadata.yml");
    fs::write(&other, "name: plain_orders\ncolumns: nope\n").unwrap();
    let doc = catalog_json(project.path());
    assert_eq!(doc["view_columns_invalid"], true);
    assert_eq!(
        doc["diagnostics"][0]["path"],
        "views/plain_orders/metadata.yml"
    );
    assert!(view(&doc, "paid_orders").get("columns").is_none());
}
