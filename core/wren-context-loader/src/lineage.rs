//! Build Warble's semantic [`LineageGraph`] from a wren [`Manifest`], plus its extension with
//! **consumer nodes** from a project's saved artifacts.
//!
//! Edges are oriented **upstream → downstream** (`from` depended on, `to` dependent), so a node's
//! blast radius is its forward-reachable set (capability-model §7.1: `raw → models → relationships
//! → metrics/dimensions → views → consumers`). The graph is built from structural references —
//! relationships, cube base objects, view statements, consumer files — without executing SQL;
//! SQL *text* is parsed (sqlparser) only to discover which relations it references, falling back
//! to a whole-word scan (recorded in `diagnostics`) when a statement does not parse.
//! Identifier and CTE scope handling follows sqlparser's `GenericDialect` representation and the
//! loader's deterministic resolution policy; it is not a claim that every datasource executes
//! quoted identifiers or CTE folding identically.
//!
//! Node id conventions (stable, queryable): `model:<name>`, `rel:<name>`, `cube:<name>`,
//! `metric:<cube>.<measure>`, `dim:<cube>.<dimension>`, `view:<name>`, `query:<slug>`,
//! `dashboard:<name>`.

use std::collections::HashSet;
use std::ops::ControlFlow;

use sqlparser::ast::{visit_expressions, Expr, Ident};
use sqlparser::dialect::GenericDialect;
use sqlparser::parser::Parser;
use warble::{LineageEdge, LineageGraph, LineageKind, LineageNode};
use wren_core_base::mdl::manifest::{Manifest, Model};

use crate::consumers::{self, RelationReference};
use crate::project::ProjectSources;

pub fn model_id(name: &str) -> String {
    format!("model:{name}")
}
pub fn rel_id(name: &str) -> String {
    format!("rel:{name}")
}
pub fn cube_id(name: &str) -> String {
    format!("cube:{name}")
}
pub fn metric_id(cube: &str, measure: &str) -> String {
    format!("metric:{cube}.{measure}")
}
pub fn dim_id(cube: &str, dimension: &str) -> String {
    format!("dim:{cube}.{dimension}")
}
pub fn view_id(name: &str) -> String {
    format!("view:{name}")
}
pub fn query_id(slug: &str) -> String {
    format!("query:{slug}")
}
pub fn dashboard_id(name: &str) -> String {
    format!("dashboard:{name}")
}

fn push_node(nodes: &mut Vec<LineageNode>, id: String, kind: LineageKind) {
    if !nodes.iter().any(|n| n.id == id) {
        nodes.push(LineageNode { id, kind });
    }
}

fn push_edge(edges: &mut Vec<LineageEdge>, from: String, to: String) {
    if !edges.iter().any(|e| e.from == from && e.to == to) {
        edges.push(LineageEdge { from, to });
    }
}

