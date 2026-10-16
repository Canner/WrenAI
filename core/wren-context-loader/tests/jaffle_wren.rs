//! Integration tests over the real `examples/jaffle-wren` project. It declares a `revenue` cube
//! (Phase 2), so `metric_additive` is answerable — `total_revenue` (SUM) is additive and
//! `avg_order_value` (AVG) is not. Existence predicates also hold via plain model columns. The
//! cube-*less* case (where `metric_additive` is unanswerable) is covered by a synthetic manifest in
//! the crate's unit tests.

use std::path::Path;

use warble::{Additivity, ContextLoader, Severity};
use wren_context_loader::{read_project_dir, MdlContext};

fn jaffle_wren() -> MdlContext {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/jaffle-wren");
    let sources = read_project_dir(&dir)
        .expect("read jaffle-wren")
        .expect("jaffle-wren is a wren project");
    MdlContext::try_from_sources(&sources).expect("jaffle-wren assembles into a valid manifest")
}

#[test]
fn parses_and_projects_models() {
    let ctx = jaffle_wren();
    assert!(ctx.is_parseable());

    // Every jaffle model is projected.
    let model_names: Vec<&str> = ctx.models().iter().map(|m| m.name.as_str()).collect();
    for expected in [
        "customers",
        "orders",
        "raw_customers",
        "raw_orders",
        "raw_payments",
    ] {
        assert!(
            model_names.contains(&expected),
            "missing model {expected}: {model_names:?}"
        );
    }

    // orders has a DATE column (order_date) → has_timestamp.
    let orders = ctx.model("orders").expect("orders model");
    assert!(orders.has_timestamp, "orders has a DATE column");
}

#[test]
fn existence_predicates_hold_via_columns() {
    let ctx = jaffle_wren();
    // Numeric columns (amount, customer_lifetime_value, …) → has_metric holds even with no cube.
    assert!(
        !ctx.metrics().is_empty(),
        "numeric columns are queryable metrics"
    );
    // Textual columns (status, first_name, …) → groupable dimensions.
    assert!(!ctx.dimensions().is_empty());
    // DATE columns (order_date, first_order, …) → time dimensions.
    assert!(!ctx.time_dimensions().is_empty());
}

#[test]
fn metric_additive_answerable_via_revenue_cube() {
    let ctx = jaffle_wren();
    // The revenue cube declares measures ⇒ additivity is expressible ⇒ answerable.
    assert!(
        ctx.can_answer("metric_additive"),
        "the revenue cube makes metric_additive answerable"
    );
    // Additivity is inferred from each measure's aggregation.
    assert_eq!(
        ctx.metric_additivity("total_revenue"),
        Some(Additivity::Additive),
        "total_revenue = SUM(amount) is additive"
    );
    assert_eq!(
        ctx.metric_additivity("avg_order_value"),
        Some(Additivity::NonAdditive),
        "avg_order_value = AVG(amount) is non-additive"
    );
    // Both declared (cube) and implicit (column) metrics are present.
    assert!(ctx.metrics().iter().any(|m| m.declared));
    assert!(ctx.metrics().iter().any(|m| !m.declared));
}

#[test]
fn lineage_is_resolvable() {
    let ctx = jaffle_wren();
    let lineage = ctx.lineage();
    assert!(
        lineage.is_resolvable(),
        "no dangling references in jaffle-wren lineage"
    );
    // Relationships connect real models: orders → rel:orders_customers is an edge.
    assert!(lineage.contains("model:orders"));
    assert!(lineage.contains("rel:orders_customers"));
    assert!(lineage
        .edges
        .iter()
        .any(|e| e.from == "model:orders" && e.to == "rel:orders_customers"));
}

#[test]
fn blast_radius_of_orders_reaches_the_revenue_cube_and_is_semantic() {
    let ctx = jaffle_wren();
    let radius = ctx.lineage().blast_radius("model:orders");
    // The revenue cube sits on orders, so changing orders reaches the cube + its measures.
    assert!(radius.downstream.contains(&"cube:revenue".to_string()));
    assert!(radius
        .downstream
        .contains(&"metric:revenue.total_revenue".to_string()));
    // A downstream metric ⇒ the worst impact is a silent number shift ⇒ semantic.
    assert_eq!(radius.severity, Severity::Semantic);
}
