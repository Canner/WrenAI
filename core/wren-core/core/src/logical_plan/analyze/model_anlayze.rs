use crate::logical_plan::analyze::plan::ModelPlanNode;
use crate::logical_plan::analyze::scope::{ScopeId, ScopeManager};
use crate::logical_plan::utils::{belong_to_mdl, expr_to_columns};
use crate::mdl::context::SessionPropertiesRef;
use crate::mdl::utils::quoted;
use crate::mdl::{AnalyzedWrenMDL, Dataset, SessionStateRef};
use datafusion::common::tree_node::{
    Transformed, TransformedResult, TreeNode, TreeNodeRecursion, TreeNodeRewriter,
};
use datafusion::common::{internal_err, plan_err, Column, DFSchemaRef, Result, Spans};
use datafusion::config::ConfigOptions;
use datafusion::error::DataFusionError;
use datafusion::logical_expr::expr::{Alias, Exists, InSubquery};
use datafusion::logical_expr::{
    col, ident, Aggregate, Distinct, DistinctOn, Expr, Extension, Filter, Join,
    LogicalPlan, LogicalPlanBuilder, Projection, Subquery, SubqueryAlias, TableScan,
    Window,
};
use datafusion::optimizer::AnalyzerRule;
use datafusion::sql::TableReference;
use std::cell::RefCell;
use std::collections::HashSet;
use std::fmt::Debug;
use std::sync::Arc;

#[cfg(test)]
thread_local! {
    /// Counts [`ModelAnalyzeRule::build_model_plan_node`] calls; thread-local because
    /// `#[tokio::test]`'s default current-thread runtime keeps caller and counter on
    /// the same thread (a `flavor = "multi_thread"` test would need something else).
    pub(crate) static BUILD_MODEL_PLAN_NODE_CALLS: std::cell::Cell<usize> =
        const { std::cell::Cell::new(0) };
}

/// [ModelAnalyzeRule] responsible for analyzing the model plan node. Turn TableScan from a model to a ModelPlanNode.
/// We collect the required fields from the projection, filter, aggregation, and join,
/// and pass them to the ModelPlanNode.
///
/// There are three main steps in this rule:
/// 1. Analyze the scope of the logical plan and collect the required columns for models and visited tables. (button-up and depth-first)
/// 2. Analyze the model and generate the ModelPlanNode according to the scope analysis. (button-up and depth-first, except the `SubqueryAlias -> TableScan` shortcut in `f_down`, which handles that shape pre-order and skips its subtree)
/// 3. Remove the catalog and schema prefix of Wren for the column and refresh the schema. (top-down)
///
/// Step 2's shortcut may skip a subtree only when no skipped node can carry a subquery
/// (a bare `TableScan` never does: filter pushdown is an optimizer rule, so `filters`
/// is always empty at analyzer time). Elsewhere, the traverse path of step 1 and step 2 should be same.
/// The corresponding scope will be pushed to or popped from the childs of [Scope] sequentially.
pub struct ModelAnalyzeRule {
    analyzed_wren_mdl: Arc<AnalyzedWrenMDL>,
    session_state: SessionStateRef,
    properties: SessionPropertiesRef,
}

/// RLAC cycle-detection state for recursive resolution (A's RLAC referencing
/// B whose RLAC references A). Allocated per `analyze` invocation and threaded
/// through recursive calls. A session context shares one `Send + Sync` analyzer
/// rule; `RefCell` being `!Sync` makes storing this state on that rule fail
/// to compile.
type ModelStack = RefCell<HashSet<String>>;

/// RAII guard that removes a model name from the cycle-detection stack on
/// drop, regardless of how the surrounding function exits.
struct ModelStackGuard<'a> {
    stack: &'a ModelStack,
    name: String,
}

impl Drop for ModelStackGuard<'_> {
    fn drop(&mut self) {
        self.stack.borrow_mut().remove(&self.name);
    }
}

/// Drives [`ModelAnalyzeRule::analyze_model`], trying
/// [`ModelAnalyzeRule::shortcut_aliased_table_scan`] before the original
/// [`ModelAnalyzeRule::analyze_model_internal`] pass.
struct ModelRewriter<'a> {
    rule: &'a ModelAnalyzeRule,
    scope_manager: &'a mut ScopeManager,
    current_scope_id: ScopeId,
    cycle_stack: &'a ModelStack,
}

