use std::any::Any;
use std::collections::HashMap;
use std::ops::Deref;
use std::sync::Arc;

use crate::logical_plan::analyze::access_control::validate_clac_rule;
use crate::logical_plan::analyze::expand_view::ExpandWrenViewRule;
use crate::logical_plan::analyze::model_anlayze::ModelAnalyzeRule;
use crate::logical_plan::analyze::model_generation::ModelGenerationRule;
use crate::logical_plan::optimize::simplify_timestamp::TimestampSimplify;
use crate::logical_plan::optimize::type_coercion::TypeCoercion as WrenTypeCoercion;
use crate::logical_plan::utils::create_schema;
use crate::mdl::manifest::Model;
use crate::mdl::type_planner::WrenTypePlanner;
use crate::mdl::{AnalyzedWrenMDL, SessionStateRef};
use async_trait::async_trait;
use datafusion::arrow::datatypes::SchemaRef;
use datafusion::catalog::memory::MemoryCatalogProvider;
use datafusion::catalog::CatalogProvider;
use datafusion::catalog::{MemorySchemaProvider, Session};
use datafusion::common::Result;
use datafusion::datasource::{TableProvider, TableType, ViewTable};
use datafusion::execution::session_state::SessionStateBuilder;
use datafusion::logical_expr::Expr;
use datafusion::optimizer::analyzer::type_coercion::TypeCoercion;
use datafusion::optimizer::eliminate_duplicated_expr::EliminateDuplicatedExpr;
use datafusion::optimizer::eliminate_filter::EliminateFilter;
use datafusion::optimizer::eliminate_group_by_constant::EliminateGroupByConstant;
use datafusion::optimizer::eliminate_join::EliminateJoin;
use datafusion::optimizer::eliminate_outer_join::EliminateOuterJoin;
use datafusion::optimizer::extract_equijoin_predicate::ExtractEquijoinPredicate;
use datafusion::optimizer::filter_null_join_keys::FilterNullJoinKeys;
use datafusion::optimizer::propagate_empty_relation::PropagateEmptyRelation;
use datafusion::optimizer::{AnalyzerRule, OptimizerRule};
use datafusion::physical_plan::ExecutionPlan;
use datafusion::prelude::SessionContext;
use datafusion::scalar::ScalarValue;
use datafusion::sql::TableReference;
use parking_lot::RwLock;

pub type SessionPropertiesRef = Arc<HashMap<String, Option<String>>>;

/// Apply Wren Rules to the context for sql generation.
pub async fn apply_wren_on_ctx(
    ctx: &SessionContext,
    analyzed_mdl: Arc<AnalyzedWrenMDL>,
    properties: SessionPropertiesRef,
    mode: Mode,
) -> Result<SessionContext> {
    let session_timezone = properties
        .get("x-wren-timezone")
        .map(|v| v.as_ref().map(|s| s.as_str()).unwrap_or("UTC").to_string());

    let mut config = ctx
        .copied_config()
        .set(
            "datafusion.sql_parser.default_null_ordering",
            &ScalarValue::Utf8(Some("nulls_last".to_string())),
        )
        .set(
            "datafusion.sql_parser.enable_ident_normalization",
            &ScalarValue::Utf8(Some("false".to_string())),
        )
        .with_create_default_catalog_and_schema(false)
        .with_default_catalog_and_schema(
            analyzed_mdl.wren_mdl.catalog(),
            analyzed_mdl.wren_mdl.schema(),
        )
        .with_information_schema(true);

    if let Some(session_timezone) = session_timezone {
        config
            .options_mut()
            .set("datafusion.execution.time_zone", &session_timezone)?;
    }

    let type_planner = Arc::new(WrenTypePlanner::default());
    let reset_default_catalog_schema = Arc::new(RwLock::new(
        SessionStateBuilder::new_from_existing(ctx.state())
            .with_config(config.clone())
            .with_type_planner(type_planner)
            .build(),
    ));

    let new_state = SessionStateBuilder::new_from_existing(
        reset_default_catalog_schema.clone().read().deref().clone(),
    );

    // ensure all the key in properties is lowercase
    let properties = Arc::new(
        properties
            .iter()
            .map(|(k, v)| {
                let k = k.to_lowercase();
                (k, v.clone())
            })
            .collect::<HashMap<_, _>>(),
    );

    let new_state = new_state.with_analyzer_rules(mode.get_analyze_rules(
        Arc::clone(&analyzed_mdl),
        Arc::clone(&reset_default_catalog_schema),
        Arc::clone(&properties),
    ));
    let new_state = if let Some(optimize_rules) = mode.get_optimize_rules() {
        new_state.with_optimizer_rules(optimize_rules)
    } else {
        new_state
    };

    let new_state = new_state.with_config(config).build();
    let ctx = SessionContext::new_with_state(new_state);
    register_table_with_mdl(&ctx, analyzed_mdl, properties, mode).await?;
    Ok(ctx)
}

