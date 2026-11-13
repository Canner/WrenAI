use crate::logical_plan::analyze::model_generation::ModelGenerationRule;
use crate::logical_plan::analyze::plan::{
    CalculationPlanNode, ModelPlanNode, ModelSourceNode, OrdExpr, PartialModelPlanNode,
};
use crate::logical_plan::analyze::relation_chain::RelationChain::Start;
use crate::logical_plan::utils::create_schema;
use crate::mdl::context::SessionPropertiesRef;
use crate::mdl::lineage::DatasetLink;
use crate::mdl::manifest::JoinType;
use crate::mdl::utils::{collect_join_keys, qualify_name_from_column_name, quoted};
use crate::mdl::Dataset;
use crate::mdl::{AnalyzedWrenMDL, SessionStateRef};
use crate::DataFusionError;
use crate::{AccessControlProvider, AccessScope, WrenAccessControlProvider};
use datafusion::common::alias::AliasGenerator;
use datafusion::common::tree_node::{Transformed, TransformedResult, TreeNode};
use datafusion::common::{internal_err, plan_err, DFSchema, DFSchemaRef, Result};
use datafusion::common::{plan_datafusion_err, TableReference};
use datafusion::logical_expr::{
    col, Expr, Extension, LogicalPlan, LogicalPlanBuilder, SubqueryAlias,
    UserDefinedLogicalNodeCore,
};
use petgraph::graph::NodeIndex;
use petgraph::Graph;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::Arc;

const ALIAS: &str = "__relation_";

/// Original (model, column) identity -> field exposed by a relation subquery.
/// A SubqueryAlias replaces qualifiers, so collisions must be carried explicitly.
pub(crate) type ColumnAliases = BTreeMap<(String, String), String>;

fn column_key(column: &datafusion::common::Column) -> (String, String) {
    (
        column
            .relation
            .as_ref()
            .map(|r| r.table())
            .unwrap_or("")
            .to_owned(),
        column.name.clone(),
    )
}

pub(crate) fn rebase_relation_column(
    expr: &Expr,
    alias: &str,
    columns: &ColumnAliases,
) -> Result<Expr> {
    expr.clone()
        .transform_down(|expr| {
            if let Expr::Column(column) = expr {
                let name = columns.get(&column_key(&column)).ok_or_else(|| {
                    plan_datafusion_err!(
                        "Relation projection has no original column {}",
                        column
                    )
                })?;
                Ok(Transformed::yes(Expr::Column(
                    datafusion::common::Column::new(Some(alias), name.clone()),
                )))
            } else {
                Ok(Transformed::no(expr))
            }
        })
        .data()
}

/// RelationChain is a chain of models that are connected by the relationship.
/// The chain is used to generate the join plan for the model.
/// The physical layout will be looked like:
/// (((Model3, Model2), Model1), Nil)
#[derive(Eq, PartialEq, Debug, Hash, Clone)]
pub enum RelationChain {
    Chain(LogicalPlan, JoinType, String, Box<RelationChain>),
    Start(LogicalPlan),
}

