//! Parse **consumer artifacts** — the git-native files that consume the semantic layer — plus the
//! SQL table-reference extraction shared with view lineage.
//!
//! Two consumer sources (both read by the host into [`crate::ProjectSources`], never from the
//! filesystem here):
//! - `knowledge/sql/<slug>.md` — the wren CLI's confirmed NL→SQL memory store. Each file is a YAML
//!   frontmatter block (`nl`, `sql`, `source`, `tags`); only `sql` matters for lineage.
//! - `dashboards.yml` — a minimal declarative dashboard spec: `dashboards[].name` +
//!   `panels[].sql` (a raw query) or `panels[].cube` + `measures` (declared cube references).
//!
//! Table extraction parses SQL with `sqlparser` (GenericDialect) and collects every relation name;
//! a statement that fails to parse is reported to the caller, who falls back to a whole-word text
//! scan and records the degradation (no silent caps).

#[cfg(test)]
use sqlparser::ast::visit_expressions;
#[cfg(test)]
use std::collections::BTreeSet;
use std::collections::HashMap;
use std::ops::ControlFlow;

use serde::Deserialize;
use sqlparser::ast::{
    Expr, Ident, ObjectName, ObjectNamePart, OrderBy, Query, Select, SelectItem,
    SelectItemQualifiedWildcardKind, SetExpr, TableFactor, Visit, Visitor,
};
use sqlparser::dialect::GenericDialect;
use sqlparser::parser::Parser;

/// The lineage-relevant slice of a `knowledge/sql/<slug>.md` frontmatter.
#[derive(Debug, Default, Deserialize)]
struct KnowledgeFrontmatter {
    #[serde(default)]
    sql: Option<String>,
}

/// Extract the confirmed query's SQL from a `knowledge/sql/<slug>.md` file. The file is YAML
/// frontmatter between `---` fences (any body after the closing fence is ignored); a fence-less
/// file is tried as bare YAML. Returns a human reason on failure so the caller can record it.
pub(crate) fn knowledge_sql(contents: &str) -> Result<String, String> {
    let yaml = frontmatter_block(contents).unwrap_or(contents);
    let front: KnowledgeFrontmatter = crate::project::parse_doc_or_default(yaml)
        .map_err(|e| format!("frontmatter is not valid yaml: {e}"))?;
    front
        .sql
        .filter(|sql| !sql.trim().is_empty())
        .ok_or_else(|| "frontmatter has no `sql:` field".to_string())
}

/// The YAML between the first `---` fence and the next line starting with `---`, if the file uses
/// frontmatter fences at all.
fn frontmatter_block(contents: &str) -> Option<&str> {
    let rest = contents.strip_prefix("---")?;
    let rest = rest
        .strip_prefix('\n')
        .or_else(|| rest.strip_prefix("\r\n"))?;
    rest.lines()
        .scan(0usize, |offset, line| {
            let start = *offset;
            *offset += line.len() + 1;
            Some((start, line))
        })
        .find(|(_, line)| line.trim_end() == "---")
        .map(|(start, _)| &rest[..start])
}

/// The root `dashboards.yml` document.
#[derive(Debug, Default, Deserialize)]
pub(crate) struct DashboardsFile {
    #[serde(default)]
    pub dashboards: Vec<DashboardSpec>,
}

/// One dashboard: a named set of panels.
#[derive(Debug, Deserialize)]
pub(crate) struct DashboardSpec {
    pub name: String,
    #[serde(default)]
    pub panels: Vec<PanelSpec>,
}

/// One panel — either a raw SQL query (`sql`, references *discovered* by parsing) or a declared
/// cube reference (`cube` + `measures`, dangling if the target doesn't exist — deliberately loud,
/// like a cube's `base_object`).
#[derive(Debug, Deserialize)]
pub(crate) struct PanelSpec {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub sql: Option<String>,
    #[serde(default)]
    pub cube: Option<String>,
    #[serde(default)]
    pub measures: Vec<String>,
}

pub(crate) fn parse_dashboards(yml: &str) -> Result<DashboardsFile, String> {
    crate::project::parse_doc_or_default(yml)
        .map_err(|e| format!("dashboards.yml is not valid yaml: {e}"))
}