impl TreeNodeRewriter for ModelRewriter<'_> {
    type Node = LogicalPlan;

    fn f_down(&mut self, plan: LogicalPlan) -> Result<Transformed<LogicalPlan>> {
        self.rule.shortcut_aliased_table_scan(
            plan,
            self.scope_manager,
            self.current_scope_id,
            self.cycle_stack,
        )
    }

    fn f_up(&mut self, plan: LogicalPlan) -> Result<Transformed<LogicalPlan>> {
        // Always run the bottom-up pass, even on a node the shortcut just built
        // (SubqueryAlias -> Extension(ModelPlanNode)): analyze_model_internal's
        // SubqueryAlias arm only matches an immediate SubqueryAlias or TableScan
        // input, so it falls to the `_` arm and reconstructs the same node via
        // SubqueryAlias::try_new, a no-op.
        let plan = self
            .rule
            .analyze_model_internal(
                plan,
                self.scope_manager,
                self.current_scope_id,
                self.cycle_stack,
            )?
            .data;
        // If the plan contains subquery, we should analyze the subquery recursively
        plan.map_subqueries(|plan| {
            if let LogicalPlan::Subquery(subquery) = &plan {
                let root_scope =
                    self.scope_manager.get_scope_mut(self.current_scope_id)?;
                let Some(child_scope_id) = root_scope.pop_child_scope() else {
                    return internal_err!("No child scope found for subquery");
                };
                let transformed = self
                    .rule
                    .analyze_model(
                        Arc::unwrap_or_clone(Arc::clone(&subquery.subquery)),
                        self.scope_manager,
                        child_scope_id,
                        self.cycle_stack,
                    )?
                    .data;
                return Ok(Transformed::yes(LogicalPlan::Subquery(
                    subquery.with_plan(Arc::new(transformed)),
                )));
            }
            Ok(Transformed::no(plan))
        })
    }
}

impl Debug for ModelAnalyzeRule {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ModelAnalyzeRule").finish()
    }
}

impl AnalyzerRule for ModelAnalyzeRule {
    fn analyze(&self, plan: LogicalPlan, _: &ConfigOptions) -> Result<LogicalPlan> {
        // One stack per invocation — see [`ModelStack`] for why it must not
        // be shared across queries.
        let cycle_stack = ModelStack::default();

        let mut scope_manager = ScopeManager::new();
        let root_scope_id = scope_manager.create_root_scope();

        self.analyze_scope(plan, &mut scope_manager, root_scope_id)?
            .map_data(|plan| {
                self.analyze_model(plan, &mut scope_manager, root_scope_id, &cycle_stack)
                    .data()
            })?
            .map_data(|plan| {
                plan.transform_up_with_subqueries(&|plan| -> Result<
                    Transformed<LogicalPlan>,
                > {
                    self.remove_wren_catalog_schema_prefix_and_refresh_schema(plan)
                })
                .data()
            })?
            .map_data(|plan| plan.recompute_schema())
            .data()
    }

    fn name(&self) -> &str {
        "ModelAnalyzeRule"
    }
}

impl ModelAnalyzeRule {
    pub fn new(
        analyzed_wren_mdl: Arc<AnalyzedWrenMDL>,
        session_state: SessionStateRef,
        properties: SessionPropertiesRef,
    ) -> Self {
        Self {
            analyzed_wren_mdl,
            session_state,
            properties,
        }
    }

    fn session_state(&self) -> SessionStateRef {
        Arc::clone(&self.session_state)
    }

    /// The goal of this function is to analyze the scope of the logical plan and collect the required columns for models and visited tables.
    /// If the plan contains subquery, we should create a new child scope and analyze the subquery recursively.
    /// After leaving the subquery, we should push(push_back) the child scope to the scope_queue.
    fn analyze_scope(
        &self,
        plan: LogicalPlan,
        scope_manager: &mut ScopeManager,
        current_scope_id: ScopeId,
    ) -> Result<Transformed<LogicalPlan>> {
        plan.transform_up(&mut |plan| -> Result<Transformed<LogicalPlan>> {
            let plan = self
                .analyze_scope_internal(plan, scope_manager, current_scope_id)?
                .data;
            plan.map_subqueries(|plan| {
                if let LogicalPlan::Subquery(Subquery {
                    subquery,
                    outer_ref_columns,
                    ..
                }) = &plan
                {
                    outer_ref_columns.iter().try_for_each(|expr| {
                        self.collect_required_column(
                            expr.clone(),
                            scope_manager,
                            current_scope_id,
                        )
                    })?;
                    let child_scope =
                        scope_manager.create_child_scope(current_scope_id)?;
                    self.analyze_scope(
                        Arc::unwrap_or_clone(Arc::clone(subquery)),
                        scope_manager,
                        child_scope,
                    )?;
                }
                Ok(Transformed::no(plan))
            })
        })
    }