/// Build the lineage DAG from the manifest's structural references. References to models that do
/// not exist (a dangling relationship member, cube base object, or view table) still produce an
/// edge whose `from` endpoint is absent from the node set — so [`LineageGraph::is_resolvable`]
/// detects them.
///
/// The second return value is the degradation diagnostics: one entry per view whose statement did
/// not parse as SQL and was matched by whole-word scan instead (no silent caps).
pub fn build(manifest: &Manifest) -> (LineageGraph, Vec<String>) {
    let mut nodes: Vec<LineageNode> = Vec::new();
    let mut edges: Vec<LineageEdge> = Vec::new();
    let mut diagnostics: Vec<String> = Vec::new();

    let model_names: Vec<String> = manifest.models.iter().map(|m| m.name.clone()).collect();
    let view_names: Vec<String> = manifest.views.iter().map(|v| v.name.clone()).collect();

    for model in &manifest.models {
        push_node(&mut nodes, model_id(&model.name), LineageKind::Model);
    }

    // Relationships depend on both joined models.
    for rel in &manifest.relationships {
        let rid = rel_id(&rel.name);
        push_node(&mut nodes, rid.clone(), LineageKind::Relationship);
        for member in &rel.models {
            push_edge(&mut edges, model_id(member), rid.clone());
        }
    }

    // Cubes depend on their base object (a model or view); measures/dimensions depend on the cube.
    // A base object that names a view and no model hangs off the `view:` node; a model wins a name
    // clash, and a name that is neither stays a dangling `model:` edge so `is_resolvable` flags it.
    for cube in &manifest.cubes {
        let cid = cube_id(&cube.name);
        push_node(&mut nodes, cid.clone(), LineageKind::Cube);
        let base_is_view = !model_names.contains(&cube.base_object)
            && manifest.views.iter().any(|v| v.name == cube.base_object);
        let base_id = if base_is_view {
            view_id(&cube.base_object)
        } else {
            model_id(&cube.base_object)
        };
        push_edge(&mut edges, base_id, cid.clone());
        for measure in &cube.measures {
            let mid = metric_id(&cube.name, &measure.name);
            push_node(&mut nodes, mid.clone(), LineageKind::Metric);
            push_edge(&mut edges, cid.clone(), mid);
        }
        let dim_names = cube
            .dimensions
            .iter()
            .map(|d| d.name.clone())
            .chain(cube.time_dimensions.iter().map(|d| d.name.clone()));
        for dim_name in dim_names {
            let did = dim_id(&cube.name, &dim_name);
            push_node(&mut nodes, did.clone(), LineageKind::Dimension);
            push_edge(&mut edges, cid.clone(), did);
        }
    }

    // Views depend on every semantic model or view their statement references. Discovered by SQL
    // parse; a statement that does not parse degrades to the whole-word scan, recorded honestly.
    for view in &manifest.views {
        let vid = view_id(&view.name);
        push_node(&mut nodes, vid.clone(), LineageKind::View);
        let references = consumers::sql_consumer_references(&view.statement);
        let mut candidates = model_names.clone();
        candidates.extend(view_names.iter().cloned());
        for name in referenced_names(
            references.as_ref(),
            &view.statement,
            &candidates,
            &vid,
            &mut diagnostics,
        ) {
            // Models deliberately win an exact model/view name collision, matching consumers and
            // the engine's relation resolution. A differently cased exact view still wins before
            // the unquoted case-insensitive fallback to a model.
            if model_names.contains(&name) {
                push_edge(&mut edges, model_id(&name), vid.clone());
            } else if view_names.contains(&name) {
                push_edge(&mut edges, view_id(&name), vid.clone());
            }
        }
        for relationship in relationships_used_by_consumer(manifest, references.as_ref()) {
            push_edge(&mut edges, rel_id(&relationship), vid.clone());
        }
    }

    (LineageGraph { nodes, edges }, diagnostics)
}