/// Every unqualified relation (table-position) name referenced by `sql`, by parsing it with
/// sqlparser's GenericDialect. Qualified relations remain physical and are intentionally not
/// matched to local semantic objects. Returns `None` when the SQL does not parse — the caller
/// decides the fallback (whole-word scan) and records the degradation.
///
/// A name bound by a `WITH` clause is not a table read, so an unqualified reference to a CTE that
/// is in scope is left out (matched case-insensitively, as SQL does for unquoted names). Scope
/// follows SQL: a CTE is visible to the query body that carries the `WITH` and to the CTEs
/// declared after it (to every sibling under `WITH RECURSIVE`), never to its own body, so
/// `WITH orders AS (SELECT * FROM orders) SELECT * FROM orders` still reads the `orders` table
/// inside the CTE body, and a CTE defined in a subquery shadows nothing outside that subquery.
#[cfg(test)]
pub(crate) fn sql_table_names(sql: &str) -> Option<BTreeSet<String>> {
    Some(
        sql_consumer_references(sql)?
            .relations
            .iter()
            .filter_map(RelationReference::unqualified_name)
            .map(|name| name.value.clone())
            .collect(),
    )
}

/// Every column name `sql` references in an expression (`total`, `o.total` → `total`), by parsing
/// it. Comments, string literals, select-list aliases and table names are not column references,
/// so they are not in the set. Returns `None` when the SQL does not parse; the caller falls back
/// to a whole-word scan, as for [`sql_table_names`].
#[cfg(test)]
pub(crate) fn sql_column_names(sql: &str) -> Option<BTreeSet<String>> {
    let statements = Parser::parse_sql(&GenericDialect {}, sql).ok()?;
    let mut names = BTreeSet::new();
    let _: ControlFlow<()> = visit_expressions(&statements, |expr| {
        match expr {
            Expr::Identifier(ident) => {
                names.insert(ident.value.clone());
            }
            Expr::CompoundIdentifier(parts) => {
                if let Some(last) = parts.last() {
                    names.insert(last.value.clone());
                }
            }
            _ => {}
        }
        ControlFlow::Continue(())
    });
    Some(names)
}

/// Parsed SQL facts that preserve enough source provenance for consumer lineage. In particular,
/// quoted identifiers stay quoted, table aliases stay attached to their relation, and projection
/// wildcards are distinguished from expression wildcards such as `COUNT(*)`.
#[derive(Debug, Default)]
pub(crate) struct SqlConsumerReferences {
    pub relations: Vec<RelationReference>,
    /// Facts owned by individual `SELECT` branches. A column must resolve through sources in the
    /// same entry; physical relations elsewhere in the statement cannot donate provenance.
    pub selects: Vec<SelectReference>,
}

#[derive(Debug, Clone)]
pub(crate) struct RelationReference {
    pub name: ObjectName,
}

