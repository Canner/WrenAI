//! `denied_columns` in rule front-matter reaches the catalog, validated against the project's
//! models, and a declaration the loader cannot honour is reported so a host can refuse to run.

use std::fs;
use std::path::Path;
use std::process::Command;

use wren_context_loader::{
    capability_catalog, catalog_document, prepared_document, read_knowledge_rules,
    read_project_dir, MdlContext,
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

/// A copy of the fixture whose only rule file is `rule`.
fn project_with_rule(rule: &str) -> tempfile::TempDir {
    let project = tempfile::tempdir().unwrap();
    copy_dir(&fixture("denied-wren"), project.path());
    let rules = project.path().join("knowledge/rules");
    fs::remove_file(rules.join("b-money.md")).unwrap();
    fs::write(rules.join("a-pii.md"), rule).unwrap();
    project
}

#[test]
fn entries_from_every_rule_file_are_merged_deduplicated_and_sorted() {
    let doc = catalog_json(&fixture("denied-wren"));
    assert_eq!(
        doc["denied_columns"],
        serde_json::json!(["customers.email", "orders.amount"])
    );
    assert!(doc.get("denied_columns_invalid").is_none());
    assert!(doc.get("diagnostics").is_none());
}

#[test]
fn the_front_matter_stays_in_the_rule_content() {
    let project = fixture("denied-wren");
    let doc = catalog_json(&project);
    let rules = doc["knowledge_rules"].as_array().unwrap();
    let content = rules[0]["content"].as_str().unwrap();
    let path = rules[0]["path"].as_str().unwrap();
    let source = fs::read_to_string(project.join(path)).unwrap();
    assert_eq!(
        content.as_bytes(),
        source.trim().as_bytes(),
        "{path} must keep its trimmed source bytes verbatim"
    );
}

#[test]
fn a_project_without_the_key_omits_both_fields() {
    for name in ["jaffle-wren", "rules-wren", "declared-wren"] {
        let doc = catalog_json(&fixture(name));
        assert!(doc.get("denied_columns").is_none(), "{name}");
        assert!(doc.get("denied_columns_invalid").is_none(), "{name}");
    }
}

#[test]
fn a_bad_entry_is_a_structured_diagnostic_and_the_catalog_is_marked_invalid() {
    let project = project_with_rule(
        "---\ndenied_columns:\n  - customers.email\n  - customers.nope\n  - nobody.email\n  - Customers.Email\n  - customers\n  - 7\n---\nbody\n",
    );
    let doc = catalog_json(project.path());
    assert_eq!(doc["denied_columns_invalid"], true);
    assert_eq!(
        doc["denied_columns"],
        serde_json::json!(["customers.email"])
    );
    let entries: Vec<(&str, &str, &str)> = doc["diagnostics"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| {
            (
                d["kind"].as_str().unwrap(),
                d["path"].as_str().unwrap(),
                d["entry"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        entries,
        vec![
            (
                "denied_columns_invalid",
                "knowledge/rules/a-pii.md",
                "customers.nope"
            ),
            (
                "denied_columns_invalid",
                "knowledge/rules/a-pii.md",
                "nobody.email"
            ),
            (
                "denied_columns_invalid",
                "knowledge/rules/a-pii.md",
                "Customers.Email"
            ),
            (
                "denied_columns_invalid",
                "knowledge/rules/a-pii.md",
                "customers"
            ),
            ("denied_columns_invalid", "knowledge/rules/a-pii.md", "7"),
        ]
    );
}

#[test]
fn a_value_that_is_not_a_list_of_names_is_invalid() {
    for body in [
        "denied_columns: customers.nope",
        "denied_columns:",
        "denied_columns: {customers: email}",
    ] {
        let project = project_with_rule(&format!("---\n{body}\n---\nbody\n"));
        let doc = catalog_json(project.path());
        assert_eq!(doc["denied_columns_invalid"], true, "{body}");
        assert!(doc.get("denied_columns").is_none(), "{body}");
    }
    let project = project_with_rule("---\ndenied_columns: []\n---\nbody\n");
    let doc = catalog_json(project.path());
    assert!(doc.get("denied_columns_invalid").is_none());
}

#[test]
fn unreadable_front_matter_that_mentions_the_key_fails_closed() {
    for text in [
        "---\ndenied_columns: [customers.email]\n# never closed\n",
        "---\nDenied-Columns: [customers.email]\n# never closed\n",
        "---\ndenied_columns: [customers.email\n---\nbody\n",
        "---\nDenied-Columns: [customers.email\n---\nbody\n",
        "---\nDENIED_COLUMNS: [customers.email\n---\nbody\n",
    ] {
        let project = project_with_rule(text);
        let doc = catalog_json(project.path());
        assert_eq!(doc["denied_columns_invalid"], true, "{text}");
        assert_eq!(
            doc["diagnostics"][0]["entry"], "front-matter is unreadable",
            "{text}"
        );
    }
    // The same breakage in a file that never mentions the key loses nothing.
    let project = project_with_rule("---\ndefaults: [oops\n---\nbody\n");
    assert!(catalog_json(project.path())
        .get("denied_columns_invalid")
        .is_none());
}

#[test]
fn a_scalar_value_is_read_as_a_one_entry_list() {
    let project = project_with_rule("---\ndenied_columns: customers.email\n---\nbody\n");
    let doc = catalog_json(project.path());
    assert_eq!(
        doc["denied_columns"],
        serde_json::json!(["customers.email"])
    );
    assert!(doc.get("denied_columns_invalid").is_none());
}

#[test]
fn a_near_miss_key_is_an_invalid_declaration_not_a_silent_no_op() {
    for key in [
        "Denied_Columns",
        "denied-columns",
        "denied_column",
        "DENIED-COLUMN",
        "deniedcolumns",
    ] {
        let project = project_with_rule(&format!("---\n{key}: [customers.email]\n---\nbody\n"));
        let doc = catalog_json(project.path());
        assert_eq!(doc["denied_columns_invalid"], true, "{key}");
        assert!(doc.get("denied_columns").is_none(), "{key}");
        assert_eq!(
            doc["diagnostics"][0]["entry"],
            format!("near-miss key: {key}"),
            "{key}"
        );
    }
    // Keys that merely resemble it are not near misses.
    let project = project_with_rule(
        "---\ndenied_columns_note: x\nundenied_columns: x\ndenied: x\n---\nbody\n",
    );
    assert!(catalog_json(project.path())
        .get("denied_columns_invalid")
        .is_none());
}

#[test]
fn a_rule_file_without_front_matter_that_mentions_the_key_fails_closed() {
    for text in [
        "# Notes\n\n---\ndenied_columns: [customers.email]\n---\n",
        "denied_columns: [customers.email]\n",
        "Remember to list customers.email under denied_columns.\n",
        "Remember to list customers.email under Denied-Columns.\n",
    ] {
        let project = project_with_rule(text);
        let doc = catalog_json(project.path());
        assert_eq!(doc["denied_columns_invalid"], true, "{text}");
        assert!(doc.get("denied_columns").is_none(), "{text}");
        assert_eq!(
            doc["diagnostics"][0]["entry"], "front-matter is missing",
            "{text}"
        );
    }
    // Without the key, a file with no front-matter is just prose.
    let project = project_with_rule("# Notes\n\nNothing declared here.\n");
    assert!(catalog_json(project.path())
        .get("denied_columns_invalid")
        .is_none());
}

#[test]
fn a_mention_without_a_top_level_key_fails_closed() {
    for (placement, text) in [
        (
            "merge key",
            "---\nbase: &b {denied_columns: [customers.email]}\n<<: *b\n---\nbody\n",
        ),
        (
            "nested under another key",
            "---\nconfig:\n  denied_columns: [customers.email]\n---\nbody\n",
        ),
        (
            "inside a top-level sequence",
            "---\n- denied_columns: [customers.email]\n---\nbody\n",
        ),
        (
            "comment only",
            "---\n# denied_columns: [customers.email]\ntitle: Conventions\n---\nbody\n",
        ),
        (
            "a typo beyond the near-miss spelling",
            "---\ndenied_colums: [customers.email]\n---\nList them under denied_columns.\n",
        ),
        (
            "empty front-matter",
            "---\n---\nPut customers.email under denied_columns.\n",
        ),
    ] {
        let project = project_with_rule(text);
        let doc = catalog_json(project.path());
        assert_eq!(doc["denied_columns_invalid"], true, "{placement}");
        assert!(doc.get("denied_columns").is_none(), "{placement}");
        assert_eq!(
            doc["diagnostics"][0]["entry"],
            "denied_columns mentioned but not declared at top level",
            "{placement}"
        );
        assert_eq!(
            doc["diagnostics"][0]["path"], "knowledge/rules/a-pii.md",
            "{placement}"
        );
    }
    // A declaration at the top level is still read, wherever else the word appears.
    let project = project_with_rule(
        "---\ndenied_columns: [customers.email]\nnote:\n  denied_columns: [orders.amount]\n---\nThe denied_columns key.\n",
    );
    let doc = catalog_json(project.path());
    assert!(doc.get("denied_columns_invalid").is_none());
    assert_eq!(
        doc["denied_columns"],
        serde_json::json!(["customers.email"])
    );
    // No mention, no diagnostic: front-matter without the key is not a declaration.
    let project = project_with_rule("---\ntitle: Conventions\n---\nbody\n");
    assert!(catalog_json(project.path())
        .get("denied_columns_invalid")
        .is_none());
}

#[test]
fn a_denylist_is_independent_of_declared_default_ids() {
    let project = project_with_rule(
        "---\ndenied_columns: [customers.email]\ndefaults:\n  - {id: Bad Id, kind: exclude_rows}\n---\nbody\n",
    );
    let doc = catalog_json(project.path());
    assert!(doc.get("declared_defaults").is_none());
    assert_eq!(
        doc["denied_columns"],
        serde_json::json!(["customers.email"])
    );
    assert!(doc.get("denied_columns_invalid").is_none());
}

#[test]
fn view_guarantees_are_carried_as_authored() {
    let doc = catalog_json(&fixture("denied-wren"));
    assert_eq!(
        doc["views"][0]["guarantees"],
        serde_json::json!(["exclude-test-accounts", "usd-at-transaction-date"])
    );
    let doc = catalog_json(&fixture("jaffle-wren"));
    for view in doc["views"].as_array().unwrap() {
        assert!(view.get("guarantees").is_none());
    }
}

#[test]
fn non_string_view_guarantees_are_diagnosed_without_dropping_valid_ids() {
    let project = tempfile::tempdir().unwrap();
    copy_dir(&fixture("denied-wren"), project.path());
    fs::write(
        project.path().join("views/revenue/metadata.yml"),
        "name: revenue\nguarantees: [exclude-test-accounts, 2024, true]\n",
    )
    .unwrap();

    let doc = catalog_json(project.path());
    assert_eq!(
        doc["views"][0]["guarantees"],
        serde_json::json!(["exclude-test-accounts"])
    );
    let diagnostics = doc["diagnostics"].as_array().unwrap();
    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic
            .as_str()
            .is_some_and(|message| message.contains("views/revenue/metadata.yml: guarantees[1]"))
    }));
    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic
            .as_str()
            .is_some_and(|message| message.contains("views/revenue/metadata.yml: guarantees[2]"))
    }));
}