    /// Collect the visited dataset and required columns
    fn analyze_scope_internal(
        &self,
        plan: LogicalPlan,
        scope_manager: &mut ScopeManager,
        current_scope_id: ScopeId,
    ) -> Result<Transformed<LogicalPlan>> {
        let scope_mut = scope_manager.get_scope_mut(current_scope_id)?;
        match &plan {
            LogicalPlan::TableScan(table_scan) => {
                if belong_to_mdl(
                    &self.analyzed_wren_mdl.wren_mdl(),
                    table_scan.table_name.clone(),
                    Arc::clone(&self.session_state),
                ) {
                    if let Some(model) = self
                        .analyzed_wren_mdl
                        .wren_mdl
                        .get_model(table_scan.table_name.table())
                    {
                        scope_mut.add_visited_dataset(
                            table_scan.table_name.clone(),
                            Dataset::Model(model),
                        );
                    }
                    scope_mut.add_visited_table(table_scan.table_name.clone());
                    Ok(Transformed::no(plan))
                } else {
                    Ok(Transformed::no(plan))
                }
            }
            LogicalPlan::Join(Join { on, filter, .. }) => {
                let mut accum = HashSet::new();
                on.iter().try_for_each(|expr| {
                    expr_to_columns(&expr.0, &mut accum)?;
                    expr_to_columns(&expr.1, &mut accum)?;
                    Ok::<_, DataFusionError>(())
                })?;
                if let Some(filter_expr) = &filter {
                    expr_to_columns(filter_expr, &mut accum)?;
                }
                accum.iter().try_for_each(|expr| {
                    self.collect_required_column(
                        Expr::Column(expr.clone()),
                        scope_manager,
                        current_scope_id,
                    )
                })?;
                Ok(Transformed::no(plan))
            }
            LogicalPlan::Projection(projection) => {
                projection.expr.iter().try_for_each(|expr| {
                    let mut acuum = HashSet::new();
                    expr_to_columns(expr, &mut acuum)?;
                    acuum.into_iter().try_for_each(|expr| {
                        self.collect_required_column(
                            Expr::Column(expr),
                            scope_manager,
                            current_scope_id,
                        )
                    })
                })?;
                Ok(Transformed::no(plan))
            }
            LogicalPlan::Filter(filter) => {
                let mut acuum = HashSet::new();
                expr_to_columns(&filter.predicate, &mut acuum)?;
                acuum.into_iter().try_for_each(|expr| {
                    self.collect_required_column(
                        Expr::Column(expr),
                        scope_manager,
                        current_scope_id,
                    )
                })?;
                Ok(Transformed::no(plan))
            }
            LogicalPlan::Aggregate(aggregate) => {
                let mut accum = HashSet::new();
                aggregate.aggr_expr.iter().for_each(|expr| {
                    Expr::add_column_refs(expr, &mut accum);
                });
                aggregate.group_expr.iter().for_each(|expr| {
                    Expr::add_column_refs(expr, &mut accum);
                });
                accum.iter().try_for_each(|expr| {
                    self.collect_required_column(
                        Expr::Column(expr.to_owned().clone()),
                        scope_manager,
                        current_scope_id,
                    )
                })?;
                Ok(Transformed::no(plan))
            }
            LogicalPlan::SubqueryAlias(subquery_alias) => {
                if let LogicalPlan::TableScan(table_scan) =
                    Arc::unwrap_or_clone(Arc::clone(&subquery_alias.input))
                {
                    if belong_to_mdl(
                        &self.analyzed_wren_mdl.wren_mdl(),
                        table_scan.table_name.clone(),
                        Arc::clone(&self.session_state),
                    ) {
                        if let Some(model) = self
                            .analyzed_wren_mdl
                            .wren_mdl
                            .get_model(table_scan.table_name.table())
                        {
                            scope_mut.add_visited_dataset(
                                subquery_alias.alias.clone(),
                                Dataset::Model(model),
                            );
                        }
                    }
                }
                scope_mut.add_visited_table(subquery_alias.alias.clone());
                Ok(Transformed::no(plan))
            }
            LogicalPlan::Window(window) => {
                window
                    .window_expr
                    .iter()
                    .fold(HashSet::new(), |mut set, expr| {
                        Expr::add_column_refs(expr, &mut set);
                        set
                    })
                    .into_iter()
                    .try_for_each(|col| {
                        self.collect_required_column(
                            Expr::Column(col.to_owned()),
                            scope_manager,
                            current_scope_id,
                        )
                    })?;
                Ok(Transformed::no(plan))
            }
            _ => Ok(Transformed::no(plan)),
        }
    }