impl RelationReference {
    /// Only a one-part relation can name a local semantic object. A qualified relation names a
    /// physical object in the engine namespace and must not be reduced to its final component.
    pub(crate) fn unqualified_name(&self) -> Option<&Ident> {
        let [ObjectNamePart::Identifier(name)] = self.name.0.as_slice() else {
            return None;
        };
        Some(name)
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ColumnReference {
    pub qualifier: Option<Ident>,
    pub name: Ident,
}

#[derive(Debug, Clone)]
pub(crate) struct SelectReference {
    pub sources: Vec<SelectSource>,
    pub columns: Vec<ColumnReference>,
    /// Projection wildcards only (`SELECT *` / `SELECT alias.*`), never expression wildcards such
    /// as `COUNT(*)`.
    pub wildcards: Vec<Option<Ident>>,
}

#[derive(Debug, Clone)]
pub(crate) struct SelectSource {
    /// A direct physical table source. `None` means a CTE, derived table, or opaque source whose
    /// projected provenance is intentionally not guessed.
    pub relation: Option<RelationReference>,
    pub name: Option<Ident>,
    pub alias: Option<Ident>,
}

/// Parse consumer SQL once and retain relation, column, and projection provenance. A malformed
/// statement returns `None`, so callers retain the established diagnostic fallback.
pub(crate) fn sql_consumer_references(sql: &str) -> Option<SqlConsumerReferences> {
    let statements = Parser::parse_sql(&GenericDialect {}, sql).ok()?;
    let mut collector = RelationCollector::default();
    let _: ControlFlow<()> = statements.visit(&mut collector);
    Some(SqlConsumerReferences {
        relations: collector.relations,
        selects: collector.selects,
    })
}

/// Collects table-position relation names while tracking which CTE names are in scope.
#[derive(Default)]
struct RelationCollector {
    relations: Vec<RelationReference>,
    selects: Vec<SelectReference>,
    /// The CTE names visible to the query being visited, innermost query last.
    scopes: Vec<Vec<Ident>>,
    /// The scope a CTE body sees, keyed by the body's address. It differs from the scope of the
    /// query that carries the `WITH`, because a CTE does not see itself or the CTEs after it.
    cte_body_scopes: HashMap<*const Query, Vec<Ident>>,
}

/// SQL matching rules for identifiers relevant to the engine's relation resolution: an unquoted
/// occurrence is ASCII case-insensitive, while any quoted side requires exact text.
pub(crate) fn identifiers_match(left: &Ident, right: &Ident) -> bool {
    if left.quote_style.is_some() || right.quote_style.is_some() {
        left.value == right.value
    } else {
        left.value.eq_ignore_ascii_case(&right.value)
    }
}

/// DuckDB folds CTE names and query-level output aliases regardless of whether their spelling was
/// quoted. This is deliberately narrower than manifest relation resolution, which retains quoted
/// identifier strictness.
fn cte_identifiers_match(left: &Ident, right: &Ident) -> bool {
    left.value.eq_ignore_ascii_case(&right.value)
}

impl Visitor for RelationCollector {
    type Break = ();

    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<()> {
        let inherited = self
            .cte_body_scopes
            .remove(&std::ptr::from_ref(query))
            .or_else(|| self.scopes.last().cloned())
            .unwrap_or_default();
        let mut visible = inherited.clone();
        if let Some(with) = &query.with {
            let declared: Vec<Ident> = with
                .cte_tables
                .iter()
                .map(|cte| cte.alias.name.clone())
                .collect();
            for (index, cte) in with.cte_tables.iter().enumerate() {
                let sees = if with.recursive {
                    declared.len()
                } else {
                    index
                };
                let mut scope = inherited.clone();
                scope.extend(declared[..sees].iter().cloned());
                self.cte_body_scopes
                    .insert(std::ptr::from_ref(&*cte.query), scope);
            }
            visible.extend(declared);
        }
        self.scopes.push(visible);
        self.collect_query_selects(query);
        ControlFlow::Continue(())
    }

    fn post_visit_query(&mut self, _query: &Query) -> ControlFlow<()> {
        self.scopes.pop();
        ControlFlow::Continue(())
    }

    fn pre_visit_relation(&mut self, relation: &ObjectName) -> ControlFlow<()> {
        if let [ObjectNamePart::Identifier(ident)] = relation.0.as_slice() {
            let bound = self
                .scopes
                .last()
                .is_some_and(|scope| scope.iter().any(|cte| cte_identifiers_match(cte, ident)));
            if bound {
                return ControlFlow::Continue(());
            }
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_table_factor(&mut self, factor: &TableFactor) -> ControlFlow<()> {
        let TableFactor::Table { name, .. } = factor else {
            return ControlFlow::Continue(());
        };
        if let [ObjectNamePart::Identifier(ident)] = name.0.as_slice() {
            let bound = self
                .scopes
                .last()
                .is_some_and(|scope| scope.iter().any(|cte| cte_identifiers_match(cte, ident)));
            if bound {
                return ControlFlow::Continue(());
            }
        }
        self.relations
            .push(RelationReference { name: name.clone() });
        ControlFlow::Continue(())
    }
}

impl RelationCollector {
    fn collect_query_selects(&mut self, query: &Query) {
        match query.body.as_ref() {
            // Query-level ORDER BY expressions resolve in the single SELECT's source scope. Set
            // operations expose their output columns rather than either branch's sources, so
            // keeping their ORDER BY out is the conservative provenance choice.
            SetExpr::Select(select) => self.collect_select(select, query.order_by.as_ref()),
            expression => self.collect_set_expr_selects(expression),
        }
    }

    fn collect_set_expr_selects(&mut self, expression: &SetExpr) {
        match expression {
            SetExpr::Select(select) => self.collect_select(select, None),
            SetExpr::SetOperation { left, right, .. } => {
                self.collect_set_expr_selects(left);
                self.collect_set_expr_selects(right);
            }
            // Nested `Query` expressions receive their own visitor callback and therefore their
            // own scope. The remaining set expressions do not expose SELECT sources.
            _ => {}
        }
    }

    fn collect_select(&mut self, select: &Select, order_by: Option<&OrderBy>) {
        let sources = self.select_sources(select);
        let mut columns = ScopedColumnCollector::default();
        // Nested queries must not contribute columns to this SELECT's scope, while expressions
        // after a nested query still belong to this SELECT and must be retained.
        let _ = select.visit(&mut columns);
        if let Some(order_by) = order_by {
            let mut order_columns = ScopedColumnCollector::default();
            let _ = order_by.visit(&mut order_columns);
            let output_aliases: Vec<&Ident> = select
                .projection
                .iter()
                .filter_map(|item| match item {
                    SelectItem::ExprWithAlias { alias, .. } => Some(alias),
                    _ => None,
                })
                .collect();
            columns
                .columns
                .extend(order_columns.columns.into_iter().filter(|column| {
                    column.qualifier.is_some()
                        || !output_aliases
                            .iter()
                            .any(|alias| cte_identifiers_match(alias, &column.name))
                }));
        }
        let mut wildcards = Vec::new();
        for item in &select.projection {
            let qualifier = match item {
                SelectItem::Wildcard(_) => None,
                SelectItem::QualifiedWildcard(
                    SelectItemQualifiedWildcardKind::ObjectName(name),
                    _,
                ) => name.0.last().and_then(|part| match part {
                    ObjectNamePart::Identifier(ident) => Some(ident.clone()),
                    _ => None,
                }),
                // `COUNT(*)` and arbitrary `expr.*` are not a projection of a relation.
                _ => continue,
            };
            wildcards.push(qualifier);
        }
        self.selects.push(SelectReference {
            sources,
            columns: columns.columns,
            wildcards,
        });
    }

    fn select_sources(&self, select: &Select) -> Vec<SelectSource> {
        let mut sources = Vec::new();
        for table in &select.from {
            Self::add_source(&table.relation, self.scopes.last(), &mut sources);
            for join in &table.joins {
                Self::add_source(&join.relation, self.scopes.last(), &mut sources);
            }
        }
        sources
    }

    fn add_source(
        factor: &TableFactor,
        scope: Option<&Vec<Ident>>,
        sources: &mut Vec<SelectSource>,
    ) {
        match factor {
            TableFactor::Table { name, alias, .. } => {
                let source_name = name.0.last().and_then(|part| match part {
                    ObjectNamePart::Identifier(ident) => Some(ident.clone()),
                    _ => None,
                });
                let is_cte = source_name.as_ref().is_some_and(|ident| {
                    name.0.len() == 1
                        && scope.is_some_and(|scope| {
                            scope.iter().any(|cte| cte_identifiers_match(cte, ident))
                        })
                });
                sources.push(SelectSource {
                    relation: (!is_cte && name.0.len() == 1)
                        .then(|| RelationReference { name: name.clone() }),
                    name: source_name,
                    alias: alias.as_ref().map(|alias| alias.name.clone()),
                });
            }
            TableFactor::Derived { alias, .. } => sources.push(SelectSource {
                relation: None,
                name: None,
                alias: alias.as_ref().map(|alias| alias.name.clone()),
            }),
            TableFactor::NestedJoin {
                table_with_joins,
                alias: None,
            } => {
                Self::add_source(&table_with_joins.relation, scope, sources);
                for join in &table_with_joins.joins {
                    Self::add_source(&join.relation, scope, sources);
                }
            }
            // Unknown table factors still block bare-column attribution. Their output may be a
            // function, pivot, UNNEST, an aliased nested join, or another construct whose cube
            // provenance is unproved.
            _ => sources.push(SelectSource {
                relation: None,
                name: None,
                alias: None,
            }),
        }
    }
}

#[derive(Default)]
struct ScopedColumnCollector {
    columns: Vec<ColumnReference>,
    nested_query_depth: usize,
}

impl Visitor for ScopedColumnCollector {
    type Break = ();

    fn pre_visit_query(&mut self, _query: &Query) -> ControlFlow<()> {
        // This collector is driven from a SELECT, so every query it encounters is nested.
        self.nested_query_depth += 1;
        ControlFlow::Continue(())
    }

    fn post_visit_query(&mut self, _query: &Query) -> ControlFlow<()> {
        self.nested_query_depth -= 1;
        ControlFlow::Continue(())
    }

    fn pre_visit_expr(&mut self, expr: &Expr) -> ControlFlow<()> {
        if self.nested_query_depth != 0 {
            return ControlFlow::Continue(());
        }
        match expr {
            Expr::Identifier(ident) => self.columns.push(ColumnReference {
                qualifier: None,
                name: ident.clone(),
            }),
            Expr::CompoundIdentifier(parts) => {
                if let Some(last) = parts.last() {
                    self.columns.push(ColumnReference {
                        qualifier: parts.get(parts.len().saturating_sub(2)).cloned(),
                        name: last.clone(),
                    });
                }
            }
            _ => {}
        }
        ControlFlow::Continue(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knowledge_sql_reads_frontmatter() {
        let md = "---\nnl: monthly revenue\nsql: SELECT status, COUNT(*) FROM orders GROUP BY 1\nsource: user\ntags:\n- source:enrich\n---\n";
        assert_eq!(
            knowledge_sql(md).unwrap(),
            "SELECT status, COUNT(*) FROM orders GROUP BY 1"
        );
    }

    #[test]
    fn knowledge_sql_ignores_body_after_closing_fence() {
        let md = "---\nsql: SELECT 1\n---\n\nSome trailing notes: not yaml [at all\n";
        assert_eq!(knowledge_sql(md).unwrap(), "SELECT 1");
    }

    #[test]
    fn knowledge_sql_with_unterminated_fence_still_parses_as_bare_yaml() {
        // An opening `---` with no closing fence: `frontmatter_block` finds no fence pair, so the
        // whole file is tried as bare YAML — where `---` is just a document-start marker.
        let md = "---\nsql: SELECT 1\n";
        assert_eq!(knowledge_sql(md).unwrap(), "SELECT 1");
    }

    #[test]
    fn knowledge_sql_without_sql_field_is_an_error() {
        let md = "---\nnl: just a note\n---\n";
        assert!(knowledge_sql(md).unwrap_err().contains("no `sql:` field"));
    }

    #[test]
    fn knowledge_sql_bad_yaml_is_an_error() {
        let md = "---\nsql: [unclosed\n---\n";
        assert!(knowledge_sql(md).is_err());
    }

    #[test]
    fn sql_table_names_walks_joins_and_subqueries() {
        let names = sql_table_names(
            "SELECT c.country, SUM(o.total) FROM orders o \
             JOIN customers c ON o.customer_id = c.id \
             WHERE o.id IN (SELECT order_id FROM refunds) GROUP BY 1",
        )
        .unwrap();
        let expected: BTreeSet<String> = ["orders", "customers", "refunds"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(names, expected);
    }

    #[test]
    fn sql_table_names_leaves_qualified_physical_relations_out() {
        let names = sql_table_names("SELECT * FROM main.orders").unwrap();
        assert!(!names.contains("orders"));
        assert!(!names.contains("main.orders"));
    }

    #[test]
    fn sql_column_names_skip_comments_literals_aliases_and_tables() {
        let names = sql_column_names(
            "SELECT o.total, SUM(amount) AS revenue /* refunds */ FROM orders o \
             WHERE note = 'status' ORDER BY revenue -- region",
        )
        .unwrap();
        let expected: BTreeSet<String> = ["total", "amount", "note", "revenue"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(names, expected);
    }

    #[test]
    fn unparseable_sql_returns_none() {
        assert!(sql_table_names("SELECT FROM WHERE ((( broken").is_none());
        assert!(sql_column_names("SELECT FROM WHERE ((( broken").is_none());
    }
}
