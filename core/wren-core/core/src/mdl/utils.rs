use datafusion::arrow::datatypes::Field;
use datafusion::common::{plan_err, Column, DFSchema};
use datafusion::error::Result;
use datafusion::execution::session_state::SessionState;
use datafusion::logical_expr::Expr;
use datafusion::sql::sqlparser::ast::Expr::{CompoundIdentifier, Identifier};
use datafusion::sql::sqlparser::ast::{visit_expressions, visit_expressions_mut, Ident};
use datafusion::sql::sqlparser::dialect::GenericDialect;
use datafusion::sql::sqlparser::parser::Parser;
use petgraph::algo::is_cyclic_directed;
use petgraph::{EdgeType, Graph};
use std::collections::{BTreeSet, VecDeque};
use std::ops::ControlFlow;
use std::sync::Arc;

use crate::logical_plan::utils::{from_qualified_name, try_map_data_type};
use crate::mdl::manifest::Model;
use crate::mdl::{AnalyzedWrenMDL, ColumnReference, Dataset, SessionStateRef};

pub fn to_expr_queue(column: Column) -> VecDeque<String> {
    column.name.split('.').map(String::from).collect()
}

pub fn is_dag<'a, N: 'a, E: 'a, Ty, Ix>(g: &'a Graph<N, E, Ty, Ix>) -> bool
where
    Ty: EdgeType,
    Ix: petgraph::graph::IndexType,
{
    g.is_directed() && !is_cyclic_directed(g)
}

/// Collect all identifiers in the expression. The output [Column] is unqualified.
/// Because the number of the CompoundIdentifier elements length would be greater than 3 in Wren Core,
/// we use the unqualified [Column] to represent the [CompoundIdentifier] in the expression.
///
/// For example, a [CompoundIdentifier] with 3 elements: `orders.customer.name` would be represented as `"orders.customer.name"`.
pub fn collect_identifiers(expr: &str) -> Result<BTreeSet<Column>> {
    let wrapped = format!("select {expr}");
    let parsed = match Parser::parse_sql(&GenericDialect {}, &wrapped) {
        Ok(v) => v,
        Err(e) => return plan_err!("Error parsing SQL: {}", e),
    };
    let statement = parsed[0].clone();
    let mut visited: BTreeSet<Column> = BTreeSet::new();

    let _ = visit_expressions(&statement, |expr| {
        match expr {
            Identifier(id) => {
                visited.insert(Column::from(quoted(&id.value)));
            }
            CompoundIdentifier(ids) => {
                let name = ids
                    .iter()
                    .map(|id| id.value.clone())
                    .collect::<Vec<String>>()
                    .join(".");
                visited.insert(Column::new_unqualified(name));
            }
            _ => {}
        }
        ControlFlow::<()>::Continue(())
    });
    Ok(visited)
}

/// Parse a relationship join condition into a list of `(left, right)` column pairs in AST
/// order. The condition must be a conjunction (`AND`) of equality (`=`) predicates over
/// column references — for example `a.x = b.x AND a.y = b.y`. Each equality contributes one
/// pair; pairs are preserved in source order so that callers can build a structurally
/// correct multi-key join condition.
///
/// Returns an error if the condition contains non-equality predicates, disjunctions, or
/// non-column operands.
pub fn collect_join_keys(expr: &str) -> Result<Vec<(Column, Column)>> {
    let parsed = match Parser::new(&GenericDialect {}).try_with_sql(expr) {
        Ok(p) => p,
        Err(e) => return plan_err!("Error parsing join condition `{expr}`: {e}"),
    }
    .parse_expr();
    let parsed = match parsed {
        Ok(e) => e,
        Err(e) => return plan_err!("Error parsing join condition `{expr}`: {e}"),
    };

    let mut pairs = Vec::new();
    collect_join_keys_inner(&parsed, &mut pairs)?;
    if pairs.is_empty() {
        return plan_err!(
            "Join condition `{expr}` must contain at least one equality predicate"
        );
    }
    Ok(pairs)
}

