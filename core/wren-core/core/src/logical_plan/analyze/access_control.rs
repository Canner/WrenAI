use std::{
    collections::{HashMap, HashSet},
    ops::ControlFlow,
    sync::Arc,
};

use datafusion::{
    arrow::datatypes::{DataType, SchemaRef},
    common::{
        config::ConfigOptions, file_options::file_type::FileType, plan_datafusion_err,
        plan_err, Result, Spans,
    },
    error::DataFusionError,
    logical_expr::{
        builder::LogicalTableSource,
        planner::{ContextProvider, ExprPlanner, TypePlanner},
        AggregateUDF, ScalarUDF, TableSource, WindowUDF,
    },
    prelude::Expr,
    sql::{
        parser::DFParserBuilder,
        planner::{ParserOptions, PlannerContext, SqlToRel},
        sqlparser::{
            ast::{
                self, visit_expressions_mut, Array, ExprWithAlias, Map, MapEntry, Query,
                Visit, Visitor,
            },
            dialect::GenericDialect,
        },
        TableReference,
    },
};
use wren_core_base::mdl::RowLevelAccessControl;
use wren_core_base::mdl::{Column, Model, SessionProperty};

use crate::{
    logical_plan::utils::{create_schema, from_qualified_name},
    mdl::{
        context::SessionPropertiesRef, type_planner::WrenTypePlanner, Dataset,
        SessionStateRef,
    },
    AnalyzedWrenMDL,
};

/// Collect the required field from the condition of row level access control rules.
///
/// Two outputs:
/// 1. Bare-identifier column references **at the top level** of the condition. These are
///    treated as columns of the outer model and are pre-marked as required so they are
///    not pruned. Identifiers inside subqueries are skipped — they belong to a different
///    scope and will be validated/resolved when the subquery is analyzed.
/// 2. Session properties (`@name`) referenced **anywhere** in the condition, including
///    inside subqueries. These need to be substituted at RLAC parse time regardless of
///    where they appear.
pub fn collect_condition(
    model: &Model,
    condition: &str,
) -> Result<(Vec<Expr>, Vec<String>)> {
    let dialect = GenericDialect {};
    let mut parser = DFParserBuilder::new(condition)
        .with_dialect(&dialect)
        .build()?;
    let expr = parser.parse_expr()?;

    let mut visitor = ConditionVisitor {
        model,
        conditions: HashSet::new(),
        session_properties: HashSet::new(),
        subquery_depth: 0,
        error: None,
    };
    let _ = expr.visit(&mut visitor);

    if let Some(err) = visitor.error {
        err?;
    }

    Ok((
        visitor.conditions.into_iter().collect(),
        visitor.session_properties.into_iter().collect::<Vec<_>>(),
    ))
}

struct ConditionVisitor<'a> {
    model: &'a Model,
    conditions: HashSet<Expr>,
    session_properties: HashSet<String>,
    subquery_depth: usize,
    error: Option<Result<(), DataFusionError>>,
}

impl Visitor for ConditionVisitor<'_> {
    type Break = ();

    fn pre_visit_query(&mut self, _query: &Query) -> ControlFlow<Self::Break> {
        self.subquery_depth += 1;
        ControlFlow::Continue(())
    }

    fn post_visit_query(&mut self, _query: &Query) -> ControlFlow<Self::Break> {
        self.subquery_depth -= 1;
        ControlFlow::Continue(())
    }

    fn pre_visit_expr(&mut self, expr: &ast::Expr) -> ControlFlow<Self::Break> {
        // TODO: consider CompoundIdentifier and CompoundFieldAccess
        if let ast::Expr::Identifier(ast::Ident { value, .. }) = expr {
            if let Some(session_property) = value.strip_prefix("@") {
                self.session_properties
                    .insert(session_property.to_ascii_lowercase());
            } else if self.subquery_depth == 0 {
                // Validate and collect only at the outer scope. Inside subqueries the
                // identifier refers to a different model's column; that resolution is
                // deferred to ModelAnalyzeRule's recursive subquery analysis.
                if self.model.get_column(value).is_none() {
                    self.error = Some(plan_err!(
                        "The column {} is not in the model {}",
                        value,
                        self.model.name()
                    ));
                    return ControlFlow::Break(());
                }
                self.conditions
                    .insert(Expr::Column(datafusion::common::Column {
                        relation: Some(TableReference::bare(self.model.name())),
                        name: value.to_string(),
                        spans: Spans::new(),
                    }));
            }
        }
        ControlFlow::Continue(())
    }
}