#[test]
fn the_prepared_document_does_not_change_with_the_denylist() {
    let with = fixture("denied-wren");
    let without = project_with_rule("# Personal data\n");
    let render = |dir: &Path| {
        let sources = read_project_dir(dir).unwrap().unwrap();
        prepared_document(&MdlContext::try_from_sources(&sources).unwrap()).unwrap()
    };
    assert_eq!(render(&with), render(without.path()));
}

#[test]
fn the_binary_exits_zero_and_writes_the_invalid_flag() {
    let project = project_with_rule("---\ndenied_columns: [customers.nope]\n---\nbody\n");
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
    assert_eq!(written["denied_columns_invalid"], true);
    assert_eq!(written["diagnostics"][0]["entry"], "customers.nope");
}

#[test]
fn a_nested_near_miss_key_is_an_invalid_declaration_not_a_silent_no_op() {
    for (key, text) in [
        (
            "Denied-Columns",
            "---\npolicy:\n  Denied-Columns: [customers.email]\n---\nbody\n",
        ),
        (
            "Denied_Column",
            "---\npolicy:\n  - Denied_Column: customers.email\n---\nbody\n",
        ),
        (
            "deniedcolumns",
            "---\na:\n  b:\n    deniedcolumns: [customers.email]\n---\nbody\n",
        ),
        (
            "DENIED-COLUMN",
            "---\n- DENIED-COLUMN: [customers.email]\n---\nbody\n",
        ),
    ] {
        let project = project_with_rule(text);
        let doc = catalog_json(project.path());
        assert_eq!(doc["denied_columns_invalid"], true, "{key}");
        assert!(doc.get("denied_columns").is_none(), "{key}");
        assert_eq!(
            doc["diagnostics"][0]["entry"],
            format!("near-miss key: {key}"),
            "{key}"
        );
    }
    // Nested keys that are not near misses stay metadata.
    let project = project_with_rule(
        "---\npolicy:\n  owner: data-team\n  denied_columns_note: x\n  items:\n    - denied: x\n---\nbody\n",
    );
    assert!(catalog_json(project.path())
        .get("denied_columns_invalid")
        .is_none());
}
