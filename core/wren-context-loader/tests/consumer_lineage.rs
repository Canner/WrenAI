//! Consumer-node lineage: `knowledge/sql/<slug>.md` confirmed queries and `dashboards.yml` specs
//! become `query:`/`dashboard:` nodes downstream of the semantic layer, so a metric is no longer a
//! leaf — the blast-radius gate can finally say "this change reaches N dashboards". Also covers
//! the degradation paths: unparseable consumer SQL falls back to a whole-word scan and is recorded
//! in `lineage_diagnostics` (no silent caps), and a project with no consumer files behaves exactly
//! as before consumers existed.

use std::fs;
use std::path::Path;

use warble::{verify_context_preconditions, ContextLoader};
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
  - { name: credit_limit, type: "DECIMAL(12,2)" }
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

/// Adds a relationship-backed calculated field. Selecting `customer_name` makes the engine plan
/// the declared relationship condition; a handwritten SQL JOIN does not use that MDL condition.
fn add_relationship_calculation(dir: &Path) {
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
  - { name: customer, type: customers, relationship: orders_customers }
  - { name: customer_name, type: VARCHAR, is_calculated: true, expression: "customer.country" }
  - { name: customer_credit, type: "DECIMAL(12,2)", is_calculated: true, expression: "customer.credit_limit" }
  - { name: customer_label, type: VARCHAR, is_calculated: true, expression: "UPPER(customer_name)" }
"#,
    );
}

fn add_hidden_relationship_calculation(dir: &Path) {
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
  - { name: customer, type: customers, relationship: orders_customers }
  - { name: hidden_customer_credit, type: "DECIMAL(12,2)", is_calculated: true, is_hidden: true, expression: "customer.credit_limit" }
"#,
    );
}

fn add_visible_calculation_with_hidden_relationship_dependency(dir: &Path) {
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
  - { name: customer, type: customers, relationship: orders_customers }
  - { name: hidden_customer_credit, type: "DECIMAL(12,2)", is_calculated: true, is_hidden: true, expression: "customer.credit_limit" }
  - { name: visible_customer_credit, type: "DECIMAL(12,2)", is_calculated: true, expression: "hidden_customer_credit" }
"#,
    );
}

fn add_multihop_relationship_calculation(dir: &Path) {
    add_relationship_calculation(dir);
    write(
        dir,
        "models/customers/metadata.yml",
        r#"name: customers
table_reference: { catalog: demo, schema: main, table: customers }
primary_key: id
columns:
  - { name: id, type: INTEGER }
  - { name: country_id, type: INTEGER }
  - { name: country, type: countries, relationship: customers_countries }
  - { name: customer_country_name, type: VARCHAR, is_calculated: true, expression: "country.name" }
"#,
    );
    write(
        dir,
        "models/countries/metadata.yml",
        r#"name: countries
table_reference: { catalog: demo, schema: main, table: countries }
primary_key: id
columns:
  - { name: id, type: INTEGER }
  - { name: name, type: VARCHAR }
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
  - { name: customer, type: customers, relationship: orders_customers }
  - { name: customer_name, type: VARCHAR, is_calculated: true, expression: "customer.id" }
  - { name: customer_label, type: VARCHAR, is_calculated: true, expression: "UPPER(customer_name)" }
  - { name: customer_country_name, type: VARCHAR, is_calculated: true, expression: "customer.customer_country_name" }
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
  - name: customers_countries
    models: [customers, countries]
    join_type: MANY_TO_ONE
    condition: "customers.country_id = countries.id"
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
fn an_empty_dashboards_document_adds_no_consumer_nodes_or_diagnostics() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    write(tmp.path(), "dashboards.yml", "# none\n");
    let ctx = load(tmp.path());

    assert!(ctx.lineage_diagnostics().is_empty());
    assert!(
        !ctx.lineage()
            .nodes
            .iter()
            .any(|node| node.id.starts_with("dashboard:")),
        "an empty optional dashboard document does not create a phantom consumer"
    );
    assert_eq!(
        ctx.host_analysis().unwrap().consumers.unwrap().dashboards,
        0
    );
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
fn relationship_condition_reaches_a_consumer_of_its_calculated_column() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    add_relationship_calculation(tmp.path());
    write(
        tmp.path(),
        "knowledge/sql/customer-names.md",
        "---\nsql: SELECT customer_name FROM orders\n---\n",
    );
    let ctx = load(tmp.path());

    assert!(
        reaches(&ctx, "rel:orders_customers", "query:customer-names"),
        "a calculated relationship column reads the declared condition during planning"
    );
}

#[test]
fn hidden_calculated_columns_do_not_create_consumer_relationship_edges() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    add_hidden_relationship_calculation(tmp.path());
    for (slug, sql) in [
        ("hidden-wildcard", "SELECT * FROM orders"),
        (
            "hidden-explicit",
            "SELECT hidden_customer_credit FROM orders",
        ),
    ] {
        write(
            tmp.path(),
            &format!("knowledge/sql/{slug}.md"),
            &format!("---\nsql: {sql}\n---\n"),
        );
    }
    let ctx = load(tmp.path());

    for query in ["query:hidden-wildcard", "query:hidden-explicit"] {
        assert!(
            !reaches(&ctx, "rel:orders_customers", query),
            "{query} must not claim an engine-rejected hidden calculation reads the relationship"
        );
    }

    let visible = tempfile::tempdir().unwrap();
    base_project(visible.path());
    add_visible_calculation_with_hidden_relationship_dependency(visible.path());
    write(
        visible.path(),
        "knowledge/sql/visible-dependency.md",
        "---\nsql: SELECT visible_customer_credit FROM orders\n---\n",
    );
    let visible = load(visible.path());
    assert!(
        reaches(&visible, "rel:orders_customers", "query:visible-dependency"),
        "a visible calculation still plans its hidden internal dependency"
    );
}

