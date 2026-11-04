//! How `read_project_dir` and `assemble` treat what is on disk: nothing the loader cannot read
//! completely may load as a smaller project without an error or a diagnostic.

use std::fs;
use std::path::Path;

use wren_context_loader::{
    assemble, capability_catalog, capture_project, project_digest, read_knowledge_rules,
    read_project_dir,
};

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
fn a_sql_yml_directory_is_not_silently_treated_as_an_absent_statement() {
    let tmp = tempfile::tempdir().unwrap();
    project(tmp.path());
    write(
        tmp.path(),
        "views/big/metadata.yml",
        "name: big\nstatement: SELECT 1\n",
    );
    fs::create_dir_all(tmp.path().join("views/big/sql.yml")).unwrap();

    let error = match read_project_dir(tmp.path()) {
        Ok(_) => panic!("sql.yml directories are invalid inputs"),
        Err(error) => error,
    };
    assert_eq!(error.kind(), std::io::ErrorKind::InvalidInput);
    assert_eq!(error.to_string(), "sql_yml_directory_unsupported");
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
    for relative in [
        "models/orders/metadata.yml",
        "cubes/orders/metadata.yml",
        "views/broken/metadata.yml",
    ] {
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

#[test]
fn captured_snapshot_matches_the_existing_readers_without_retaining_unrelated_sources() {
    let tmp = tempfile::tempdir().unwrap();
    project(tmp.path());
    write(tmp.path(), "knowledge/rules/a.md", "# Rule\n");
    write(
        tmp.path(),
        "knowledge/sql/query.md",
        "---\nsql: SELECT 1\n---\n",
    );
    write(
        tmp.path(),
        "models/orders/unused.csv",
        "large,irrelevant,source\n",
    );

    let snapshot = capture_project(tmp.path()).unwrap();
    let existing = read_project_dir(tmp.path()).unwrap().unwrap();
    assert_eq!(
        snapshot.sources.as_ref().unwrap().model_ymls,
        existing.model_ymls
    );
    assert_eq!(
        snapshot.sources.as_ref().unwrap().knowledge_sql_mds,
        existing.knowledge_sql_mds
    );
    assert_eq!(snapshot.rules, read_knowledge_rules(tmp.path()).unwrap());
    assert_eq!(snapshot.digest, project_digest(tmp.path()).unwrap());
}

#[test]
fn captured_snapshot_does_not_reread_a_source_after_edit_and_restore() {
    let tmp = tempfile::tempdir().unwrap();
    project(tmp.path());
    let model = tmp.path().join("models/orders/metadata.yml");
    let original = fs::read_to_string(&model).unwrap();
    let snapshot = capture_project(tmp.path()).unwrap();

    fs::write(&model, "name: changed\ncolumns: []\n").unwrap();
    fs::write(&model, &original).unwrap();

    assert_eq!(snapshot.digest, project_digest(tmp.path()).unwrap());
    assert_eq!(
        snapshot.sources.unwrap().model_ymls,
        read_project_dir(tmp.path()).unwrap().unwrap().model_ymls,
        "the captured semantic bytes survive an edit-and-restore interval without rereading"
    );
}