/// Validate the definition of row level access control rules.
/// Check if the syntax of the condition is valid.
/// Check if the properties used in the condition are defined in the session properties.
#[allow(dead_code)]
pub fn validate_rlac_rule(rule: &RowLevelAccessControl, model: &Model) -> Result<()> {
    let RowLevelAccessControl {
        condition,
        required_properties,
        name,
    } = rule;
    let (_, session_properties) = collect_condition(model, condition)?;

    let required_properties: Vec<_> = required_properties
        .iter()
        .map(|property| property.normalized_name())
        .collect();

    let missed_properties: Vec<_> = session_properties
        .iter()
        .filter(|property| !required_properties.contains(&property.as_str()))
        .collect();
    if !missed_properties.is_empty() {
        return plan_err!(
            "The session property {} is used for `{}` rule, but not found in the session properties",
            missed_properties
                .iter()
                .map(|property| format!("@{property}"))
                .collect::<Vec<_>>()
                .join(", "),
            name
        );
    }
    Ok(())
}

/// Build the filter expression for the row level access control rule.
///
/// `analyzed_mdl` is optional: when provided, the parser can resolve table references
/// inside the condition against MDL models, enabling subqueries that select from other
/// models. When `None`, only the current model's columns are visible to the parser.
pub fn build_filter_expression(
    session_state: &SessionStateRef,
    analyzed_mdl: Option<Arc<AnalyzedWrenMDL>>,
    model: Arc<Model>,
    properties: &SessionPropertiesRef,
    rule: &RowLevelAccessControl,
) -> Result<Expr> {
    let RowLevelAccessControl {
        condition,
        required_properties,
        ..
    } = rule;
    let mut error: Option<Result<Expr, DataFusionError>> = None;
    let dialect = GenericDialect {};
    let mut parser = DFParserBuilder::new(condition.as_str())
        .with_dialect(&dialect)
        .build()?;
    let mut expr = parser.parse_expr()?;

    let _ = visit_expressions_mut(&mut expr, |expr| {
        if let ast::Expr::Identifier(ast::Ident { value, .. }) = expr {
            if value.starts_with("@") {
                let property_name =
                    value.trim_start_matches("@").to_string().to_lowercase();
                let Some(property_value) = properties.get(&property_name).or_else(|| {
                    required_properties
                        .iter()
                        .filter(|r| !r.required && r.normalized_name().eq(&property_name))
                        .map(|r| &r.default_expr)
                        .next()
                }) else {
                    error = Some(plan_err!(
                        "The session property {} is required for `{}` rule but not found in the session properties",
                        property_name,
                        rule.name
                    ));
                    return ControlFlow::Break(());
                };

                let Some(property_value) = property_value else {
                    error = Some(plan_err!(
                        "The session property {} is required for `{}` rule and should not be null",
                        property_name,
                        rule.name
                    ));
                    return ControlFlow::Break(());
                };

                if property_value.trim().is_empty() {
                    error = Some(plan_err!(
                        "The session property {} is required for `{}` rule and should not be empty",
                        property_name,
                        rule.name
                    ));
                    return ControlFlow::Break(());
                }

                match parse_expr(property_value) {
                    Ok(parsed_expr) => {
                        *expr = parsed_expr.expr;
                    }
                    Err(e) => {
                        error = Some(plan_err!(
                            "The session property {} is required for `{}` rule but not valid: {}",
                            property_name,
                            rule.name,
                            e
                        ));
                        return ControlFlow::Break(());
                    }
                }
            }
        }
        ControlFlow::Continue(())
    });

    if let Some(error) = error {
        return error;
    }
    // The condition could contains the hidden columns, so we need to build the shcmea with hidden columns
    let df_schema = Dataset::Model(Arc::clone(&model)).to_qualified_schema(false)?;

    // Build a ContextProvider that can resolve table references (in subqueries) against
    // the MDL's models, in addition to delegating function/type/options lookups to the
    // session state. This is required because DataFusion's default
    // `SessionState::create_logical_expr` constructs a `SessionContextProvider` with an
    // empty `tables` map and does not consult the session catalog, so any table reference
    // inside the RLAC condition (e.g. in a scalar/IN/EXISTS subquery) fails to resolve.
    let provider = RlacContextProvider::new(Arc::clone(session_state), analyzed_mdl);
    let parser_options = build_parser_options(session_state);
    let sql_to_rel = SqlToRel::new_with_options(&provider, parser_options);
    sql_to_rel.sql_to_expr_with_alias(expr, &df_schema, &mut PlannerContext::new())
}

