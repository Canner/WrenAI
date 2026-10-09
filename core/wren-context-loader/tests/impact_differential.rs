//! Differential test: Wren's own impact traversal against the framework's `blast_radius`.
//!
//! Wren now owns the lineage ontology, the severity model and the traversal, because classifying
//! impact is a judgement about what MDL objects mean. The framework still computes its own copy
//! for one more step, and the two answers are what a consumer's threshold gate reads — so while
//! both exist, they must agree exactly, node by node, on the downstream set *and* on the severity
//! rank. This file is the guard on that overlap.
//!
//! Each case builds a `warble::LineageGraph`, projects it into an [`ImpactGraph`], and compares
//! every node in the graph as a seed — plus ids that are not nodes at all. The severity cases are
//! exhaustive over all nine kinds, one kind per graph, so the worst-severity answer is exactly
//! that kind's class: any permutation of the classification arms changes a rank and fails here.

use std::collections::BTreeSet;
use std::path::Path;

use warble::{ContextLoader, LineageEdge, LineageGraph, LineageKind, LineageNode, PreparedContext};
use wren_context_loader::{prepared_document, read_project_dir, ImpactGraph, MdlContext, Severity};

fn node(id: &str, kind: LineageKind) -> LineageNode {
    LineageNode {
        id: id.to_string(),
        kind,
    }
}

fn edge(from: &str, to: &str) -> LineageEdge {
    LineageEdge {
        from: from.to_string(),
        to: to.to_string(),
    }
}

/// Compare the two analyses for `seed`, field by field. Returns the shared downstream set so a
/// caller can additionally pin what it expects.
fn assert_agrees_on(graph: &LineageGraph, seed: &str) -> Vec<String> {
    let ours = ImpactGraph::from(graph).impact(seed);
    let theirs = graph.blast_radius(seed);

    assert_eq!(
        ours.seed, theirs.seed,
        "seed echoed differently for {seed:?}"
    );
    assert_eq!(
        ours.downstream, theirs.downstream,
        "downstream set disagreed for {seed:?}"
    );
    assert_eq!(
        ours.severity.rank(),
        theirs.severity.rank(),
        "severity rank disagreed for {seed:?} (ours {}, theirs {})",
        ours.severity.label(),
        theirs.severity.label()
    );
    assert_eq!(
        ours.severity.label(),
        theirs.severity.label(),
        "severity label disagreed for {seed:?}"
    );
    ours.downstream
}

/// Every declared node as a seed, plus ids that are not in the graph.
fn assert_agrees_everywhere(graph: &LineageGraph) {
    for n in &graph.nodes {
        assert_agrees_on(graph, &n.id);
    }
    for absent in ["", "model:does_not_exist", "metric:nope.nope"] {
        assert_agrees_on(graph, absent);
    }
}

#[test]
fn leaf_node_reaches_nothing() {
    let graph = LineageGraph {
        nodes: vec![
            node("model:orders", LineageKind::Model),
            node("dashboard:sales", LineageKind::Dashboard),
        ],
        edges: vec![edge("model:orders", "dashboard:sales")],
    };

    // The dashboard is a sink: nothing downstream, so nothing to be severe about.
    let downstream = assert_agrees_on(&graph, "dashboard:sales");
    assert!(downstream.is_empty(), "a sink reached {downstream:?}");
    let leaf = ImpactGraph::from(&graph).impact("dashboard:sales");
    assert_eq!(leaf.severity, Severity::None);

    assert_agrees_everywhere(&graph);
}

#[test]
fn unknown_seed_reaches_nothing() {
    let graph = LineageGraph {
        nodes: vec![node("model:orders", LineageKind::Model)],
        edges: vec![],
    };
    let downstream = assert_agrees_on(&graph, "model:typo");
    assert!(downstream.is_empty());
}

#[test]
fn fan_out_reaches_every_child() {
    let graph = LineageGraph {
        nodes: vec![
            node("model:orders", LineageKind::Model),
            node("rel:orders_customers", LineageKind::Relationship),
            node("cube:order_metrics", LineageKind::Cube),
            node("view:recent_orders", LineageKind::View),
        ],
        edges: vec![
            edge("model:orders", "rel:orders_customers"),
            edge("model:orders", "cube:order_metrics"),
            edge("model:orders", "view:recent_orders"),
        ],
    };

    let downstream = assert_agrees_on(&graph, "model:orders");
    assert_eq!(
        downstream,
        vec![
            "cube:order_metrics".to_string(),
            "rel:orders_customers".to_string(),
            "view:recent_orders".to_string(),
        ],
        "fan-out should reach all three children, sorted"
    );
    // A view is downstream, so the worst class is structural even though two siblings are milder.
    assert_eq!(
        ImpactGraph::from(&graph).impact("model:orders").severity,
        Severity::Structural
    );

    assert_agrees_everywhere(&graph);
}