fn collect_join_keys_inner(
    expr: &datafusion::sql::sqlparser::ast::Expr,
    out: &mut Vec<(Column, Column)>,
) -> Result<()> {
    use datafusion::sql::sqlparser::ast::{BinaryOperator, Expr as SqlExpr};
    match expr {
        SqlExpr::Nested(inner) => collect_join_keys_inner(inner, out),
        SqlExpr::BinaryOp {
            left,
            op: BinaryOperator::And,
            right,
        } => {
            collect_join_keys_inner(left, out)?;
            collect_join_keys_inner(right, out)
        }
        SqlExpr::BinaryOp {
            left,
            op: BinaryOperator::Eq,
            right,
        } => {
            let l = column_from_sql_expr(left)?;
            let r = column_from_sql_expr(right)?;
            out.push((l, r));
            Ok(())
        }
        other => plan_err!(
            "Join condition must be a conjunction of column equalities, got: {other}"
        ),
    }
}

fn column_from_sql_expr(expr: &datafusion::sql::sqlparser::ast::Expr) -> Result<Column> {
    use datafusion::sql::sqlparser::ast::Expr as SqlExpr;
    match expr {
        SqlExpr::Identifier(id) => Ok(Column::new_unqualified(id.value.clone())),
        SqlExpr::CompoundIdentifier(ids) => {
            let name = ids
                .iter()
                .map(|id| id.value.clone())
                .collect::<Vec<String>>()
                .join(".");
            Ok(Column::new_unqualified(name))
        }
        SqlExpr::Nested(inner) => column_from_sql_expr(inner),
        other => {
            plan_err!("Expected column reference in join condition, got: {other}")
        }
    }
}

/// Provide a qualified name from a [Column] name.
///
/// Example: if a column name is `"orders.customer.name"`, the qualified name would be `"orders"."customer"."name"`.
pub fn qualify_name_from_column_name(column: &Column) -> String {
    column
        .flat_name()
        .split(".")
        .map(quoted)
        .collect::<Vec<String>>()
        .join(".")
}

/// Create the Logical Expr for the calculated field
pub fn create_wren_calculated_field_expr(
    column_rf: ColumnReference,
    analyzed_wren_mdl: Arc<AnalyzedWrenMDL>,
    session_state: SessionStateRef,
) -> Result<Expr> {
    if !column_rf.column.is_calculated {
        return plan_err!("Column is not calculated: {}", column_rf.column.name);
    }
    let qualified_col = from_qualified_name(
        &analyzed_wren_mdl.wren_mdl,
        column_rf.dataset.name(),
        column_rf.column.name(),
    );
    let Some(required_fields) = analyzed_wren_mdl
        .lineage
        .required_fields_map
        .get(&qualified_col)
    else {
        return plan_err!("Required fields not found for {}", qualified_col);
    };

    // collect all required models.
    let models = required_fields
        .iter()
        .filter_map(|c| c.relation.as_ref().map(|r| r.table().to_string()))
        .collect::<BTreeSet<_>>() // Collect into a BTreeSet to remove duplicates
        .into_iter() // Convert BTreeSet back into an iterator
        .map(|m| m.to_string())
        .collect::<Vec<String>>();
    // Remove all relationship fields from the expression. Only keep the target expression and its source table.
    let expr = column_rf.column.expression.clone().ok_or_else(|| {
        plan_err!(
            "calculated field must have an expression: {}",
            column_rf.column.name()
        )
    })?;
    let session_state = session_state.read();
    let mut expr = session_state
        .sql_to_expr(&expr, &session_state.config_options().sql_parser.dialect)?;
    let _ = visit_expressions_mut(&mut expr, |e| {
        if let CompoundIdentifier(ids) = e {
            let name_size = ids.len();
            if name_size > 2 {
                let slice = &ids[name_size - 2..name_size];
                *e = CompoundIdentifier(slice.to_vec());
            }
        }
        ControlFlow::<()>::Continue(())
    });

    let Some(schema) = models
        .into_iter()
        .map(|m| analyzed_wren_mdl.wren_mdl().get_model(&m))
        .filter_map(|m| m.map(Dataset::Model))
        .map(|m| m.to_qualified_schema(true))
        .reduce(|acc, schema| acc?.join(&schema?))
        .transpose()?
    else {
        return plan_err!("Error for creating schemas: {}", qualified_col);
    };
    session_state.create_logical_expr(&expr.to_string(), &schema)
}

