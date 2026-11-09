//! How `read_project_dir` and `assemble` treat what is on disk: nothing the loader cannot read
//! completely may load as a smaller project without an error or a diagnostic.

use std::fs;
use std::path::Path;
use std::process::Command;

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

const ROOT_CUBE: &str = r#"- name: order_metrics
  base_object: orders
  measures:
    - { name: total_value, expression: "SUM(total)", type: DOUBLE }
    - { name: order_count, expression: "COUNT(*)", type: BIGINT }
  dimensions: []
  time_dimensions: []
"#;

const CUBE_METADATA: &str = r#"name: order_metrics
base_object: orders
description: Directory prose does not affect execution semantics.
measures:
  - { name: order_count, expression: "COUNT(*)", type: BIGINT, description: "A count." }
  - { name: total_value, expression: "SUM(total)", type: DOUBLE, description: "A sum." }
dimensions: []
time_dimensions: []
"#;

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

#[cfg(unix)]
#[test]
fn a_non_project_directory_is_none_before_source_validation() {
    use std::os::unix::fs::symlink;

    let tmp = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::create_dir_all(tmp.path().join("models")).unwrap();
    symlink(outside.path(), tmp.path().join("models/link")).unwrap();

    assert!(
        read_project_dir(tmp.path()).unwrap().is_none(),
        "a directory without wren_project.yml is not a project even if an ignored source root is malformed"
    );
}

#[test]
fn root_only_cubes_are_rejected_by_native_readers() {
    let tmp = tempfile::tempdir().unwrap();
    project(tmp.path());
    write(tmp.path(), "cubes.yml", ROOT_CUBE);

    for result in [
        read_project_dir(tmp.path()).map(|_| ()),
        capture_project(tmp.path()).map(|_| ()),
    ] {
        let error = result.expect_err("root-only cubes.yml is not an engine-readable v5 source");
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidInput);
        assert!(
            error.to_string().contains("cubes/<name>/metadata.yml"),
            "{error}"
        );
    }

    let output = tempfile::tempdir().unwrap();
    let context = output.path().join("context.json");
    let run = Command::new(env!("CARGO_BIN_EXE_wren-context-loader"))
        .arg(tmp.path())
        .arg("-o")
        .arg(&context)
        .output()
        .unwrap();
    assert!(!run.status.success());
    assert!(
        String::from_utf8_lossy(&run.stderr).contains("cubes/<name>/metadata.yml"),
        "{}",
        String::from_utf8_lossy(&run.stderr)
    );
    assert!(
        !context.exists(),
        "the loader must fail before writing output"
    );
}

