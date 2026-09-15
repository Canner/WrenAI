//! Wren's own lineage ontology, severity model and impact traversal.
//!
//! # Why this lives here and not in the framework
//!
//! Building a lineage graph out of MDL is Wren's job, and already happens in this crate.
//! *Classifying* what a change to one node does to the nodes below it is the same kind of job:
//! deciding that a metric quietly shifting its numbers is worse than a model breaking outright is
//! a judgement about what these semantic objects mean, and only whoever owns the semantic format
//! can make it. So the ontology and the classification live on this side of the boundary. The
//! dependency runs one way: Wren depends on Warble, never the reverse.
//!
//! Warble does still derive its own copy of this analysis, and will for one more step — which is
//! why this crate's tests assert the two agree node by node rather than trusting that they do.
//!
//! # What crosses the wire
//!
//! A severity crosses as a **rank plus a label** (`warble::RankedSeverity`). The framework orders
//! by the rank and does not read the label, so it can gate on "worse than this" without knowing
//! what any class means. That split is what lets the judgement stay here.
//!
//! # Using it without Warble in the call path
//!
//! Everything here is expressed in this crate's own types, so a caller (the `wren` CLI, say) can
//! go project → [`crate::MdlContext`] → [`ImpactGraph`] → [`Impact`] without naming a Warble type.
//! Warble's shapes appear only at the wire boundary, via the `From` conversions and
//! [`ImpactGraph::host_analysis`], because those shapes *are* the exchange contract.

use std::collections::{BTreeMap, BTreeSet};

/// The kind of a node in the semantic lineage DAG.
///
/// Ordered coarse→fine along the dependency flow `raw → models → relationships →
/// metrics/dimensions → views → consumers`. [`Self::Query`] and [`Self::Dashboard`] are *consumer*
/// nodes — artifacts outside the semantic layer that depend on it — and are always sinks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeKind {
    Model,
    Column,
    Relationship,
    Cube,
    Metric,
    Dimension,
    View,
    Query,
    Dashboard,
}

/// How bad it is for a given node to be affected by an upstream change, least → most dangerous.
///
/// Ordered so that the severity of a whole impact set is simply the max over its members, and
/// `None` is the honest answer for an empty set.
///
/// - [`Self::Compatibility`] — a type or grain mismatch downstream.
/// - [`Self::Structural`] — a downstream model, view or column breaks. Loud: queries error.
/// - [`Self::Semantic`] — a downstream metric or consumer silently shifts its numbers. The most
///   dangerous class *precisely because* nothing errors: every consumer keeps reading a number
///   that no longer means what it did, and no failure draws anyone's attention to it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Severity {
    None,
    Compatibility,
    Structural,
    Semantic,
}

impl Severity {
    /// This severity's position in the ordering. Higher is worse.
    ///
    /// The only part of a severity a framework consumer acts on — see the module docs on what
    /// crosses the wire.
    pub fn rank(self) -> u32 {
        match self {
            Severity::None => 0,
            Severity::Compatibility => 1,
            Severity::Structural => 2,
            Severity::Semantic => 3,
        }
    }

    /// The human-readable name carried alongside the rank, for logs and messages. The framework
    /// does not branch on it.
    pub fn label(self) -> &'static str {
        match self {
            Severity::None => "none",
            Severity::Compatibility => "compatibility",
            Severity::Structural => "structural",
            Severity::Semantic => "semantic",
        }
    }
}

impl NodeKind {
    /// The impact class of this kind of node when something upstream of it changes.
    ///
    /// This match is the load-bearing judgement of the whole module:
    ///
    /// - A **metric** — and equally a **query** or **dashboard** reading one — is
    ///   [`Severity::Semantic`]: the number changes and nothing complains.
    /// - A **model**, **view** or **column** is [`Severity::Structural`]: downstream queries
    ///   reference a shape that moved, so they break loudly.
    /// - A **relationship**, **cube** or **dimension** is [`Severity::Compatibility`]: a join key
    ///   or grain no longer lines up.
    pub fn severity(self) -> Severity {
        match self {
            NodeKind::Metric | NodeKind::Query | NodeKind::Dashboard => Severity::Semantic,
            NodeKind::Model | NodeKind::View | NodeKind::Column => Severity::Structural,
            NodeKind::Relationship | NodeKind::Cube | NodeKind::Dimension => {
                Severity::Compatibility
            }
        }
    }
}

/// A node in the impact graph. `id` is the stable identifier the graph is queried by (e.g.
/// `model:orders`, `metric:revenue.total_revenue`); the id-builder helpers this crate re-exports
/// (`model_id`, `metric_id`, …) are the conventions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImpactNode {
    pub id: String,
    pub kind: NodeKind,
}

/// A directed dependency edge, oriented **upstream → downstream**: `from` is the thing depended
/// on, `to` is the dependent that would be affected if `from` changed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImpactEdge {
    pub from: String,
    pub to: String,
}

