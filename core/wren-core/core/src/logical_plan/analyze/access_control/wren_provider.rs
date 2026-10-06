use std::sync::Arc;

use datafusion::common::Result;
use datafusion::prelude::Expr;
use wren_core_base::mdl::{Column, Model};

use super::provider::{AccessControlProvider, AccessScope, ColumnAccessDecision};
use super::{
    build_filter_expression, collect_condition, validate_clac_rule, validate_rule,
};
use crate::mdl::context::SessionPropertiesRef;
use crate::mdl::SessionStateRef;
use crate::AnalyzedWrenMDL;

/// Default access control using MDL row/column rules and session properties.
#[derive(Debug, Default)]
pub struct WrenAccessControlProvider;

impl AccessControlProvider for WrenAccessControlProvider {
    fn row_filter(
        &self,
        model: &Model,
        session_state: &SessionStateRef,
        properties: &SessionPropertiesRef,
        analyzed_mdl: Option<Arc<AnalyzedWrenMDL>>,
        _scope: AccessScope,
    ) -> Result<Option<Expr>> {
        let mut combined: Option<Expr> = None;
        for rule in model.row_level_access_controls() {
            if !validate_rule(&rule.name, &rule.required_properties, properties)? {
                continue;
            }
            let expr = build_filter_expression(
                session_state,
                analyzed_mdl.clone(),
                Arc::new(model.clone()),
                properties,
                rule,
            )?;
            combined = Some(match combined {
                Some(acc) => acc.and(expr),
                None => expr,
            });
        }
        Ok(combined)
    }

    fn column_access(
        &self,
        model_name: &str,
        column: &Column,
        properties: &SessionPropertiesRef,
        analyzed_mdl: Option<Arc<AnalyzedWrenMDL>>,
    ) -> Result<ColumnAccessDecision> {
        let (allowed, rule_name) =
            validate_clac_rule(model_name, column, properties, analyzed_mdl)?;
        Ok(if allowed {
            ColumnAccessDecision::Allow
        } else {
            ColumnAccessDecision::Deny {
                // The MDL validator supplies a rule name for every denial.
                rule_name: rule_name
                    .unwrap_or_else(|| format!("{}.{}", model_name, column.name())),
            }
        })
    }

    fn collect_required_fields(
        &self,
        model: &Model,
        _session_state: &SessionStateRef,
        properties: &SessionPropertiesRef,
        _analyzed_mdl: Option<Arc<AnalyzedWrenMDL>>,
    ) -> Result<Vec<Expr>> {
        let mut fields = Vec::new();
        for rule in model.row_level_access_controls() {
            if validate_rule(&rule.name, &rule.required_properties, properties)? {
                fields.extend(collect_condition(model, &rule.condition)?.0);
            }
        }
        Ok(fields)
    }
}
