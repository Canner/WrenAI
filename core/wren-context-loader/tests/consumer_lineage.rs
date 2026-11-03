//! Consumer-node lineage: `knowledge/sql/<slug>.md` confirmed queries and `dashboards.yml` specs
//! become `query:`/`dashboard:` nodes downstream of the semantic layer, so a metric is no longer a
//! leaf — the blast-radius gate can finally say "this change reaches N dashboards". Also covers
//! the degradation paths: unparseable consumer SQL falls back to a whole-word scan and is recorded
//! in `lineage_diagnostics` (no silent caps), and a project with no consumer files behaves exactly
//! as before consumers existed.

use std::fs;
use std::path::Path;

use warble::ContextLoader;
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
    let radius = impact(&ctx, "metric:order_metrics.total_value");
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
    let radius = impact(&ctx, "metric:order_metrics.total_value");
    assert_eq!(
        radius.downstream,
        vec!["query:total-by-day".to_string()],
        "the declared metric is no longer a leaf"
    );
    assert_eq!(
        radius.severity.rank, 3,
        "hitting a consumer is a silent number shift for the end user"
    );
    assert!(impact(&ctx, "dim:order_metrics.placed_at")
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
            impact(&ctx, model)
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
    let radius = impact(&ctx, "metric:order_metrics.total_value");
    assert_eq!(radius.downstream, vec!["dashboard:exec-weekly".to_string()]);
    assert_eq!(radius.severity.rank, 3);

    // SQL panel: model → dashboard. And the full chain: the base model reaches the dashboard
    // through the cube AND directly counts it once (deduplicated edges).
    assert!(impact(&ctx, "model:customers")
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
        impact(&ctx, "model:orders")
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

/// The real `tests/fixtures/driftwood-wren` fixtures, end to end: ≥2 confirmed queries + 1 dashboard
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
    let radius = impact(&ctx, "metric:mrr_metrics.mrr");
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
    assert_eq!(radius.severity.rank, 3);

    // The SQL panel binds the dashboard to the models it queries.
    assert!(impact(&ctx, "model:orders")
        .downstream
        .contains(&"dashboard:exec-weekly".to_string()));

    // And the whole graph still resolves (no dangling consumer references in the fixtures).
    assert!(ctx.lineage().is_resolvable());
}

fn impact(ctx: &MdlContext, seed: &str) -> warble::HostImpact {
    ctx.host_analysis()
        .expect("Wren supplies impact analysis")
        .impact
        .get(seed)
        .expect("declared seed")
        .clone()
}

#[test]
fn prepared_v2_preserves_host_analysis_and_consumer_totals() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/driftwood-wren");
    let ctx = load(&dir);
    let document = wren_context_loader::prepared_document(&ctx).unwrap();
    let parsed = warble::PreparedContext::from_json(&document).unwrap();
    assert_eq!(parsed.host_analysis(), ctx.host_analysis());
    let counts = parsed.host_analysis().unwrap().consumers.unwrap();
    assert!(counts.queries >= 2);
    assert_eq!(counts.dashboards, 1);
    assert!(MdlContext::unparseable().host_analysis().is_none());
}

fn reaches(ctx: &MdlContext, seed: &str, consumer: &str) -> bool {
    impact(ctx, seed).downstream.contains(&consumer.to_string())
}

#[test]
fn cr12_a_cte_named_like_a_model_is_not_a_read_of_that_model() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    write(
        tmp.path(),
        "knowledge/sql/shadowed.md",
        "---\nsql: WITH orders AS (SELECT * FROM customers) SELECT COUNT(*) FROM orders\n---\n",
    );
    let ctx = load(tmp.path());

    assert!(
        !reaches(&ctx, "model:orders", "query:shadowed"),
        "`orders` here is the CTE, so the model is not a dependency of the query"
    );
    assert!(
        reaches(&ctx, "model:customers", "query:shadowed"),
        "the CTE body still reads `customers`"
    );
}

