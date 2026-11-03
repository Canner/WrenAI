//! Wren's impact policy over its structural lineage. The framework receives these
//! results; it does not decide what a changed Wren object means for consumers.

use std::collections::{BTreeMap, BTreeSet};
use warble::{HostAnalysis, HostConsumers, HostImpact, LineageGraph, LineageKind, RankedSeverity};

/// Analyze every declared seed. A malformed graph supplies no analysis, whereas
/// a valid empty graph explicitly supplies an empty analysis and zero consumers.
pub(crate) fn analyze(graph: &LineageGraph) -> Option<HostAnalysis> {
    let kinds: BTreeMap<_, _> = graph
        .nodes
        .iter()
        .map(|n| (n.id.as_str(), n.kind))
        .collect();
    if kinds.len() != graph.nodes.len() || !graph.is_resolvable() {
        return None;
    }
    let mut outgoing: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for edge in &graph.edges {
        outgoing.entry(&edge.from).or_default().push(&edge.to);
    }
    let impact = kinds
        .keys()
        .map(|&seed| {
            let mut seen = BTreeSet::from([seed]);
            let mut pending = vec![seed];
            while let Some(node) = pending.pop() {
                for &next in outgoing.get(node).into_iter().flatten() {
                    if seen.insert(next) {
                        pending.push(next);
                    }
                }
            }
            seen.remove(seed);
            let rank = seen
                .iter()
                .map(|id| match kinds[id] {
                    LineageKind::Metric | LineageKind::Query | LineageKind::Dashboard => 3,
                    LineageKind::Model | LineageKind::Column | LineageKind::View => 2,
                    LineageKind::Relationship | LineageKind::Cube | LineageKind::Dimension => 1,
                })
                .max()
                .unwrap_or(0);
            // Preserve Wren's existing gate thresholds: silent metric/consumer changes
            // outrank structural errors, which outrank type/grain compatibility changes.
            let name = ["none", "compatibility", "structural", "semantic"][rank as usize];
            (
                seed.to_owned(),
                HostImpact {
                    downstream: seen.into_iter().map(str::to_owned).collect(),
                    severity: RankedSeverity {
                        rank,
                        name: name.to_owned(),
                    },
                },
            )
        })
        .collect();
    Some(HostAnalysis {
        impact,
        consumers: Some(HostConsumers {
            queries: kinds
                .values()
                .filter(|&&kind| kind == LineageKind::Query)
                .count(),
            dashboards: kinds
                .values()
                .filter(|&&kind| kind == LineageKind::Dashboard)
                .count(),
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use warble::{LineageEdge, LineageNode};

    #[test]
    fn cycles_duplicates_and_multiple_paths_do_not_duplicate_impact_or_seed() {
        let graph = LineageGraph {
            nodes: vec![
                LineageNode {
                    id: "model:a".into(),
                    kind: LineageKind::Model,
                },
                LineageNode {
                    id: "view:b".into(),
                    kind: LineageKind::View,
                },
                LineageNode {
                    id: "query:c".into(),
                    kind: LineageKind::Query,
                },
            ],
            edges: [
                ("model:a", "view:b"),
                ("view:b", "model:a"),
                ("view:b", "query:c"),
                ("model:a", "query:c"),
                ("model:a", "query:c"),
            ]
            .into_iter()
            .map(|(from, to)| LineageEdge {
                from: from.into(),
                to: to.into(),
            })
            .collect(),
        };
        let result = analyze(&graph).unwrap();
        assert_eq!(result.impact["model:a"].downstream, ["query:c", "view:b"]);
        assert_eq!(result.impact["model:a"].severity.rank, 3);
        assert_eq!(result.impact["query:c"].severity.rank, 0);
        assert_eq!(result.consumers.unwrap().queries, 1);
    }

    #[test]
    fn missing_analysis_is_distinct_from_analyzed_empty() {
        assert!(analyze(&LineageGraph::default()).unwrap().impact.is_empty());
        let invalid = LineageGraph {
            nodes: vec![],
            edges: vec![LineageEdge {
                from: "missing".into(),
                to: "also_missing".into(),
            }],
        };
        assert!(analyze(&invalid).is_none());
    }

    #[test]
    fn structural_and_compatibility_ranks_remain_distinct() {
        for (kind, rank) in [(LineageKind::Column, 2), (LineageKind::Dimension, 1)] {
            let graph = LineageGraph {
                nodes: vec![
                    LineageNode {
                        id: "seed".into(),
                        kind: LineageKind::Model,
                    },
                    LineageNode {
                        id: "child".into(),
                        kind,
                    },
                ],
                edges: vec![LineageEdge {
                    from: "seed".into(),
                    to: "child".into(),
                }],
            };
            assert_eq!(analyze(&graph).unwrap().impact["seed"].severity.rank, rank);
        }
    }
}