#[test]
fn root_cube_mirror_requires_usable_matching_directory_semantics() {
    let cases = [
        ("empty", String::new()),
        ("comment-only", "# draft\n".to_string()),
        ("non-mapping", "just prose\n".to_string()),
        ("invalid", "name: order_metrics\n".to_string()),
        (
            "different-name",
            CUBE_METADATA.replacen("name: order_metrics", "name: other_metrics", 1),
        ),
        (
            "different-definition",
            CUBE_METADATA.replacen("SUM(total)", "SUM(other)", 1),
        ),
        (
            "different-base-object",
            CUBE_METADATA.replacen("base_object: orders", "base_object: other", 1),
        ),
        (
            "different-member-type",
            CUBE_METADATA.replacen("type: DOUBLE", "type: INTEGER", 1),
        ),
        (
            "different-hierarchy",
            format!("{CUBE_METADATA}hierarchies: {{ drill: [total_value] }}\n"),
        ),
    ];
    for (name, metadata) in cases {
        let tmp = tempfile::tempdir().unwrap();
        project(tmp.path());
        write(tmp.path(), "cubes.yml", ROOT_CUBE);
        write(tmp.path(), "cubes/order_metrics/metadata.yml", &metadata);
        for result in [
            read_project_dir(tmp.path()).map(|_| ()),
            capture_project(tmp.path()).map(|_| ()),
        ] {
            let error = result.expect_err(name);
            assert_eq!(error.kind(), std::io::ErrorKind::InvalidInput, "{name}");
            assert!(
                error.to_string().contains("exact semantic mirror"),
                "{name}: {error}"
            );
        }
    }

    let drafted = tempfile::tempdir().unwrap();
    project(drafted.path());
    write(drafted.path(), "cubes.yml", ROOT_CUBE);
    write(
        drafted.path(),
        "cubes/order_metrics/metadata.yml",
        CUBE_METADATA,
    );
    write(drafted.path(), "cubes/draft/metadata.yml", "# draft\n");
    read_project_dir(drafted.path())
        .expect("a comment-only draft cube must not void a correct mirror");
    capture_project(drafted.path())
        .expect("a comment-only draft cube must not void a correct mirror");

    let scalar = tempfile::tempdir().unwrap();
    project(scalar.path());
    write(scalar.path(), "cubes.yml", ROOT_CUBE);
    write(
        scalar.path(),
        "cubes/order_metrics/metadata.yml",
        CUBE_METADATA,
    );
    write(scalar.path(), "cubes/broken/metadata.yml", "just prose\n");
    assert!(
        read_project_dir(scalar.path()).is_err(),
        "a scalar cube metadata file is corrupt, not a draft"
    );
    assert!(
        capture_project(scalar.path()).is_err(),
        "a scalar cube metadata file is corrupt, not a draft"
    );

    let duplicate = tempfile::tempdir().unwrap();
    project(duplicate.path());
    write(duplicate.path(), "cubes.yml", ROOT_CUBE);
    write(duplicate.path(), "cubes/first/metadata.yml", CUBE_METADATA);
    write(duplicate.path(), "cubes/second/metadata.yml", CUBE_METADATA);
    for result in [
        read_project_dir(duplicate.path()).map(|_| ()),
        capture_project(duplicate.path()).map(|_| ()),
    ] {
        assert!(
            result.is_err(),
            "duplicate directory cube names must not be hidden"
        );
    }

    let tmp = tempfile::tempdir().unwrap();
    project(tmp.path());
    write(tmp.path(), "cubes.yml", ROOT_CUBE);
    write(
        tmp.path(),
        "cubes/order_metrics/metadata.yml",
        CUBE_METADATA,
    );
    assert!(read_project_dir(tmp.path()).unwrap().is_some());
    assert!(capture_project(tmp.path()).unwrap().sources.is_some());

    let tmp = tempfile::tempdir().unwrap();
    project(tmp.path());
    write(
        tmp.path(),
        "models/legacy.yml",
        "name: legacy\ncolumns: []\n",
    );
    write(tmp.path(), "views.yml", "views: []\n");
    assert!(read_project_dir(tmp.path()).unwrap().is_some());
    assert!(capture_project(tmp.path()).unwrap().sources.is_some());
}