#[test]
fn relationship_condition_reaches_a_measure_of_its_calculated_column() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    add_relationship_calculation(tmp.path());
    write(
        tmp.path(),
        "cubes/order_metrics/metadata.yml",
        r#"name: order_metrics
base_object: orders
measures:
  - { name: customer_total, expression: "SUM(customer_credit)", type: DOUBLE }
dimensions: []
time_dimensions: []
"#,
    );
    let ctx = load(tmp.path());

    assert!(
        reaches(
            &ctx,
            "rel:orders_customers",
            "metric:order_metrics.customer_total"
        ),
        "planning a measure over a calculated relationship field reads the declared condition"
    );
}

#[test]
fn relationship_condition_reaches_a_qualified_measure_of_its_calculated_column_only() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    add_relationship_calculation(tmp.path());
    write(
        tmp.path(),
        "cubes/order_metrics/metadata.yml",
        r#"name: order_metrics
base_object: orders
measures:
  - { name: qualified_customer_total, expression: "SUM(orders.customer_credit)", type: DOUBLE }
  - { name: wrong_qualifier_total, expression: "SUM(customers.customer_credit)", type: DOUBLE }
dimensions: []
time_dimensions: []
"#,
    );
    let ctx = load(tmp.path());

    assert!(has_edge(
        &ctx,
        "rel:orders_customers",
        "metric:order_metrics.qualified_customer_total"
    ));
    assert!(
        !has_edge(
            &ctx,
            "rel:orders_customers",
            "metric:order_metrics.wrong_qualifier_total"
        ),
        "a relationship path must not be inferred from a different qualifier"
    );
}

#[test]
fn relationship_condition_reaches_dimensions_of_its_calculated_column() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    add_relationship_calculation(tmp.path());
    write(
        tmp.path(),
        "cubes/order_metrics/metadata.yml",
        r#"name: order_metrics
base_object: orders
measures: []
dimensions:
  - { name: customer_credit, expression: customer_credit, type: DECIMAL }
time_dimensions:
  - { name: customer_credit_at, expression: customer_credit, type: TIMESTAMP }
"#,
    );
    let ctx = load(tmp.path());

    for member in [
        "dim:order_metrics.customer_credit",
        "dim:order_metrics.customer_credit_at",
    ] {
        assert!(
            has_edge(&ctx, "rel:orders_customers", member),
            "planning {member} reads the declared relationship condition"
        );
    }
}