/// Execution mode for Wren engine.
#[derive(Debug)]
pub enum Mode {
    /// Local runtime mode, used for executing queries by DataFusion directly.
    LocalRuntime,
    /// Unparse mode, used for generating SQL statements.
    /// This mode is used to generate SQL statements that can be executed in other SQL engines.
    Unparse,
    /// Permission analyze mode, used for analyzing if the error is caused by permission denied.
    /// It's only be used when an error is raised during Unparse mode.
    PermissionAnalyze,
}

impl Mode {
    pub fn get_analyze_rules(
        &self,
        analyzed_mdl: Arc<AnalyzedWrenMDL>,
        session_state_ref: SessionStateRef,
        properties: SessionPropertiesRef,
    ) -> Vec<Arc<dyn AnalyzerRule + Send + Sync>> {
        match self {
            Mode::LocalRuntime => analyze_rule_for_local_runtime(
                Arc::clone(&analyzed_mdl),
                Arc::clone(&session_state_ref),
                Arc::clone(&properties),
            ),
            Mode::Unparse => analyze_rule_for_unparsing(
                Arc::clone(&analyzed_mdl),
                Arc::clone(&session_state_ref),
                Arc::clone(&properties),
            ),
            Mode::PermissionAnalyze => analyze_rule_for_permission(
                Arc::clone(&analyzed_mdl),
                Arc::clone(&session_state_ref),
                Arc::clone(&properties),
            ),
        }
    }

    pub fn get_optimize_rules(
        &self,
    ) -> Option<Vec<Arc<dyn OptimizerRule + Send + Sync>>> {
        match self {
            Mode::LocalRuntime => None,
            Mode::Unparse => Some(optimize_rule_for_unparsing()),
            Mode::PermissionAnalyze => Some(vec![]),
        }
    }

    pub fn is_permission_analyze(&self) -> bool {
        matches!(self, Mode::PermissionAnalyze)
    }
}

// Analyzer rules for local runtime
fn analyze_rule_for_local_runtime(
    analyzed_mdl: Arc<AnalyzedWrenMDL>,
    session_state_ref: SessionStateRef,
    properties: SessionPropertiesRef,
) -> Vec<Arc<dyn AnalyzerRule + Send + Sync>> {
    vec![
        // expand the view should be the first rule
        Arc::new(ExpandWrenViewRule::new(
            Arc::clone(&analyzed_mdl),
            Arc::clone(&session_state_ref),
        )),
        Arc::new(ModelAnalyzeRule::new(
            Arc::clone(&analyzed_mdl),
            Arc::clone(&session_state_ref),
            Arc::clone(&properties),
        )),
        Arc::new(ModelGenerationRule::new(
            Arc::clone(&analyzed_mdl),
            session_state_ref,
            properties,
        )),
        // Use DataFusion TypeCoercion for the executing purpose
        Arc::new(TypeCoercion::new()),
    ]
}