/// Extend an already-built graph with **consumer nodes** from the project's saved artifacts:
/// `knowledge/sql/<slug>.md` confirmed queries (→ `query:<slug>`) and `dashboards.yml` specs
/// (→ `dashboard:<name>`). This is what makes a metric no longer a leaf — the gate can now say
/// "this change reaches N dashboards".
///
/// Reference semantics mirror the rest of the graph:
/// - **Discovered** references (SQL text, of a query or a `panels[].sql`) only bind to nodes that
///   exist — an unknown relation name (a CTE, a raw table) produces nothing.
/// - **Declared** references (`panels[].cube` + `measures`) always produce an edge; naming a cube
///   or measure that does not exist leaves a dangling edge that `is_resolvable` flags, exactly
///   like a dangling cube `base_object`.
///
/// A malformed consumer file is skipped, and every skip or SQL-parse fallback appends a
/// human-readable entry to `diagnostics` (no silent caps).
pub fn extend_with_consumers(
    graph: &mut LineageGraph,
    manifest: &Manifest,
    sources: &ProjectSources,
    diagnostics: &mut Vec<String>,
) {
    let model_names: Vec<String> = manifest.models.iter().map(|m| m.name.clone()).collect();
    let view_names: Vec<String> = manifest.views.iter().map(|v| v.name.clone()).collect();

    for (slug, contents) in &sources.knowledge_sql_mds {
        let qid = query_id(slug);
        let sql = match consumers::knowledge_sql(contents) {
            Ok(sql) => sql,
            Err(reason) => {
                diagnostics.push(format!("knowledge/sql/{slug}.md skipped: {reason}"));
                continue;
            }
        };
        push_node(&mut graph.nodes, qid.clone(), LineageKind::Query);
        link_sql_consumer(
            graph,
            manifest,
            &model_names,
            &view_names,
            &qid,
            &sql,
            diagnostics,
        );
    }

    let Some(dashboards_yml) = &sources.dashboards_yml else {
        return;
    };
    let parsed = match consumers::parse_dashboards(dashboards_yml) {
        Ok(parsed) => parsed,
        Err(reason) => {
            diagnostics.push(format!("dashboards.yml skipped: {reason}"));
            return;
        }
    };
    let mut dashboard_names = HashSet::new();
    for dashboard in &parsed.dashboards {
        if !dashboard_names.insert(dashboard.name.as_str()) {
            diagnostics.push(format!(
                "dashboard '{}' skipped: duplicate name",
                dashboard.name
            ));
            continue;
        }
        let did = dashboard_id(&dashboard.name);
        push_node(&mut graph.nodes, did.clone(), LineageKind::Dashboard);
        for (index, panel) in dashboard.panels.iter().enumerate() {
            let panel_label = panel
                .name
                .clone()
                .unwrap_or_else(|| format!("panel {}", index + 1));
            if panel.sql.is_none() && panel.cube.is_none() {
                diagnostics.push(format!(
                    "dashboard '{}' {panel_label} skipped: declares neither `sql` nor `cube`",
                    dashboard.name
                ));
                continue;
            }
            if let Some(sql) = &panel.sql {
                link_sql_consumer(
                    graph,
                    manifest,
                    &model_names,
                    &view_names,
                    &did,
                    sql,
                    diagnostics,
                );
            }
            if let Some(cube) = &panel.cube {
                // Declared references: emitted even when the target is missing (dangling → loud).
                push_edge(&mut graph.edges, cube_id(cube), did.clone());
                for measure in &panel.measures {
                    push_edge(&mut graph.edges, metric_id(cube, measure), did.clone());
                }
            }
        }
    }
}

/// Add edges from every semantic node a consumer's SQL references to the consumer. Relations are
/// matched against models, views, and cubes; a referenced cube additionally links the measures and
/// dimensions the SQL references as columns, so `metric → consumer` edges exist for cube queries.
fn link_sql_consumer(
    graph: &mut LineageGraph,
    manifest: &Manifest,
    model_names: &[String],
    view_names: &[String],
    consumer: &str,
    sql: &str,
    diagnostics: &mut Vec<String>,
) {
    let mut candidates: Vec<String> = Vec::new();
    candidates.extend(model_names.iter().cloned());
    candidates.extend(view_names.iter().cloned());
    candidates.extend(manifest.cubes.iter().map(|c| c.name.clone()));

    let references = consumers::sql_consumer_references(sql);
    for name in referenced_names(references.as_ref(), sql, &candidates, consumer, diagnostics) {
        if model_names.contains(&name) {
            push_edge(&mut graph.edges, model_id(&name), consumer.to_string());
        } else if view_names.contains(&name) {
            push_edge(&mut graph.edges, view_id(&name), consumer.to_string());
        } else if let Some(cube) = manifest.cubes.iter().find(|c| c.name == name) {
            push_edge(&mut graph.edges, cube_id(&name), consumer.to_string());
            for measure in &cube.measures {
                if member_is_referenced(
                    references.as_ref(),
                    sql,
                    manifest,
                    &cube.name,
                    &measure.name,
                ) {
                    push_edge(
                        &mut graph.edges,
                        metric_id(&cube.name, &measure.name),
                        consumer.to_string(),
                    );
                }
            }
            let dim_names = cube
                .dimensions
                .iter()
                .map(|d| d.name.as_str())
                .chain(cube.time_dimensions.iter().map(|d| d.name.as_str()));
            for dim_name in dim_names {
                if member_is_referenced(references.as_ref(), sql, manifest, &cube.name, dim_name) {
                    push_edge(
                        &mut graph.edges,
                        dim_id(&cube.name, dim_name),
                        consumer.to_string(),
                    );
                }
            }
        }
    }
    for relationship in relationships_used_by_consumer(manifest, references.as_ref()) {
        push_edge(
            &mut graph.edges,
            rel_id(&relationship),
            consumer.to_string(),
        );
    }
}