#[test]
fn correlated_outer_cube_members_are_linked_but_inner_columns_do_not_borrow_them() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    for (slug, sql) in [
        (
            "correlated",
            "SELECT 1 FROM order_metrics om WHERE EXISTS (SELECT 1 FROM orders o WHERE om.total_value > o.total)",
        ),
        (
            "inner-only",
            "SELECT 1 FROM order_metrics om WHERE EXISTS (SELECT total_value FROM orders o)",
        ),
        (
            "shadowed",
            "SELECT 1 FROM order_metrics om WHERE EXISTS (SELECT om.total_value FROM orders om)",
        ),
        (
            "table-function-shadowed",
            "SELECT 1 FROM order_metrics om WHERE EXISTS (SELECT om.total_value FROM UNNEST(ARRAY[1]) AS om(total_value))",
        ),
        (
            "union-branch-correlation",
            "SELECT 1 FROM order_metrics om WHERE EXISTS (SELECT 1 FROM orders o WHERE om.total_value > 0 UNION ALL SELECT 1 FROM orders om WHERE om.id > 0)",
        ),
        (
            "deep-outer-correlation",
            "SELECT 1 FROM order_metrics om WHERE EXISTS (SELECT 1 FROM orders o WHERE EXISTS (SELECT om.total_value))",
        ),
        (
            "middle-shadowed",
            "SELECT 1 FROM order_metrics om WHERE EXISTS (SELECT 1 FROM orders om WHERE EXISTS (SELECT om.total_value))",
        ),
    ] {
        write(
            tmp.path(),
            &format!("knowledge/sql/{slug}.md"),
            &format!("---\nsql: {sql}\n---\n"),
        );
    }
    let ctx = load(tmp.path());

    assert!(reaches(
        &ctx,
        "metric:order_metrics.total_value",
        "query:correlated"
    ));
    assert!(
        !reaches(&ctx, "metric:order_metrics.total_value", "query:inner-only"),
        "an unqualified inner column must not be attributed to the outer cube"
    );
    assert!(
        !reaches(&ctx, "metric:order_metrics.total_value", "query:shadowed"),
        "an inner source alias shadows the outer cube alias"
    );
    assert!(
        !reaches(
            &ctx,
            "metric:order_metrics.total_value",
            "query:table-function-shadowed"
        ),
        "a table-function alias shadows the outer cube alias"
    );
    assert!(
        reaches(
            &ctx,
            "metric:order_metrics.total_value",
            "query:union-branch-correlation"
        ),
        "an alias in another UNION branch must not mask a correlated outer reference"
    );
    assert!(
        reaches(
            &ctx,
            "metric:order_metrics.total_value",
            "query:deep-outer-correlation"
        ),
        "an unshadowed outer alias remains visible across nested queries"
    );
    assert!(
        !reaches(
            &ctx,
            "metric:order_metrics.total_value",
            "query:middle-shadowed"
        ),
        "a middle SELECT source shadows the outer cube alias for deeper queries"
    );
}

#[test]
fn relationship_condition_reaches_consumers_of_indirect_and_multihop_calculations() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    add_multihop_relationship_calculation(tmp.path());
    write(
        tmp.path(),
        "knowledge/sql/customer-label.md",
        "---\nsql: SELECT customer_label FROM orders\n---\n",
    );
    write(
        tmp.path(),
        "knowledge/sql/customer-country.md",
        "---\nsql: SELECT customer_country_name FROM orders\n---\n",
    );
    let ctx = load(tmp.path());

    assert!(reaches(
        &ctx,
        "rel:orders_customers",
        "query:customer-label"
    ));
    for relationship in ["rel:orders_customers", "rel:customers_countries"] {
        assert!(
            reaches(&ctx, relationship, "query:customer-country"),
            "{relationship} is required by the calculated relationship path"
        );
    }
}

