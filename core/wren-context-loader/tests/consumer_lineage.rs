//! Consumer-node lineage: `knowledge/sql/<slug>.md` confirmed queries and `dashboards.yml` specs
//! become `query:`/`dashboard:` nodes downstream of the semantic layer, so a metric is no longer a
//! leaf — the blast-radius gate can finally say "this change reaches N dashboards". Also covers
//! the degradation paths: unparseable consumer SQL falls back to a whole-word scan and is recorded
//! in `lineage_diagnostics` (no silent caps), and a project with no consumer files behaves exactly
//! as before consumers existed.

use std::fs;
use std::path::Path;

use warble::{ContextLoader, Severity};
use wren_context_loader::{read_project_dir, MdlContext};

fn write(dir: &Path, rel: &str, contents: &str) {
    let path = dir.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, contents).unwrap();
}

/// The same minimal v5-shape project as `cli_v5_project.rs`: two models, one relationship, one
/// cube — the semantic layer consumers will point at.
fn base_project(dir: &Path) {
    write(
        dir,
        "wren_project.yml",
        "schema_version: 5\nname: consumerdemo\nversion: '1.0'\ncatalog: wren\nschema: public\ndata_source: duckdb\nprofile: consumerdemo\n",
    );
    write(
        dir,
        "models/customers/metadata.yml",
        r#"name: customers
table_reference: { catalog: demo, schema: main, table: customers }
primary_key: id
columns:
  - { name: id, type: INTEGER }
  - { name: country, type: VARCHAR }
"#,
    );
    write(
        dir,
        "models/orders/metadata.yml",
        r#"name: orders
table_reference: { catalog: demo, schema: main, table: orders }
primary_key: id
columns:
  - { name: id, type: INTEGER }
  - { name: customer_id, type: INTEGER }
  - { name: total, type: "DECIMAL(12,2)" }
  - { name: placed_at, type: TIMESTAMP }
"#,
    );
    write(
        dir,
        "relationships.yml",
        r#"relationships:
  - name: orders_customers
    models: [orders, customers]
    join_type: MANY_TO_ONE
    condition: "orders.customer_id = customers.id"
"#,
    );
    write(
        dir,
        "cubes/order_metrics/metadata.yml",
        r#"name: order_metrics
base_object: orders
measures:
  - { name: total_value, expression: "SUM(total)", type: DOUBLE }
dimensions: []
time_dimensions:
  - { name: placed_at, expression: placed_at, type: TIMESTAMP }
"#,
    );
}

fn load(dir: &Path) -> MdlContext {
    let sources = read_project_dir(dir)
        .expect("read project dir")
        .expect("fixture is a wren project");
    MdlContext::try_from_sources(&sources).expect("fixture assembles into a valid manifest")
}

#[test]
fn no_consumer_files_means_no_consumer_nodes_and_no_diagnostics() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    let ctx = load(tmp.path());

    assert!(ctx.lineage_diagnostics().is_empty());
    assert!(
        !ctx.lineage()
            .nodes
            .iter()
            .any(|n| n.id.starts_with("query:") || n.id.starts_with("dashboard:")),
        "a project without consumer artifacts must not grow consumer nodes"
    );
    // A metric is still a leaf here — the pre-consumer behavior, unchanged.
    let radius = ctx
        .lineage()
        .blast_radius("metric:order_metrics.total_value");
    assert!(radius.downstream.is_empty());
}

#[test]
fn confirmed_query_over_a_cube_makes_the_metric_reach_the_query() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    write(
        tmp.path(),
        "knowledge/sql/total-by-day.md",
        "---\nnl: total order value per day\nsql: SELECT placed_at, total_value FROM order_metrics GROUP BY placed_at\nsource: user\n---\n",
    );
    let ctx = load(tmp.path());

    assert!(ctx.lineage_diagnostics().is_empty(), "clean parse expected");
    assert!(ctx.lineage().contains("query:total-by-day"));
    // The query references the cube as a relation → cube edge; it mentions the measure and the
    // time dimension by name → metric/dim edges.
    let radius = ctx
        .lineage()
        .blast_radius("metric:order_metrics.total_value");
    assert_eq!(
        radius.downstream,
        vec!["query:total-by-day".to_string()],
        "the declared metric is no longer a leaf"
    );
    assert_eq!(
        radius.severity,
        Severity::Semantic,
        "hitting a consumer is a silent number shift for the end user"
    );
    assert!(ctx
        .lineage()
        .blast_radius("dim:order_metrics.placed_at")
        .downstream
        .contains(&"query:total-by-day".to_string()));
}