/// The declared relationship conditions a parsed consumer reads through calculated model fields.
/// A query-owned `JOIN ... ON` is deliberately absent: it is not a reference to an MDL
/// relationship condition. A malformed statement also has no relationship edge, because the
/// fallback scanner cannot prove a calculated column was selected.
fn relationships_used_by_consumer(
    manifest: &Manifest,
    references: Option<&consumers::SqlConsumerReferences>,
) -> Vec<String> {
    let Some(references) = references else {
        return Vec::new();
    };
    let mut relationships = HashSet::new();
    for model in &manifest.models {
        for column in model.columns.iter().filter(|column| column.is_calculated) {
            if !consumer_references_model_column(references, manifest, model, &column.name) {
                continue;
            }
            let mut visiting = HashSet::new();
            relationships.extend(calculated_column_relationships(
                manifest,
                model,
                &column.name,
                &mut visiting,
            ));
        }
    }
    let mut relationships: Vec<_> = relationships.into_iter().collect();
    relationships.sort();
    relationships
}

/// Does the statement read this precise semantic model column? The source and qualifier rules
/// mirror cube-member provenance: direct relations only, with a bare column accepted only where
/// its SELECT has a single source. A wildcard reads every column from its resolved model.
fn consumer_references_model_column(
    references: &consumers::SqlConsumerReferences,
    manifest: &Manifest,
    model: &Model,
    column: &str,
) -> bool {
    references.selects.iter().any(|select| {
        select.columns.iter().any(|reference| {
            if !identifier_matches_name(&reference.name, column) {
                return false;
            }
            match &reference.qualifier {
                Some(qualifier) => {
                    let mut sources = select
                        .sources
                        .iter()
                        .filter(|source| source_matches_qualifier(source, qualifier));
                    matches!(sources.next(), Some(source) if source_resolves_to_model(source, manifest, model))
                        && sources.next().is_none()
                }
                None => {
                    select.sources.len() == 1
                        && source_resolves_to_model(&select.sources[0], manifest, model)
                }
            }
        }) || select.wildcards.iter().any(|qualifier| {
            select.sources.iter().any(|source| {
                source_resolves_to_model(source, manifest, model)
                    && qualifier
                        .as_ref()
                        .is_none_or(|qualifier| source_matches_qualifier(source, qualifier))
            })
        })
    })
}

/// The named relationship conditions used while the engine plans one calculated column. This
/// follows relationship handles in a compound field path (`customer.country.name`) and follows
/// local calculated-field references recursively. It intentionally does not infer dependencies
/// from arbitrary SQL text or handwritten joins.
fn calculated_column_relationships(
    manifest: &Manifest,
    model: &Model,
    column_name: &str,
    visiting: &mut HashSet<(String, String)>,
) -> Vec<String> {
    if !visiting.insert((model.name.clone(), column_name.to_string())) {
        return Vec::new();
    }
    let Some(column) = model
        .columns
        .iter()
        .find(|column| column.is_calculated && column.name == column_name)
    else {
        return Vec::new();
    };
    let Some(expression) = &column.expression else {
        return Vec::new();
    };

    let mut relationships = HashSet::new();
    for path in expression_identifiers(expression) {
        let Some(first) = path.first() else {
            continue;
        };
        let Some(source) = model
            .columns
            .iter()
            .find(|candidate| identifier_matches_name(first, &candidate.name))
        else {
            continue;
        };
        if source.relationship.is_none() {
            if path.len() == 1 && source.is_calculated {
                relationships.extend(calculated_column_relationships(
                    manifest,
                    model,
                    &source.name,
                    visiting,
                ));
            }
            continue;
        }

        let Some((relationship, mut current_model)) = relationship_target(manifest, model, source)
        else {
            continue;
        };
        relationships.insert(relationship.name.clone());
        let path_after_handle = &path[1..];
        for (index, identifier) in path_after_handle.iter().enumerate() {
            let Some(next) = current_model
                .columns
                .iter()
                .find(|candidate| identifier_matches_name(identifier, &candidate.name))
            else {
                break;
            };
            if index + 1 == path_after_handle.len() {
                if next.is_calculated {
                    relationships.extend(calculated_column_relationships(
                        manifest,
                        current_model,
                        &next.name,
                        visiting,
                    ));
                }
                break;
            }
            let Some((relationship, target)) = relationship_target(manifest, current_model, next)
            else {
                break;
            };
            relationships.insert(relationship.name.clone());
            current_model = target;
        }
    }
    relationships.into_iter().collect()
}