fn build_parser_options(session_state: &SessionStateRef) -> ParserOptions {
    let state = session_state.read();
    let sql_parser = &state.config_options().sql_parser;
    ParserOptions {
        parse_float_as_decimal: sql_parser.parse_float_as_decimal,
        enable_ident_normalization: sql_parser.enable_ident_normalization,
        enable_options_value_normalization: sql_parser.enable_options_value_normalization,
        support_varchar_with_length: sql_parser.support_varchar_with_length,
        map_string_types_to_utf8view: sql_parser.map_string_types_to_utf8view,
        collect_spans: sql_parser.collect_spans,
        default_null_ordering: sql_parser.default_null_ordering.as_str().into(),
    }
}

/// A ContextProvider used while parsing RLAC condition expressions.
///
/// It resolves table references against the [`AnalyzedWrenMDL`]'s models so that
/// subqueries inside an RLAC condition (e.g. `SELECT id FROM other_model WHERE ...`)
/// can reference other models in the manifest. All other lookups (functions, type
/// planner, options) delegate to the underlying [`SessionStateRef`].
///
/// The TableSource returned for an MDL model is a [`LogicalTableSource`] holding the
/// model's physical schema. The resulting `TableScan` is later rewritten to a
/// [`ModelPlanNode`](crate::logical_plan::analyze::plan::ModelPlanNode) by
/// `ModelAnalyzeRule` via natural subquery traversal, so the embedded model
/// participates in the same RLAC/CLAC/relationship machinery as the outer query.
pub struct RlacContextProvider {
    session_state: SessionStateRef,
    analyzed_mdl: Option<Arc<AnalyzedWrenMDL>>,
    options: ConfigOptions,
    type_planner: Option<Arc<dyn TypePlanner>>,
    expr_planners: Vec<Arc<dyn ExprPlanner>>,
}

impl RlacContextProvider {
    pub fn new(
        session_state: SessionStateRef,
        analyzed_mdl: Option<Arc<AnalyzedWrenMDL>>,
    ) -> Self {
        // Snapshot fields that the trait methods would otherwise need to borrow through
        // a per-call RwLock guard. ExprPlanners are required for parsing array/map
        // literals (e.g. RLAC property values like `[1,2,3]`); without them the parser
        // emits `Could not plan array literal`.
        let (options, expr_planners) = {
            let guard = session_state.read();
            (
                guard.config_options().as_ref().clone(),
                guard.expr_planners().to_vec(),
            )
        };
        // WrenTypePlanner is stateless; the session-attached instance is not exposed
        // through SessionState's public API on this DataFusion version, so we build a
        // fresh one to mirror what `apply_wren_on_ctx` registers.
        let type_planner: Option<Arc<dyn TypePlanner>> =
            Some(Arc::new(WrenTypePlanner::default()));
        Self {
            session_state,
            analyzed_mdl,
            options,
            type_planner,
            expr_planners,
        }
    }

    fn model_table_source(&self, name: &TableReference) -> Option<Arc<dyn TableSource>> {
        let mdl = self.analyzed_mdl.as_ref()?.wren_mdl();
        // Only resolve references that point at this MDL's catalog/schema (or are bare).
        match name {
            TableReference::Bare { .. } => {}
            TableReference::Partial { schema, .. } => {
                if schema.as_ref() != mdl.schema() {
                    return None;
                }
            }
            TableReference::Full {
                catalog, schema, ..
            } => {
                if catalog.as_ref() != mdl.catalog() || schema.as_ref() != mdl.schema() {
                    return None;
                }
            }
        }
        let model = mdl.get_model(name.table())?;
        let columns: Vec<Arc<Column>> = model.get_physical_columns(false);
        let schema: SchemaRef = create_schema(columns).ok()?;
        Some(Arc::new(LogicalTableSource::new(schema)))
    }
}

impl ContextProvider for RlacContextProvider {
    fn get_table_source(&self, name: TableReference) -> Result<Arc<dyn TableSource>> {
        if let Some(source) = self.model_table_source(&name) {
            return Ok(source);
        }
        plan_err!("table '{name}' not found")
    }

    fn get_file_type(&self, _ext: &str) -> Result<Arc<dyn FileType>> {
        Err(plan_datafusion_err!(
            "Registered file types are not supported in RLAC conditions"
        ))
    }

    fn get_table_function_source(
        &self,
        _name: &str,
        _args: Vec<Expr>,
    ) -> Result<Arc<dyn TableSource>> {
        Err(plan_datafusion_err!(
            "Table functions are not supported in RLAC conditions"
        ))
    }

    fn get_expr_planners(&self) -> &[Arc<dyn ExprPlanner>] {
        &self.expr_planners
    }

    fn get_type_planner(&self) -> Option<Arc<dyn TypePlanner>> {
        self.type_planner.clone()
    }

