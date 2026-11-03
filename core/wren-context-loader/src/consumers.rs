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

use std::collections::{BTreeSet, HashMap};
use std::ops::ControlFlow;

use serde::Deserialize;
use sqlparser::ast::{visit_expressions, Expr, ObjectName, ObjectNamePart, Query, Visit, Visitor};
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

/// Every relation (table-position) name referenced by `sql`, by parsing it with sqlparser's
/// GenericDialect. Compound names keep only their last part (`main.orders` → `orders`), since MDL
/// node names are unqualified. Returns `None` when the SQL does not parse — the caller decides the
/// fallback (whole-word scan) and records the degradation.
///
/// A name bound by a `WITH` clause is not a table read, so an unqualified reference to a CTE that
/// is in scope is left out (matched case-insensitively, as SQL does for unquoted names). Scope
/// follows SQL: a CTE is visible to the query body that carries the `WITH` and to the CTEs
/// declared after it (to every sibling under `WITH RECURSIVE`), never to its own body, so
/// `WITH orders AS (SELECT * FROM orders) SELECT * FROM orders` still reads the `orders` table
/// inside the CTE body, and a CTE defined in a subquery shadows nothing outside that subquery.
pub(crate) fn sql_table_names(sql: &str) -> Option<BTreeSet<String>> {
    let statements = Parser::parse_sql(&GenericDialect {}, sql).ok()?;
    let mut collector = RelationCollector::default();
    let _: ControlFlow<()> = statements.visit(&mut collector);
    Some(collector.names)
}

/// Every column name `sql` references in an expression (`total`, `o.total` → `total`), by parsing
/// it. Comments, string literals, select-list aliases and table names are not column references,
/// so they are not in the set. Returns `None` when the SQL does not parse; the caller falls back
/// to a whole-word scan, as for [`sql_table_names`].
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

/// Collects table-position relation names while tracking which CTE names are in scope.
#[derive(Default)]
struct RelationCollector {
    names: BTreeSet<String>,
    /// The CTE names (lowercased) visible to the query being visited, innermost query last.
    scopes: Vec<Vec<String>>,
    /// The scope a CTE body sees, keyed by the body's address. It differs from the scope of the
    /// query that carries the `WITH`, because a CTE does not see itself or the CTEs after it.
    cte_body_scopes: HashMap<*const Query, Vec<String>>,
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
            let declared: Vec<String> = with
                .cte_tables
                .iter()
                .map(|cte| cte.alias.name.value.to_lowercase())
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
                .is_some_and(|scope| scope.contains(&ident.value.to_lowercase()));
            if bound {
                return ControlFlow::Continue(());
            }
        }
        if let Some(ObjectNamePart::Identifier(ident)) = relation.0.last() {
            self.names.insert(ident.value.clone());
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
    fn sql_table_names_unqualifies_compound_names() {
        let names = sql_table_names("SELECT * FROM main.orders").unwrap();
        assert!(names.contains("orders"));
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