    /// This function only collects the model required columns
    fn collect_required_column(
        &self,
        expr: Expr,
        scope_manager: &mut ScopeManager,
        current_scope_id: ScopeId,
    ) -> Result<()> {
        match expr {
            Expr::Column(Column {
                relation: Some(relation),
                name,
                ..
            }) => {
                // only collect the required column if the relation belongs to the mdl
                if belong_to_mdl(
                    &self.analyzed_wren_mdl.wren_mdl(),
                    relation.clone(),
                    Arc::clone(&self.session_state),
                ) && self
                    .analyzed_wren_mdl
                    .wren_mdl()
                    .get_view(relation.table())
                    .is_none()
                {
                    scope_manager.add_required_column(
                        current_scope_id,
                        relation.clone(),
                        Expr::Column(Column::new(Some(relation.clone()), name)),
                    )?;
                }
            }
            // It is possible that the column is a rebase column from the aggregation or join
            // e.g. Column {
            //         relation: None,
            //         name: "min(wrenai.public.order_items_model.price)",
            //     },
            Expr::Column(Column { relation: None, .. }) => {
                // do nothing
            }
            Expr::OuterReferenceColumn(_, column) => {
                self.collect_required_column(
                    Expr::Column(column),
                    scope_manager,
                    current_scope_id,
                )?;
            }
            _ => return plan_err!("Invalid column expression: {}", expr),
        }
        Ok(())
    }

    /// Analyze the table scan and rewrite the table scan to the ModelPlanNode according to the scope analysis.
    /// If the plan contains subquery, we should analyze the subquery recursively.
    /// Before enter the subquery, the corresponding child scope should be popped (pop_front) from the scope_queue.
    fn analyze_model(
        &self,
        plan: LogicalPlan,
        scope_manager: &mut ScopeManager,
        current_scope_id: ScopeId,
        cycle_stack: &ModelStack,
    ) -> Result<Transformed<LogicalPlan>> {
        let mut rewriter = ModelRewriter {
            rule: self,
            scope_manager,
            current_scope_id,
            cycle_stack,
        };
        plan.rewrite(&mut rewriter)
    }

    /// Analyze the model and generate the ModelPlanNode
    fn analyze_model_internal(
        &self,
        plan: LogicalPlan,
        scope_manager: &mut ScopeManager,
        current_scope_id: ScopeId,
        cycle_stack: &ModelStack,
    ) -> Result<Transformed<LogicalPlan>> {
        match plan {
            LogicalPlan::SubqueryAlias(SubqueryAlias { input, alias, .. }) => {
                // `shortcut_aliased_table_scan` consumes `SubqueryAlias -> TableScan`
                // over a model in `f_down`, so no model scan reaches the arms below.
                // The `SubqueryAlias` arm rejects any `Extension` input and flattens
                // everything else onto the outer alias; the `TableScan` arm sees only
                // the scans the shortcut declined — tables outside the MDL, or inside
                // it but not a model.
                match Arc::unwrap_or_clone(Arc::clone(&input)) {
                    LogicalPlan::SubqueryAlias(subquery_alias) => {
                        self.analyze_subquery_alias_model(subquery_alias, alias)
                    }
                    LogicalPlan::TableScan(table_scan) => {
                        let model_plan = self
                            .analyze_table_scan(
                                table_scan,
                                Some(alias.clone()),
                                scope_manager,
                                current_scope_id,
                                cycle_stack,
                            )?
                            .data;
                        let subquery =
                            LogicalPlanBuilder::from(model_plan).alias(alias)?.build()?;
                        Ok(Transformed::yes(subquery))
                    }
                    _ => Ok(Transformed::no(LogicalPlan::SubqueryAlias(
                        SubqueryAlias::try_new(input, alias)?,
                    ))),
                }
            }
            LogicalPlan::TableScan(table_scan) => self.analyze_table_scan(
                table_scan,
                None,
                scope_manager,
                current_scope_id,
                cycle_stack,
            ),
            LogicalPlan::Join(join) => {
                let left = match Arc::unwrap_or_clone(join.left) {
                    LogicalPlan::TableScan(table_scan) => {
                        self.analyze_table_scan(
                            table_scan,
                            None,
                            scope_manager,
                            current_scope_id,
                            cycle_stack,
                        )?
                        .data
                    }
                    ignore => ignore,
                };

                let right = match Arc::unwrap_or_clone(join.right) {
                    LogicalPlan::TableScan(table_scan) => {
                        self.analyze_table_scan(
                            table_scan,
                            None,
                            scope_manager,
                            current_scope_id,
                            cycle_stack,
                        )?
                        .data
                    }
                    ignore => ignore,
                };
                Ok(Transformed::yes(LogicalPlan::Join(Join {
                    left: Arc::new(left),
                    right: Arc::new(right),
                    on: join.on,
                    join_type: join.join_type,
                    schema: join.schema,
                    filter: join.filter,
                    join_constraint: join.join_constraint,
                    null_equality: join.null_equality,
                    null_aware: join.null_aware,
                })))
            }
            _ => Ok(Transformed::no(plan)),
        }
    }

