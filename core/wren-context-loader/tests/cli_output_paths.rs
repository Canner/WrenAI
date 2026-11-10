//! CLI output-path validation must reject aliases before either document is written.

use std::fs;
use std::path::Path;
use std::process::Command;

fn fixture(name: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

fn run_loader(args: &[&std::ffi::OsStr]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_wren-context-loader"))
        .args(args)
        .output()
        .unwrap()
}

fn run_loader_from(dir: &Path, args: &[&std::ffi::OsStr]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_wren-context-loader"))
        .current_dir(dir)
        .args(args)
        .output()
        .unwrap()
}

#[test]
fn duplicate_output_destinations_are_rejected_before_writing() {
    let output = tempfile::tempdir().unwrap();
    let project = fixture("rules-wren");
    let same = output.path().join("same.json");
    let same_alias = output.path().join(".").join("same.json");

    for catalog_out in [&same, &same_alias] {
        let run = run_loader(&[
            project.as_os_str(),
            "-o".as_ref(),
            same.as_os_str(),
            "--catalog-out".as_ref(),
            catalog_out.as_os_str(),
        ]);
        assert_eq!(run.status.code(), Some(2));
        assert!(String::from_utf8_lossy(&run.stderr)
            .contains("-o and --catalog-out must name different files"));
        assert!(
            !same.exists(),
            "argument rejection must happen before either output is written"
        );
    }

    let context = output.path().join("context.json");
    let catalog = output.path().join("catalog.json");
    let distinct = run_loader(&[
        project.as_os_str(),
        "-o".as_ref(),
        context.as_os_str(),
        "--catalog-out".as_ref(),
        catalog.as_os_str(),
    ]);
    assert!(distinct.status.success());
    assert!(context.is_file());
    assert!(catalog.is_file());

    fs::remove_file(context).unwrap();
    let stdout = run_loader(&[
        project.as_os_str(),
        "--catalog-out".as_ref(),
        catalog.as_os_str(),
    ]);
    assert!(stdout.status.success());
    assert!(
        !stdout.stdout.is_empty(),
        "omitting -o still writes to stdout"
    );
}

#[test]
fn distinct_relative_output_destinations_are_written_in_the_current_directory() {
    let output = tempfile::tempdir().unwrap();
    let project = fixture("rules-wren");
    let run = run_loader_from(
        output.path(),
        &[
            project.as_os_str(),
            "-o".as_ref(),
            "context.json".as_ref(),
            "--catalog-out".as_ref(),
            "catalog.json".as_ref(),
        ],
    );

    assert!(run.status.success(), "{:?}", run.stderr);
    assert!(output.path().join("context.json").is_file());
    assert!(output.path().join("catalog.json").is_file());
}

#[cfg(unix)]
#[test]
fn symlink_and_hardlink_output_aliases_are_rejected_before_writing() {
    use std::os::unix::fs::symlink;

    let project = fixture("rules-wren");
    let reject = |out: &Path, catalog: &Path| {
        let run = run_loader(&[
            project.as_os_str(),
            "-o".as_ref(),
            out.as_os_str(),
            "--catalog-out".as_ref(),
            catalog.as_os_str(),
        ]);
        assert_eq!(run.status.code(), Some(2), "{:?}", run.stderr);
    };

    let output = tempfile::tempdir().unwrap();
    let out = output.path().join("out.json");
    fs::write(&out, "retain").unwrap();
    let file_link = output.path().join("file-link.json");
    symlink(&out, &file_link).unwrap();
    reject(&out, &file_link);
    assert_eq!(fs::read_to_string(&out).unwrap(), "retain");

    let parent_link = output.path().join("parent-link");
    symlink(output.path(), &parent_link).unwrap();
    reject(&out, &parent_link.join("out.json"));
    assert_eq!(fs::read_to_string(&out).unwrap(), "retain");

    let hard_link = output.path().join("hard-link.json");
    fs::hard_link(&out, &hard_link).unwrap();
    reject(&out, &hard_link);
    assert_eq!(fs::read_to_string(&out).unwrap(), "retain");

    fs::remove_file(&out).unwrap();
    let dangling_link = output.path().join("dangling-link.json");
    symlink(&out, &dangling_link).unwrap();
    reject(&out, &dangling_link);
    assert!(!out.exists());
}

#[cfg(unix)]
#[test]
fn digest_covered_and_unresolvable_outputs_fail_before_the_other_write() {
    use std::os::unix::fs::symlink;

    let project = fixture("rules-wren");
    let output = tempfile::tempdir().unwrap();
    let ordinary = output.path().join("ordinary.json");
    let covered = project.join("knowledge/catalog.json");
    let covered_run = run_loader(&[
        project.as_os_str(),
        "-o".as_ref(),
        ordinary.as_os_str(),
        "--catalog-out".as_ref(),
        covered.as_os_str(),
    ]);
    assert_eq!(covered_run.status.code(), Some(2));
    assert!(!ordinary.exists());
    assert!(!covered.exists());

    let loop_path = output.path().join("loop");
    symlink(&loop_path, &loop_path).unwrap();
    let loop_run = run_loader(&[
        project.as_os_str(),
        "-o".as_ref(),
        loop_path.as_os_str(),
        "--catalog-out".as_ref(),
        ordinary.as_os_str(),
    ]);
    assert_eq!(loop_run.status.code(), Some(2));
    assert!(!ordinary.exists());
}

#[test]
fn output_in_an_untracked_target_directory_remains_valid() {
    let project = tempfile::tempdir().unwrap();
    fs::write(
        project.path().join("wren_project.yml"),
        "schema_version: 5\n",
    )
    .unwrap();
    let target = project.path().join("target");
    fs::create_dir(&target).unwrap();
    let prepared = target.join("prepared.json");
    let catalog = target.join("catalog.json");

    let run = run_loader(&[
        project.path().as_os_str(),
        "-o".as_ref(),
        prepared.as_os_str(),
        "--catalog-out".as_ref(),
        catalog.as_os_str(),
    ]);
    assert!(run.status.success(), "{:?}", run.stderr);
    assert!(prepared.is_file());
    assert!(catalog.is_file());
}

#[cfg(unix)]
#[test]
fn source_links_and_hardlinks_are_rejected_before_any_output() {
    use std::os::unix::fs::symlink;

    let project = tempfile::tempdir().unwrap();
    fs::write(
        project.path().join("wren_project.yml"),
        "schema_version: 5\n",
    )
    .unwrap();
    let knowledge = project.path().join("knowledge");
    fs::create_dir(&knowledge).unwrap();
    let outside = tempfile::tempdir().unwrap();
    let linked_source = knowledge.join("catalog.json");
    let outside_target = outside.path().join("outside.json");
    symlink(&outside_target, &linked_source).unwrap();
    let ordinary = outside.path().join("ordinary.json");
    let linked_run = run_loader(&[
        project.path().as_os_str(),
        "-o".as_ref(),
        linked_source.as_os_str(),
        "--catalog-out".as_ref(),
        ordinary.as_os_str(),
    ]);
    assert_eq!(linked_run.status.code(), Some(2));
    assert!(!outside_target.exists());
    assert!(!ordinary.exists());

    let hard_link = outside.path().join("wren-project-link.yml");
    fs::hard_link(project.path().join("wren_project.yml"), &hard_link).unwrap();
    let hard_link_run = run_loader(&[
        project.path().as_os_str(),
        "-o".as_ref(),
        hard_link.as_os_str(),
        "--catalog-out".as_ref(),
        ordinary.as_os_str(),
    ]);
    assert_eq!(hard_link_run.status.code(), Some(2));
    assert_eq!(
        fs::read_to_string(project.path().join("wren_project.yml")).unwrap(),
        "schema_version: 5\n"
    );
    assert!(!ordinary.exists());
}

#[test]
fn invalid_output_parents_are_rejected_before_the_other_write() {
    let project = fixture("rules-wren");
    let output = tempfile::tempdir().unwrap();
    let catalog = output.path().join("catalog.json");
    let missing_parent = output.path().join("missing/out.json");
    let regular_parent = output.path().join("regular");
    fs::write(&regular_parent, "not a directory").unwrap();
    let through_file_parent = regular_parent.join("../out.json");
    let directory = output.path().join("directory");
    fs::create_dir(&directory).unwrap();

    for prepared in [&missing_parent, &through_file_parent, &directory] {
        let run = run_loader(&[
            project.as_os_str(),
            "-o".as_ref(),
            prepared.as_os_str(),
            "--catalog-out".as_ref(),
            catalog.as_os_str(),
        ]);
        assert_eq!(run.status.code(), Some(2), "{:?}", run.stderr);
        assert!(!catalog.exists());
    }
}

#[cfg(windows)]
#[test]
fn hardlinked_output_aliases_are_rejected_before_writing() {
    let project = fixture("rules-wren");
    let output = tempfile::tempdir().unwrap();
    let out = output.path().join("out.json");
    let hard_link = output.path().join("hard-link.json");
    fs::write(&out, "retain").unwrap();
    fs::hard_link(&out, &hard_link).unwrap();

    let run = run_loader(&[
        project.as_os_str(),
        "-o".as_ref(),
        out.as_os_str(),
        "--catalog-out".as_ref(),
        hard_link.as_os_str(),
    ]);
    assert_eq!(run.status.code(), Some(2), "{:?}", run.stderr);
    assert_eq!(fs::read_to_string(out).unwrap(), "retain");
}
