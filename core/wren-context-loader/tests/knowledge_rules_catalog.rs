//! The capability catalog carries a project's business rules; the prepared document does not.
//!
//! Warble owns the prepared-context wire format and rejects unknown top-level fields, so rules
//! travel in the loader-owned catalog and the prepared document must stay byte-identical whether or
//! not a project has rules.

use std::fs;
use std::path::Path;

use wren_context_loader::{
    capability_catalog, catalog_document, prepared_document, project_digest, read_knowledge_rules,
    read_project_dir, MdlContext,
};

fn fixture(name: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

/// The catalog document for a project directory, as the binary's `--catalog-out` writes it.
fn catalog_json(dir: &Path) -> serde_json::Value {
    let sources = read_project_dir(dir).unwrap().expect("a wren project");
    let catalog = capability_catalog(&sources)
        .with_knowledge_rules(read_knowledge_rules(dir).expect("read rules"))
        .with_digest(project_digest(dir).expect("digest"));
    serde_json::from_str(&catalog_document(&catalog).unwrap()).unwrap()
}

fn prepared(dir: &Path) -> String {
    let sources = read_project_dir(dir).unwrap().expect("a wren project");
    prepared_document(&MdlContext::try_from_sources(&sources).unwrap()).unwrap()
}

#[test]
fn rule_files_are_carried_whole_in_path_order() {
    let project = fixture("rules-wren");
    let doc = catalog_json(&project);
    let rules = doc["knowledge_rules"].as_array().unwrap();
    assert_eq!(
        rules
            .iter()
            .map(|rule| rule["path"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["knowledge/rules/a-revenue.md", "knowledge/rules/b-money.md"]
    );
    for rule in rules {
        let content = rule["content"].as_str().unwrap();
        let path = rule["path"].as_str().unwrap();
        let source = fs::read_to_string(project.join(path)).unwrap();
        assert_eq!(
            content.as_bytes(),
            source.trim().as_bytes(),
            "{path} must keep its trimmed source bytes verbatim"
        );
    }
    assert!(doc.get("knowledge_rules_used_legacy").is_none());
    assert_eq!(doc["catalog_version"], 1);
}

#[test]
fn confirmed_sql_memory_never_reaches_the_catalog() {
    let dir = fixture("rules-wren");
    assert!(dir.join("knowledge/sql/total-revenue.md").is_file());
    let text = serde_json::to_string(&catalog_json(&dir)).unwrap();
    for forbidden in ["secret_marker_amount", "total-revenue", "knowledge/sql"] {
        assert!(!text.contains(forbidden), "catalog carries {forbidden}");
    }
}

#[test]
fn a_legacy_instructions_file_follows_the_current_rules_and_is_flagged() {
    let project = tempfile::tempdir().unwrap();
    copy_dir(&fixture("rules-wren"), project.path());
    fs::write(
        project.path().join("instructions.md"),
        "\n# Legacy\n\nOld rule.\n",
    )
    .unwrap();

    let doc = catalog_json(project.path());
    let paths: Vec<&str> = doc["knowledge_rules"]
        .as_array()
        .unwrap()
        .iter()
        .map(|file| file["path"].as_str().unwrap())
        .collect();
    assert_eq!(
        paths,
        [
            "knowledge/rules/a-revenue.md",
            "knowledge/rules/b-money.md",
            "instructions.md"
        ]
    );
    assert_eq!(
        doc["knowledge_rules"][2]["content"],
        "# Legacy\n\nOld rule."
    );
    assert_eq!(doc["knowledge_rules_used_legacy"], true);
}

#[test]
fn a_legacy_file_alone_still_yields_rules() {
    let project = tempfile::tempdir().unwrap();
    copy_dir(&fixture("rules-wren"), project.path());
    fs::remove_dir_all(project.path().join("knowledge/rules")).unwrap();
    fs::write(project.path().join("instructions.md"), "# Legacy\n").unwrap();

    let doc = catalog_json(project.path());
    assert_eq!(
        doc["knowledge_rules"],
        serde_json::json!([{ "path": "instructions.md", "content": "# Legacy" }])
    );
    assert_eq!(doc["knowledge_rules_used_legacy"], true);
}

#[test]
fn a_project_without_rules_omits_both_fields() {
    let project = tempfile::tempdir().unwrap();
    copy_dir(&fixture("rules-wren"), project.path());
    fs::remove_dir_all(project.path().join("knowledge")).unwrap();

    let doc = catalog_json(project.path());
    assert!(doc.get("knowledge_rules").is_none());
    assert!(doc.get("knowledge_rules_used_legacy").is_none());
}

#[test]
fn rules_do_not_change_the_prepared_document() {
    let with_rules = prepared(&fixture("rules-wren"));

    let project = tempfile::tempdir().unwrap();
    copy_dir(&fixture("rules-wren"), project.path());
    fs::remove_dir_all(project.path().join("knowledge/rules")).unwrap();
    fs::write(project.path().join("instructions.md"), "# Legacy\n").unwrap();
    let with_legacy = prepared(project.path());
    fs::remove_file(project.path().join("instructions.md")).unwrap();
    let without_rules = prepared(project.path());

    assert_eq!(with_rules, without_rules);
    assert_eq!(with_legacy, without_rules);
    assert!(!with_rules.contains("knowledge_rules"));
}

#[test]
fn the_binary_writes_the_same_catalog_document() {
    let out = tempfile::tempdir().unwrap();
    let catalog_path = out.path().join("catalog.json");
    let status = std::process::Command::new(env!("CARGO_BIN_EXE_wren-context-loader"))
        .arg(fixture("rules-wren"))
        .arg("-o")
        .arg(out.path().join("context.json"))
        .arg("--catalog-out")
        .arg(&catalog_path)
        .status()
        .unwrap();
    assert!(status.success());
    let written: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(catalog_path).unwrap()).unwrap();
    assert_eq!(written, catalog_json(&fixture("rules-wren")));
    let context = fs::read_to_string(out.path().join("context.json")).unwrap();
    assert_eq!(context, prepared(&fixture("rules-wren")));
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