/// Create the Logical Expr for the remote column.
pub(crate) fn create_remote_expr_for_model(
    expr: &str,
    model: Arc<Model>,
    analyzed_wren_mdl: Arc<AnalyzedWrenMDL>,
    session_state: SessionStateRef,
) -> Result<Expr> {
    let dataset = Dataset::Model(model);
    let schema = dataset.to_remote_schema(
        Some(analyzed_wren_mdl.wren_mdl().get_register_tables()),
        Arc::clone(&session_state),
    )?;
    let session_state = session_state.read();
    let input_expr = qualified_expr(expr, &schema, &session_state)?;
    session_state.create_logical_expr(input_expr.as_str(), &schema)
}

/// Create the Logical Expr for the remote column.
pub(crate) fn create_wren_expr_for_model(
    expr: &str,
    model: Arc<Model>,
    session_state: SessionStateRef,
) -> Result<Expr> {
    let dataset = Dataset::Model(model);
    let schema = dataset.to_qualified_schema(true)?;
    let session_state = session_state.read();
    session_state.create_logical_expr(
        qualified_expr(expr, &schema, &session_state)?.as_str(),
        &schema,
    )
}

/// Add the table prefix for the column expression if it can be resolved by the schema.
fn qualified_expr(
    expr: &str,
    schema: &DFSchema,
    session_state: &SessionState,
) -> Result<String> {
    let mut expr = session_state
        .sql_to_expr(expr, &session_state.config_options().sql_parser.dialect)?;
    let _ = visit_expressions_mut(&mut expr, |e| {
        if let Identifier(id) = e {
            if let Ok((Some(qualifier), _)) =
                schema.qualified_field_with_unqualified_name(&id.value)
            {
                let mut parts: Vec<_> = qualifier
                    .to_vec()
                    .into_iter()
                    .map(|q| quoted_ident(&q))
                    .collect();
                parts.push(quoted_ident(id.value.as_str()));
                *e = CompoundIdentifier(parts);
            }
        }
        ControlFlow::<()>::Continue(())
    });
    Ok(expr.to_string())
}

#[inline]
pub fn quoted_ident(s: &str) -> Ident {
    Ident::with_quote('"', s)
}

#[inline]
pub fn quoted(s: &str) -> String {
    format!("\"{s}\"")
}

#[inline]
pub fn dequote_identifier(s: &str) -> &str {
    // Require >= 2 chars so a single `"` doesn't slice 1..0 and panic.
    if s.len() >= 2 && s.starts_with('"') && s.ends_with('"') {
        &s[1..s.len() - 1]
    } else {
        s
    }
}

