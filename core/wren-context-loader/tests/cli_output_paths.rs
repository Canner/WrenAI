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