impl RelationChain {
    pub(crate) fn source(
        dataset: &Dataset,
        required_fields: Vec<Expr>,
        analyzed_wren_mdl: Arc<AnalyzedWrenMDL>,
        session_state_ref: SessionStateRef,
        session_properties: SessionPropertiesRef,
        access_control: Arc<dyn AccessControlProvider>,
    ) -> Result<Self> {
        let Dataset::Model(source_model) = dataset;
        Ok(Start(LogicalPlan::Extension(Extension {
            node: Arc::new(ModelSourceNode::new(
                Arc::clone(source_model),
                required_fields,
                analyzed_wren_mdl,
                session_state_ref,
                session_properties,
                None,
                access_control,
            )?),
        })))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn with_chain(
        source: Self,
        start: NodeIndex,
        iter: impl Iterator<Item = NodeIndex>,
        directed_graph: Graph<Dataset, DatasetLink>,
        model_required_fields: &HashMap<TableReference, BTreeSet<OrdExpr>>,
        analyzed_wren_mdl: Arc<AnalyzedWrenMDL>,
        session_state_ref: SessionStateRef,
        properties: SessionPropertiesRef,
    ) -> Result<Self> {
        Self::with_chain_with_access_control(
            source,
            start,
            iter,
            directed_graph,
            model_required_fields,
            analyzed_wren_mdl,
            session_state_ref,
            properties,
            Arc::new(WrenAccessControlProvider),
            AccessScope::DirectQuery,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn with_chain_with_access_control(
        source: Self,
        start: NodeIndex,
        iter: impl Iterator<Item = NodeIndex>,
        directed_graph: Graph<Dataset, DatasetLink>,
        model_required_fields: &HashMap<TableReference, BTreeSet<OrdExpr>>,
        analyzed_wren_mdl: Arc<AnalyzedWrenMDL>,
        session_state_ref: SessionStateRef,
        properties: SessionPropertiesRef,
        access_control: Arc<dyn AccessControlProvider>,
        access_scope: AccessScope,
    ) -> Result<Self> {
        let mut relation_chain = source;
        // Track the most recently visited node so that we can walk both linear
        // chains (A -> B -> C, where each link starts from the previously
        // visited node) and star fan-outs (A -> B and A -> C, both starting
        // from the base model). At each step we prefer an edge from the
        // previous node; if none exists we fall back to an edge from the
        // original starting node. This lets a single model project calculated
        // columns that span multiple distinct relationships without truncating
        // the join chain.
        let mut prev = start;

        for next in iter {
            let target = directed_graph.node_weight(next).unwrap();
            let link_index = directed_graph
                .find_edge(prev, next)
                .or_else(|| directed_graph.find_edge(start, next));
            let Some(link_index) = link_index else {
                break;
            };
            let link = directed_graph.edge_weight(link_index).unwrap();
            let target_ref = TableReference::full(
                analyzed_wren_mdl.wren_mdl().catalog(),
                analyzed_wren_mdl.wren_mdl().schema(),
                target.name(),
            );
            let Some(fields) = model_required_fields.get(&target_ref) else {
                return plan_err!("Required fields not found for {}", target_ref);
            };
            let Dataset::Model(target_model) = target;
            let schema = create_schema(
                fields
                    .iter()
                    .map(|e| {
                        e.column.clone().ok_or_else(|| {
                            plan_datafusion_err!(
                                "Required field {:?} has no physical column",
                                e.expr
                            )
                        })
                    })
                    .collect::<Result<_>>()?,
            )?;
            let exprs = fields.iter().cloned().map(|c| c.expr).collect();
            let plan = ModelPlanNode::new(
                Arc::clone(target_model),
                exprs,
                None,
                Arc::clone(&analyzed_wren_mdl),
                Arc::clone(&session_state_ref),
                Arc::clone(&properties),
                Arc::clone(&access_control),
                access_scope,
            )?;

            let df_schema = DFSchemaRef::from(DFSchema::try_from(schema)?);
            let node = LogicalPlan::Extension(Extension {
                node: Arc::new(PartialModelPlanNode::new(plan, df_schema)),
            });
            relation_chain = RelationChain::Chain(
                node,
                link.join_type,
                link.condition.clone(),
                Box::new(relation_chain),
            );
            prev = next;
        }
        Ok(relation_chain)
    }

    pub(crate) fn plan(
        &mut self,
        rule: ModelGenerationRule,
        alias_generator: &AliasGenerator,
    ) -> Result<(Option<LogicalPlan>, Option<String>, ColumnAliases)> {
        match self {
            RelationChain::Chain(plan, _, condition, ref mut next) => {
                let left = rule.generate_model_internal(plan.clone())?.data;
                let left_alias = if let LogicalPlan::SubqueryAlias(SubqueryAlias {
                    alias,
                    ..
                }) = &left
                {
                    alias.table()
                } else {
                    return internal_err!(
                        "model plan should be wrapped in a subquery alias"
                    );
                };

                let (Some(right), right_alias, right_columns) =
                    next.plan(rule, alias_generator)?
                else {
                    return plan_err!("Nil relation chain");
                };

                // Parse the relationship condition as a conjunction of column equalities.
                // Composite keys (e.g. `a.x = b.x AND a.y = b.y`) produce one pair per
                // equality; we rebase each column to the right alias when needed and AND
                // the equalities back together to form the final join predicate.
                let key_pairs = collect_join_keys(condition)?;
                let right_alias_ref = right_alias.as_deref();
                let rebase_key = |column: &datafusion::common::Column| -> Result<Expr> {
                    let expr = col(qualify_name_from_column_name(column));
                    if let Expr::Column(c) = &expr {
                        let needs_rebase = c
                            .relation
                            .as_ref()
                            .map(|r| r.table() != left_alias)
                            .unwrap_or(false);
                        if needs_rebase {
                            if let Some(right_alias) = right_alias_ref {
                                return rebase_relation_column(
                                    &expr,
                                    right_alias,
                                    &right_columns,
                                );
                            }
                        }
                    }
                    Ok::<_, DataFusionError>(expr)
                };
                let join_condition = key_pairs
                    .iter()
                    .map(|(l, r)| Ok(rebase_key(l)?.eq(rebase_key(r)?)))
                    .collect::<Result<Vec<_>>>()?
                    .into_iter()
                    .reduce(|acc, eq| acc.and(eq))
                    .ok_or_else(|| {
                        plan_datafusion_err!(
                            "Join condition `{condition}` produced no equality predicates"
                        )
                    })?;
                let mut required_exprs = BTreeSet::new();
                // collect the output calculated fields
                match plan {
                    LogicalPlan::Extension(plan) => {
                        if let Some(model_plan) =
                            plan.node.as_any().downcast_ref::<ModelPlanNode>()
                        {
                            UserDefinedLogicalNodeCore::schema(model_plan)
                                .fields()
                                .iter()
                                .map(|field| {
                                    col(format!(
                                        "{}.{}",
                                        quoted(model_plan.plan_name()),
                                        quoted(field.name()),
                                    ))
                                })
                                .for_each(|c| {
                                    required_exprs.insert(OrdExpr::new(c));
                                });
                        } else if let Some(model_source_plan) =
                            plan.node.as_any().downcast_ref::<ModelSourceNode>()
                        {
                            UserDefinedLogicalNodeCore::schema(model_source_plan)
                                .fields()
                                .iter()
                                .map(|field| {
                                    col(format!(
                                        "{}.{}",
                                        quoted(&model_source_plan.model_name),
                                        quoted(field.name()),
                                    ))
                                })
                                .for_each(|c| {
                                    required_exprs.insert(OrdExpr::new(c));
                                });
                        } else if let Some(calculation_plan) =
                            plan.node.as_any().downcast_ref::<CalculationPlanNode>()
                        {
                            UserDefinedLogicalNodeCore::schema(calculation_plan)
                                .fields()
                                .iter()
                                .map(|field| {
                                    col(format!(
                                        "{}.{}",
                                        quoted(
                                            calculation_plan.calculation.column.name()
                                        ),
                                        quoted(field.name()),
                                    ))
                                })
                                .for_each(|c| {
                                    required_exprs.insert(OrdExpr::new(c));
                                });
                        } else if let Some(partial_model_plan) =
                            plan.node.as_any().downcast_ref::<PartialModelPlanNode>()
                        {
                            UserDefinedLogicalNodeCore::schema(partial_model_plan)
                                .fields()
                                .iter()
                                .map(|field| {
                                    col(format!(
                                        "{}.{}",
                                        quoted(partial_model_plan.model_node.plan_name()),
                                        quoted(field.name()),
                                    ))
                                })
                                .for_each(|c| {
                                    required_exprs.insert(OrdExpr::new(c));
                                });
                        } else {
                            return plan_err!("Invalid extension plan node");
                        }
                    }
                    _ => return internal_err!("Invalid plan node"),
                };
                // collect the column of the left table
                for index in 0..left.schema().fields().len() {
                    let (Some(table_rf), f) = left.schema().qualified_field(index) else {
                        return plan_err!("Field not found");
                    };
                    let qualified_name =
                        format!("{}.{}", table_rf.to_quoted_string(), quoted(f.name()));
                    required_exprs.insert(OrdExpr::new(col(qualified_name)));
                }

                // collect the column of the right table
                for index in 0..right.schema().fields().len() {
                    let (Some(table_rf), f) = right.schema().qualified_field(index)
                    else {
                        return plan_err!("Field not found");
                    };
                    let qualified_name =
                        format!("{}.{}", table_rf.to_quoted_string(), quoted(f.name()));
                    required_exprs.insert(OrdExpr::new(col(qualified_name)));
                }

                // Keep identity while flattening a joined schema. Deduplicating by
                // bare name silently substituted the other model's id. A previous
                // chain has already replaced its qualifiers; recover those owners
                // from its explicit projection mapping before assigning new fields.
                let previous: BTreeMap<_, _> = right_alias
                    .as_ref()
                    .map(|alias| {
                        right_columns
                            .iter()
                            .map(|(owner, name)| {
                                ((alias.clone(), name.clone()), owner.clone())
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                let mut fields = BTreeMap::new();
                for required in required_exprs {
                    let Expr::Column(column) = &required.expr else {
                        return internal_err!("Relation field must be a column");
                    };
                    let key = column_key(column);
                    let original = previous.get(&key).cloned().unwrap_or(key);
                    fields.insert(original, required.expr);
                }
                let mut counts = BTreeMap::new();
                let mut reserved = BTreeSet::new();
                for (_, name) in fields.keys() {
                    *counts.entry(name.clone()).or_insert(0) += 1;
                    reserved.insert(name.clone());
                }
                let mut columns = ColumnAliases::new();
                let mut required_field = Vec::new();
                for (owner, expr) in fields {
                    let mut name = owner.1.clone();
                    if counts[&name] > 1 {
                        loop {
                            name = alias_generator.next("__column_");
                            if reserved.insert(name.clone()) {
                                break;
                            }
                        }
                    }
                    columns.insert(owner, name.clone());
                    required_field.push(expr.alias(name));
                }
                let alias = alias_generator.next(ALIAS);
                Ok((
                    Some(
                        LogicalPlanBuilder::from(left)
                            .join_on(
                                right,
                                datafusion::logical_expr::JoinType::Right,
                                vec![join_condition],
                            )?
                            .project(required_field)?
                            .alias(&alias)?
                            .build()?,
                    ),
                    Some(alias),
                    columns,
                ))
            }
            Start(plan) => {
                let generated = rule.generate_model_internal(plan.clone())?.data;
                let mut columns = ColumnAliases::new();
                for index in 0..generated.schema().fields().len() {
                    let (relation, field) = generated.schema().qualified_field(index);
                    columns.insert(
                        (
                            relation.map(|r| r.table()).unwrap_or("").to_owned(),
                            field.name().clone(),
                        ),
                        field.name().clone(),
                    );
                }
                Ok((Some(generated), None, columns))
            }
        }
    }
}
