//! How `read_project_dir` and `assemble` treat what is on disk: nothing the loader cannot read
//! completely may load as a smaller project without an error or a diagnostic.

use std::fs;
use std::path::Path;

use wren_context_loader::{assemble, capability_catalog, read_project_dir};

fn write(dir: &Path, rel: &str, contents: &str) {
    let path = dir.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, contents).unwrap();
}

fn project(dir: &Path) {
    write(
        dir,
        "wren_project.yml",
        "schema_version: 5\nname: reading\ncatalog: wren\nschema: public\ndata_source: duckdb\n",
    );
    write(
        dir,
        "models/orders/metadata.yml",
        "name: orders\ntable_reference: { catalog: demo, schema: main, table: orders }\nprimary_key: id\ncolumns:\n  - { name: id, type: INTEGER }\n  - { name: total, type: INTEGER }\n",
    );
}

fn statements(dir: &Path) -> Vec<(String, String)> {
    let sources = read_project_dir(dir).unwrap().unwrap();
    let loaded = assemble(&sources).expect("project assembles");
    loaded
        .manifest
        .views
        .iter()
        .map(|v| (v.name.clone(), v.statement.clone()))
        .collect()
}

#[test]
fn a_view_whose_statement_lives_in_its_metadata_is_read() {
    let tmp = tempfile::tempdir().unwrap();
    project(tmp.path());
    write(
        tmp.path(),
        "views/big/metadata.yml",
        "name: big\nstatement: SELECT id FROM orders WHERE total > 100\n",
    );

    assert_eq!(
        statements(tmp.path()),
        [(
            "big".to_string(),
            "SELECT id FROM orders WHERE total > 100".to_string()
        )],
        "the wren CLI accepts an inline statement, so a view without sql.yml is still a view"
    );
}

#[test]
fn sql_yml_wins_over_an_inline_statement() {
    let tmp = tempfile::tempdir().unwrap();
    project(tmp.path());
    write(
        tmp.path(),
        "views/big/metadata.yml",
        "name: big\nstatement: SELECT 1\n",
    );
    write(
        tmp.path(),
        "views/big/sql.yml",
        "statement: SELECT id FROM orders\n",
    );

    assert_eq!(
        statements(tmp.path()),
        [("big".to_string(), "SELECT id FROM orders".to_string())]
    );
}

#[test]
fn a_view_with_no_statement_anywhere_is_an_error_and_a_diagnostic() {
    let tmp = tempfile::tempdir().unwrap();
    project(tmp.path());
    write(tmp.path(), "views/half/metadata.yml", "name: half\n");

    let sources = read_project_dir(tmp.path()).unwrap().unwrap();
    let error = assemble(&sources)
        .err()
        .expect("a view the CLI would refuse must not load as no view");
    let message = error.to_string();
    assert!(
        message.contains("half") && message.contains("statement"),
        "the error names the view and what is missing: {message}"
    );

    let catalog = capability_catalog(&sources);
    assert!(
        catalog
            .diagnostics
            .iter()
            .any(|d| d.to_string().contains("views/half") && d.to_string().contains("statement")),
        "the catalog reports it too: {:?}",
        catalog.diagnostics
    );
}

#[test]
fn a_directory_with_a_sql_yml_and_no_metadata_is_not_a_view_to_the_cli_either() {
    let tmp = tempfile::tempdir().unwrap();
    project(tmp.path());
    write(tmp.path(), "views/stray/sql.yml", "statement: SELECT 1\n");

    assert!(statements(tmp.path()).is_empty());
}

#[test]
fn metadata_directories_are_not_silently_skipped() {
    for relative in ["models/orders/metadata.yml", "views/broken/metadata.yml"] {
        let tmp = tempfile::tempdir().unwrap();
        project(tmp.path());
        let metadata = tmp.path().join(relative);
        if metadata.exists() {
            fs::remove_file(&metadata).unwrap();
        }
        fs::create_dir_all(&metadata).unwrap();

        let error = match read_project_dir(tmp.path()) {
            Ok(_) => panic!("{relative} must be rejected"),
            Err(error) => error,
        };
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidInput);
        assert_eq!(error.to_string(), "metadata_directory_unsupported");
    }
}
