#![cfg(not(target_arch = "wasm32"))]

use std::fs;
use wren_context_loader::read_knowledge_rules;

#[test]
fn knowledge_rules_are_sorted_trimmed_and_followed_by_legacy_content() {
    let project = tempfile::tempdir().unwrap();
    let rules = project.path().join("knowledge/rules");
    fs::create_dir_all(&rules).unwrap();
    fs::write(rules.join("z-last.md"), "\n# Z\r\n\r\nlast\n").unwrap();
    fs::write(rules.join("a-first.md"), "# A\n\nfirst\n").unwrap();
    fs::write(rules.join("empty.md"), " \n").unwrap();
    fs::write(project.path().join("instructions.md"), "\n# Legacy\n").unwrap();

    let loaded = read_knowledge_rules(project.path()).unwrap();

    assert_eq!(
        loaded.content,
        "# A\n\nfirst\n\n# Z\r\n\r\nlast\n\n# Legacy"
    );
    assert!(loaded.used_legacy);
}

#[test]
fn missing_rules_are_an_explicit_empty_payload() {
    let project = tempfile::tempdir().unwrap();
    let loaded = read_knowledge_rules(project.path()).unwrap();
    assert_eq!(loaded.content, "");
    assert!(!loaded.used_legacy);
}
