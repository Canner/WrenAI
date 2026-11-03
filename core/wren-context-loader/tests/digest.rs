//! The catalog's `digest` changes with the project sources and with nothing else.

use std::fs;
use std::path::Path;
use std::process::Command;

use wren_context_loader::{
    capability_catalog, catalog_document, project_digest, read_knowledge_rules, read_project_dir,
};

fn fixture(name: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
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

fn copy_of(name: &str) -> tempfile::TempDir {
    let project = tempfile::tempdir().unwrap();
    copy_dir(&fixture(name), project.path());
    project
}

fn digest(dir: &Path) -> String {
    project_digest(dir).unwrap()
}

#[test]
fn the_digest_is_stable_lowercase_sha256_hex() {
    let one = digest(&fixture("denied-wren"));
    assert_eq!(one.len(), 64);
    assert!(one
        .bytes()
        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)));
    assert_eq!(one, digest(&fixture("denied-wren")));
    assert_eq!(one, digest(copy_of("denied-wren").path()));
    assert_ne!(one, digest(&fixture("declared-wren")));
}

#[test]
fn changing_one_byte_of_any_covered_file_changes_the_digest() {
    let base = digest(&fixture("denied-wren"));
    for relative in [
        "wren_project.yml",
        "models/orders/metadata.yml",
        "knowledge/rules/a-pii.md",
        "views/revenue/metadata.yml",
    ] {
        let project = copy_of("denied-wren");
        let path = project.path().join(relative);
        let mut bytes = fs::read(&path).unwrap();
        bytes.push(b'\n');
        fs::write(&path, bytes).unwrap();
        assert_ne!(base, digest(project.path()), "{relative}");
    }
}

#[test]
fn adding_or_removing_a_covered_file_changes_the_digest() {
    let base = digest(&fixture("denied-wren"));
    let project = copy_of("denied-wren");
    fs::write(project.path().join("knowledge/rules/c.md"), "new rule\n").unwrap();
    let added = digest(project.path());
    assert_ne!(base, added);
    fs::remove_file(project.path().join("knowledge/rules/c.md")).unwrap();
    assert_eq!(base, digest(project.path()));
    fs::remove_file(project.path().join("knowledge/rules/b-money.md")).unwrap();
    assert_ne!(base, digest(project.path()));
}

#[test]
fn renaming_a_file_changes_the_digest() {
    let project = copy_of("denied-wren");
    let base = digest(project.path());
    fs::rename(
        project.path().join("knowledge/rules/a-pii.md"),
        project.path().join("knowledge/rules/z-pii.md"),
    )
    .unwrap();
    assert_ne!(base, digest(project.path()));
}

#[test]
fn the_target_directory_data_files_and_dotfiles_do_not_change_it() {
    let project = copy_of("denied-wren");
    let base = digest(project.path());
    fs::create_dir_all(project.path().join("target")).unwrap();
    fs::write(project.path().join("target/mdl.json"), "{}").unwrap();
    fs::write(project.path().join("target/mdl.json"), "{\"a\":1}").unwrap();
    fs::create_dir_all(project.path().join("data")).unwrap();
    fs::write(project.path().join("data/x.csv"), "a,b\n").unwrap();
    fs::write(project.path().join("service.yml"), "caller: x\n").unwrap();
    fs::write(project.path().join("knowledge/rules/.DS_Store"), "junk").unwrap();
    assert_eq!(base, digest(project.path()));
}

#[test]
fn the_legacy_instructions_file_is_part_of_the_digest() {
    let project = copy_of("denied-wren");
    let base = digest(project.path());
    fs::write(project.path().join("instructions.md"), "old rules\n").unwrap();
    assert_ne!(base, digest(project.path()));
}

#[test]
fn the_catalog_carries_the_digest_and_the_loader_version_and_the_binary_agrees() {
    let dir = fixture("denied-wren");
    let sources = read_project_dir(&dir).unwrap().unwrap();
    let catalog = capability_catalog(&sources)
        .with_knowledge_rules(read_knowledge_rules(&dir).unwrap())
        .with_digest(digest(&dir));
    let in_process: serde_json::Value =
        serde_json::from_str(&catalog_document(&catalog).unwrap()).unwrap();
    assert_eq!(in_process["digest"], digest(&dir));
    assert_eq!(in_process["loader_version"], env!("CARGO_PKG_VERSION"));

    let out = tempfile::tempdir().unwrap();
    let status = Command::new(env!("CARGO_BIN_EXE_wren-context-loader"))
        .arg(&dir)
        .arg("-o")
        .arg(out.path().join("context.json"))
        .arg("--catalog-out")
        .arg(out.path().join("catalog.json"))
        .status()
        .unwrap();
    assert!(status.success());
    let written: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(out.path().join("catalog.json")).unwrap())
            .unwrap();
    assert_eq!(written, in_process);
}

#[test]
fn the_pure_builder_leaves_the_digest_out() {
    let dir = fixture("denied-wren");
    let sources = read_project_dir(&dir).unwrap().unwrap();
    let doc: serde_json::Value =
        serde_json::from_str(&catalog_document(&capability_catalog(&sources)).unwrap()).unwrap();
    assert!(doc.get("digest").is_none());
}
