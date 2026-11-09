//! The capability catalog names the project's declared default rules; the prepared document does not.
//!
//! The ids are read from the front-matter of `knowledge/rules/*.md`, which stays in the rule text
//! verbatim. Only the `wren` CLI validates declarations, so these tests cover id extraction, order,
//! omission, and the byte-identity of the prepared document.

use std::fs;
use std::path::Path;
use std::process::Command;

use wren_context_loader::{
    capability_catalog, capture_project, catalog_document, declared_default_ids, prepared_document,
    project_digest, read_knowledge_rules, read_project_dir, KnowledgeRuleFile, MdlContext,
};

fn fixture(name: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

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

fn rule_file(path: &str, content: &str) -> KnowledgeRuleFile {
    KnowledgeRuleFile {
        path: path.to_string(),
        content: content.to_string(),
    }
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

/// The project with the front-matter blocks cut off every rule file.
fn without_front_matter(dir: &Path) {
    let rules = dir.join("knowledge/rules");
    for entry in fs::read_dir(&rules).unwrap() {
        let path = entry.unwrap().path();
        let text = fs::read_to_string(&path).unwrap();
        let body = front_matter_body(&text);
        fs::write(path, body).unwrap();
    }
}

/// Returns the text after the leading fenced block without changing its line endings.
fn front_matter_body(text: &str) -> &str {
    let fence = if text.starts_with("---\r\n") {
        "---\r\n"
    } else {
        "---\n"
    };
    text.splitn(3, fence).nth(2).expect("a fenced block")
}

fn rewrite_rule_line_endings(dir: &Path, line_ending: &str) {
    let rules = dir.join("knowledge/rules");
    for entry in fs::read_dir(rules).unwrap() {
        let path = entry.unwrap().path();
        let text = fs::read_to_string(&path).unwrap();
        fs::write(path, text.replace("\r\n", "\n").replace('\n', line_ending)).unwrap();
    }
}

fn run_loader(dir: &Path, out: &Path) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_wren-context-loader"))
        .arg(dir)
        .arg("-o")
        .arg(out.join("context.json"))
        .arg("--catalog-out")
        .arg(out.join("catalog.json"))
        .output()
        .unwrap()
}

#[test]
fn declared_ids_follow_file_order_then_declaration_order() {
    let doc = catalog_json(&fixture("declared-wren"));
    assert_eq!(
        doc["declared_defaults"],
        serde_json::json!(["usd-at-transaction-date", "exclude-test-accounts"])
    );
    assert_eq!(doc["catalog_version"], 1);
}

#[test]
fn the_front_matter_stays_verbatim_in_the_rule_content() {
    let project = fixture("declared-wren");
    let doc = catalog_json(&project);
    let rules = doc["knowledge_rules"].as_array().unwrap();
    assert_eq!(rules.len(), 2);
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
    assert!(rules[1]["content"]
        .as_str()
        .unwrap()
        .contains("- id: exclude-test-accounts"));
}

#[test]
fn prepared_document_strips_crlf_front_matter_without_changing_rule_body_bytes() {
    let declared = tempfile::tempdir().unwrap();
    copy_dir(&fixture("declared-wren"), declared.path());
    rewrite_rule_line_endings(declared.path(), "\r\n");

    let stripped = tempfile::tempdir().unwrap();
    copy_dir(declared.path(), stripped.path());
    without_front_matter(stripped.path());

    assert_eq!(prepared(declared.path()), prepared(stripped.path()));

    let out_declared = tempfile::tempdir().unwrap();
    let out_stripped = tempfile::tempdir().unwrap();
    assert!(run_loader(declared.path(), out_declared.path())
        .status
        .success());
    assert!(run_loader(stripped.path(), out_stripped.path())
        .status
        .success());
    assert_eq!(
        fs::read(out_declared.path().join("context.json")).unwrap(),
        fs::read(out_stripped.path().join("context.json")).unwrap()
    );
}

#[test]
fn a_project_without_declarations_omits_the_key() {
    let doc = catalog_json(&fixture("jaffle-wren"));
    assert!(doc.get("declared_defaults").is_none());

    let doc = catalog_json(&fixture("rules-wren"));
    assert!(doc.get("knowledge_rules").is_some());
    assert!(doc.get("declared_defaults").is_none());
}

#[test]
fn the_prepared_document_is_byte_identical_with_the_front_matter_stripped() {
    let declared = fixture("declared-wren");
    let project = tempfile::tempdir().unwrap();
    copy_dir(&declared, project.path());
    without_front_matter(project.path());
    assert!(catalog_json(project.path())
        .get("declared_defaults")
        .is_none());
    assert_eq!(prepared(&declared), prepared(project.path()));

    let out_declared = tempfile::tempdir().unwrap();
    let out_stripped = tempfile::tempdir().unwrap();
    assert!(run_loader(&declared, out_declared.path()).status.success());
    assert!(run_loader(project.path(), out_stripped.path())
        .status
        .success());
    assert_eq!(
        fs::read(out_declared.path().join("context.json")).unwrap(),
        fs::read(out_stripped.path().join("context.json")).unwrap()
    );
    assert!(
        !fs::read_to_string(out_declared.path().join("context.json"))
            .unwrap()
            .contains("declared_defaults")
    );
}

#[test]
fn the_binary_writes_declared_ids_into_the_catalog() {
    let out = tempfile::tempdir().unwrap();
    let run = run_loader(&fixture("declared-wren"), out.path());
    assert!(run.status.success());
    assert!(
        run.stderr.is_empty(),
        "{}",
        String::from_utf8_lossy(&run.stderr)
    );
    let written: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(out.path().join("catalog.json")).unwrap())
            .unwrap();
    assert_eq!(written, catalog_json(&fixture("declared-wren")));
}