#[test]
fn native_readers_reject_flat_v1_sources_but_keep_directory_layouts() {
    let project_versions = [
        (
            "explicit v1",
            "schema_version: 1\nname: legacy\ncatalog: wren\nschema: public\ndata_source: duckdb\n",
        ),
        (
            "default v1",
            "name: legacy\ncatalog: wren\nschema: public\ndata_source: duckdb\n",
        ),
    ];
    let flat_sources = [
        ("models/orders.yml", "name: orders\ncolumns: []\n"),
        ("cubes/order_metrics.yml", "name: order_metrics\n"),
        ("views.yml", "views: []\n"),
    ];
    for (version_name, wren_project) in project_versions {
        for (path, contents) in flat_sources {
            let tmp = tempfile::tempdir().unwrap();
            write(tmp.path(), "wren_project.yml", wren_project);
            write(tmp.path(), path, contents);
            for result in [
                read_project_dir(tmp.path()).map(|_| ()),
                capture_project(tmp.path()).map(|_| ()),
            ] {
                let error = result.expect_err(&format!("{version_name} {path}"));
                assert_eq!(error.kind(), std::io::ErrorKind::InvalidInput);
                assert!(
                    error.to_string().contains("directory layout"),
                    "{version_name} {path}: {error}"
                );
            }
        }
    }

    for (path, contents, empty_counterpart) in [
        (
            "models/orders.yml",
            "name: orders\ncolumns: []\n",
            "models/orders",
        ),
        (
            "cubes/order_metrics.yml",
            "name: order_metrics\n",
            "cubes/order_metrics",
        ),
        ("views.yml", "views: []\n", "views/current"),
    ] {
        let tmp = tempfile::tempdir().unwrap();
        write(
            tmp.path(),
            "wren_project.yml",
            "schema_version: 1\nname: legacy\ncatalog: wren\nschema: public\ndata_source: duckdb\n",
        );
        write(tmp.path(), path, contents);
        fs::create_dir_all(tmp.path().join(empty_counterpart)).unwrap();
        for result in [
            read_project_dir(tmp.path()).map(|_| ()),
            capture_project(tmp.path()).map(|_| ()),
        ] {
            let error = result.expect_err(path);
            assert_eq!(error.kind(), std::io::ErrorKind::InvalidInput);
            assert!(error.to_string().contains("flat-only"), "{path}: {error}");
        }
    }

    for wren_project in [
        "schema_version: 1\nname: directory\ncatalog: wren\nschema: public\ndata_source: duckdb\n",
        "name: directory\ncatalog: wren\nschema: public\ndata_source: duckdb\n",
        "schema_version: '٢'\nname: directory\ncatalog: wren\nschema: public\ndata_source: duckdb\n",
    ] {
        let tmp = tempfile::tempdir().unwrap();
        project(tmp.path());
        write(tmp.path(), "wren_project.yml", wren_project);
        assert_eq!(read_project_dir(tmp.path()).unwrap().unwrap().model_ymls.len(), 1);
        assert_eq!(
            capture_project(tmp.path())
                .unwrap()
                .sources
                .unwrap()
                .model_ymls
                .len(),
            1
        );
    }

    let tmp = tempfile::tempdir().unwrap();
    project(tmp.path());
    write(
        tmp.path(),
        "wren_project.yml",
        "schema_version: 1\nname: mirrored\ncatalog: wren\nschema: public\ndata_source: duckdb\n",
    );
    write(
        tmp.path(),
        "models/orders.yml",
        "name: orders\ncolumns: []\n",
    );
    write(
        tmp.path(),
        "cubes/order_metrics.yml",
        "name: order_metrics\n",
    );
    write(
        tmp.path(),
        "cubes/order_metrics/metadata.yml",
        CUBE_METADATA,
    );
    write(tmp.path(), "views.yml", "views: []\n");
    write(
        tmp.path(),
        "views/current/metadata.yml",
        "name: current\nstatement: SELECT 1\n",
    );
    assert!(read_project_dir(tmp.path()).unwrap().is_some());
    assert!(capture_project(tmp.path()).unwrap().sources.is_some());
}