    /// Construct a [`ModelPlanNode`] with cycle-aware RLAC handling.
    ///
    /// Steps:
    /// 1. Push the model's name onto the invocation's cycle-detection stack; error out
    ///    if it is already present (which means an RLAC condition transitively
    ///    re-entered this model). An RAII guard removes the name when this function
    ///    exits.
    /// 2. Build the [`ModelPlanNode`] (the builder parses each matching RLAC condition
    ///    via [`crate::logical_plan::analyze::access_control::RlacContextProvider`], so
    ///    table references inside subqueries are resolved against MDL models).
    /// 3. If the resulting `rlac_filter` contains subqueries, recursively run the same
    ///    analyzer pipeline on each subquery's inner plan with a fresh scope manager —
    ///    that rewrites their `TableScan`s into `ModelPlanNode`s so the referenced
    ///    models' own RLAC/CLAC and relationship handling apply transitively.
    fn build_model_plan_node(
        &self,
        model: Arc<wren_core_base::mdl::Model>,
        required_fields: Vec<Expr>,
        original_table_scan: Option<LogicalPlan>,
        cycle_stack: &ModelStack,
    ) -> Result<ModelPlanNode> {
        #[cfg(test)]
        BUILD_MODEL_PLAN_NODE_CALLS.with(|c| c.set(c.get() + 1));
        let model_name = model.name().to_string();
        // Keep the mutation in its own scope: recursive analysis and
        // `ModelStackGuard::drop` both borrow the `RefCell` again, so extending
        // the `RefMut` lifetime would cause a re-entrant-borrow panic.
        {
            let mut stack = cycle_stack.borrow_mut();
            if stack.contains(&model_name) {
                return plan_err!(
                    "Detected a cycle in row level access control conditions for model `{}`",
                    model_name
                );
            }
            stack.insert(model_name.clone());
        }
        let _guard = ModelStackGuard {
            stack: cycle_stack,
            name: model_name,
        };

        let mut plan_node = ModelPlanNode::new(
            model,
            required_fields,
            original_table_scan,
            Arc::clone(&self.analyzed_wren_mdl),
            Arc::clone(&self.session_state),
            Arc::clone(&self.properties),
        )?;

        if let Some(filter) = plan_node.rlac_filter.take() {
            plan_node.rlac_filter =
                Some(self.analyze_rlac_subqueries(filter, cycle_stack)?);
        }
        Ok(plan_node)
    }

    /// Walk `expr` and analyze the inner plan of every embedded subquery
    /// (`ScalarSubquery`, `InSubquery`, `Exists`). Each inner plan is processed with a
    /// fresh `ScopeManager`/scope id — RLAC subqueries are introduced after the outer
    /// scope analysis runs, so they don't have entries in the outer `scope_manager`.
    fn analyze_rlac_subqueries(
        &self,
        expr: Expr,
        cycle_stack: &ModelStack,
    ) -> Result<Expr> {
        expr.transform_down(|expr| -> Result<Transformed<Expr>> {
            match expr {
                Expr::ScalarSubquery(sq) => {
                    let plan = self.analyze_subquery_plan(
                        Arc::unwrap_or_clone(sq.subquery),
                        cycle_stack,
                    )?;
                    Ok(Transformed::yes(Expr::ScalarSubquery(Subquery {
                        subquery: Arc::new(plan),
                        outer_ref_columns: sq.outer_ref_columns,
                        spans: sq.spans,
                    })))
                }
                Expr::InSubquery(InSubquery {
                    expr,
                    subquery,
                    negated,
                }) => {
                    let plan = self.analyze_subquery_plan(
                        Arc::unwrap_or_clone(subquery.subquery),
                        cycle_stack,
                    )?;
                    Ok(Transformed::yes(Expr::InSubquery(InSubquery {
                        expr,
                        subquery: Subquery {
                            subquery: Arc::new(plan),
                            outer_ref_columns: subquery.outer_ref_columns,
                            spans: subquery.spans,
                        },
                        negated,
                    })))
                }
                Expr::Exists(Exists { subquery, negated }) => {
                    let plan = self.analyze_subquery_plan(
                        Arc::unwrap_or_clone(subquery.subquery),
                        cycle_stack,
                    )?;
                    Ok(Transformed::yes(Expr::Exists(Exists {
                        subquery: Subquery {
                            subquery: Arc::new(plan),
                            outer_ref_columns: subquery.outer_ref_columns,
                            spans: subquery.spans,
                        },
                        negated,
                    })))
                }
                other => Ok(Transformed::no(other)),
            }
        })
        .data()
    }