/// What one node's change reaches: the transitive downstream closure plus the worst severity
/// across it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Impact {
    /// The node whose downstream reach was computed.
    pub seed: String,
    /// Every node transitively downstream of `seed`, sorted, excluding `seed` itself.
    pub downstream: Vec<String>,
    /// The worst severity over `downstream`; [`Severity::None`] when nothing is downstream.
    pub severity: Severity,
}

/// How many consumer artifacts the graph holds, by kind.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ConsumerCounts {
    pub queries: usize,
    pub dashboards: usize,
}

/// The semantic lineage DAG, together with this crate's traversal over it.
///
/// "DAG" describes the intent, not a guarantee: a malformed project can present a cycle, and
/// [`Self::impact`] terminates on one rather than trusting the shape.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ImpactGraph {
    pub nodes: Vec<ImpactNode>,
    pub edges: Vec<ImpactEdge>,
}

impl ImpactGraph {
    /// Whether a node with this id is declared.
    pub fn contains(&self, id: &str) -> bool {
        self.nodes.iter().any(|n| n.id == id)
    }

    /// Look up a declared node by id.
    pub fn node(&self, id: &str) -> Option<&ImpactNode> {
        self.nodes.iter().find(|n| n.id == id)
    }

    /// Everything `seed` reaches: the forward transitive closure along `from → to` edges, plus the
    /// worst [`Severity`] across it.
    ///
    /// Read-only, and cycle-safe — the visited set bounds the walk even when the graph is
    /// malformed and cyclic, so such a project still terminates with an answer. An
    /// unknown or leaf `seed` yields an empty closure and [`Severity::None`]. `seed` is excluded
    /// from its own closure even when a cycle leads back to it: the question being asked is what
    /// *else* a change reaches.
    pub fn impact(&self, seed: &str) -> Impact {
        let mut downstream: BTreeSet<String> = BTreeSet::new();
        let mut stack = vec![seed.to_string()];
        while let Some(current) = stack.pop() {
            for edge in self.edges.iter().filter(|e| e.from == current) {
                if edge.to != seed && downstream.insert(edge.to.clone()) {
                    stack.push(edge.to.clone());
                }
            }
        }
        let severity = downstream
            .iter()
            .map(|id| self.severity_of(id))
            .max()
            .unwrap_or(Severity::None);
        Impact {
            seed: seed.to_string(),
            downstream: downstream.into_iter().collect(),
            severity,
        }
    }

    /// [`Self::impact`] for every declared node, keyed by node id.
    pub fn impact_all(&self) -> BTreeMap<String, Impact> {
        self.nodes
            .iter()
            .map(|node| (node.id.clone(), self.impact(&node.id)))
            .collect()
    }

    /// Count the consumer artifacts in the graph.
    ///
    /// Which node kinds count as consumers is this crate's call, which is why the totals are
    /// reported across the wire rather than derived by whoever reads them.
    pub fn consumer_counts(&self) -> ConsumerCounts {
        let count = |kind: NodeKind| self.nodes.iter().filter(|n| n.kind == kind).count();
        ConsumerCounts {
            queries: count(NodeKind::Query),
            dashboards: count(NodeKind::Dashboard),
        }
    }

    /// The severity of a single node.
    ///
    /// An id with no declared node is [`Severity::None`]: a dangling edge endpoint is a graph
    /// defect for `is_resolvable` to report, and guessing a severity for a node nobody declared
    /// would overstate what is known about it.
    fn severity_of(&self, id: &str) -> Severity {
        self.node(id)
            .map(|node| node.kind.severity())
            .unwrap_or(Severity::None)
    }

    /// This analysis in the framework's wire shape, ready to hand to a consumer that reads ranks.
    ///
    /// The one place Warble's types appear in a return position, because this *is* the exchange
    /// contract. Everything above it is expressed in this crate's own vocabulary.
    pub fn host_analysis(&self) -> warble::HostAnalysis {
        warble::HostAnalysis {
            impact: self
                .impact_all()
                .into_iter()
                .map(|(id, impact)| (id, impact.into()))
                .collect(),
            consumers: Some(self.consumer_counts().into()),
        }
    }
}

// --- wire-boundary conversions ------------------------------------------------------------------
//
// The framework's lineage types are the shape a bound context is already expressed in, so the
// graph is projected from them rather than rebuilt. These conversions are total in both
// directions: the two ontologies have the same nine kinds, by construction.

impl From<warble::LineageKind> for NodeKind {
    fn from(kind: warble::LineageKind) -> Self {
        match kind {
            warble::LineageKind::Model => NodeKind::Model,
            warble::LineageKind::Column => NodeKind::Column,
            warble::LineageKind::Relationship => NodeKind::Relationship,
            warble::LineageKind::Cube => NodeKind::Cube,
            warble::LineageKind::Metric => NodeKind::Metric,
            warble::LineageKind::Dimension => NodeKind::Dimension,
            warble::LineageKind::View => NodeKind::View,
            warble::LineageKind::Query => NodeKind::Query,
            warble::LineageKind::Dashboard => NodeKind::Dashboard,
        }
    }
}