#[cfg(unix)]
#[test]
fn non_v1_ignores_root_views_yml_without_reading_or_digesting_it() {
    let tmp = tempfile::tempdir().unwrap();
    project(tmp.path());
    let baseline = capture_project(tmp.path()).unwrap();

    write(tmp.path(), "views.yml", "views: first ignored value\n");
    assert!(read_project_dir(tmp.path()).unwrap().is_some());
    let first = capture_project(tmp.path()).unwrap();
    assert_eq!(first.digest, baseline.digest);

    write(tmp.path(), "views.yml", "views: changed ignored value\n");
    let second = capture_project(tmp.path()).unwrap();
    assert_eq!(second.digest, baseline.digest);

    fs::remove_file(tmp.path().join("views.yml")).unwrap();
    assert!(Command::new("mkfifo")
        .arg(tmp.path().join("views.yml"))
        .status()
        .unwrap()
        .success());
    assert!(read_project_dir(tmp.path()).unwrap().is_some());
    assert_eq!(capture_project(tmp.path()).unwrap().digest, baseline.digest);
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
    let error = match capture_project(tmp.path()) {
        Ok(_) => panic!("captured reader rejects view sql.yml dir"),
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

    fs::remove_file(tmp.path().join("views/stray/sql.yml")).unwrap();
    fs::create_dir(tmp.path().join("views/stray/sql.yml")).unwrap();
    assert!(
        capture_project(tmp.path())
            .unwrap()
            .sources
            .unwrap()
            .views
            .is_empty(),
        "a sql-only directory remains absent to the captured reader"
    );
}

#[test]
fn a_ref_sql_directory_without_model_metadata_is_not_a_model() {
    let tmp = tempfile::tempdir().unwrap();
    project(tmp.path());
    fs::create_dir_all(tmp.path().join("models/stray/ref_sql.sql")).unwrap();

    let snapshot = capture_project(tmp.path()).unwrap();
    assert_eq!(snapshot.sources.unwrap().model_ymls.len(), 1);
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
    write(tmp.path(), "knowledge/rules/a.md", "# Original rule\n");
    let model = tmp.path().join("models/orders/metadata.yml");
    let rule = tmp.path().join("knowledge/rules/a.md");
    let original = fs::read_to_string(&model).unwrap();
    let original_rule = fs::read_to_string(&rule).unwrap();
    let snapshot = capture_project(tmp.path()).unwrap();

    fs::write(&model, "name: changed\ncolumns: []\n").unwrap();
    fs::write(&rule, "# Changed rule\n").unwrap();
    let catalog = capability_catalog(snapshot.sources.as_ref().unwrap());
    assert_eq!(catalog.models[0].name, "orders");
    assert_eq!(snapshot.rules.content, "# Original rule");
    fs::write(&model, &original).unwrap();
    fs::write(&rule, &original_rule).unwrap();

    assert_eq!(snapshot.digest, project_digest(tmp.path()).unwrap());
    assert_eq!(
        snapshot.sources.as_ref().unwrap().model_ymls,
        read_project_dir(tmp.path()).unwrap().unwrap().model_ymls,
        "the captured semantic bytes survive an edit-and-restore interval without rereading"
    );
}

#[test]
fn the_manifest_layout_follows_the_schema_version_like_the_cli() {
    for (schema, layout) in [(1, 1), (2, 1), (3, 2), (4, 3), (5, 3)] {
        let tmp = tempfile::tempdir().unwrap();
        project(tmp.path());
        write(
            tmp.path(),
            "wren_project.yml",
            &format!("schema_version: {schema}\nname: reading\ncatalog: wren\nschema: public\ndata_source: duckdb\n"),
        );
        let sources = read_project_dir(tmp.path()).unwrap().unwrap();
        let loaded = assemble(&sources).expect("project assembles");
        assert_eq!(
            loaded.manifest.layout_version, layout,
            "schema_version {schema}"
        );
    }
    // Arabic-Indic four: the native gate reads it as 4 (Python's int() does too), and the
    // layout must follow the same conversion.
    let tmp = tempfile::tempdir().unwrap();
    project(tmp.path());
    write(
        tmp.path(),
        "wren_project.yml",
        "schema_version: '\u{0664}'\nname: reading\ncatalog: wren\nschema: public\ndata_source: duckdb\n",
    );
    let mut sources = read_project_dir(tmp.path()).unwrap().unwrap();
    assert_eq!(assemble(&sources).unwrap().manifest.layout_version, 3);

    // An in-memory caller's non-integer version is an error, as the CLI's int() is.
    sources.wren_project_yml =
        "schema_version: abc\nname: reading\ncatalog: wren\nschema: public\ndata_source: duckdb\n"
            .to_string();
    assert!(assemble(&sources).is_err());

    // 2^63 does not fit an i64: the native gate refuses it rather than saturating.
    let tmp = tempfile::tempdir().unwrap();
    project(tmp.path());
    write(
        tmp.path(),
        "wren_project.yml",
        "schema_version: 9223372036854775808.0\nname: reading\ncatalog: wren\nschema: public\ndata_source: duckdb\n",
    );
    let refused = read_project_dir(tmp.path())
        .err()
        .expect("an out-of-range version is refused");
    assert!(
        refused.to_string().contains("expected an integer"),
        "{refused}"
    );
}