    fn get_function_meta(&self, name: &str) -> Option<Arc<ScalarUDF>> {
        self.session_state
            .read()
            .scalar_functions()
            .get(name)
            .cloned()
    }

    fn get_aggregate_meta(&self, name: &str) -> Option<Arc<AggregateUDF>> {
        self.session_state
            .read()
            .aggregate_functions()
            .get(name)
            .cloned()
    }

    fn get_window_meta(&self, name: &str) -> Option<Arc<WindowUDF>> {
        self.session_state
            .read()
            .window_functions()
            .get(name)
            .cloned()
    }

    fn get_variable_type(&self, _variable_names: &[String]) -> Option<DataType> {
        None
    }

    fn options(&self) -> &ConfigOptions {
        &self.options
    }

    fn udf_names(&self) -> Vec<String> {
        self.session_state
            .read()
            .scalar_functions()
            .keys()
            .cloned()
            .collect()
    }

    fn udaf_names(&self) -> Vec<String> {
        self.session_state
            .read()
            .aggregate_functions()
            .keys()
            .cloned()
            .collect()
    }

    fn udwf_names(&self) -> Vec<String> {
        self.session_state
            .read()
            .window_functions()
            .keys()
            .cloned()
            .collect()
    }
}

fn parse_expr(expr: &str) -> Result<ExprWithAlias> {
    let dialect = GenericDialect {};
    let mut parser = DFParserBuilder::new(expr).with_dialect(&dialect).build()?;
    let expr = parser.parse_expr()?;
    prevent_invalid_expr(&expr.expr)?;
    Ok(expr)
}

/// Prevent invalid expression for the session property.
/// Only literal values are allowed.
fn prevent_invalid_expr(expr: &ast::Expr) -> Result<()> {
    match &expr {
        ast::Expr::Value(_) | ast::Expr::Interval(_) => Ok(()),
        ast::Expr::Array(Array { elem, .. }) => {
            for e in elem {
                prevent_invalid_expr(e)?;
            }
            Ok(())
        }
        ast::Expr::Map(Map { entries }) => {
            for MapEntry { key, value } in entries {
                prevent_invalid_expr(key)?;
                prevent_invalid_expr(value)?;
            }
            Ok(())
        }
        ast::Expr::Dictionary(fileds) => {
            for field in fileds {
                prevent_invalid_expr(&field.value)?;
            }
            Ok(())
        }
        _ => plan_err!("The session property {} allow only literal value", expr),
    }
}

/// Validate the input headers with the required properties.
/// If the result is false, the rules are not satisfied and it should be ignored.
///
/// If the required property is not found in the headers, return an error.
/// If the required property is found in the headers, return true.
/// If the optional property is found in the headers, return true.
/// If the optional property is not found in the headers but has a default value, return true.
/// If the optional property is not found in the headers and has no default value, return false.
pub fn validate_rule(
    name: &str,
    required_properties: &[SessionProperty],
    headers: &HashMap<String, Option<String>>,
) -> Result<bool> {
    if required_properties.is_empty() {
        return Ok(true);
    }

    let exists = required_properties
        .iter()
        .map(|property| {
            if property.required {
                if !is_property_present(headers, property) {
                    return plan_err!(
                        "session property {} is required for `{}` rule but not found in headers",
                        property.name,
                        name
                    );
                }
                Ok(true)
            } else {
                let exist = is_property_present(headers, property);
                if exist
                    || property
                        .default_expr
                        .as_ref()
                        .is_some_and(|expr| !expr.is_empty())
                {
                    Ok(true)
                } else {
                    Ok(false)
                }
            }
        })
        .collect::<Result<Vec<_>>>()?;

    Ok(exists.iter().all(|x| *x))
}