#[test]
fn relationship_condition_reaches_a_view_of_its_calculated_column() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    add_relationship_calculation(tmp.path());
    write(
        tmp.path(),
        "views/customer_names/metadata.yml",
        "name: customer_names\n",
    );
    write(
        tmp.path(),
        "views/customer_names/sql.yml",
        "statement: SELECT customer_name FROM orders\n",
    );
    let ctx = load(tmp.path());

    assert!(
        reaches(&ctx, "rel:orders_customers", "view:customer_names"),
        "the view's calculated field makes planning read the relationship condition"
    );
}

#[test]
fn a_handwritten_join_does_not_depend_on_the_declared_relationship_condition() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    add_relationship_calculation(tmp.path());
    write(
        tmp.path(),
        "knowledge/sql/handwritten-join.md",
        "---\nsql: SELECT o.id FROM orders o JOIN customers c ON o.customer_id = c.id\n---\n",
    );
    let ctx = load(tmp.path());

    assert!(
        !reaches(&ctx, "rel:orders_customers", "query:handwritten-join"),
        "a query-owned JOIN ON does not read the declared relationship condition"
    );
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
fn duplicate_dashboard_names_are_skipped_with_a_diagnostic() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    write(
        tmp.path(),
        "dashboards.yml",
        r#"dashboards:
  - name: exec-weekly
    panels:
      - { cube: order_metrics, measures: [total_value] }
  - name: exec-weekly
    panels:
      - { sql: "SELECT * FROM customers" }
"#,
    );
    let ctx = load(tmp.path());

    assert_eq!(
        ctx.host_analysis().unwrap().consumers.unwrap().dashboards,
        1,
        "only the unambiguous dashboard must contribute a consumer node"
    );
    assert!(impact(&ctx, "metric:order_metrics.total_value")
        .downstream
        .contains(&"dashboard:exec-weekly".to_string()));
    assert!(
        !impact(&ctx, "model:customers")
            .downstream
            .contains(&"dashboard:exec-weekly".to_string()),
        "the duplicate dashboard's panels must not merge into the first dashboard"
    );
    assert!(
        ctx.lineage_diagnostics().iter().any(
            |diagnostic| diagnostic.contains("exec-weekly") && diagnostic.contains("duplicate")
        ),
        "the ambiguous identity must be visible to the host: {:?}",
        ctx.lineage_diagnostics()
    );
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
fn unparseable_consumer_sql_ignores_names_only_in_comments_or_literals() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    write(
        tmp.path(),
        "knowledge/sql/comment-only.md",
        "---\nsql: |\n  SELCT 'orders' /* orders */ -- orders\n---\n",
    );
    let ctx = load(tmp.path());

    assert!(
        !impact(&ctx, "model:orders")
            .downstream
            .contains(&"query:comment-only".to_string()),
        "comments and literals are not relation references"
    );
    assert!(ctx
        .lineage_diagnostics()
        .iter()
        .any(|d| d.contains("query:comment-only") && d.contains("whole-word")));
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

#[test]
fn prepared_context_keeps_expression_only_additivity_unknown_and_rejects_it() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/driftwood-wren");
    let document = wren_context_loader::prepared_document(&load(&dir)).unwrap();
    let parsed = warble::PreparedContext::from_json(&document).unwrap();

    assert_eq!(parsed.metric_additivity("mrr"), None);
    assert_eq!(parsed.metric_additivity("active_subscriptions"), None);
    assert_eq!(
        parsed.metric_additivity("avg_order_value"),
        Some(warble::Additivity::NonAdditive)
    );
    assert!(
        parsed.can_answer("metric_additive"),
        "published Warble reports this coarse capability from a declared metric"
    );
    verify_context_preconditions(&serde_json::json!([{"predicate": "has_metric"}]), &parsed)
        .expect("unknown additivity does not make a declared measure disappear");

    // A pinned unknown gets the public consumer's specific unanswerable outcome.
    let pinned = verify_context_preconditions(
        &serde_json::json!([{"predicate": "metric_additive", "args": {"metric": "mrr"}}]),
        &parsed,
    )
    .expect_err("a metric with unknown dimensional additivity must be rejected");
    assert!(pinned.to_string().contains("unanswerable"), "{pinned}");

    // The published coarse capability still says a declared metric exists; with no approved
    // measure, its existential evaluation fails rather than passing.
    let existential = verify_context_preconditions(
        &serde_json::json!([{"predicate": "metric_additive"}]),
        &parsed,
    )
    .expect_err("declared but unknown metrics must not satisfy the existential predicate");
    assert!(existential.to_string().contains("failed"), "{existential}");
}