    /// Re-run the analyzer pipeline (scope analysis → model rewriting → schema cleanup)
    /// on an inner subquery plan with a fresh `ScopeManager`. Used to make `TableScan`s
    /// introduced by RLAC condition parsing go through the same transformation as
    /// regular query plans.
    fn analyze_subquery_plan(
        &self,
        plan: LogicalPlan,
        cycle_stack: &ModelStack,
    ) -> Result<LogicalPlan> {
        let mut scope_manager = ScopeManager::new();
        let root_scope_id = scope_manager.create_root_scope();
        self.analyze_scope(plan, &mut scope_manager, root_scope_id)?
            .map_data(|p| {
                self.analyze_model(p, &mut scope_manager, root_scope_id, cycle_stack)
                    .data()
            })?
            .map_data(|p| {
                p.transform_up_with_subqueries(&|p| -> Result<Transformed<LogicalPlan>> {
                    self.remove_wren_catalog_schema_prefix_and_refresh_schema(p)
                })
                .data()
            })?
            .map_data(|p| p.recompute_schema())
            .data()
    }

    /// Resolve the required fields for `table_ref` in `current_scope_id`: the
    /// recorded required columns if any, `vec![]` if the table was only visited
    /// (e.g. `count(*)`), or an error if neither is present.
    fn resolve_required_fields(
        &self,
        scope_manager: &ScopeManager,
        current_scope_id: ScopeId,
        table_ref: &TableReference,
    ) -> Result<Vec<Expr>> {
        if let Some(used_columns) =
            scope_manager.try_get_required_columns(current_scope_id, table_ref)
        {
            Ok(used_columns.iter().cloned().collect())
        } else if scope_manager
            .try_get_visited_dataset(current_scope_id, table_ref)
            .is_some()
        {
            Ok(vec![])
        } else {
            internal_err!(
                "Table {} not found in the visited dataset and required columns map",
                table_ref
            )
        }
    }

    /// Pre-order shortcut for `SubqueryAlias -> TableScan` (e.g. `FROM a_model AS alias`).
    /// Builds the `ModelPlanNode` directly with the alias's own required columns,
    /// replacing the bottom-up path for this shape entirely (see [`Self::analyze_subquery_alias_model`]).
    fn shortcut_aliased_table_scan(
        &self,
        plan: LogicalPlan,
        scope_manager: &mut ScopeManager,
        current_scope_id: ScopeId,
        cycle_stack: &ModelStack,
    ) -> Result<Transformed<LogicalPlan>> {
        let LogicalPlan::SubqueryAlias(SubqueryAlias { input, alias, .. }) = &plan else {
            return Ok(Transformed::no(plan));
        };
        let LogicalPlan::TableScan(scan) = input.as_ref() else {
            return Ok(Transformed::no(plan));
        };
        if !belong_to_mdl(
            &self.analyzed_wren_mdl.wren_mdl(),
            scan.table_name.clone(),
            Arc::clone(&self.session_state),
        ) {
            return Ok(Transformed::no(plan));
        }
        let Some(model) = self
            .analyzed_wren_mdl
            .wren_mdl
            .get_model(scan.table_name.table())
        else {
            return Ok(Transformed::no(plan));
        };
        // original_table_scan is None below, so `input` is never consumed: clone just
        // the alias instead of re-matching `plan` to take ownership of it.
        let alias = alias.clone();

        let field =
            self.resolve_required_fields(scope_manager, current_scope_id, &alias)?;
        let model_plan_node =
            self.build_model_plan_node(model, field, None, cycle_stack)?;
        let model_plan = LogicalPlan::Extension(Extension {
            node: Arc::new(model_plan_node),
        });
        let subquery = LogicalPlanBuilder::from(model_plan).alias(alias)?.build()?;
        Ok(Transformed::new(subquery, true, TreeNodeRecursion::Jump))
    }

    fn analyze_table_scan(
        &self,
        table_scan: TableScan,
        alias: Option<TableReference>,
        scope_manager: &mut ScopeManager,
        current_scope_id: ScopeId,
        cycle_stack: &ModelStack,
    ) -> Result<Transformed<LogicalPlan>> {
        if belong_to_mdl(
            &self.analyzed_wren_mdl.wren_mdl(),
            table_scan.table_name.clone(),
            self.session_state(),
        ) {
            let table_name = table_scan.table_name.table();
            if let Some(model) = self.analyzed_wren_mdl.wren_mdl.get_model(table_name) {
                let table_ref = alias.unwrap_or(table_scan.table_name.clone());
                let field = self.resolve_required_fields(
                    scope_manager,
                    current_scope_id,
                    &table_ref,
                )?;
                let model_plan_node = self.build_model_plan_node(
                    Arc::clone(&model),
                    field,
                    Some(LogicalPlan::TableScan(table_scan.clone())),
                    cycle_stack,
                )?;
                let model_plan = LogicalPlan::Extension(Extension {
                    node: Arc::new(model_plan_node),
                });
                let subquery = LogicalPlanBuilder::from(model_plan)
                    .alias(quoted(model.name()))?
                    .build()?;
                Ok(Transformed::yes(subquery))
            } else {
                Ok(Transformed::no(LogicalPlan::TableScan(table_scan)))
            }
        } else {
            Ok(Transformed::no(LogicalPlan::TableScan(table_scan)))
        }
    }