#[test]
fn an_unclosed_fence_voids_every_id_and_warns_on_stderr() {
    let project = tempfile::tempdir().unwrap();
    copy_dir(&fixture("declared-wren"), project.path());
    fs::write(
        project.path().join("knowledge/rules/conventions.md"),
        "---\ndefaults:\n  - id: exclude-test-accounts\n    kind: exclude_rows\n# no closing fence\n",
    )
    .unwrap();

    let out = tempfile::tempdir().unwrap();
    let run = run_loader(project.path(), out.path());
    assert!(run.status.success());
    let stderr = String::from_utf8_lossy(&run.stderr);
    assert!(
        stderr.contains("conventions.md") && stderr.contains("not closed"),
        "{stderr}"
    );
    assert!(catalog_json(project.path())
        .get("declared_defaults")
        .is_none());
    let written: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(out.path().join("catalog.json")).unwrap())
            .unwrap();
    assert!(written.get("declared_defaults").is_none());
}

#[test]
fn a_legacy_instructions_file_is_read_last() {
    let project = tempfile::tempdir().unwrap();
    copy_dir(&fixture("declared-wren"), project.path());
    fs::write(
        project.path().join("instructions.md"),
        "---\ndefaults:\n  - {id: legacy-rule, kind: exclude_rows}\n---\nOld rule.\n",
    )
    .unwrap();
    assert_eq!(
        catalog_json(project.path())["declared_defaults"],
        serde_json::json!([
            "usd-at-transaction-date",
            "exclude-test-accounts",
            "legacy-rule"
        ])
    );
}

#[test]
fn only_a_leading_fence_declares() {
    let (ids, warnings) = declared_default_ids(&[
        rule_file(
            "knowledge/rules/a.md",
            "# Title\n\n---\ndefaults:\n  - {id: not-leading, kind: exclude_rows}\n---\n",
        ),
        rule_file("knowledge/rules/b.md", "---\nnotes: none\n---\nBody\n"),
        rule_file(
            "knowledge/rules/c.md",
            "\u{feff}\n---\r\ndefaults:\r\n  - {id: crlf-and-bom, kind: require_rate_join}\r\n---\r\nBody\r\n",
        ),
    ]);
    assert_eq!(ids, ["crlf-and-bom"]);
    assert!(warnings.is_empty(), "{warnings:?}");
}

#[test]
fn any_malformed_entry_voids_the_whole_set() {
    let valid = "---\ndefaults:\n  - {id: ok, kind: exclude_rows}\n---\n";
    let long = "a".repeat(65);
    let bad_entries = [
        "{id: Upper, kind: exclude_rows}".to_string(),
        format!("{{id: {long}, kind: exclude_rows}}"),
        "{id: ok, kind: exclude_rows}".to_string(),
        "{id: odd-kind, kind: other}".to_string(),
        "{kind: exclude_rows}".to_string(),
        "plain".to_string(),
        "{id: 7, kind: exclude_rows}".to_string(),
    ];
    for entry in bad_entries {
        let text =
            format!("---\ndefaults:\n  - {{id: z, kind: require_rate_join}}\n  - {entry}\n---\n");
        let (ids, warnings) = declared_default_ids(&[
            rule_file("knowledge/rules/a.md", valid),
            rule_file("knowledge/rules/b.md", &text),
        ]);
        assert!(ids.is_empty(), "{entry}: {ids:?}");
        assert_eq!(warnings.len(), 1, "{entry}: {warnings:?}");
        assert!(warnings[0].contains("b.md"), "{warnings:?}");
    }
    let (ids, warnings) = declared_default_ids(&[
        rule_file("knowledge/rules/a.md", valid),
        rule_file("knowledge/rules/b.md", valid),
    ]);
    assert!(ids.is_empty());
    assert!(warnings[0].contains("duplicate id 'ok'"), "{warnings:?}");
}