pub(crate) fn validate_clac_rule(
    model_name: &str,
    column: &Column,
    properties: &SessionPropertiesRef,
    analyzed_mdl: Option<Arc<AnalyzedWrenMDL>>,
) -> Result<(bool, Option<String>)> {
    let (is_valid, rule_name) = if let Some(clac) = column.column_level_access_control() {
        if !validate_rule(&clac.name, &clac.required_properties, properties)? {
            return Ok((true, None));
        }

        if clac.required_properties.len() > 1 {
            return plan_err!(
                "Only support one required property for column access-control level rule: {}",
                clac.name
            );
        }

        let property = &clac.required_properties[0];
        let value_opt = properties.get(property.normalized_name());

        match value_opt {
            Some(Some(value)) => (clac.eval(value), Some(clac.name.clone())),
            Some(None) | None => {
                if let Some(default) = &property.default_expr {
                    (clac.eval(default), Some(clac.name.clone()))
                } else {
                    (true, None)
                }
            }
        }
    } else {
        (true, None)
    };

    if is_valid && column.is_calculated {
        if let Some(analyzed_mdl) = analyzed_mdl {
            let qualified_col =
                from_qualified_name(&analyzed_mdl.wren_mdl, model_name, column.name());
            let Some(required_fields) =
                analyzed_mdl.lineage.required_fields_map.get(&qualified_col)
            else {
                return plan_err!("Required fields not found for {}", qualified_col);
            };
            for field in required_fields {
                let Some(model_name) = &field.relation else {
                    return plan_err!("Model name not found for {}", field);
                };
                let Some(ref_model) = analyzed_mdl.wren_mdl.get_model(model_name.table())
                else {
                    return plan_err!("Model {} not found", model_name.table());
                };
                let Some(ref_column) = ref_model.get_visible_column(field.name()) else {
                    return plan_err!(
                        "Column {}.{} not found",
                        model_name.table(),
                        field.name()
                    );
                };
                let (valid_result, rule_name) = validate_clac_rule(
                    ref_model.name(),
                    &ref_column,
                    properties,
                    Some(Arc::clone(&analyzed_mdl)),
                )?;
                if !valid_result {
                    return Ok((false, rule_name));
                }
            }
        }
    }

    Ok((is_valid, rule_name))
}

/// Check if the property is present in the headers and not empty
/// If the property is present and not empty, return true.
fn is_property_present(
    headers: &HashMap<String, Option<String>>,
    property: &SessionProperty,
) -> bool {
    headers
        .get(property.normalized_name())
        .map(|v| v.as_ref().is_some_and(|value| !value.is_empty()))
        .unwrap_or(false)
}

#[cfg(test)]
mod test {
    use std::{
        collections::{HashMap, HashSet},
        sync::Arc,
    };

    use datafusion::{
        error::Result,
        prelude::{Expr, SessionContext},
        sql::unparser::Unparser,
    };
    use insta::assert_snapshot;
    use wren_core_base::mdl::{
        ColumnBuilder, ModelBuilder, RowLevelAccessControl, SessionProperty,
    };

    use crate::logical_plan::analyze::access_control::{
        collect_condition, validate_rule,
    };

    use super::{build_filter_expression, validate_rlac_rule};

    #[test]
    pub fn test_collect_condition() -> Result<()> {
        let model = ModelBuilder::new("model1")
            .column(ColumnBuilder::new("id", "int").build())
            .column(ColumnBuilder::new("name", "varchar").build())
            .build();

        let conditions = vec![
            "id = @session_id AND name = 'test'",
            "id = @session_id /* comment */ AND name = 'test'",
            "id = @session_id \nAND name = 'test'",
        ];
        for condition in conditions {
            let (required_exprs, session_properties) =
                collect_condition(&model, condition)?;
            assert_eq!(required_exprs.len(), 2);
            let name = required_exprs
                .into_iter()
                .map(|e| e.schema_name().to_string())
                .collect::<Vec<_>>();
            let expected: HashSet<&str> =
                ["model1.name", "model1.id"].iter().cloned().collect();
            let all_match = name.iter().all(|n| expected.contains(n.as_str()));

            if !all_match {
                panic!("should be all match, but got: {name:?}");
            }
            assert_eq!(session_properties.len(), 1);
            assert_eq!(session_properties[0], "session_id");
        }

        let condition = "not_found  = @session_id AND name = 'test'";
        match collect_condition(&model, condition) {
            Err(error)
                if error.message()
                    == "The column not_found is not in the model model1" => {}
            _ => panic!("should be error"),
        };

        Ok(())
    }