// Analyze rules for local runtime
fn analyze_rule_for_unparsing(
    analyzed_mdl: Arc<AnalyzedWrenMDL>,
    session_state_ref: SessionStateRef,
    properties: SessionPropertiesRef,
) -> Vec<Arc<dyn AnalyzerRule + Send + Sync>> {
    vec![
        // expand the view should be the first rule
        Arc::new(ExpandWrenViewRule::new(
            Arc::clone(&analyzed_mdl),
            Arc::clone(&session_state_ref),
        )),
        Arc::new(ModelAnalyzeRule::new(
            Arc::clone(&analyzed_mdl),
            Arc::clone(&session_state_ref),
            Arc::clone(&properties),
        )),
        Arc::new(ModelGenerationRule::new(
            Arc::clone(&analyzed_mdl),
            session_state_ref,
            properties,
        )),
        // TimestampSimplify should be placed before TypeCoercion because the simplified timestamp should
        // be casted to the target type if needed
        Arc::new(TimestampSimplify::new()),
        // Use WrenTypeCoercion for the unparsing purpose
        Arc::new(WrenTypeCoercion::new()),
    ]
}

/// Optimizer rules for unparse
fn optimize_rule_for_unparsing() -> Vec<Arc<dyn OptimizerRule + Send + Sync>> {
    vec![
        // Disable EliminateNestedUnion because unparser only support unparsing an union with two inputs
        // see https://github.com/apache/datafusion/issues/13621 for details
        // Arc::new(EliminateNestedUnion::new()),
        // Disable SimplifyExpressions to avoid apply some function locally
        // Arc::new(SimplifyExpressions::new()),
        // Unparser has some issues for handling derived table generated by ReplaceDistinctWithAggregate rule
        // Arc::new(ReplaceDistinctWithAggregate::new()),
        Arc::new(EliminateJoin::new()),
        // Unparser has some issues for handling decorrelated plans
        // Arc::new(DecorrelatePredicateSubquery::new()),
        // Disable ScalarSubqueryToJoin to avoid generate invalid sql (join without condition)
        // Arc::new(ScalarSubqueryToJoin::new()),
        Arc::new(ExtractEquijoinPredicate::new()),
        // Disable SimplifyExpressions to avoid apply some function locally
        // Arc::new(SimplifyExpressions::new()),
        Arc::new(EliminateDuplicatedExpr::new()),
        Arc::new(EliminateFilter::new()),
        // Disable EliminateCrossJoin to avoid generate invalid sql (expression should be rebased manually)
        // Arc::new(EliminateCrossJoin::new()),
        // Disable CommonSubexprEliminate to avoid generate invalid projection plan
        // Arc::new(CommonSubexprEliminate::new()),
        // Arc::new(EliminateLimit::new()),
        Arc::new(PropagateEmptyRelation::new()),
        // OptimizeUnions replaces both EliminateNestedUnion and EliminateOneUnion in DataFusion 53,
        // but it also flattens nested unions into multi-input unions which the unparser cannot handle.
        // See https://github.com/apache/datafusion/issues/13621 for details.
        // Arc::new(OptimizeUnions::new()),
        Arc::new(FilterNullJoinKeys::default()),
        Arc::new(EliminateOuterJoin::new()),
        // Filters can't be pushed down past Limits, we should do PushDownFilter after PushDownLimit
        // TODO: Sort with pushdown-limit doesn't support to be unparse
        // Arc::new(PushDownLimit::new()),
        // Disable PushDownFilter to avoid the casting for bigquery (datetime/timestamp) column be removed
        // Arc::new(PushDownFilter::new()),
        // Disable SingleDistinctToGroupBy to avoid generate invalid aggregation plan
        // Arc::new(SingleDistinctToGroupBy::new()),
        // Disable SimplifyExpressions to avoid apply some function locally
        // Arc::new(SimplifyExpressions::new()),
        // Disable CommonSubexprEliminate to avoid generate invalid projection plan
        // Arc::new(CommonSubexprEliminate::new()),
        Arc::new(EliminateGroupByConstant::new()),
        // TODO: This rule would generate a plan that is not supported by the current unparser
        // Arc::new(OptimizeProjections::new()),
    ]
}