#[test]
fn cr12_a_cte_body_that_reads_the_same_named_model_still_links_it() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    write(
        tmp.path(),
        "knowledge/sql/pass-through.md",
        "---\nsql: WITH orders AS (SELECT * FROM orders WHERE total > 0) SELECT COUNT(*) FROM orders\n---\n",
    );
    write(
        tmp.path(),
        "knowledge/sql/later-sibling.md",
        "---\nsql: WITH a AS (SELECT * FROM orders), orders AS (SELECT * FROM a) SELECT * FROM orders\n---\n",
    );
    write(
        tmp.path(),
        "knowledge/sql/outside-the-cte.md",
        "---\nsql: SELECT * FROM (WITH orders AS (SELECT 1 AS id) SELECT * FROM orders) c JOIN orders o ON o.id = c.id\n---\n",
    );
    let ctx = load(tmp.path());

    for query in [
        "query:pass-through",
        "query:later-sibling",
        "query:outside-the-cte",
    ] {
        assert!(
            reaches(&ctx, "model:orders", query),
            "{query} reads the real `orders` model outside the scope of its CTE"
        );
    }
}

#[test]
fn cr12_a_view_over_a_cte_named_like_a_model_does_not_depend_on_the_model() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    write(
        tmp.path(),
        "views/by_country/metadata.yml",
        "name: by_country\n",
    );
    write(
        tmp.path(),
        "views/by_country/sql.yml",
        "statement: WITH orders AS (SELECT * FROM customers) SELECT country FROM orders\n",
    );
    let ctx = load(tmp.path());

    assert!(!ctx
        .lineage()
        .edges
        .iter()
        .any(|e| e.from == "model:orders" && e.to == "view:by_country"));
    assert!(ctx
        .lineage()
        .edges
        .iter()
        .any(|e| e.from == "model:customers" && e.to == "view:by_country"));
}

#[test]
fn cr14_view_backed_cube_resolves_to_view_node() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    write(
        tmp.path(),
        "views/big_orders/metadata.yml",
        "name: big_orders\n",
    );
    write(
        tmp.path(),
        "views/big_orders/sql.yml",
        "statement: SELECT id, total FROM orders WHERE total > 100\n",
    );
    write(
        tmp.path(),
        "cubes/big_order_metrics/metadata.yml",
        r#"name: big_order_metrics
base_object: big_orders
measures:
  - { name: big_total, expression: "SUM(total)", type: DOUBLE }
dimensions: []
time_dimensions: []
"#,
    );
    let ctx = load(tmp.path());

    let edges = &ctx.lineage().edges;
    assert!(
        edges
            .iter()
            .any(|e| e.from == "view:big_orders" && e.to == "cube:big_order_metrics"),
        "the cube hangs off the view it is built on; edges were {edges:?}"
    );
    assert!(ctx.lineage().is_resolvable());
    assert!(
        ctx.host_analysis().is_some(),
        "a resolvable graph keeps impact analysis available"
    );
    // The change to `orders` reaches the cube's metric through the view.
    assert!(reaches(
        &ctx,
        "model:orders",
        "metric:big_order_metrics.big_total"
    ));
}

#[test]
fn cr14_a_model_wins_when_a_model_and_a_view_share_the_cube_base_name() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    write(tmp.path(), "views/orders/metadata.yml", "name: orders\n");
    write(
        tmp.path(),
        "views/orders/sql.yml",
        "statement: SELECT * FROM customers\n",
    );
    let ctx = load(tmp.path());

    let edges = &ctx.lineage().edges;
    assert!(edges
        .iter()
        .any(|e| e.from == "model:orders" && e.to == "cube:order_metrics"));
    assert!(!edges
        .iter()
        .any(|e| e.from == "view:orders" && e.to == "cube:order_metrics"));
}

#[test]
fn cr15_a_measure_named_only_in_a_comment_or_a_string_does_not_link_the_consumer() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    write(
        tmp.path(),
        "knowledge/sql/mentions.md",
        "---\nsql: \"SELECT placed_at /* total_value */ FROM order_metrics WHERE 'total_value' <> 'x' GROUP BY placed_at -- total_value\"\n---\n",
    );
    write(
        tmp.path(),
        "knowledge/sql/uses.md",
        "---\nsql: SELECT placed_at, SUM(total_value) AS revenue FROM order_metrics GROUP BY placed_at\n---\n",
    );
    let ctx = load(tmp.path());

    assert!(
        !reaches(&ctx, "metric:order_metrics.total_value", "query:mentions"),
        "a comment and a string literal are not references to the measure"
    );
    assert!(
        reaches(&ctx, "dim:order_metrics.placed_at", "query:mentions"),
        "a real column reference still links"
    );
    assert!(
        reaches(&ctx, "metric:order_metrics.total_value", "query:uses"),
        "a real column reference still links"
    );
}