    #[test]
    pub fn test_validate_rule() -> Result<()> {
        // required property
        assert!(validate_rule(
            "test",
            &[SessionProperty::new_required("session_id")],
            &build_headers(&[("session_id".to_string(), Some("1".to_string()))])
        )?);

        match validate_rule(
            "test",
            &[SessionProperty::new_required("session_id")],
            &build_headers(&[("session_id".to_string(), None)]),
        ) {
            Err(error) => {
                assert_snapshot!(error.message(), @"session property session_id is required for `test` rule but not found in headers");
            }
            _ => panic!("should be error"),
        }

        match validate_rule(
            "test",
            &[SessionProperty::new_required("session_id")],
            &build_headers(&[("session_id".to_string(), Some("".to_string()))]),
        ) {
            Err(error) => {
                assert_snapshot!(error.message(), @"session property session_id is required for `test` rule but not found in headers");
            }
            _ => panic!("should be error"),
        }

        match validate_rule(
            "test",
            &[SessionProperty::new_required("session_id")],
            &build_headers(&[]),
        ) {
            Err(error) => {
                assert_snapshot!(error.message(), @"session property session_id is required for `test` rule but not found in headers");
            }
            _ => panic!("should be error"),
        }

        // optional property with default
        assert!(validate_rule(
            "test",
            &[SessionProperty::new_optional(
                "session_id",
                Some("1".to_string())
            )],
            &build_headers(&[("session_id".to_string(), Some("2".to_string()))])
        )?);

        assert!(validate_rule(
            "test",
            &[SessionProperty::new_optional(
                "session_id",
                Some("1".to_string())
            )],
            &build_headers(&[("session_id".to_string(), None)])
        )?);

        assert!(validate_rule(
            "test",
            &[SessionProperty::new_optional(
                "session_id",
                Some("1".to_string())
            )],
            &build_headers(&[("session_id".to_string(), Some("".to_string()))])
        )?);

        assert!(validate_rule(
            "test",
            &[SessionProperty::new_optional(
                "session_id",
                Some("1".to_string())
            )],
            &build_headers(&[])
        )?);

        // optional property without default
        assert!(validate_rule(
            "test",
            &[SessionProperty::new_optional("session_id", None)],
            &build_headers(&[("session_id".to_string(), Some("2".to_string()))])
        )?);

        // expected false
        assert!(!validate_rule(
            "test",
            &[SessionProperty::new_optional("session_id", None)],
            &build_headers(&[("session_id".to_string(), None)])
        )?);

        // expected false
        assert!(!validate_rule(
            "test",
            &[SessionProperty::new_optional("session_id", None)],
            &build_headers(&[("session_id".to_string(), Some("".to_string()))])
        )?);

        // expected false
        assert!(!validate_rule(
            "test",
            &[SessionProperty::new_optional("session_id", None)],
            &build_headers(&[])
        )?);

        assert!(validate_rule(
            "test",
            &[
                SessionProperty::new_required("session_id"),
                SessionProperty::new_optional("session_id_1", None),
                SessionProperty::new_optional("session_id_2", Some("1".to_string()))
            ],
            &build_headers(&[
                ("session_id".to_string(), Some("1".to_string())),
                ("session_id_1".to_string(), Some("1".to_string())),
                ("session_id_2".to_string(), Some("2".to_string())),
            ])
        )?);

        // expected false
        assert!(!validate_rule(
            "test",
            &[
                SessionProperty::new_required("session_id"),
                SessionProperty::new_optional("session_id_1", None),
                SessionProperty::new_optional("session_id_2", Some("1".to_string()))
            ],
            &build_headers(&[
                ("session_id".to_string(), Some("1".to_string())),
                ("session_id_1".to_string(), None),
                ("session_id_2".to_string(), Some("2".to_string())),
            ])
        )?);

        assert!(validate_rule(
            "test",
            &[
                SessionProperty::new_required("session_id"),
                SessionProperty::new_optional("session_id_1", None),
                SessionProperty::new_optional("session_id_2", Some("1".to_string()))
            ],
            &build_headers(&[
                ("session_id".to_string(), Some("1".to_string())),
                ("session_id_1".to_string(), Some("1".to_string())),
                ("session_id_2".to_string(), None),
            ])
        )?);

        match validate_rule(
            "test",
            &[
                SessionProperty::new_required("session_id"),
                SessionProperty::new_optional("session_id_1", None),
                SessionProperty::new_optional("session_id_2", Some("1".to_string())),
            ],
            &build_headers(&[
                ("session_id".to_string(), None),
                ("session_id_1".to_string(), Some("1".to_string())),
                ("session_id_2".to_string(), None),
            ]),
        ) {
            Err(error) => {
                assert_snapshot!(error.message(), @"session property session_id is required for `test` rule but not found in headers");
            }
            _ => panic!("should be error"),
        }

        Ok(())
    }

    fn build_headers(
        field: &[(String, Option<String>)],
    ) -> HashMap<String, Option<String>> {
        let mut headers = HashMap::new();
        for (key, value) in field {
            headers.insert(key.clone(), value.clone());
        }
        headers
    }