/// Transform the column to a datafusion field
pub fn to_field(column: &wren_core_base::mdl::Column) -> Result<Field> {
    let data_type = try_map_data_type(&column.r#type)?;
    Ok(Field::new(&column.name, data_type, column.not_null))
}

/// Transform the column to a datafusion field for a remote table
pub fn to_remote_field(
    column: &wren_core_base::mdl::Column,
    session_state: SessionStateRef,
) -> Result<Vec<Field>> {
    if let Some(expr_str) = column.expression() {
        let session_state = session_state.read();
        let expr = session_state.sql_to_expr(
            expr_str,
            &session_state.config_options().sql_parser.dialect,
        )?;
        let columns = collect_columns(expr);
        columns
            .into_iter()
            .map(|c| {
                Ok(Field::new(
                    c.value,
                    try_map_data_type(&column.r#type)?,
                    false,
                ))
            })
            .collect::<Result<_>>()
    } else {
        Ok(vec![to_field(column)?])
    }
}

fn collect_columns(expr: datafusion::logical_expr::sqlparser::ast::Expr) -> Vec<Ident> {
    let mut visited = vec![];
    let _ = visit_expressions(&expr, |e| {
        if let CompoundIdentifier(ids) = e {
            ids.iter().cloned().for_each(|id| visited.push(id));
        } else if let Identifier(id) = e {
            visited.push(id.clone());
        }
        ControlFlow::<()>::Continue(())
    });
    visited
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Arc;

    use datafusion::error::Result;
    use datafusion::prelude::SessionContext;

    use crate::logical_plan::utils::from_qualified_name;
    use crate::mdl::context::Mode;
    use crate::mdl::manifest::Manifest;
    use crate::mdl::AnalyzedWrenMDL;

    #[test]
    fn test_create_wren_expr() -> Result<()> {
        let test_data: PathBuf =
            [env!("CARGO_MANIFEST_DIR"), "tests", "data", "mdl.json"]
                .iter()
                .collect();
        let mdl_json = fs::read_to_string(test_data.as_path()).unwrap();
        let mdl = serde_json::from_str::<Manifest>(&mdl_json).unwrap();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            mdl,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let ctx = SessionContext::new();
        let column_rf = analyzed_mdl
            .wren_mdl
            .qualified_references
            .get(&from_qualified_name(
                &analyzed_mdl.wren_mdl,
                "orders",
                "customer_name",
            ))
            .unwrap();
        let expr = super::create_wren_calculated_field_expr(
            column_rf.clone(),
            analyzed_mdl.clone(),
            ctx.state_ref(),
        )?;
        assert_eq!(expr.to_string(), "customer.c_name");
        Ok(())
    }

    #[test]
    fn test_create_wren_expr_non_relationship() -> Result<()> {
        let test_data: PathBuf =
            [env!("CARGO_MANIFEST_DIR"), "tests", "data", "mdl.json"]
                .iter()
                .collect();
        let mdl_json = fs::read_to_string(test_data.as_path()).unwrap();
        let mdl = serde_json::from_str::<Manifest>(&mdl_json).unwrap();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            mdl,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let ctx = SessionContext::new();
        let column_rf = analyzed_mdl
            .wren_mdl
            .qualified_references
            .get(&from_qualified_name(
                &analyzed_mdl.wren_mdl,
                "orders",
                "orderkey_plus_custkey",
            ))
            .unwrap();
        let expr = super::create_wren_calculated_field_expr(
            column_rf.clone(),
            analyzed_mdl,
            ctx.state_ref(),
        )?;
        assert_eq!(expr.to_string(), "orders.o_orderkey + orders.o_custkey");
        Ok(())
    }

    #[test]
    fn test_collect_identifiers() -> Result<()> {
        let expr = "orders.orderkey + orders.custkey";
        let result = super::collect_identifiers(expr)?;
        assert_eq!(result.len(), 2);
        assert!(result.contains(&super::Column::new_unqualified("orders.orderkey")));
        assert!(result.contains(&super::Column::new_unqualified("orders.custkey")));

        let expr = "customers.state || order_id";
        let result = super::collect_identifiers(expr)?;
        assert_eq!(result.len(), 2);
        assert!(result.contains(&super::Column::new_unqualified("customers.state")));
        assert!(result.contains(&super::Column::new_unqualified("order_id")));

        let expr = r#""City" || ' ' || "State""#;
        let result = super::collect_identifiers(expr)?;
        assert!(result.contains(&super::Column::new_unqualified("City")));
        assert!(result.contains(&super::Column::new_unqualified("State")));
        Ok(())
    }

    #[test]
    fn test_collect_join_keys_single() -> Result<()> {
        let pairs = super::collect_join_keys("a.x = b.x")?;
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].0, super::Column::new_unqualified("a.x"));
        assert_eq!(pairs[0].1, super::Column::new_unqualified("b.x"));
        Ok(())
    }

    #[test]
    fn test_collect_join_keys_composite() -> Result<()> {
        let pairs = super::collect_join_keys("a.x = b.x AND a.y = b.y")?;
        assert_eq!(pairs.len(), 2);
        assert_eq!(pairs[0].0, super::Column::new_unqualified("a.x"));
        assert_eq!(pairs[0].1, super::Column::new_unqualified("b.x"));
        assert_eq!(pairs[1].0, super::Column::new_unqualified("a.y"));
        assert_eq!(pairs[1].1, super::Column::new_unqualified("b.y"));
        Ok(())
    }

    #[test]
    fn test_collect_join_keys_composite_three() -> Result<()> {
        let pairs = super::collect_join_keys("a.x = b.x AND a.y = b.y AND a.z = b.z")?;
        assert_eq!(pairs.len(), 3);
        assert_eq!(pairs[2].0, super::Column::new_unqualified("a.z"));
        assert_eq!(pairs[2].1, super::Column::new_unqualified("b.z"));
        Ok(())
    }

    #[test]
    fn test_collect_join_keys_parenthesized() -> Result<()> {
        let pairs = super::collect_join_keys("(a.x = b.x) AND (a.y = b.y)")?;
        assert_eq!(pairs.len(), 2);
        Ok(())
    }

    #[test]
    fn test_collect_join_keys_quoted() -> Result<()> {
        let pairs =
            super::collect_join_keys(r#""a"."X" = "b"."X" AND "a"."Y" = "b"."Y""#)?;
        assert_eq!(pairs.len(), 2);
        assert_eq!(pairs[0].0, super::Column::new_unqualified("a.X"));
        assert_eq!(pairs[0].1, super::Column::new_unqualified("b.X"));
        Ok(())
    }

    #[test]
    fn test_collect_join_keys_rejects_non_eq() {
        let err = super::collect_join_keys("a.x > b.x").unwrap_err();
        assert!(
            err.to_string().contains("conjunction of column equalities"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn test_collect_join_keys_rejects_disjunction() {
        let err = super::collect_join_keys("a.x = b.x OR a.y = b.y").unwrap_err();
        assert!(
            err.to_string().contains("conjunction of column equalities"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn test_collect_join_keys_rejects_literal() {
        let err = super::collect_join_keys("a.x = 1").unwrap_err();
        assert!(
            err.to_string().contains("Expected column reference"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn test_create_wren_expr_for_model() -> Result<()> {
        let test_data: PathBuf =
            [env!("CARGO_MANIFEST_DIR"), "tests", "data", "mdl.json"]
                .iter()
                .collect();
        let mdl_json = fs::read_to_string(test_data.as_path()).unwrap();
        let mdl = serde_json::from_str::<Manifest>(&mdl_json).unwrap();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            mdl,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let ctx = SessionContext::new();
        let model = analyzed_mdl.wren_mdl().get_model("customer").unwrap();
        let expr = super::create_wren_expr_for_model(
            "c_name",
            Arc::clone(&model),
            ctx.state_ref(),
        )?;
        assert_eq!(expr.to_string(), "customer.c_name");
        Ok(())
    }

    #[test]
    fn test_create_remote_expr_for_model() -> Result<()> {
        let test_data: PathBuf =
            [env!("CARGO_MANIFEST_DIR"), "tests", "data", "mdl.json"]
                .iter()
                .collect();
        let mdl_json = fs::read_to_string(test_data.as_path()).unwrap();
        let mdl = serde_json::from_str::<Manifest>(&mdl_json).unwrap();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            mdl,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let ctx = SessionContext::new();
        let model = analyzed_mdl.wren_mdl().get_model("customer").unwrap();
        let expr = super::create_remote_expr_for_model(
            "c_name",
            Arc::clone(&model),
            analyzed_mdl,
            ctx.state_ref(),
        )?;
        assert_eq!(expr.to_string(), "customer.c_name");
        Ok(())
    }
}