impl From<NodeKind> for warble::LineageKind {
    fn from(kind: NodeKind) -> Self {
        match kind {
            NodeKind::Model => warble::LineageKind::Model,
            NodeKind::Column => warble::LineageKind::Column,
            NodeKind::Relationship => warble::LineageKind::Relationship,
            NodeKind::Cube => warble::LineageKind::Cube,
            NodeKind::Metric => warble::LineageKind::Metric,
            NodeKind::Dimension => warble::LineageKind::Dimension,
            NodeKind::View => warble::LineageKind::View,
            NodeKind::Query => warble::LineageKind::Query,
            NodeKind::Dashboard => warble::LineageKind::Dashboard,
        }
    }
}

impl From<&warble::LineageGraph> for ImpactGraph {
    fn from(graph: &warble::LineageGraph) -> Self {
        ImpactGraph {
            nodes: graph
                .nodes
                .iter()
                .map(|n| ImpactNode {
                    id: n.id.clone(),
                    kind: n.kind.into(),
                })
                .collect(),
            edges: graph
                .edges
                .iter()
                .map(|e| ImpactEdge {
                    from: e.from.clone(),
                    to: e.to.clone(),
                })
                .collect(),
        }
    }
}

impl From<Severity> for warble::RankedSeverity {
    fn from(severity: Severity) -> Self {
        warble::RankedSeverity {
            rank: severity.rank(),
            name: severity.label().to_string(),
        }
    }
}

impl From<Impact> for warble::HostImpact {
    fn from(impact: Impact) -> Self {
        warble::HostImpact {
            downstream: impact.downstream,
            severity: impact.severity.into(),
        }
    }
}

impl From<ConsumerCounts> for warble::HostConsumers {
    fn from(counts: ConsumerCounts) -> Self {
        warble::HostConsumers {
            queries: counts.queries,
            dashboards: counts.dashboards,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str, kind: NodeKind) -> ImpactNode {
        ImpactNode {
            id: id.to_string(),
            kind,
        }
    }

    fn edge(from: &str, to: &str) -> ImpactEdge {
        ImpactEdge {
            from: from.to_string(),
            to: to.to_string(),
        }
    }

    /// The whole analysis, start to finish, without a Warble type anywhere in the call path — the
    /// route a CLI takes. If this ever needs a Warble import to compile, the boundary has moved.
    #[test]
    fn the_analysis_runs_on_this_crate_s_own_types_alone() {
        let graph = ImpactGraph {
            nodes: vec![
                node("model:orders", NodeKind::Model),
                node("cube:order_metrics", NodeKind::Cube),
                node("metric:order_metrics.revenue", NodeKind::Metric),
                node("dashboard:sales", NodeKind::Dashboard),
                node("query:orders_by_day", NodeKind::Query),
            ],
            edges: vec![
                edge("model:orders", "cube:order_metrics"),
                edge("cube:order_metrics", "metric:order_metrics.revenue"),
                edge("metric:order_metrics.revenue", "dashboard:sales"),
                edge("model:orders", "query:orders_by_day"),
            ],
        };

        let impact = graph.impact("model:orders");
        assert_eq!(impact.downstream.len(), 4);
        assert_eq!(impact.severity, Severity::Semantic);
        assert_eq!(impact.severity.rank(), 3);
        assert_eq!(impact.severity.label(), "semantic");

        assert_eq!(graph.consumer_counts().queries, 1);
        assert_eq!(graph.consumer_counts().dashboards, 1);
        assert_eq!(graph.impact_all().len(), 5);
        assert!(graph.contains("cube:order_metrics"));
        assert_eq!(
            graph.node("metric:order_metrics.revenue").map(|n| n.kind),
            Some(NodeKind::Metric)
        );
    }

    /// A graph this crate built itself still projects onto the wire shapes a consumer reads.
    #[test]
    fn the_wire_projection_carries_a_rank_and_a_label() {
        let graph = ImpactGraph {
            nodes: vec![
                node("model:a", NodeKind::Model),
                node("view:b", NodeKind::View),
            ],
            edges: vec![edge("model:a", "view:b")],
        };

        let analysis = graph.host_analysis();
        let entry = analysis.impact.get("model:a").expect("seed is a node");
        assert_eq!(entry.downstream, vec!["view:b".to_string()]);
        assert_eq!(entry.severity.rank, Severity::Structural.rank());
        assert_eq!(entry.severity.name, "structural");
        // Every node gets an entry, including the sink — an empty impact is still an answer.
        assert_eq!(analysis.impact.len(), 2);
        assert_eq!(analysis.impact["view:b"].severity.rank, 0);
    }
}