#[test]
fn malformed_front_matter_voids_the_set_and_never_panics() {
    let (ids, warnings) = declared_default_ids(&[
        rule_file(
            "knowledge/rules/a.md",
            "---\ndefaults: [unterminated\n---\n",
        ),
        rule_file("knowledge/rules/b.md", "---\ndefaults: nope\n---\n"),
        rule_file("knowledge/rules/c.md", "---\n- just\n- a list\n---\n"),
        rule_file("knowledge/rules/d.md", "---\n---\n"),
        rule_file("knowledge/rules/e.md", "---"),
    ]);
    assert!(ids.is_empty());
    // a.md and b.md declare `defaults`; c.md, d.md and e.md carry no declaration signal.
    assert_eq!(warnings.len(), 2, "{warnings:?}");
}

#[test]
fn declaration_shaped_sequence_front_matter_voids_defaults_but_prose_lists_do_not() {
    let valid = "---\ndefaults:\n  - {id: valid, kind: exclude_rows}\n---\n";
    let declaration_sequence = "---\n- {id: misplaced, kind: exclude_rows}\n---\n";
    let malformed_declaration_sequence = "---\n- {id: Invalid, kind: unknown}\n---\n";
    let id_only_sequence = "---\n- {id: a-note}\n---\n";
    let kind_only_sequence = "---\n- {kind: a-note}\n---\n";
    let prose_sequence = "---\n- title: Team conventions\n- Keep identifiers stable\n---\n";

    for declaration_sequence in [declaration_sequence, malformed_declaration_sequence] {
        let (ids, warnings) = declared_default_ids(&[
            rule_file("knowledge/rules/a.md", valid),
            rule_file("knowledge/rules/b.md", declaration_sequence),
        ]);
        assert!(ids.is_empty(), "{ids:?}");
        assert_eq!(warnings.len(), 1, "{warnings:?}");
        assert!(warnings[0].contains("sequence"), "{warnings:?}");
    }

    for prose_sequence in [id_only_sequence, kind_only_sequence, prose_sequence] {
        let (ids, warnings) =
            declared_default_ids(&[rule_file("knowledge/rules/prose.md", prose_sequence)]);
        assert!(ids.is_empty(), "{ids:?}");
        assert!(warnings.is_empty(), "{warnings:?}");
    }

    let project = tempfile::tempdir().unwrap();
    copy_dir(&fixture("declared-wren"), project.path());
    fs::write(
        project.path().join("knowledge/rules/conventions.md"),
        declaration_sequence,
    )
    .unwrap();
    let legacy_rules = read_knowledge_rules(project.path()).unwrap();
    let snapshot_rules = capture_project(project.path()).unwrap().rules;
    assert!(legacy_rules.declared_defaults.is_empty());
    assert_eq!(snapshot_rules, legacy_rules);
}

#[test]
fn declaration_shaped_unknown_mapping_voids_defaults_but_metadata_does_not() {
    let valid = "---\ndefaults:\n  - {id: valid, kind: exclude_rows}\n---\n";
    let misspelt = "---\ndefauts:\n  - {id: misplaced, kind: exclude_rows}\n---\n";

    let (ids, warnings) = declared_default_ids(&[
        rule_file("knowledge/rules/a.md", valid),
        rule_file("knowledge/rules/b.md", misspelt),
    ]);
    assert!(ids.is_empty(), "{ids:?}");
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert!(warnings[0].contains("mapping"), "{warnings:?}");

    for (metadata, expected_ids) in [
        ("---\ndefauts:\n  - {id: a-note}\n---\n", Vec::new()),
        ("---\ndefauts:\n  - {kind: a-note}\n---\n", Vec::new()),
        (
            "---\ndefaults:\n  - {id: valid, kind: exclude_rows}\nmetadata:\n  - {id: prose, kind: note}\n---\n",
            vec!["valid"],
        ),
    ] {
        let (ids, warnings) = declared_default_ids(&[rule_file("knowledge/rules/a.md", metadata)]);
        assert_eq!(ids, expected_ids, "{metadata}: {ids:?}");
        assert!(warnings.is_empty(), "{metadata}: {warnings:?}");
    }

    let project = tempfile::tempdir().unwrap();
    copy_dir(&fixture("declared-wren"), project.path());
    fs::write(
        project.path().join("knowledge/rules/conventions.md"),
        misspelt,
    )
    .unwrap();
    assert!(catalog_json(project.path())
        .get("declared_defaults")
        .is_none());
    let legacy_rules = read_knowledge_rules(project.path()).unwrap();
    let snapshot_rules = capture_project(project.path()).unwrap().rules;
    assert!(legacy_rules.declared_defaults.is_empty());
    assert_eq!(snapshot_rules, legacy_rules);
}