    /// Handles the input of a `SubqueryAlias -> SubqueryAlias -> ...` shape. An
    /// `Extension` input is rejected; any other input is flattened onto the outer
    /// `alias`, dropping the inner one.
    fn analyze_subquery_alias_model(
        &self,
        subquery_alias: SubqueryAlias,
        alias: TableReference,
    ) -> Result<Transformed<LogicalPlan>> {
        let SubqueryAlias { input, .. } = subquery_alias;
        if let LogicalPlan::Extension(Extension { node }) =
            Arc::unwrap_or_clone(Arc::clone(&input))
        {
            if let Some(model_node) = node.as_any().downcast_ref::<ModelPlanNode>() {
                // Unreachable: `shortcut_aliased_table_scan` consumes every
                // `SubqueryAlias -> TableScan` over a model in `f_down`, and the only
                // producer of a directly-nested `SubqueryAlias` is `ExpandWrenViewRule`,
                // which plans view bodies with `SessionState::create_logical_plan`
                // (unoptimized). A view body therefore always has a `Projection` root,
                // so the inner node is never a bare `TableScan` and this shape never
                // forms. Revisit if view planning starts handing back optimized plans.
                internal_err!(
                    "SubqueryAlias wrapping an already-analyzed ModelPlanNode ({}) \
                     reached the bottom-up rebuild path; shortcut_aliased_table_scan \
                     should have handled this shape in f_down",
                    model_node.plan_name()
                )
            } else {
                internal_err!("ModelPlanNode not found in the Extension node")
            }
        } else {
            Ok(Transformed::no(LogicalPlan::SubqueryAlias(
                SubqueryAlias::try_new(input, alias)?,
            )))
        }
    }

    /// Remove the catalog and schema prefix of Wren for the column and refresh the schema.
    /// The plan created by DataFusion is always with the Wren prefix for the column name.
    /// Something like "wrenai.public.order_items_model.price". However, the model plan will be rewritten to a subquery alias
    /// The catalog and schema are invalid for the subquery alias. We should remove the prefix and refresh the schema.
    fn remove_wren_catalog_schema_prefix_and_refresh_schema(
        &self,
        plan: LogicalPlan,
    ) -> Result<Transformed<LogicalPlan>> {
        match plan {
            LogicalPlan::SubqueryAlias(SubqueryAlias { input, alias, .. }) => {
                let subquery = self
                    .remove_wren_catalog_schema_prefix_and_refresh_schema(
                        Arc::unwrap_or_clone(input),
                    )?
                    .data;
                Ok(Transformed::yes(LogicalPlan::SubqueryAlias(
                    SubqueryAlias::try_new(Arc::new(subquery), alias)?,
                )))
            }
            LogicalPlan::Subquery(Subquery {
                subquery,
                outer_ref_columns,
                spans,
            }) => {
                let subquery = self
                    .remove_wren_catalog_schema_prefix_and_refresh_schema(
                        Arc::unwrap_or_clone(subquery),
                    )?
                    .data;
                Ok(Transformed::yes(LogicalPlan::Subquery(Subquery {
                    subquery: Arc::new(subquery),
                    outer_ref_columns,
                    spans,
                })))
            }
            LogicalPlan::Distinct(Distinct::On(DistinctOn {
                on_expr,
                select_expr,
                sort_expr,
                input,
                ..
            })) => Ok(Transformed::yes(LogicalPlan::Distinct(Distinct::On(
                DistinctOn::try_new(on_expr, select_expr, sort_expr, input)?,
            )))),
            LogicalPlan::Window(Window {
                input, window_expr, ..
            }) => Ok(Transformed::yes(LogicalPlan::Window(Window::try_new(
                window_expr,
                input,
            )?))),
            LogicalPlan::Projection(Projection { expr, input, .. }) => {
                let Some(alias_model) = Self::find_alias_model(Arc::clone(&input)) else {
                    return Ok(Transformed::no(LogicalPlan::Projection(
                        Projection::try_new(expr, input)?,
                    )));
                };
                let expr = expr
                    .into_iter()
                    .map(|e| {
                        self.map_column_and_rewrite_qualifier(
                            e,
                            &alias_model,
                            input.schema().clone(),
                        )
                        .data()
                    })
                    .collect::<Result<Vec<_>>>()?;
                Ok(Transformed::yes(LogicalPlan::Projection(
                    Projection::try_new(expr, input)?,
                )))
            }
            LogicalPlan::Filter(Filter {
                input, predicate, ..
            }) => {
                let Some(alias_model) = Self::find_alias_model(Arc::clone(&input)) else {
                    return Ok(Transformed::no(LogicalPlan::Filter(Filter::try_new(
                        predicate, input,
                    )?)));
                };
                let expr = self
                    .map_column_and_rewrite_qualifier(
                        predicate,
                        &alias_model,
                        input.schema().clone(),
                    )?
                    .data;
                Ok(Transformed::yes(LogicalPlan::Filter(Filter::try_new(
                    expr, input,
                )?)))
            }
            LogicalPlan::Aggregate(Aggregate {
                input,
                aggr_expr,
                group_expr,
                ..
            }) => {
                let Some(alias_model) = Self::find_alias_model(Arc::clone(&input)) else {
                    return Ok(Transformed::no(LogicalPlan::Aggregate(
                        Aggregate::try_new(input, group_expr, aggr_expr)?,
                    )));
                };
                let aggr_expr = aggr_expr
                    .into_iter()
                    .map(|e| {
                        self.map_column_and_rewrite_qualifier(
                            e,
                            &alias_model,
                            input.schema().clone(),
                        )
                        .data()
                    })
                    .collect::<Result<Vec<_>>>()?;
                let group_expr = group_expr
                    .into_iter()
                    .map(|e| {
                        self.map_column_and_rewrite_qualifier(
                            e,
                            &alias_model,
                            input.schema().clone(),
                        )
                        .data()
                    })
                    .collect::<Result<Vec<_>>>()?;
                Ok(Transformed::yes(LogicalPlan::Aggregate(
                    Aggregate::try_new(input, group_expr, aggr_expr)?,
                )))
            }
            _ => Ok(Transformed::no(plan)),
        }
    }