#[test]
fn confirmed_query_over_models_hangs_off_each_referenced_model() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    write(
        tmp.path(),
        "knowledge/sql/orders-per-country.md",
        "---\nsql: SELECT c.country, COUNT(*) FROM orders o JOIN customers c ON o.customer_id = c.id GROUP BY 1\n---\n",
    );
    let ctx = load(tmp.path());

    for model in ["model:orders", "model:customers"] {
        assert!(
            ctx.lineage()
                .blast_radius(model)
                .downstream
                .contains(&"query:orders-per-country".to_string()),
            "{model} must reach the confirmed query"
        );
    }
}

#[test]
fn dashboard_declared_cube_panel_links_cube_and_measures() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    write(
        tmp.path(),
        "dashboards.yml",
        r#"dashboards:
  - name: exec-weekly
    panels:
      - name: totals
        cube: order_metrics
        measures: [total_value]
      - name: by-country
        sql: SELECT country, COUNT(*) FROM customers GROUP BY country
"#,
    );
    let ctx = load(tmp.path());

    assert!(ctx.lineage_diagnostics().is_empty());
    assert!(ctx.lineage().contains("dashboard:exec-weekly"));
    assert!(ctx.lineage().is_resolvable());

    // Declared cube panel: metric → dashboard.
    let radius = ctx
        .lineage()
        .blast_radius("metric:order_metrics.total_value");
    assert_eq!(radius.downstream, vec!["dashboard:exec-weekly".to_string()]);
    assert_eq!(radius.severity, Severity::Semantic);

    // SQL panel: model → dashboard. And the full chain: the base model reaches the dashboard
    // through the cube AND directly counts it once (deduplicated edges).
    assert!(ctx
        .lineage()
        .blast_radius("model:customers")
        .downstream
        .contains(&"dashboard:exec-weekly".to_string()));
}

#[test]
fn dashboard_naming_a_missing_cube_is_a_dangling_edge_not_a_silent_skip() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    write(
        tmp.path(),
        "dashboards.yml",
        r#"dashboards:
  - name: ghost
    panels:
      - { name: broken, cube: no_such_cube, measures: [nope] }
"#,
    );
    let ctx = load(tmp.path());

    // A declared reference to a missing target dangles, exactly like a bad cube base_object —
    // `lineage_resolvable` (and the components gated on it) go loud instead of quietly ignoring.
    assert!(!ctx.lineage().is_resolvable());
}

#[test]
fn unparseable_consumer_sql_falls_back_to_whole_word_scan_and_is_recorded() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    // Not SQL sqlparser can parse — but it names `orders` as a whole word.
    write(
        tmp.path(),
        "knowledge/sql/broken.md",
        "---\nsql: \"SELCT * FRM ((( orders\"\n---\n",
    );
    let ctx = load(tmp.path());

    assert!(
        ctx.lineage()
            .blast_radius("model:orders")
            .downstream
            .contains(&"query:broken".to_string()),
        "fallback whole-word scan must still bind the query to `orders`"
    );
    let diagnostics = ctx.lineage_diagnostics();
    assert!(
        diagnostics
            .iter()
            .any(|d| d.contains("query:broken") && d.contains("whole-word")),
        "the degradation must be recorded honestly; diagnostics were: {diagnostics:?}"
    );
}

#[test]
fn knowledge_file_without_sql_is_skipped_with_a_diagnostic() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    write(
        tmp.path(),
        "knowledge/sql/note-only.md",
        "---\nnl: just a note\n---\n",
    );
    let ctx = load(tmp.path());

    assert!(!ctx.lineage().contains("query:note-only"));
    let diagnostics = ctx.lineage_diagnostics();
    assert!(
        diagnostics.iter().any(|d| d.contains("note-only")),
        "the skip must be recorded; diagnostics were: {diagnostics:?}"
    );
}

/// The real `examples/driftwood-wren` fixtures, end to end: ≥2 confirmed queries + 1 dashboard
/// spec, and the acceptance chain — `blast_radius("metric:mrr_metrics.mrr")` reaches both a
/// `query:` and a `dashboard:` node at Semantic severity.
#[test]
fn driftwood_metric_reaches_its_query_and_dashboard() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/driftwood-wren");
    let ctx = load(&dir);

    assert!(
        ctx.lineage_diagnostics().is_empty(),
        "driftwood consumer fixtures parse cleanly"
    );
    let radius = ctx.lineage().blast_radius("metric:mrr_metrics.mrr");
    assert!(
        radius.downstream.contains(&"query:mrr-trend".to_string()),
        "downstream was: {:?}",
        radius.downstream
    );
    assert!(
        radius
            .downstream
            .contains(&"dashboard:exec-weekly".to_string()),
        "downstream was: {:?}",
        radius.downstream
    );
    assert_eq!(radius.severity, Severity::Semantic);

    // The SQL panel binds the dashboard to the models it queries.
    assert!(ctx
        .lineage()
        .blast_radius("model:orders")
        .downstream
        .contains(&"dashboard:exec-weekly".to_string()));

    // And the whole graph still resolves (no dangling consumer references in the fixtures).
    assert!(ctx.lineage().is_resolvable());
}