fn reaches(ctx: &MdlContext, seed: &str, consumer: &str) -> bool {
    impact(ctx, seed).downstream.contains(&consumer.to_string())
}

fn has_edge(ctx: &MdlContext, from: &str, to: &str) -> bool {
    ctx.lineage()
        .edges
        .iter()
        .any(|edge| edge.from == from && edge.to == to)
}

#[test]
fn a_cte_named_like_a_model_is_not_a_read_of_that_model() {
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
fn a_cte_body_that_reads_the_same_named_model_still_links_it() {
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
fn a_view_over_a_cte_named_like_a_model_does_not_depend_on_the_model() {
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
fn views_chain_with_exact_first_case_resolution() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    write(tmp.path(), "views/Orders/metadata.yml", "name: Orders\n");
    write(
        tmp.path(),
        "views/Orders/sql.yml",
        "statement: SELECT id, total FROM orders\n",
    );
    write(
        tmp.path(),
        "views/order_report/metadata.yml",
        "name: order_report\n",
    );
    write(
        tmp.path(),
        "views/order_report/sql.yml",
        "statement: SELECT id, total FROM Orders\n",
    );
    write(
        tmp.path(),
        "knowledge/sql/order-report.md",
        "---\nsql: SELECT total FROM order_report\n---\n",
    );
    let ctx = load(tmp.path());

    assert!(has_edge(&ctx, "view:Orders", "view:order_report"));
    assert!(has_edge(&ctx, "view:order_report", "query:order-report"));
    assert!(
        !has_edge(&ctx, "model:orders", "view:order_report"),
        "the exact `Orders` view wins before case-insensitive model fallback"
    );
    assert!(reaches(&ctx, "model:orders", "query:order-report"));
}

#[test]
fn view_backed_cube_resolves_to_view_node() {
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
fn a_model_wins_when_a_model_and_a_view_share_the_cube_base_name() {
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
fn a_measure_named_only_in_a_comment_or_a_string_does_not_link_the_consumer() {
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

#[test]
fn under_recursive_a_cte_sees_its_later_siblings() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    write(
        tmp.path(),
        "knowledge/sql/recursive-siblings.md",
        "---\nsql: WITH RECURSIVE a AS (SELECT * FROM customers), customers AS (SELECT 1 AS id) SELECT * FROM a\n---\n",
    );
    let ctx = load(tmp.path());

    assert!(
        !reaches(&ctx, "model:customers", "query:recursive-siblings"),
        "under WITH RECURSIVE, `customers` inside `a` is the later sibling CTE, not the model"
    );
}

#[test]
fn nested_cube_sources_keep_exact_first_case_identity() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    write(
        tmp.path(),
        "cubes/Orders/metadata.yml",
        r#"name: Orders
base_object: orders
measures:
  - { name: total_value, expression: "SUM(total)", type: DOUBLE }
dimensions: []
time_dimensions: []
"#,
    );
    write(
        tmp.path(),
        "knowledge/sql/nested-case.md",
        "---\nsql: SELECT 1 FROM Orders WHERE EXISTS (SELECT total_value FROM orders)\n---\n",
    );

    let ctx = load(tmp.path());
    assert!(
        !reaches(&ctx, "metric:Orders.total_value", "query:nested-case"),
        "the outer case-distinct cube must not borrow an inner member"
    );
}

#[test]
fn cte_names_match_case_insensitively() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    write(
        tmp.path(),
        "knowledge/sql/mixed-case.md",
        "---\nsql: WITH Orders AS (SELECT * FROM customers) SELECT * FROM orders\n---\n",
    );
    let ctx = load(tmp.path());

    assert!(
        !reaches(&ctx, "model:orders", "query:mixed-case"),
        "`orders` resolves to the CTE `Orders`, as SQL names do"
    );
    assert!(reaches(&ctx, "model:customers", "query:mixed-case"));
}

#[test]
fn projection_wildcards_link_only_their_cube_members() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    for (slug, sql) in [
        ("all", "SELECT * FROM order_metrics"),
        ("alias", "SELECT om.* FROM order_metrics om"),
        ("count", "SELECT COUNT(*) FROM order_metrics"),
        (
            "customers-only",
            "SELECT c.* FROM customers c JOIN order_metrics om ON TRUE",
        ),
    ] {
        write(
            tmp.path(),
            &format!("knowledge/sql/{slug}.md"),
            &format!("---\nsql: {sql}\n---\n"),
        );
    }
    let ctx = load(tmp.path());

    for query in ["query:all", "query:alias"] {
        assert!(reaches(&ctx, "metric:order_metrics.total_value", query));
        assert!(reaches(&ctx, "dim:order_metrics.placed_at", query));
    }
    for query in ["query:count", "query:customers-only"] {
        assert!(!reaches(&ctx, "metric:order_metrics.total_value", query));
        assert!(!reaches(&ctx, "dim:order_metrics.placed_at", query));
    }
}

#[test]
fn qualified_cube_members_must_resolve_to_the_cube_source() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    write(
        tmp.path(),
        "knowledge/sql/unrelated-qualified.md",
        "---\nsql: SELECT c.total_value FROM customers c JOIN order_metrics om ON TRUE\n---\n",
    );
    write(
        tmp.path(),
        "knowledge/sql/cube-qualified.md",
        "---\nsql: SELECT om.total_value FROM customers c JOIN order_metrics om ON TRUE\n---\n",
    );
    let ctx = load(tmp.path());

    assert!(!reaches(
        &ctx,
        "metric:order_metrics.total_value",
        "query:unrelated-qualified"
    ));
    assert!(reaches(
        &ctx,
        "metric:order_metrics.total_value",
        "query:cube-qualified"
    ));
}