    #[test]
    pub fn test_build_filter_expression() -> Result<()> {
        let ctx = SessionContext::new();
        let state = ctx.state_ref();
        let model = ModelBuilder::new("m1")
            .column(ColumnBuilder::new("id", "int").build())
            .column(ColumnBuilder::new("name", "varchar").build())
            .build();

        let headers = Arc::new(build_headers(&[
            ("session_id".to_string(), Some("1".to_string())),
            ("session_name".to_string(), Some("'test'".to_string())),
        ]));

        let rule = RowLevelAccessControl {
            condition: "id = @session_id AND name = @session_name".to_string(),
            required_properties: vec![
                SessionProperty::new_required("session_id"),
                SessionProperty::new_required("session_name"),
            ],
            name: "test".to_string(),
        };

        let expr =
            build_filter_expression(&state, None, Arc::clone(&model), &headers, &rule)?;
        assert_snapshot!(expr_to_sql(&expr)?, @"m1.id = 1 AND m1.\"name\" = 'test'");

        let rule = RowLevelAccessControl {
            condition: "id = @not_found AND name = @session_name".to_string(),
            required_properties: vec![
                SessionProperty::new_required("session_id"),
                SessionProperty::new_required("session_name"),
            ],
            name: "test".to_string(),
        };

        match build_filter_expression(&state, None, Arc::clone(&model), &headers, &rule) {
            Err(error) => {
                assert_snapshot!(error.to_string(), @"Error during planning: The session property not_found is required for `test` rule but not found in the session properties");
            }
            _ => panic!("should be error"),
        }

        let rule = RowLevelAccessControl {
            condition: "id = @session_id AND name = @session_name".to_string(),
            required_properties: vec![
                SessionProperty::new_required("session_id"),
                SessionProperty::new_required("session_name"),
            ],
            name: "test".to_string(),
        };

        let headers = Arc::new(build_headers(&[(
            "session_id".to_string(),
            Some("1".to_string()),
        )]));
        match build_filter_expression(&state, None, Arc::clone(&model), &headers, &rule) {
            Err(error) => {
                assert_snapshot!(error.to_string(), @"Error during planning: The session property session_name is required for `test` rule but not found in the session properties");
            }
            _ => panic!("should be error"),
        }

        let rule = RowLevelAccessControl {
            condition: "id = @session_id AND name = @session_name".to_string(),
            required_properties: vec![
                SessionProperty::new_required("session_id"),
                SessionProperty::new_optional("session_name", Some("'test'".to_string())),
            ],
            name: "test".to_string(),
        };

        let headers = Arc::new(build_headers(&[(
            "session_id".to_string(),
            Some("1".to_string()),
        )]));

        let expr =
            build_filter_expression(&state, None, Arc::clone(&model), &headers, &rule)?;
        assert_snapshot!(expr_to_sql(&expr)?, @"m1.id = 1 AND m1.\"name\" = 'test'");

        Ok(())
    }

    fn expr_to_sql(expr: &Expr) -> Result<String> {
        let unparser = Unparser::default().with_pretty(true);
        unparser.expr_to_sql(expr).map(|sql| sql.to_string())
    }

    #[test]
    pub fn test_build_filter_expression_with_bypass_function() -> Result<()> {
        use crate::mdl::function::ByPassScalarUDF;
        use datafusion::logical_expr::ScalarUDF;

        // A function unknown to wren-core, registered as an inferred bypass UDF
        // (as the manifest scan does), can be used inside an RLAC condition.
        let ctx = SessionContext::new();
        ctx.register_udf(ScalarUDF::new_from_impl(ByPassScalarUDF::new_inferred(
            "mask",
        )));
        let state = ctx.state_ref();
        let model = ModelBuilder::new("m1")
            .column(ColumnBuilder::new("id", "int").build())
            .column(ColumnBuilder::new("name", "varchar").build())
            .build();

        let headers = Arc::new(build_headers(&[(
            "session_name".to_string(),
            Some("'test'".to_string()),
        )]));

        let rule = RowLevelAccessControl {
            condition: "mask(name) = @session_name".to_string(),
            required_properties: vec![SessionProperty::new_required("session_name")],
            name: "test".to_string(),
        };

        let expr = build_filter_expression(&state, Arc::clone(&model), &headers, &rule)?;
        assert_snapshot!(expr_to_sql(&expr)?, @"mask(m1.\"name\") = 'test'");
        Ok(())
    }

    #[test]
    pub fn test_match_case_insensitive() -> Result<()> {
        let ctx = SessionContext::new();
        let state = ctx.state_ref();
        let model = ModelBuilder::new("m1")
            .column(ColumnBuilder::new("id", "int").build())
            .column(ColumnBuilder::new("name", "varchar").build())
            .build();

        let headers: Arc<HashMap<String, Option<String>>> = Arc::new(build_headers(&[
            ("session_id".to_string(), Some("1".to_string())),
            ("session_name".to_string(), Some("'test'".to_string())),
        ]));

        let rule = RowLevelAccessControl {
            condition: "id = @session_id AND name = @SESSION_NAME".to_string(),
            required_properties: vec![
                SessionProperty::new_required("SESSION_ID"),
                SessionProperty::new_required("session_name"),
            ],
            name: "test".to_string(),
        };

        let expr =
            build_filter_expression(&state, None, Arc::clone(&model), &headers, &rule)?;
        assert_snapshot!(expr_to_sql(&expr)?, @"m1.id = 1 AND m1.\"name\" = 'test'");
        Ok(())
    }

