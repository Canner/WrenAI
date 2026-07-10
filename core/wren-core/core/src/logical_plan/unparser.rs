use datafusion::common::Result;
use datafusion::logical_expr::UserDefinedLogicalNode;
use datafusion::sql::sqlparser::ast::Statement;
use datafusion::sql::sqlparser::dialect::GenericDialect;
use datafusion::sql::sqlparser::parser::Parser;
use datafusion::sql::unparser::ast::{
    DerivedRelationBuilder, QueryBuilder, RelationBuilder, SelectBuilder,
};
use datafusion::sql::unparser::extension_unparser::{
    UnparseWithinStatementResult, UserDefinedLogicalNodeUnparser,
};
use datafusion::sql::unparser::Unparser;

use crate::logical_plan::analyze::plan::SqlReferencePlanNode;

pub struct SqlReferenceNodeUnparser;

impl UserDefinedLogicalNodeUnparser for SqlReferenceNodeUnparser {
    fn unparse(
        &self,
        node: &dyn UserDefinedLogicalNode,
        _unparser: &Unparser,
        _query: &mut Option<&mut QueryBuilder>,
        _select: &mut Option<&mut SelectBuilder>,
        relation: &mut Option<&mut RelationBuilder>,
    ) -> Result<UnparseWithinStatementResult> {
        let Some(sql_ref) = node.as_any().downcast_ref::<SqlReferencePlanNode>() else {
            return Ok(UnparseWithinStatementResult::Unmodified);
        };

        // Parse the ref_sql string into a SQL AST
        let dialect = GenericDialect {};
        let statements = Parser::new(&dialect)
            .try_with_sql(&sql_ref.sql)?
            .parse_statements()?;

        if statements.len() != 1 {
            return Err(datafusion::error::DataFusionError::Plan(format!(
                "ref_sql for model '{}' must contain exactly one SQL statement, found {}",
                sql_ref.model_name,
                statements.len()
            )));
        }

        let statement = statements.into_iter().next().expect("checked length == 1");
        let Statement::Query(parsed_query) = statement else {
            return Err(datafusion::error::DataFusionError::Plan(format!(
                "ref_sql for model '{}' must be a SELECT statement",
                sql_ref.model_name
            )));
        };

        let mut derived_builder = DerivedRelationBuilder::default();
        derived_builder.subquery(parsed_query);
        derived_builder.lateral(false);

        if let Some(rel) = relation {
            rel.derived(derived_builder);
        }

        Ok(UnparseWithinStatementResult::Modified)
    }
}
