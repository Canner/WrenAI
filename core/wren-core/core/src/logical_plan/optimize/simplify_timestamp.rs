/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
use datafusion::arrow::datatypes::{DataType, TimeUnit};
use datafusion::common::tree_node::{
    Transformed, TransformedResult, TreeNode, TreeNodeRewriter,
};
use datafusion::common::ScalarValue::{
    TimestampMicrosecond, TimestampMillisecond, TimestampSecond,
};
use datafusion::common::{DFSchema, DFSchemaRef, Result, ScalarValue};
use datafusion::config::ConfigOptions;
use datafusion::logical_expr::expr_rewriter::NamePreserver;
use datafusion::logical_expr::simplify::SimplifyContext;
use datafusion::logical_expr::utils::merge_schema;
use datafusion::logical_expr::{cast, Cast, LogicalPlan, TryCast};
use datafusion::optimizer::simplify_expressions::ExprSimplifier;
use datafusion::optimizer::AnalyzerRule;
use datafusion::prelude::Expr;
use datafusion::scalar::ScalarValue::TimestampNanosecond;
use std::sync::Arc;

/// Simplify the casting to [DataType::Timestamp] expression in the logical plan.
/// It's modified from [datafusion::optimizer::simplify_expressions::SimplifyExpressions].
/// Only the `Expr::Cast` with [DataType::Timestamp] is handled here.
#[derive(Debug, Default)]
pub struct TimestampSimplify {}

impl TimestampSimplify {
    pub fn new() -> Self {
        Self {}
    }
}

impl AnalyzerRule for TimestampSimplify {
    fn analyze(&self, plan: LogicalPlan, _config: &ConfigOptions) -> Result<LogicalPlan> {
        Self::analyze_internal(plan).data()
    }

    fn name(&self) -> &str {
        "simplify_timestamp_expressions"
    }
}

impl TimestampSimplify {
    fn analyze_internal(plan: LogicalPlan) -> Result<Transformed<LogicalPlan>> {
        let schema = if !plan.inputs().is_empty() {
            DFSchemaRef::new(merge_schema(&plan.inputs()))
        } else if let LogicalPlan::TableScan(scan) = &plan {
            // When predicates are pushed into a table scan, there is no input
            // schema to resolve predicates against, so it must be handled specially
            //
            // Note that this is not `plan.schema()` which is the *output*
            // schema, and reflects any pushed down projection. The output schema
            // will not contain columns that *only* appear in pushed down predicates
            // (and no where else) in the plan.
            //
            // Thus, use the full schema of the inner provider without any
            // projection applied for simplification
            Arc::new(DFSchema::try_from_qualified_schema(
                scan.table_name.clone(),
                &scan.source.schema(),
            )?)
        } else {
            Arc::new(DFSchema::empty())
        };
        let info = SimplifyContext::default().with_schema(schema);

        // Inputs have already been rewritten (due to bottom-up traversal handled by Optimizer)
        // Just need to rewrite our own expressions

        let simplifier = ExprSimplifier::new(info);

        // The left and right expressions in a Join on clause are not
        // commutative, for reasons that are not entirely clear. Thus, do not
        // reorder expressions in Join while simplifying.
        //
        // This is likely related to the fact that order of the columns must
        // match the order of the children. see
        // https://github.com/apache/datafusion/pull/8780 for more details
        let simplifier = if let LogicalPlan::Join(_) = plan {
            simplifier.with_canonicalize(false)
        } else {
            simplifier
        };

        // Preserve expression names to avoid changing the schema of the plan.
        let name_preserver = NamePreserver::new(&plan);
        let mut rewriter = ExprRewriter {
            simplifier: &simplifier,
            name_preserver,
        };
        plan.map_expressions(|e| e.rewrite(&mut rewriter))
    }
}

/// Rewriter for simplifying expressions in the logical plan.
/// Try to evaluate the expression and replace it with a constant if possible.
struct ExprRewriter<'a> {
    simplifier: &'a ExprSimplifier,
    name_preserver: NamePreserver,
}

impl TreeNodeRewriter for ExprRewriter<'_> {
    type Node = Expr;

    fn f_down(&mut self, expr: Expr) -> Result<Transformed<Self::Node>> {
        match &expr {
            // we only simplify the cast expression for the literal value
            Expr::Cast(Cast {
                data_type,
                expr: sub_expr,
            })
            | Expr::TryCast(TryCast {
                data_type,
                expr: sub_expr,
            }) if is_timestamp(data_type)
                && matches!(sub_expr.as_ref(), Expr::Literal(_, _)) =>
            {
                let original_name = self.name_preserver.save(&expr);
                let new_e = self
                    .simplifier
                    .simplify(expr)
                    .map(|expr| original_name.restore(expr))?;
                // TODO it would be nice to have a way to know if the expression was simplified
                // or not. For now conservatively return Transformed::yes
                Ok(Transformed::yes(new_e))
            }
            Expr::Literal(value, _) => {
                if let Some(cast_type) = cast_to_utc(value) {
                    let cast_to_utc_expr = cast(expr.clone(), cast_type);
                    let new_e = self.simplifier.simplify(cast_to_utc_expr)?;
                    Ok(Transformed::yes(new_e))
                } else {
                    Ok(Transformed::no(expr))
                }
            }
            _ => Ok(Transformed::no(expr)),
        }
    }
}

fn is_timestamp(data_type: &DataType) -> bool {
    matches!(data_type, DataType::Timestamp(_, _))
}

fn cast_to_utc(value: &ScalarValue) -> Option<DataType> {
    match value {
        TimestampSecond(..) => Some(DataType::Timestamp(TimeUnit::Second, None)),
        TimestampMillisecond(..) => {
            Some(DataType::Timestamp(TimeUnit::Millisecond, None))
        }
        TimestampMicrosecond(..) => {
            Some(DataType::Timestamp(TimeUnit::Microsecond, None))
        }
        TimestampNanosecond(..) => Some(DataType::Timestamp(TimeUnit::Nanosecond, None)),
        _ => None,
    }
}