#[test]
fn cube_member_lineage_resolves_model_cube_name_collisions_exact_first() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    write(
        tmp.path(),
        "cubes/orders_caps/metadata.yml",
        r#"name: Orders
base_object: orders
measures:
  - { name: total_value, expression: "SUM(total)", type: DOUBLE }
dimensions: []
time_dimensions: []
"#,
    );
    for (slug, sql) in [
        ("model", "SELECT m.total_value FROM orders m"),
        ("cube", "SELECT m.total_value FROM Orders m"),
    ] {
        write(
            tmp.path(),
            &format!("knowledge/sql/{slug}.md"),
            &format!("---\nsql: {sql}\n---\n"),
        );
    }
    let ctx = load(tmp.path());

    assert!(
        !reaches(&ctx, "metric:Orders.total_value", "query:model"),
        "the exact model spelling must not borrow the case-distinct cube member"
    );
    assert!(reaches(&ctx, "metric:Orders.total_value", "query:cube"));
}

#[test]
fn an_alias_hides_a_source_name_for_qualified_cube_members() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    for (slug, sql) in [
        (
            "aliased",
            "SELECT om.total_value FROM order_metrics om JOIN om AS x ON TRUE",
        ),
        (
            "original-name",
            "SELECT order_metrics.total_value FROM order_metrics om",
        ),
    ] {
        write(
            tmp.path(),
            &format!("knowledge/sql/{slug}.md"),
            &format!("---\nsql: {sql}\n---\n"),
        );
    }
    let ctx = load(tmp.path());

    assert!(reaches(
        &ctx,
        "metric:order_metrics.total_value",
        "query:aliased"
    ));
    assert!(
        !reaches(
            &ctx,
            "metric:order_metrics.total_value",
            "query:original-name"
        ),
        "a table alias hides its original source name"
    );
}