    #[test]
    pub fn test_property_value() -> Result<()> {
        let ctx = SessionContext::new();
        let state = ctx.state_ref();
        let model = ModelBuilder::new("m1")
            .column(ColumnBuilder::new("id", "int").build())
            .column(ColumnBuilder::new("name", "varchar").build())
            .build();

        let rule = RowLevelAccessControl {
            condition: "id = @session_id".to_string(),
            required_properties: vec![SessionProperty::new_required("SESSION_ID")],
            name: "test".to_string(),
        };

        let valid_values = vec![
            "1",
            "'aaa'",
            "1.0",
            "true",
            "false",
            "[1,2,3]",
            "{'key': 'value'}",
            "{key: 'value'}",
            "INTERVAL '1' YEAR",
        ];

        for value in valid_values {
            let headers: Arc<HashMap<String, Option<String>>> = Arc::new(build_headers(
                &[("session_id".to_string(), Some(value.to_string()))],
            ));

            let expr = build_filter_expression(
                &state,
                None,
                Arc::clone(&model),
                &headers,
                &rule,
            )?;
            expr_to_sql(&expr)?;
        }

        let invalid_values = vec![
            "1 + 1",
            "upper('aaa')",
            "(select 1)",
            "1 or 1",
            "aaa",
            "is null",
            "is not null",
            "case when 1 then 1 else 2 end",
            "[upper('aaa'), upper('aaa')]",
            "{'key': upper('aaa')}",
            "{ key: upper('aaa') }",
        ];

        for value in invalid_values {
            let headers: Arc<HashMap<String, Option<String>>> = Arc::new(build_headers(
                &[("session_id".to_string(), Some(value.to_string()))],
            ));

            match build_filter_expression(
                &state,
                None,
                Arc::clone(&model),
                &headers,
                &rule,
            ) {
                Err(_) => {}
                _ => panic!(
                    "should be error: {}",
                    &headers.get("session_id").unwrap().as_ref().unwrap()
                ),
            }
        }
        Ok(())
    }

    #[test]
    pub fn test_validate_rlac_rule() -> Result<()> {
        let model = ModelBuilder::new("m1")
            .column(ColumnBuilder::new("id", "int").build())
            .column(ColumnBuilder::new("name", "varchar").build())
            .build();

        let rule = RowLevelAccessControl {
            condition: "id = @session_id".to_string(),
            required_properties: vec![SessionProperty::new_required("SESSION_ID")],
            name: "test".to_string(),
        };

        validate_rlac_rule(&rule, &model)?;

        let rule = RowLevelAccessControl {
            condition: "id = @session_id AND name = @session_name".to_string(),
            required_properties: vec![
                SessionProperty::new_required("SESSION_ID"),
                SessionProperty::new_required("SESSION_NAME"),
            ],
            name: "test".to_string(),
        };

        validate_rlac_rule(&rule, &model)?;

        let rule = RowLevelAccessControl {
            condition: "id = @session_id AND name = @session_name".to_string(),
            required_properties: vec![SessionProperty::new_required("SESSION_ID")],
            name: "test".to_string(),
        };

        match validate_rlac_rule(&rule, &model) {
            Err(error) => {
                assert_snapshot!(error.message(), @"The session property @session_name is used for `test` rule, but not found in the session properties");
            }
            _ => panic!("should be error"),
        }

        let rule = RowLevelAccessControl {
            condition: ",invalid".to_string(),
            required_properties: vec![],
            name: "test".to_string(),
        };

        match validate_rlac_rule(&rule, &model) {
            Err(error) => {
                assert_snapshot!(error.message(), @r#"ParserError("Expected: an expression, found: , at Line: 1, Column: 1")"#);
            }
            _ => panic!("should be error"),
        }

        let rule = RowLevelAccessControl {
            condition: "not_found = @SESSION_ID".to_string(),
            required_properties: vec![SessionProperty::new_required("SESSION_ID")],
            name: "test".to_string(),
        };

        match validate_rlac_rule(&rule, &model) {
            Err(error) => {
                assert_snapshot!(error.message(), @"The column not_found is not in the model m1");
            }
            _ => panic!("should be error"),
        }

        Ok(())
    }
}