#[test]
fn a_sale_statuses_declaration_keeps_its_id_and_does_not_void_the_set() {
    let text = "---\ndefaults:\n  - {id: z, kind: require_rate_join}\n  - id: paid-and-shipped\n    kind: sale_statuses\n    column: orders.status\n    values: [paid, shipped]\n    domain: [paid, shipped, cancelled, pending]\n    overridable_by_caller: true\n    when: aggregated\n---\n";
    let (ids, warnings) = declared_default_ids(&[rule_file("knowledge/rules/a.md", text)]);
    assert_eq!(ids, ["z", "paid-and-shipped"]);
    assert!(warnings.is_empty(), "{warnings:?}");

    let project = tempfile::tempdir().unwrap();
    copy_dir(&fixture("declared-wren"), project.path());
    fs::write(project.path().join("knowledge/rules/conventions.md"), text).unwrap();
    assert_eq!(
        catalog_json(project.path())["declared_defaults"],
        serde_json::json!(["usd-at-transaction-date", "z", "paid-and-shipped"])
    );
}

#[test]
fn a_misspelt_sale_statuses_kind_still_voids_the_set() {
    let text = "---\ndefaults:\n  - {id: ok, kind: exclude_rows}\n  - {id: typo, kind: sale_status}\n---\n";
    let (ids, warnings) = declared_default_ids(&[rule_file("knowledge/rules/a.md", text)]);
    assert!(ids.is_empty(), "{ids:?}");
    assert!(warnings[0].contains("unknown kind"), "{warnings:?}");
}

#[test]
fn a_leading_fence_without_a_declaration_signal_is_prose() {
    let valid = "---\ndefaults:\n  - {id: valid, kind: exclude_rows}\n---\n";
    for prose in [
        // A markdown horizontal rule followed by prose: an unclosed fence with no signal.
        "---\nSome prose after a horizontal rule.\n\nMore prose: with a colon.\n",
        // A closed block that is not valid YAML and carries no signal.
        "---\nNote: this: is not yaml\n---\nBody\n",
        // A closed block with ordinary metadata only.
        "---\ntitle: Conventions\n---\nBody\n",
    ] {
        let (ids, warnings) = declared_default_ids(&[
            rule_file("knowledge/rules/a.md", valid),
            rule_file("knowledge/rules/b.md", prose),
        ]);
        assert_eq!(ids, ["valid"], "{prose}");
        assert!(warnings.is_empty(), "{prose}: {warnings:?}");
    }
}

#[test]
fn an_unclosed_fence_with_a_declaration_signal_still_voids_the_set() {
    let valid = "---\ndefaults:\n  - {id: valid, kind: exclude_rows}\n---\n";
    for unclosed in [
        "---\ndefaults:\n  - id: x\n    kind: exclude_rows\n",
        "---\n\"semantics\": []\n",
        "---\n- id: x\n  kind: exclude_rows\n",
        "---\n- {id: x, kind: exclude_rows}\n",
    ] {
        let (ids, warnings) = declared_default_ids(&[
            rule_file("knowledge/rules/a.md", valid),
            rule_file("knowledge/rules/b.md", unclosed),
        ]);
        assert!(ids.is_empty(), "{unclosed}: {ids:?}");
        assert_eq!(warnings.len(), 1, "{unclosed}: {warnings:?}");
        assert!(warnings[0].contains("not closed"), "{warnings:?}");
    }
    // A closed block with a signal and invalid YAML is still void.
    let (ids, warnings) = declared_default_ids(&[
        rule_file("knowledge/rules/a.md", valid),
        rule_file(
            "knowledge/rules/b.md",
            "---\ndefaults: [unterminated\n---\n",
        ),
    ]);
    assert!(ids.is_empty());
    assert!(warnings[0].contains("not valid YAML"), "{warnings:?}");
}