#[test]
fn multi_hop_chain_is_transitive() {
    // model → cube → metric → dashboard: four hops, and the worst class sits at the far end.
    let graph = LineageGraph {
        nodes: vec![
            node("model:subscriptions", LineageKind::Model),
            node("cube:mrr_metrics", LineageKind::Cube),
            node("metric:mrr_metrics.total_mrr", LineageKind::Metric),
            node("dashboard:revenue", LineageKind::Dashboard),
        ],
        edges: vec![
            edge("model:subscriptions", "cube:mrr_metrics"),
            edge("cube:mrr_metrics", "metric:mrr_metrics.total_mrr"),
            edge("metric:mrr_metrics.total_mrr", "dashboard:revenue"),
        ],
    };

    let downstream = assert_agrees_on(&graph, "model:subscriptions");
    assert_eq!(
        downstream.len(),
        3,
        "the whole chain is downstream, not just the next hop: {downstream:?}"
    );
    // The metric at the end is what makes this semantic: numbers move and nothing errors.
    assert_eq!(
        ImpactGraph::from(&graph)
            .impact("model:subscriptions")
            .severity,
        Severity::Semantic
    );

    assert_agrees_everywhere(&graph);
}

/// Every kind, one per graph, so the seed's worst severity *is* that kind's class. This is the
/// case that a swapped classification arm cannot survive.
#[test]
fn every_kind_classifies_the_same_on_both_sides() {
    let cases: [(LineageKind, &str, Severity); 9] = [
        (LineageKind::Metric, "semantic", Severity::Semantic),
        (LineageKind::Query, "semantic", Severity::Semantic),
        (LineageKind::Dashboard, "semantic", Severity::Semantic),
        (LineageKind::Model, "structural", Severity::Structural),
        (LineageKind::View, "structural", Severity::Structural),
        (LineageKind::Column, "structural", Severity::Structural),
        (
            LineageKind::Relationship,
            "compatibility",
            Severity::Compatibility,
        ),
        (LineageKind::Cube, "compatibility", Severity::Compatibility),
        (
            LineageKind::Dimension,
            "compatibility",
            Severity::Compatibility,
        ),
    ];

    for (kind, expected_label, expected) in cases {
        let graph = LineageGraph {
            nodes: vec![node("model:root", LineageKind::Model), node("target", kind)],
            edges: vec![edge("model:root", "target")],
        };

        // Pin Wren's own judgement, independent of what the framework says...
        let ours = ImpactGraph::from(&graph).impact("model:root");
        assert_eq!(
            ours.severity, expected,
            "{kind:?} downstream should be {expected_label}"
        );
        assert_eq!(ours.severity.label(), expected_label);
        // Pin the set as well, for the same reason and in the same order: the severity above is
        // only meaningful because `target` is what the seed reaches, so a case that stopped
        // reaching it would assert nothing while still passing.
        assert_eq!(
            ours.downstream,
            vec!["target".to_string()],
            "{kind:?} case must actually reach its target"
        );
        // ...and that the framework still agrees while it computes its own copy.
        let downstream = assert_agrees_on(&graph, "model:root");
        assert_eq!(downstream, ours.downstream);
        assert_agrees_everywhere(&graph);
    }
}

#[test]
fn severity_ranks_are_ordered_least_to_most_dangerous() {
    assert_eq!(Severity::None.rank(), 0);
    assert_eq!(Severity::Compatibility.rank(), 1);
    assert_eq!(Severity::Structural.rank(), 2);
    assert_eq!(Severity::Semantic.rank(), 3);
    assert!(Severity::Semantic > Severity::Structural);
    assert!(Severity::Structural > Severity::Compatibility);
    assert!(Severity::Compatibility > Severity::None);
}

#[test]
fn a_cyclic_graph_terminates_and_still_agrees() {
    // A malformed project can present a cycle. Both traversals must stop, and neither may count
    // the seed as downstream of itself.
    let graph = LineageGraph {
        nodes: vec![
            node("model:a", LineageKind::Model),
            node("model:b", LineageKind::Model),
            node("metric:c.c", LineageKind::Metric),
        ],
        edges: vec![
            edge("model:a", "model:b"),
            edge("model:b", "metric:c.c"),
            edge("metric:c.c", "model:a"),
        ],
    };

    for seed in ["model:a", "model:b", "metric:c.c"] {
        let downstream = assert_agrees_on(&graph, seed);
        assert!(
            !downstream.contains(&seed.to_string()),
            "{seed} was reported downstream of itself"
        );
        assert_eq!(downstream.len(), 2, "{seed} should reach the other two");
    }

    // A two-node cycle, where the only edge out of the seed points back at it.
    let tight = LineageGraph {
        nodes: vec![
            node("model:x", LineageKind::Model),
            node("model:y", LineageKind::Model),
        ],
        edges: vec![edge("model:x", "model:y"), edge("model:y", "model:x")],
    };
    assert_agrees_everywhere(&tight);
    let self_loop = LineageGraph {
        nodes: vec![node("model:z", LineageKind::Model)],
        edges: vec![edge("model:z", "model:z")],
    };
    let downstream = assert_agrees_on(&self_loop, "model:z");
    assert!(
        downstream.is_empty(),
        "a self-loop is not its own blast radius"
    );
}