/// Parse a calculated expression as a SELECT item and retain identifier paths. Expressions that
/// do not parse produce no new lineage edge instead of treating words in comments or strings as
/// relationship navigation.
fn expression_identifiers(expression: &str) -> Vec<Vec<Ident>> {
    let Ok(statements) = Parser::parse_sql(&GenericDialect {}, &format!("SELECT {expression}"))
    else {
        return Vec::new();
    };
    let mut paths = Vec::new();
    let _: ControlFlow<()> = visit_expressions(&statements, |expr| {
        match expr {
            Expr::Identifier(identifier) => paths.push(vec![identifier.clone()]),
            Expr::CompoundIdentifier(identifiers) => paths.push(identifiers.clone()),
            _ => {}
        }
        ControlFlow::Continue(())
    });
    paths
}

/// Find the target model for a relationship handle on `model`. The handle's declared type must be
/// a member of the declared relationship, matching engine planning's validation rather than
/// guessing another model with a coincidentally similar name.
fn relationship_target<'a>(
    manifest: &'a Manifest,
    model: &Model,
    column: &wren_core_base::mdl::manifest::Column,
) -> Option<(&'a wren_core_base::mdl::manifest::Relationship, &'a Model)> {
    let relationship_name = column.relationship.as_ref()?;
    let relationship = manifest
        .relationships
        .iter()
        .find(|relationship| relationship.name == *relationship_name)?;
    if !relationship.models.iter().any(|name| name == &model.name) {
        return None;
    }
    let target = manifest.models.iter().find(|candidate| {
        candidate.name == column.r#type
            && relationship
                .models
                .iter()
                .any(|name| name == &candidate.name)
    })?;
    Some((relationship, target))
}

/// The manifest names resolved from relations that `sql` references. A parsed relation resolves
/// to at most one candidate: exact spelling wins; a quoted miss has no match; an unquoted
/// case-insensitive collision deterministically chooses the lexicographically smallest name.
/// When SQL does not parse, this degrades to the established whole-word scan and records the
/// degradation against `node` in `diagnostics`.
fn referenced_names(
    references: Option<&consumers::SqlConsumerReferences>,
    sql: &str,
    candidates: &[String],
    node: &str,
    diagnostics: &mut Vec<String>,
) -> Vec<String> {
    match references {
        Some(references) => references
            .relations
            .iter()
            .filter_map(RelationReference::unqualified_name)
            .filter_map(|name| resolve_relation_name(name, candidates))
            .collect(),
        None => {
            diagnostics.push(format!(
                "{node}: statement did not parse as SQL; matched tables by whole-word scan"
            ));
            candidates
                .iter()
                .filter(|name| statement_references(sql, name))
                .cloned()
                .collect()
        }
    }
}

/// Resolve one parsed relation identifier using the same deterministic policy as the Python
/// semantic gate. Exact spelling wins even for an unquoted identifier. A quoted identifier never
/// falls back case-insensitively; an unquoted collision chooses lexical-minimum for stability.
fn resolve_relation_name(
    identifier: &sqlparser::ast::Ident,
    candidates: &[String],
) -> Option<String> {
    if let Some(exact) = candidates.iter().find(|name| **name == identifier.value) {
        return Some(exact.clone());
    }
    if identifier.quote_style.is_some() {
        return None;
    }
    candidates
        .iter()
        .filter(|name| name.eq_ignore_ascii_case(&identifier.value))
        .min()
        .cloned()
}