#[test]
fn unaliased_parenthesized_joins_retain_inner_cube_aliases() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    for (slug, sql) in [
        (
            "unaliased",
            "SELECT om.total_value FROM (order_metrics om JOIN customers c ON TRUE)",
        ),
        (
            "aliased",
            "SELECT joined.total_value FROM (order_metrics om JOIN customers c ON TRUE) joined",
        ),
    ] {
        write(
            tmp.path(),
            &format!("knowledge/sql/{slug}.md"),
            &format!("---\nsql: {sql}\n---\n"),
        );
    }
    let ctx = load(tmp.path());

    assert!(reaches(
        &ctx,
        "metric:order_metrics.total_value",
        "query:unaliased"
    ));
    assert!(
        !reaches(&ctx, "metric:order_metrics.total_value", "query:aliased"),
        "an alias on the parenthesized join hides its inner relation aliases"
    );
}

#[test]
fn qualified_relations_do_not_resolve_to_local_semantic_objects() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    for (slug, sql) in [
        ("orders", "SELECT * FROM orders"),
        ("main-orders", "SELECT * FROM main.orders"),
        ("external-orders", "SELECT * FROM external_schema.orders"),
        ("catalog-orders", "SELECT * FROM catalog.schema.orders"),
        ("cube", "SELECT total_value FROM order_metrics"),
        (
            "qualified-cube",
            "SELECT total_value FROM main.order_metrics",
        ),
        (
            "cte",
            "WITH orders AS (SELECT 1 AS id) SELECT * FROM orders",
        ),
    ] {
        write(
            tmp.path(),
            &format!("knowledge/sql/{slug}.md"),
            &format!("---\nsql: {sql}\n---\n"),
        );
    }
    let ctx = load(tmp.path());

    assert!(reaches(&ctx, "model:orders", "query:orders"));
    assert!(reaches(
        &ctx,
        "metric:order_metrics.total_value",
        "query:cube"
    ));
    for query in [
        "query:main-orders",
        "query:external-orders",
        "query:catalog-orders",
        "query:cte",
    ] {
        assert!(
            !reaches(&ctx, "model:orders", query),
            "{query} must not resolve a qualified physical relation or CTE as the local model"
        );
    }
    assert!(
        !reaches(
            &ctx,
            "metric:order_metrics.total_value",
            "query:qualified-cube"
        ),
        "a qualified physical relation must not donate local cube member provenance"
    );
}

#[test]
fn quoted_ctes_and_relations_preserve_engine_case_resolution() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    write(
        tmp.path(),
        "knowledge/sql/quoted-cte.md",
        "---\nsql: WITH \"Orders\" AS (SELECT * FROM customers) SELECT * FROM orders\n---\n",
    );
    write(
        tmp.path(),
        "knowledge/sql/unquoted-model.md",
        "---\nsql: SELECT * FROM ORDERS\n---\n",
    );
    write(
        tmp.path(),
        "knowledge/sql/quoted-model.md",
        "---\nsql: SELECT * FROM \"ORDERS\"\n---\n",
    );
    let ctx = load(tmp.path());

    assert!(reaches(&ctx, "model:customers", "query:quoted-cte"));
    assert!(!reaches(&ctx, "model:orders", "query:quoted-cte"));
    assert!(reaches(&ctx, "model:orders", "query:unquoted-model"));
    assert!(!reaches(&ctx, "model:orders", "query:quoted-model"));
}

#[test]
fn duckdb_cte_scope_folds_quotes_and_case() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    for (slug, sql) in [
        (
            "unquoted-to-quoted",
            "WITH orders AS (SELECT 1) SELECT * FROM \"ORDERS\"",
        ),
        (
            "quoted-variants",
            "WITH \"Orders\" AS (SELECT 1) SELECT * FROM \"ORDERS\"",
        ),
    ] {
        write(
            tmp.path(),
            &format!("knowledge/sql/{slug}.md"),
            &format!("---\nsql: {sql}\n---\n"),
        );
    }
    let ctx = load(tmp.path());
    for query in ["query:unquoted-to-quoted", "query:quoted-variants"] {
        assert!(!reaches(&ctx, "model:orders", query));
    }
}

