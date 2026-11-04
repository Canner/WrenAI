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
fn regular_source_directory_entries_are_absent_to_loader_and_digest() {
    for source_dir in ["models", "views"] {
        let project = copy_of("denied-wren");
        let source = project.path().join(source_dir);
        fs::remove_dir_all(&source).unwrap();
        fs::write(&source, "ordinary source file").unwrap();

        let before = digest(project.path());
        fs::write(&source, "changed ordinary source file").unwrap();
        assert_eq!(
            before,
            digest(project.path()),
            "{source_dir} is not a source root"
        );

        let sources = read_project_dir(project.path()).unwrap().unwrap();
        match source_dir {
            "models" => assert!(sources.model_ymls.is_empty()),
            "views" => assert!(sources.views.is_empty()),
            _ => unreachable!(),
        }
    }
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

/// What the catalog and the prepared document are built from, listed through the readers the
/// loader uses: rule files, saved queries, and the model, cube and view sources.
fn listed_inputs(dir: &Path) -> (Vec<String>, Vec<String>, usize, usize, usize) {
    let rules = read_knowledge_rules(dir).unwrap();
    let sources = read_project_dir(dir).unwrap().unwrap();
    (
        rules.files.iter().map(|f| f.path.clone()).collect(),
        sources
            .knowledge_sql_mds
            .iter()
            .map(|(slug, _)| slug.clone())
            .collect(),
        sources.model_ymls.len(),
        sources.cube_ymls.len(),
        sources.views.len(),
    )
}

#[test]
fn the_digest_and_the_readers_agree_that_dot_named_entries_are_not_inputs() {
    let project = copy_of("rules-wren");
    let dir = project.path();
    let digest_before = digest(dir);
    let listed_before = listed_inputs(dir);

    let write = |relative: &str, contents: &str| {
        let path = dir.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    };
    write("knowledge/rules/.private.md", "Never show salaries.\n");
    write("knowledge/sql/.draft.md", "---\nsql: SELECT 1\n---\n");
    write(
        "models/.scratch/metadata.yml",
        "name: scratch\ncolumns:\n  - { name: id, type: INTEGER }\n",
    );
    write(
        "cubes/.scratch/metadata.yml",
        "name: scratch\nbase_object: orders\n",
    );
    write("views/.scratch/metadata.yml", "name: scratch\n");
    write("views/.scratch/sql.yml", "statement: SELECT 1\n");

    assert_eq!(
        digest_before,
        digest(dir),
        "the digest ignores dot-named entries"
    );
    assert_eq!(
        listed_before,
        listed_inputs(dir),
        "so must every reader the catalog and the prepared document are built from"
    );
}

#[test]
#[cfg(target_os = "linux")]
fn non_utf8_source_names_are_rejected_but_hidden_entries_are_ignored() {
    use std::os::unix::ffi::OsStringExt;

    let project = copy_of("rules-wren");
    let invalid = std::ffi::OsString::from_vec(b"\xff.md".to_vec());
    let hidden_invalid = std::ffi::OsString::from_vec(b".\xff.md".to_vec());
    let rules = project.path().join("knowledge/rules");
    fs::write(rules.join(&invalid), "not a rule").unwrap();

    for result in [
        project_digest(project.path()).map(|_| ()),
        read_project_dir(project.path()).map(|_| ()),
        read_knowledge_rules(project.path()).map(|_| ()),
    ] {
        let error = result.expect_err("non-hidden non-UTF-8 source name must be rejected");
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidInput);
        assert_eq!(error.to_string(), "non_utf8_source_name");
    }

    fs::remove_file(rules.join(invalid)).unwrap();
    fs::write(rules.join(hidden_invalid), "ignored").unwrap();
    assert!(project_digest(project.path()).is_ok());
    assert!(read_project_dir(project.path()).is_ok());
    assert!(read_knowledge_rules(project.path()).is_ok());
}

#[cfg(unix)]
fn bounded_loader_rejection(dir: &Path, output: &Path) {
    use std::process::Stdio;
    use std::time::{Duration, Instant};
    let mut child = Command::new(env!("CARGO_BIN_EXE_wren-context-loader"))
        .arg(dir)
        .arg("-o")
        .arg(output.join("context.json"))
        .arg("--catalog-out")
        .arg(output.join("catalog.json"))
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if child.try_wait().unwrap().is_some() {
            break;
        }
        if Instant::now() >= deadline {
            child.kill().unwrap();
            child.wait().unwrap();
            panic!("directory-symlink traversal exceeded its bound");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let result = child.wait_with_output().unwrap();
    assert!(!result.status.success());
    assert!(String::from_utf8_lossy(&result.stderr).contains("directory_symlink_unsupported"));
}

#[test]
#[cfg(unix)]
fn directory_symlinks_are_rejected_by_digest_and_both_readers() {
    use std::os::unix::fs::symlink;
    for relative in [
        "models",
        "cubes",
        "views",
        "knowledge",
        "knowledge/rules",
        "models/linked",
        "knowledge/rules/loop",
    ] {
        let project = copy_of("rules-wren");
        let output = tempfile::tempdir().unwrap();
        let link = project.path().join(relative);
        if link.exists() {
            fs::rename(&link, output.path().join("original")).unwrap();
        }
        fs::create_dir_all(link.parent().unwrap()).unwrap();
        symlink(project.path(), &link).unwrap();
        // The subprocess deadline makes a regression to recursive traversal safe.
        bounded_loader_rejection(project.path(), output.path());
        assert!(project_digest(project.path()).is_err(), "{relative}");
        assert!(read_project_dir(project.path()).is_err(), "{relative}");
        assert!(read_knowledge_rules(project.path()).is_err(), "{relative}");
    }
}

#[test]
#[cfg(unix)]
fn branching_directory_cycles_are_rejected_before_expansion() {
    use std::os::unix::fs::symlink;
    let project = copy_of("rules-wren");
    let cycles = project.path().join("knowledge/cycles");
    fs::create_dir_all(&cycles).unwrap();
    symlink(project.path().join("knowledge"), cycles.join("a")).unwrap();
    symlink(project.path().join("knowledge"), cycles.join("b")).unwrap();
    let output = tempfile::tempdir().unwrap();
    bounded_loader_rejection(project.path(), output.path());
}

#[test]
#[cfg(unix)]
fn file_symlinks_still_contribute_target_bytes_and_are_read() {
    use std::os::unix::fs::symlink;
    let project = copy_of("rules-wren");
    let outside = tempfile::tempdir().unwrap();
    let linked = project.path().join("knowledge/rules/linked.md");
    let target = outside.path().join("rule.md");
    fs::write(&target, "first external rule").unwrap();
    symlink(&target, &linked).unwrap();
    let first = digest(project.path());
    assert!(read_knowledge_rules(project.path())
        .unwrap()
        .content
        .contains("first external rule"));
    fs::write(&target, "updated external rule").unwrap();
    assert_ne!(first, digest(project.path()));
    assert!(read_knowledge_rules(project.path())
        .unwrap()
        .content
        .contains("updated external rule"));
    let model = project.path().join("models/orders/metadata.yml");
    let expected = fs::read_to_string(&model).unwrap();
    fs::rename(&model, outside.path().join("model.yml")).unwrap();
    symlink(outside.path().join("model.yml"), &model).unwrap();
    assert!(read_project_dir(project.path())
        .unwrap()
        .unwrap()
        .model_ymls
        .contains(&expected));
}