fn analyze_rule_for_permission(
    analyzed_mdl: Arc<AnalyzedWrenMDL>,
    session_state_ref: SessionStateRef,
    properties: SessionPropertiesRef,
) -> Vec<Arc<dyn AnalyzerRule + Send + Sync>> {
    vec![
        // expand the view should be the first rule
        Arc::new(ExpandWrenViewRule::new(
            Arc::clone(&analyzed_mdl),
            Arc::clone(&session_state_ref),
        )),
        Arc::new(ModelAnalyzeRule::new(
            Arc::clone(&analyzed_mdl),
            Arc::clone(&session_state_ref),
            Arc::clone(&properties),
        )),
    ]
}

pub async fn register_table_with_mdl(
    ctx: &SessionContext,
    analyzed_mdl: Arc<AnalyzedWrenMDL>,
    properties: SessionPropertiesRef,
    mode: Mode,
) -> Result<()> {
    let catalog = MemoryCatalogProvider::new();
    let schema = MemorySchemaProvider::new();
    let wren_mdl = analyzed_mdl.wren_mdl();
    catalog.register_schema(&wren_mdl.manifest.schema, Arc::new(schema))?;
    ctx.register_catalog(&wren_mdl.manifest.catalog, Arc::new(catalog));

    for model in wren_mdl.manifest.models.iter() {
        let table = WrenDataSource::new(
            Arc::clone(model),
            &properties,
            Arc::clone(&analyzed_mdl),
            &mode,
        )?;
        ctx.register_table(
            TableReference::full(wren_mdl.catalog(), wren_mdl.schema(), model.name()),
            Arc::new(table),
        )?;
    }
    for view in wren_mdl.manifest.views.iter() {
        let plan = ctx.state().create_logical_plan(&view.statement).await?;
        let view_table = ViewTable::new(plan, Some(view.statement.clone()));
        ctx.register_table(
            TableReference::full(wren_mdl.catalog(), wren_mdl.schema(), view.name()),
            Arc::new(view_table),
        )?;
    }
    Ok(())
}

#[derive(Debug)]
pub struct WrenDataSource {
    schema: SchemaRef,
}

impl WrenDataSource {
    pub fn new(
        model: Arc<Model>,
        properties: &SessionPropertiesRef,
        analyzed_mdl: Arc<AnalyzedWrenMDL>,
        mode: &Mode,
    ) -> Result<Self> {
        let available_columns = model
            .get_physical_columns(true)
            .iter()
            .map(|column| {
                if mode.is_permission_analyze()
                    || validate_clac_rule(
                        model.name(),
                        column,
                        properties,
                        Some(Arc::clone(&analyzed_mdl)),
                    )?
                    .0
                {
                    Ok(Some(Arc::clone(column)))
                } else {
                    Ok(None)
                }
            })
            .collect::<Result<Vec<_>>>()?
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();
        let schema = create_schema(available_columns)?;
        Ok(Self { schema })
    }

    pub fn new_with_schema(schema: SchemaRef) -> Self {
        Self { schema }
    }
}

#[async_trait]
impl TableProvider for WrenDataSource {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn schema(&self) -> SchemaRef {
        self.schema.clone()
    }

    fn table_type(&self) -> TableType {
        TableType::View
    }

    async fn scan(
        &self,
        _state: &dyn Session,
        _projection: Option<&Vec<usize>>,
        // filters and limit can be used here to inject some push-down operations if needed
        _filters: &[Expr],
        _limit: Option<usize>,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        unreachable!("WrenDataSource should be replaced before physical planning")
    }
}