#[test]
fn cte_projection_does_not_borrow_a_cube_member_from_its_body() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    write(
        tmp.path(),
        "knowledge/sql/cte-constant.md",
        "---\nsql: WITH c AS (SELECT 1 AS total_value FROM order_metrics) SELECT total_value FROM c\n---\n",
    );
    let ctx = load(tmp.path());

    assert!(!reaches(
        &ctx,
        "metric:order_metrics.total_value",
        "query:cte-constant"
    ));
}

#[test]
fn query_order_by_uses_the_select_scope_without_borrowing_output_aliases() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    for (slug, sql) in [
        ("member", "SELECT 1 FROM order_metrics ORDER BY total_value"),
        (
            "constant-alias",
            "SELECT 1 AS total_value FROM order_metrics ORDER BY total_value",
        ),
        (
            "quoted-constant-alias",
            "SELECT 1 AS \"TOTAL_VALUE\" FROM order_metrics ORDER BY total_value",
        ),
        (
            "reverse-quoted-constant-alias",
            "SELECT 1 AS total_value FROM order_metrics ORDER BY \"TOTAL_VALUE\"",
        ),
        (
            "qualified",
            "SELECT 1 FROM order_metrics om ORDER BY om.total_value",
        ),
        (
            "cte",
            "WITH c AS (SELECT 1 AS total_value) SELECT 1 FROM c ORDER BY total_value",
        ),
        (
            "derived",
            "SELECT 1 FROM (SELECT 1 AS total_value) c ORDER BY total_value",
        ),
        (
            "union",
            "SELECT 1 FROM order_metrics UNION ALL SELECT 1 FROM customers ORDER BY total_value",
        ),
    ] {
        write(
            tmp.path(),
            &format!("knowledge/sql/{slug}.md"),
            &format!("---\nsql: {sql}\n---\n"),
        );
    }

    let ctx = load(tmp.path());
    for query in ["query:member", "query:qualified"] {
        assert!(
            reaches(&ctx, "metric:order_metrics.total_value", query),
            "{query} should retain its SELECT source provenance"
        );
    }
    for query in [
        "query:constant-alias",
        "query:quoted-constant-alias",
        "query:reverse-quoted-constant-alias",
        "query:cte",
        "query:derived",
        "query:union",
    ] {
        assert!(
            !reaches(&ctx, "metric:order_metrics.total_value", query),
            "{query} must not borrow an unrelated cube member"
        );
    }
}

#[test]
fn derived_source_does_not_borrow_a_nested_cube_alias() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    write(
        tmp.path(),
        "knowledge/sql/derived-constant.md",
        "---\nsql: SELECT c.total_value FROM (SELECT 1 AS total_value) c WHERE EXISTS (SELECT 1 FROM order_metrics c)\n---\n",
    );
    let ctx = load(tmp.path());

    assert!(!reaches(
        &ctx,
        "metric:order_metrics.total_value",
        "query:derived-constant"
    ));
}

#[test]
fn set_operation_projection_wildcards_keep_their_branch_sources() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    write(
        tmp.path(),
        "knowledge/sql/union-all.md",
        "---\nsql: SELECT * FROM order_metrics UNION ALL SELECT * FROM order_metrics\n---\n",
    );
    let ctx = load(tmp.path());

    assert!(reaches(
        &ctx,
        "metric:order_metrics.total_value",
        "query:union-all"
    ));
    assert!(reaches(
        &ctx,
        "dim:order_metrics.placed_at",
        "query:union-all"
    ));
}

#[test]
fn outer_columns_after_nested_queries_still_resolve_to_their_cube() {
    let tmp = tempfile::tempdir().unwrap();
    base_project(tmp.path());
    for (slug, sql) in [
        (
            "later-projection",
            "SELECT (SELECT 1), om.total_value FROM order_metrics om",
        ),
        (
            "later-expression",
            "SELECT COALESCE((SELECT 1), om.total_value) FROM order_metrics om",
        ),
    ] {
        write(
            tmp.path(),
            &format!("knowledge/sql/{slug}.md"),
            &format!("---\nsql: {sql}\n---\n"),
        );
    }
    let ctx = load(tmp.path());

    for query in ["query:later-projection", "query:later-expression"] {
        assert!(reaches(&ctx, "metric:order_metrics.total_value", query));
    }
}
