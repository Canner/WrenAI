//! `semantics:` in rule front-matter reaches the catalog, and a declaration the loader cannot read
//! in full is reported so a host can refuse to run.

use std::fs;
use std::path::Path;
use std::process::Command;

use wren_context_loader::{
    capability_catalog, catalog_document, read_knowledge_rules, read_project_dir,
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

fn project_with_rules(files: &[(&str, &str)]) -> tempfile::TempDir {
    let project = tempfile::tempdir().unwrap();
    copy_dir(&fixture("declared-wren"), project.path());
    let rules = project.path().join("knowledge/rules");
    for entry in fs::read_dir(&rules).unwrap() {
        fs::remove_file(entry.unwrap().path()).unwrap();
    }
    for (name, text) in files {
        fs::write(rules.join(name), text).unwrap();
    }
    project
}

const VALID: &str = "---\nsemantics:\n  - id: fiscal-calendar-bounds\n    models: [orders]\n    note: Quarter edges follow the fiscal calendar, which no check reads.\n  - id: legacy-platform-union\n    models: [orders, legacy_orders]\n    note: Legacy platform rows live in another table.\n---\n# Notes\n";

#[test]
fn entries_are_carried_in_declaration_order() {
    let project = project_with_rules(&[("a.md", VALID)]);
    let doc = catalog_json(project.path());
    assert_eq!(
        doc["semantics"],
        serde_json::json!([
            {
                "id": "fiscal-calendar-bounds",
                "models": ["orders"],
                "note": "Quarter edges follow the fiscal calendar, which no check reads."
            },
            {
                "id": "legacy-platform-union",
                "models": ["orders", "legacy_orders"],
                "note": "Legacy platform rows live in another table."
            }
        ])
    );
    assert!(doc.get("semantics_invalid").is_none());
    assert!(doc.get("diagnostics").is_none());
}

#[test]
fn entries_from_every_rule_file_are_gathered_in_file_order() {
    let second = "---\nsemantics:\n  - {id: dedup-scope, models: [orders], note: Dedup is per order line.}\n---\n";
    let project = project_with_rules(&[("a.md", VALID), ("b.md", second)]);
    let ids: Vec<String> = catalog_json(project.path())["semantics"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["id"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        ids,
        [
            "fiscal-calendar-bounds",
            "legacy-platform-union",
            "dedup-scope"
        ]
    );
}

#[test]
fn a_project_without_semantics_omits_both_keys() {
    let doc = catalog_json(&fixture("declared-wren"));
    assert!(doc.get("semantics").is_none());
    assert!(doc.get("semantics_invalid").is_none());
}

#[test]
fn any_malformed_entry_voids_the_list_and_flags_it() {
    let long = "n".repeat(401);
    let bad_entries = [
        "plain".to_string(),
        "{id: Upper, models: [orders], note: x}".to_string(),
        "{models: [orders], note: x}".to_string(),
        "{id: a, models: [], note: x}".to_string(),
        "{id: a, models: orders, note: x}".to_string(),
        "{id: a, models: [1], note: x}".to_string(),
        "{id: a, models: [orders]}".to_string(),
        "{id: a, models: [orders], note: \"\"}".to_string(),
        format!("{{id: a, models: [orders], note: {long}}}"),
        "{id: a, models: [orders], note: x, extra: 1}".to_string(),
        "{id: fiscal-calendar-bounds, models: [orders], note: repeated}".to_string(),
    ];
    for entry in bad_entries {
        let second = format!("---\nsemantics:\n  - {entry}\n---\n");
        let project = project_with_rules(&[("a.md", VALID), ("b.md", &second)]);
        let doc = catalog_json(project.path());
        assert!(doc.get("semantics").is_none(), "{entry}");
        assert_eq!(doc["semantics_invalid"], true, "{entry}");
        let diagnostics = doc["diagnostics"].as_array().unwrap();
        assert_eq!(diagnostics.len(), 1, "{entry}: {diagnostics:?}");
        assert_eq!(diagnostics[0]["kind"], "semantics_invalid", "{entry}");
        assert!(
            diagnostics[0]["path"].as_str().unwrap().ends_with("b.md"),
            "{entry}"
        );
    }
}

#[test]
fn a_value_that_is_not_a_list_is_invalid() {
    for text in [
        "---\nsemantics: nope\n---\n",
        "---\nsemantics: {id: a, models: [orders], note: x}\n---\n",
    ] {
        let project = project_with_rules(&[("a.md", text)]);
        let doc = catalog_json(project.path());
        assert_eq!(doc["semantics_invalid"], true, "{text}");
        assert!(doc.get("semantics").is_none(), "{text}");
    }
}

#[test]
fn unreadable_front_matter_that_starts_a_semantics_declaration_is_invalid() {
    for text in [
        "---\nsemantics: [unterminated\n---\n",
        "---\nsemantics:\n  - id: fiscal-calendar-bounds\n",
    ] {
        let project = project_with_rules(&[("a.md", text)]);
        let doc = catalog_json(project.path());
        assert!(doc.get("semantics").is_none(), "{text}");
        assert_eq!(doc["semantics_invalid"], true, "{text}");
        let diagnostics: Vec<_> = doc["diagnostics"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|d| d["kind"] == "semantics_invalid")
            .collect();
        assert_eq!(diagnostics.len(), 1, "{text}");
        assert!(!diagnostics[0].to_string().contains("fiscal-calendar"));
    }
}

#[test]
fn unreadable_front_matter_without_a_semantics_line_declares_nothing_here() {
    let project = project_with_rules(&[("a.md", "---\nowner: [unterminated\n---\n")]);
    let doc = catalog_json(project.path());
    assert!(doc.get("semantics").is_none());
    assert!(doc.get("semantics_invalid").is_none());
}

#[test]
fn the_binary_writes_semantics_into_the_catalog() {
    let project = project_with_rules(&[("a.md", VALID)]);
    let out = tempfile::tempdir().unwrap();
    let run = Command::new(env!("CARGO_BIN_EXE_wren-context-loader"))
        .arg(project.path())
        .arg("-o")
        .arg(out.path().join("context.json"))
        .arg("--catalog-out")
        .arg(out.path().join("catalog.json"))
        .output()
        .unwrap();
    assert!(run.status.success());
    let written: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(out.path().join("catalog.json")).unwrap())
            .unwrap();
    assert_eq!(written["semantics"][0]["id"], "fiscal-calendar-bounds");
    assert!(written.get("semantics_invalid").is_none());
}