/// A seed that is an edge *source* but not a declared node. Distinct from a dangling endpoint:
/// here the undeclared id has outgoing edges, so "unknown seed" and "leaf seed" come apart, and
/// whether the traversal short-circuits on an undeclared seed becomes observable.
#[test]
fn a_dangling_edge_source_agrees_too() {
    let graph = LineageGraph {
        nodes: vec![node("dashboard:sales", LineageKind::Dashboard)],
        edges: vec![edge("model:missing", "dashboard:sales")],
    };
    // Pin the answer *before* checking agreement, deliberately. Agreement alone is not enough:
    // if both sides ever treated an undeclared source as a leaf they would agree on an empty
    // result and this case would pass while the property it exists to pin had gone. Asserting the
    // value first also keeps it from being shadowed — a one-sided regression would otherwise trip
    // the agreement check and this assertion would never run.
    let ours = ImpactGraph::from(&graph).impact("model:missing");
    assert_eq!(
        ours.downstream,
        vec!["dashboard:sales".to_string()],
        "an undeclared seed's edges are still followed"
    );
    assert_eq!(
        ours.severity,
        Severity::Semantic,
        "and the dashboard it reaches still sets the class"
    );

    let downstream = assert_agrees_on(&graph, "model:missing");
    assert_eq!(downstream, ours.downstream);
    assert_agrees_everywhere(&graph);
}

#[test]
fn a_dangling_edge_endpoint_carries_no_severity() {
    // `is_resolvable` is what reports a dangling reference; the impact analysis must not invent a
    // severity for a node nobody declared.
    let graph = LineageGraph {
        nodes: vec![node("model:orders", LineageKind::Model)],
        edges: vec![edge("model:orders", "cube:never_declared")],
    };
    let downstream = assert_agrees_on(&graph, "model:orders");
    assert_eq!(downstream, vec!["cube:never_declared".to_string()]);
    assert_eq!(
        ImpactGraph::from(&graph).impact("model:orders").severity,
        Severity::None,
        "an undeclared endpoint has no known class"
    );
}

#[test]
fn a_mixed_graph_agrees_on_every_node() {
    // One graph holding all nine kinds, a diamond, a fan-in and a consumer layer — exercised from
    // every node as a seed.
    let graph = LineageGraph {
        nodes: vec![
            node("model:orders", LineageKind::Model),
            node("model:customers", LineageKind::Model),
            node("column:orders.amount", LineageKind::Column),
            node("rel:orders_customers", LineageKind::Relationship),
            node("cube:order_metrics", LineageKind::Cube),
            node("metric:order_metrics.revenue", LineageKind::Metric),
            node("dim:order_metrics.status", LineageKind::Dimension),
            node("view:recent_orders", LineageKind::View),
            node("query:orders_by_status", LineageKind::Query),
            node("dashboard:sales", LineageKind::Dashboard),
        ],
        edges: vec![
            edge("model:orders", "column:orders.amount"),
            edge("model:orders", "rel:orders_customers"),
            edge("model:customers", "rel:orders_customers"),
            edge("model:orders", "cube:order_metrics"),
            edge("cube:order_metrics", "metric:order_metrics.revenue"),
            edge("cube:order_metrics", "dim:order_metrics.status"),
            edge("model:orders", "view:recent_orders"),
            edge("view:recent_orders", "query:orders_by_status"),
            edge("metric:order_metrics.revenue", "dashboard:sales"),
            edge("dim:order_metrics.status", "dashboard:sales"),
        ],
    };

    assert_agrees_everywhere(&graph);

    let mine = ImpactGraph::from(&graph);
    // A dimension reaches only a dashboard, so it is semantic, not compatibility: the class is a
    // statement about what is *reached*, not about the seed.
    assert_eq!(
        mine.impact("dim:order_metrics.status").severity,
        Severity::Semantic
    );
    // A model with a relationship and nothing else below it stays a compatibility concern.
    assert_eq!(
        mine.impact("model:customers").severity,
        Severity::Compatibility
    );
    assert_eq!(mine.consumer_counts().queries, 1);
    assert_eq!(mine.consumer_counts().dashboards, 1);
}

