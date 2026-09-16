use std::sync::Arc;

use datafusion::common::Result;
use datafusion::error::DataFusionError;
use datafusion::prelude::Expr;
use wren_core_base::mdl::{Column, Model};

use crate::logical_plan::error::WrenError;
use crate::mdl::context::SessionPropertiesRef;
use crate::mdl::SessionStateRef;
use crate::AnalyzedWrenMDL;

/// The origin of a model access, including accesses through relationships.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccessScope {
    /// Referenced by user SQL, including user-written subqueries.
    DirectQuery,
    /// Referenced by a subquery introduced by a provider's row filter.
    InternalSubquery,
}

/// A provider's decision about one model column.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ColumnAccessDecision {
    Allow,
    Deny { rule_name: String },
}

/// Pluggable row and column access control for semantic query planning.
///
/// Providers must be safe to share between concurrent planning calls. Bind any
/// request-specific identity to the provider or read it from session properties;
/// do not keep mutable query traversal state on a shared provider.
/// Errors propagate to the caller and never fall back to another provider.
pub trait AccessControlProvider: std::fmt::Debug + Send + Sync {
    /// Return a filter over the model's semantic columns, or `None` for no filter.
    /// Return a permission error to reject access to the entire model.
    /// Subqueries in the filter are analyzed recursively with `InternalSubquery`.
    fn row_filter(
        &self,
        model: &Model,
        session_state: &SessionStateRef,
        properties: &SessionPropertiesRef,
        analyzed_mdl: Option<Arc<AnalyzedWrenMDL>>,
        scope: AccessScope,
    ) -> Result<Option<Expr>>;

    /// Decide column visibility and validate explicit column references.
    /// Denied columns are omitted from wildcard expansion.
    fn column_access(
        &self,
        model_name: &str,
        column: &Column,
        properties: &SessionPropertiesRef,
        analyzed_mdl: Option<Arc<AnalyzedWrenMDL>>,
    ) -> Result<ColumnAccessDecision>;

    /// Semantic columns needed by the row filter, even when not selected by SQL.
    /// These columns still undergo column access checks. Include only references
    /// on this model; referenced subqueries plan their own required columns.
    fn collect_required_fields(
        &self,
        model: &Model,
        session_state: &SessionStateRef,
        properties: &SessionPropertiesRef,
        analyzed_mdl: Option<Arc<AnalyzedWrenMDL>>,
    ) -> Result<Vec<Expr>>;
}

pub(crate) fn check_column_access(
    provider: &dyn AccessControlProvider,
    model_name: &str,
    column: &Column,
    properties: &SessionPropertiesRef,
    analyzed_mdl: Option<Arc<AnalyzedWrenMDL>>,
) -> Result<()> {
    match provider.column_access(model_name, column, properties, analyzed_mdl)? {
        ColumnAccessDecision::Allow => Ok(()),
        ColumnAccessDecision::Deny { rule_name } => Err(DataFusionError::External(
            Box::new(WrenError::PermissionDenied(format!(
                r#"Access denied to column "{}"."{}": violates access control rule "{}""#,
                model_name,
                column.name(),
                rule_name
            ))),
        )),
    }
}