fn identifier_matches_name(identifier: &sqlparser::ast::Ident, name: &str) -> bool {
    identifier.value == name
        || (identifier.quote_style.is_none() && identifier.value.eq_ignore_ascii_case(name))
}

fn source_resolves_to_cube(
    source: &consumers::SelectSource,
    manifest: &Manifest,
    cube: &str,
) -> bool {
    let Some(identifier) = source
        .relation
        .as_ref()
        .and_then(RelationReference::unqualified_name)
    else {
        return false;
    };
    let mut candidates: Vec<String> = manifest
        .models
        .iter()
        .map(|candidate| candidate.name.clone())
        .collect();
    candidates.extend(manifest.views.iter().map(|view| view.name.clone()));
    candidates.extend(
        manifest
            .cubes
            .iter()
            .map(|candidate| candidate.name.clone()),
    );
    let Some(resolved) = resolve_relation_name(identifier, &candidates) else {
        return false;
    };
    resolved == cube
        && !manifest.models.iter().any(|model| model.name == resolved)
        && !manifest.views.iter().any(|view| view.name == resolved)
}

/// Resolve a source once against the full semantic namespace before attributing a column to a
/// model. This preserves exact-first/quoted-strict resolution when names differ only by case and
/// when a model, view, or cube competes for the same spelling.
fn source_resolves_to_model(
    source: &consumers::SelectSource,
    manifest: &Manifest,
    model: &Model,
) -> bool {
    let Some(identifier) = source
        .relation
        .as_ref()
        .and_then(RelationReference::unqualified_name)
    else {
        return false;
    };
    let mut candidates: Vec<String> = manifest
        .models
        .iter()
        .map(|candidate| candidate.name.clone())
        .collect();
    candidates.extend(manifest.views.iter().map(|view| view.name.clone()));
    candidates.extend(manifest.cubes.iter().map(|cube| cube.name.clone()));
    resolve_relation_name(identifier, &candidates).is_some_and(|resolved| resolved == model.name)
}

fn source_matches_qualifier(
    source: &consumers::SelectSource,
    qualifier: &sqlparser::ast::Ident,
) -> bool {
    source
        .alias
        .as_ref()
        .is_some_and(|alias| consumers::identifiers_match(alias, qualifier))
        || source
            .name
            .as_ref()
            .is_some_and(|name| consumers::identifiers_match(name, qualifier))
}

/// Whether a cube member is referenced from this cube. Qualified columns resolve within the
/// owning `SELECT`; bare names require that SELECT to have exactly one source, a direct cube
/// relation. CTE and derived sources are blockers unless their projection can be proved, which is
/// deliberately outside this lightweight consumer lineage parser.
fn member_is_referenced(
    references: Option<&consumers::SqlConsumerReferences>,
    sql: &str,
    manifest: &Manifest,
    cube: &str,
    member: &str,
) -> bool {
    let Some(references) = references else {
        return statement_references(sql, member);
    };
    references.selects.iter().any(|select| {
        let column_matches = select.columns.iter().any(|column| {
            if !identifier_matches_name(&column.name, member) {
                return false;
            }
            match &column.qualifier {
                Some(qualifier) => {
                    let mut sources = select
                        .sources
                        .iter()
                        .filter(|source| source_matches_qualifier(source, qualifier));
                    matches!(sources.next(), Some(source) if source_resolves_to_cube(source, manifest, cube))
                        && sources.next().is_none()
                }
                None => {
                    select.sources.len() == 1
                        && source_resolves_to_cube(&select.sources[0], manifest, cube)
                }
            }
        });
        column_matches
            || select.wildcards.iter().any(|qualifier| {
                select.sources.iter().any(|source| {
                    source_resolves_to_cube(source, manifest, cube)
                        && qualifier
                            .as_ref()
                            .is_none_or(|qualifier| source_matches_qualifier(source, qualifier))
                })
            })
    })
}