/// Compare, for one real project, the analysis this crate computes against the analysis the
/// framework wrote into the prepared-context document — the pairing a consumer actually reads.
///
/// Returns the severity labels the project actually produced, so the caller can check that the
/// fixtures between them exercise every class. Agreement on a project that only ever yields one
/// class would prove very little.
fn real_project_analysis_agrees(fixture: &str) -> (BTreeSet<String>, warble::HostConsumers) {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(fixture);
    let sources = read_project_dir(&dir)
        .unwrap()
        .unwrap_or_else(|| panic!("{fixture} is a project"));
    let context = MdlContext::try_from_sources(&sources).expect("fixture assembles");
    assert!(context.is_parseable(), "{fixture} did not assemble");

    let document = prepared_document(&context).expect("document serializes");
    let parsed = PreparedContext::from_json(&document).expect("document parses back");
    let theirs = parsed
        .host_analysis()
        .expect("the document carries an analysis block");
    let ours = context.impact_graph().host_analysis();

    assert_eq!(
        ours.impact.keys().collect::<Vec<_>>(),
        theirs.impact.keys().collect::<Vec<_>>(),
        "{fixture}: the two analyses cover different nodes"
    );
    for (id, ours_impact) in &ours.impact {
        let theirs_impact = theirs.impact.get(id).expect("same key set, checked above");
        assert_eq!(
            ours_impact.downstream, theirs_impact.downstream,
            "{fixture}: downstream disagreed for {id}"
        );
        assert_eq!(
            ours_impact.severity.rank, theirs_impact.severity.rank,
            "{fixture}: severity rank disagreed for {id}"
        );
        assert_eq!(
            ours_impact.severity.name, theirs_impact.severity.name,
            "{fixture}: severity label disagreed for {id}"
        );
    }
    assert_eq!(
        ours.consumers, theirs.consumers,
        "{fixture}: consumer totals disagreed"
    );

    let labels = ours
        .impact
        .values()
        .map(|i| i.severity.name.clone())
        .collect();
    (
        labels,
        ours.consumers.expect("consumer totals are reported"),
    )
}

/// End to end on real projects. Also proves the crate did not start producing its own document:
/// the analysis it computes and the analysis the framework serialized are the same values.
///
/// Two fixtures, because neither alone exercises the whole classification — the larger one has the
/// consumer layer but no view, so it never yields `structural`; the smaller one has a view but no
/// consumers. Between them all four classes appear on real data, which is asserted rather than
/// assumed.
#[test]
fn the_real_project_analysis_matches_the_emitted_document() {
    let (driftwood_labels, driftwood_consumers) = real_project_analysis_agrees("driftwood-wren");
    let (jaffle_labels, jaffle_consumers) = real_project_analysis_agrees("jaffle-wren");

    assert!(
        driftwood_consumers.queries > 0 && driftwood_consumers.dashboards > 0,
        "expected a consumer layer: {driftwood_consumers:?}"
    );
    assert!(
        jaffle_labels.contains("structural"),
        "expected a view to make something structural: {jaffle_labels:?}"
    );
    assert_eq!(jaffle_consumers, warble::HostConsumers::default());

    let seen: BTreeSet<String> = driftwood_labels.union(&jaffle_labels).cloned().collect();
    let expected: BTreeSet<String> = ["none", "compatibility", "structural", "semantic"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    assert_eq!(
        seen, expected,
        "the fixtures must between them produce every severity class"
    );
}

/// The graph handed to the analysis is the same graph the document reports, so a consumer reading
/// either sees one project. Guards the projection, not the traversal.
#[test]
fn the_impact_graph_mirrors_the_bound_lineage() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/jaffle-wren");
    let sources = read_project_dir(&dir)
        .unwrap()
        .expect("fixture is a project");
    let context = MdlContext::try_from_sources(&sources).expect("fixture assembles");

    let mine = context.impact_graph();
    let theirs = context.lineage();
    assert_eq!(mine.nodes.len(), theirs.nodes.len());
    assert_eq!(mine.edges.len(), theirs.edges.len());
    for (ours, theirs) in mine.nodes.iter().zip(&theirs.nodes) {
        assert_eq!(ours.id, theirs.id);
        assert_eq!(warble::LineageKind::from(ours.kind), theirs.kind);
    }
    for (ours, theirs) in mine.edges.iter().zip(&theirs.edges) {
        assert_eq!(ours.from, theirs.from);
        assert_eq!(ours.to, theirs.to);
    }
}