    fn map_column_and_rewrite_qualifier(
        &self,
        expr: Expr,
        alias_model: &str,
        schema: DFSchemaRef,
    ) -> Result<Transformed<Expr>> {
        match expr {
            Expr::Column(Column { relation, name, .. }) => {
                if let Some(relation) = relation {
                    Ok(self.rewrite_column_qualifier(relation, name, alias_model))
                } else {
                    let name = name.replace(
                        self.analyzed_wren_mdl.wren_mdl().catalog_schema_prefix(),
                        "",
                    );
                    let ident = ident(&name);
                    Ok(Transformed::yes(ident))
                }
            }
            Expr::Alias(Alias {
                expr,
                relation,
                name,
                metadata,
            }) => {
                let expr =
                    self.map_column_and_rewrite_qualifier(*expr, alias_model, schema)?;
                Ok(Transformed::yes(Expr::Alias(Alias {
                    expr: Box::new(expr.data),
                    relation,
                    name,
                    metadata,
                })))
            }
            _ => expr.map_children(|e| {
                self.map_column_and_rewrite_qualifier(e, alias_model, schema.clone())
            }),
        }
    }

    fn rewrite_column_qualifier(
        &self,
        relation: TableReference,
        name: String,
        alias_model: &str,
    ) -> Transformed<Expr> {
        if belong_to_mdl(
            &self.analyzed_wren_mdl.wren_mdl(),
            relation.clone(),
            self.session_state(),
        ) {
            if self
                .analyzed_wren_mdl
                .wren_mdl()
                .get_model(relation.table())
                .is_some()
            {
                Transformed::yes(col(format!("{}.{}", alias_model, quoted(&name))))
            } else {
                // handle Wren View
                let name = name.replace(
                    self.analyzed_wren_mdl.wren_mdl().catalog_schema_prefix(),
                    "",
                );
                Transformed::yes(Expr::Column(Column::new(
                    Some(TableReference::bare(relation.table())),
                    &name,
                )))
            }
        } else {
            Transformed::no(Expr::Column(Column {
                relation: Some(relation),
                name,
                spans: Spans::new(),
            }))
        }
    }

    /// Find Plan pattern like
    /// SubqueryAlias
    ///     Extension
    ///         ModelPlanNode
    /// and return the model name
    fn find_alias_model(plan: Arc<LogicalPlan>) -> Option<String> {
        let plan = Arc::unwrap_or_clone(plan);
        match plan {
            LogicalPlan::SubqueryAlias(SubqueryAlias { input, alias, .. }) => {
                if let LogicalPlan::Extension(Extension { node }) =
                    Arc::unwrap_or_clone(Arc::clone(&input))
                {
                    if node.as_any().downcast_ref::<ModelPlanNode>().is_some() {
                        Some(alias.to_quoted_string())
                    } else {
                        None
                    }
                } else {
                    Self::find_alias_model(input)
                }
            }
            LogicalPlan::Filter(Filter { input, .. }) => Self::find_alias_model(input),
            LogicalPlan::Aggregate(Aggregate { input, .. }) => {
                Self::find_alias_model(input)
            }
            LogicalPlan::Projection(Projection { input, .. }) => {
                Self::find_alias_model(input)
            }
            _ => None,
        }
    }
}