/// Naive whole-word containment check: does `statement` reference `name` as a standalone token?
/// Avoids the false positive where `orders` matches inside `raw_orders` by requiring
/// non-identifier boundaries on both sides. The fallback matcher when SQL does not parse.
fn statement_references(statement: &str, name: &str) -> bool {
    let bytes = statement.as_bytes();
    let name_bytes = name.as_bytes();
    if name_bytes.is_empty() {
        return false;
    }
    let is_ident = |b: u8| b.is_ascii_alphanumeric() || b == b'_';
    let mut start = 0;
    while let Some(pos) = statement[start..].find(name) {
        let abs = start + pos;
        let before_ok = abs == 0 || !is_ident(bytes[abs - 1]);
        let after_idx = abs + name_bytes.len();
        let after_ok = after_idx >= bytes.len() || !is_ident(bytes[after_idx]);
        if before_ok && after_ok {
            return true;
        }
        start = abs + name_bytes.len();
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use wren_core_base::mdl::builder::{
        ColumnBuilder, ManifestBuilder, ModelBuilder, RelationshipBuilder, ViewBuilder,
    };
    use wren_core_base::mdl::manifest::JoinType;

    #[test]
    fn relation_resolution_is_exact_first_quoted_strict_and_deterministic() {
        let candidates = vec!["orders".to_string(), "Orders".to_string()];
        let exact = sqlparser::ast::Ident::new("orders");
        let folded = sqlparser::ast::Ident::new("ORDERS");
        let quoted = sqlparser::ast::Ident::with_quote('"', "ORDERS");
        assert_eq!(
            resolve_relation_name(&exact, &candidates),
            Some("orders".to_string())
        );
        assert_eq!(
            resolve_relation_name(&folded, &candidates),
            Some("Orders".to_string())
        );
        assert_eq!(resolve_relation_name(&quoted, &candidates), None);
    }

    #[test]
    fn calculated_relationship_lineage_resolves_case_collisions_once() {
        let manifest = ManifestBuilder::new()
            .model(
                ModelBuilder::new("orders")
                    .column(ColumnBuilder::new("id", "INTEGER").build())
                    .column(
                        ColumnBuilder::new_relationship(
                            "customer",
                            "customers",
                            "orders_customers",
                        )
                        .build(),
                    )
                    .column(
                        ColumnBuilder::new_calculated("customer_name", "VARCHAR")
                            .expression("customer.name")
                            .build(),
                    )
                    .build(),
            )
            .model(
                ModelBuilder::new("Orders")
                    .column(ColumnBuilder::new("id", "INTEGER").build())
                    .column(ColumnBuilder::new("customer_name", "VARCHAR").build())
                    .build(),
            )
            .model(
                ModelBuilder::new("customers")
                    .column(ColumnBuilder::new("id", "INTEGER").build())
                    .column(ColumnBuilder::new("name", "VARCHAR").build())
                    .build(),
            )
            // Models precede views in the loader's established semantic namespace resolution.
            .view(ViewBuilder::new("Orders").statement("SELECT 1").build())
            .relationship(
                RelationshipBuilder::new("orders_customers")
                    .model("orders")
                    .model("customers")
                    .join_type(JoinType::ManyToOne)
                    .condition("orders.id = customers.id")
                    .build(),
            )
            .build();
        let sources = ProjectSources {
            wren_project_yml: String::new(),
            model_ymls: Vec::new(),
            relationships_yml: None,
            cubes_yml: None,
            cube_ymls: Vec::new(),
            views: Vec::new(),
            knowledge_sql_mds: vec![
                (
                    "case-exact".to_string(),
                    "---\nsql: SELECT customer_name FROM Orders\n---\n".to_string(),
                ),
                (
                    "case-lower".to_string(),
                    "---\nsql: SELECT customer_name FROM orders\n---\n".to_string(),
                ),
            ],
            dashboards_yml: None,
        };
        let (mut graph, mut diagnostics) = build(&manifest);
        extend_with_consumers(&mut graph, &manifest, &sources, &mut diagnostics);

        assert!(graph
            .edges
            .iter()
            .any(|edge| { edge.from == "model:Orders" && edge.to == "query:case-exact" }));
        assert!(!graph
            .edges
            .iter()
            .any(|edge| { edge.from == "rel:orders_customers" && edge.to == "query:case-exact" }));
        assert!(graph
            .edges
            .iter()
            .any(|edge| { edge.from == "rel:orders_customers" && edge.to == "query:case-lower" }));
    }
}
