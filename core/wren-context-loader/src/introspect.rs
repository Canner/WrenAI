//! Project a wren [`Manifest`] into Warble's narrow Info types + infer measure additivity.
//!
//! The projection is deliberately **loose for existence, strict for semantics** (the Phase 2
//! predicate-semantics decision): a queryable quantity is either a declared cube measure *or* a
//! plain numeric column (so `has_metric` holds on cube-less projects), but additivity is only
//! reported when the expression proves a measure non-additive. An expression alone cannot prove
//! dimensional additivity: a `SUM` or `COUNT` may be a balance or snapshot, so it carries
//! `additivity: None` rather than an unsupported green light.

use std::collections::{HashMap, HashSet};

use sqlparser::{
    ast::{
        BinaryOperator, DuplicateTreatment, Expr, Function, FunctionArg, FunctionArgExpr,
        FunctionArguments,
    },
    dialect::GenericDialect,
    parser::Parser,
    tokenizer::Token,
};
use warble::{Additivity, ContextLoader, DimensionInfo, LineageGraph, MetricInfo, ModelInfo};
use wren_core_base::mdl::manifest::Manifest;

use crate::lineage;
use crate::project::{assemble, LoadError, ProjectSources};

/// A `ContextLoader` backed by a wren MDL manifest. Built once from an assembled manifest; all
/// accessors return borrowed, pre-projected data (pure, sans-IO).
pub struct MdlContext {
    parseable: bool,
    parse_error: Option<String>,
    metrics: Vec<MetricInfo>,
    dimensions: Vec<DimensionInfo>,
    time_dimensions: Vec<DimensionInfo>,
    models: Vec<ModelInfo>,
    lineage: LineageGraph,
    lineage_diagnostics: Vec<String>,
}

impl MdlContext {
    /// Build from assembled project sources. On assembly failure returns an *unparseable* context
    /// (rather than an error) so the compiler can evaluate `mdl_parseable`/`wren_project_exists`
    /// to `false` and loud-fail with a precondition message, per the sans-IO probe model. The
    /// underlying [`LoadError`] text is discarded here — use [`Self::try_from_sources`] (or catch
    /// the error and call [`Self::unparseable_with_error`]) when the caller wants it surfaced.
    pub fn from_sources(sources: &ProjectSources) -> Self {
        match assemble(sources) {
            Ok(loaded) => Self::from_manifest_and_consumers(&loaded.manifest, sources),
            Err(_) => Self::unparseable(),
        }
    }

    /// Build from an assembled project, surfacing the assembly error to the host if it wants it.
    pub fn try_from_sources(sources: &ProjectSources) -> Result<Self, LoadError> {
        assemble(sources).map(|loaded| Self::from_manifest_and_consumers(&loaded.manifest, sources))
    }

    /// [`Self::from_manifest`] plus the consumer extension: `knowledge/sql` confirmed queries and
    /// `dashboards.yml` specs from `sources` become `query:`/`dashboard:` lineage nodes. Consumer
    /// artifacts live outside the MDL manifest, which is why this needs the raw sources.
    fn from_manifest_and_consumers(manifest: &Manifest, sources: &ProjectSources) -> Self {
        let mut ctx = Self::from_manifest(manifest);
        lineage::extend_with_consumers(
            &mut ctx.lineage,
            manifest,
            sources,
            &mut ctx.lineage_diagnostics,
        );
        ctx
    }

    /// An empty, non-parseable context (bound project missing or malformed), with no detail on
    /// *why* — used when the caller has no [`LoadError`] to hand (e.g. no wren project directory
    /// found at all).
    pub fn unparseable() -> Self {
        Self::unparseable_with_error(None)
    }

    /// An empty, non-parseable context carrying the real assembly failure text (from
    /// [`Self::try_from_sources`]'s `Err`), so the host can surface *why* the bound project didn't
    /// parse instead of only the generic `mdl_parseable` floor message.
    pub fn unparseable_with_error(parse_error: Option<String>) -> Self {
        MdlContext {
            parseable: false,
            parse_error,
            metrics: Vec::new(),
            dimensions: Vec::new(),
            time_dimensions: Vec::new(),
            models: Vec::new(),
            lineage: LineageGraph::default(),
            lineage_diagnostics: Vec::new(),
        }
    }

    /// Project a parsed manifest into the Info types + lineage.
    pub fn from_manifest(manifest: &Manifest) -> Self {
        let mut metrics = Vec::new();
        let mut dimensions = Vec::new();
        let mut time_dimensions = Vec::new();
        let mut models = Vec::new();

        // Declared cube members: measures are metrics (proven non-additivity may be projected);
        // cube dimensions and time-dimensions are dimensions.
        for cube in &manifest.cubes {
            for measure in &cube.measures {
                metrics.push(MetricInfo {
                    name: measure.name.clone(),
                    owner: cube.name.clone(),
                    declared: true,
                    additivity: infer_additivity(&measure.expression),
                });
            }
            for dim in &cube.dimensions {
                dimensions.push(DimensionInfo {
                    name: dim.name.clone(),
                    owner: cube.name.clone(),
                    is_temporal: false,
                });
            }
            for tdim in &cube.time_dimensions {
                let d = DimensionInfo {
                    name: tdim.name.clone(),
                    owner: cube.name.clone(),
                    is_temporal: true,
                };
                time_dimensions.push(d.clone());
                dimensions.push(d);
            }
        }

        // Implicit column-level projection: numeric columns are queryable quantities (metrics);
        // categorical columns are groupable dimensions; date/timestamp columns are time dimensions.
        for model in &manifest.models {
            let mut has_timestamp = false;
            let mut column_names = Vec::new();
            for col in model.columns.iter().filter(|c| !c.is_hidden) {
                column_names.push(col.name.clone());
                // Relationship columns are navigation, not queryable values.
                if col.relationship.is_some() {
                    continue;
                }
                if is_temporal_type(&col.r#type) {
                    has_timestamp = true;
                    let d = DimensionInfo {
                        name: col.name.clone(),
                        owner: model.name.clone(),
                        is_temporal: true,
                    };
                    time_dimensions.push(d.clone());
                    dimensions.push(d);
                } else if is_numeric_type(&col.r#type) {
                    metrics.push(MetricInfo {
                        name: col.name.clone(),
                        owner: model.name.clone(),
                        declared: false,
                        additivity: None,
                    });
                } else {
                    // Textual / boolean / other → groupable dimension.
                    dimensions.push(DimensionInfo {
                        name: col.name.clone(),
                        owner: model.name.clone(),
                        is_temporal: false,
                    });
                }
            }
            models.push(ModelInfo {
                name: model.name.clone(),
                has_timestamp,
                columns: column_names,
            });
        }

        // `metric_additive` is currently addressed by metric name alone across the prepared
        // context wire. Keep legal same-named cube measures, but erase a conflicting answer
        // before serialization so an external consumer cannot accidentally select the first cube.
        let mut additivity_by_name = HashMap::new();
        let mut ambiguous_names = HashSet::new();
        for metric in metrics.iter().filter(|metric| metric.declared) {
            match additivity_by_name.insert(metric.name.clone(), metric.additivity) {
                Some(previous) if previous != metric.additivity => {
                    ambiguous_names.insert(metric.name.clone());
                }
                _ => {}
            }
        }
        for metric in metrics.iter_mut() {
            if metric.declared && ambiguous_names.contains(&metric.name) {
                metric.additivity = None;
            }
        }

        let (lineage, lineage_diagnostics) = lineage::build(manifest);
        MdlContext {
            parseable: true,
            parse_error: None,
            metrics,
            dimensions,
            time_dimensions,
            models,
            lineage,
            lineage_diagnostics,
        }
    }
}

impl ContextLoader for MdlContext {
    fn is_parseable(&self) -> bool {
        self.parseable
    }
    fn parse_error(&self) -> Option<&str> {
        self.parse_error.as_deref()
    }
    fn metrics(&self) -> &[MetricInfo] {
        &self.metrics
    }
    fn dimensions(&self) -> &[DimensionInfo] {
        &self.dimensions
    }
    fn time_dimensions(&self) -> &[DimensionInfo] {
        &self.time_dimensions
    }
    fn models(&self) -> &[ModelInfo] {
        &self.models
    }
    fn lineage(&self) -> &LineageGraph {
        &self.lineage
    }
    fn host_analysis(&self) -> Option<warble::HostAnalysis> {
        self.parseable
            .then(|| crate::impact::analyze(&self.lineage))
            .flatten()
    }
    fn lineage_diagnostics(&self) -> &[String] {
        &self.lineage_diagnostics
    }
    fn metric_additivity(&self, metric: &str) -> Option<Additivity> {
        // The public predicate has no owner argument. A legal duplicate measure name therefore
        // cannot safely borrow whichever cube happened to be projected first: it is answerable
        // only when every declared match carries the same known value.
        let mut matches = self
            .metrics
            .iter()
            .filter(|candidate| candidate.declared && candidate.name == metric);
        let additivity = matches.next()?.additivity;
        matches
            .all(|candidate| candidate.additivity == additivity)
            .then_some(additivity)
            .flatten()
    }
}

/// Report only non-additivity that an aggregation expression proves.
///
/// `AVG`/`MIN`/`MAX`/`MEDIAN`/`STDDEV`/`VARIANCE`, actual `DISTINCT` aggregate arguments, and
/// ratios of aggregate results are non-additive: decomposing them along dimensions can mislead.
/// `SUM`, non-distinct `COUNT`, scalar division, and unrecognized expressions return `None`:
/// expression syntax cannot establish whether their input is additive across every business
/// dimension or is a balance/snapshot. `SemiAdditive` requires explicit dimensional business
/// semantics and is not inferred here. The prepared-context wire preserves this unknown as a null
/// additivity value; a consumer must reject it rather than treating it as additive.
pub fn infer_additivity(expression: &str) -> Option<Additivity> {
    let expression = parse_expression(expression)?;
    match without_parentheses(&expression) {
        Expr::Function(function) if function_is_nonadditive(function) => {
            Some(Additivity::NonAdditive)
        }
        Expr::BinaryOp {
            left,
            op: BinaryOperator::Divide,
            right,
        } if is_aggregate_result(left) && is_aggregate_result(right) => {
            Some(Additivity::NonAdditive)
        }
        _ => None,
    }
}

fn parse_expression(expression: &str) -> Option<Expr> {
    let dialect = GenericDialect {};
    let mut parser = Parser::new(&dialect).try_with_sql(expression).ok()?;
    let expression = parser.parse_expr().ok()?;
    (parser.peek_token().token == Token::EOF).then_some(expression)
}

fn without_parentheses(expression: &Expr) -> &Expr {
    match expression {
        Expr::Nested(inner) => without_parentheses(inner),
        other => other,
    }
}

fn function_is_nonadditive(function: &Function) -> bool {
    let name = function.name.to_string().to_ascii_uppercase();
    matches!(
        name.as_str(),
        "AVG" | "MIN" | "MAX" | "MEDIAN" | "STDDEV" | "VARIANCE"
    ) || (is_aggregate_name(&name) && has_distinct_arguments(&function.args))
}

fn is_aggregate_call(expression: &Expr) -> bool {
    matches!(
        without_parentheses(expression),
        Expr::Function(function) if is_aggregate_name(&function.name.to_string().to_ascii_uppercase())
    )
}

/// `NULLIF(aggregate, fallback)` preserves the aggregate-result shape used by a ratio while
/// avoiding a division-by-zero value. Other scalar wrappers remain unknown: their algebra alone
/// does not establish business-dimensional additivity.
fn is_aggregate_result(expression: &Expr) -> bool {
    let expression = without_parentheses(expression);
    is_aggregate_call(expression)
        || matches!(
            expression,
            Expr::Function(Function { name, args: FunctionArguments::List(arguments), .. })
                if name.to_string().eq_ignore_ascii_case("NULLIF")
                    && matches!(
                        arguments.args.as_slice(),
                        [
                            FunctionArg::Unnamed(FunctionArgExpr::Expr(first)),
                            FunctionArg::Unnamed(FunctionArgExpr::Expr(_)),
                        ] if is_aggregate_call(first)
                    )
        )
}

fn is_aggregate_name(name: &str) -> bool {
    matches!(
        name,
        "SUM" | "COUNT" | "AVG" | "MIN" | "MAX" | "MEDIAN" | "STDDEV" | "VARIANCE"
    )
}

fn has_distinct_arguments(arguments: &FunctionArguments) -> bool {
    matches!(
        arguments,
        FunctionArguments::List(args)
            if args.duplicate_treatment == Some(DuplicateTreatment::Distinct)
    )
}

fn normalize_type(t: &str) -> String {
    // Strip any precision/args, e.g. DECIMAL(10,2) → DECIMAL; VARCHAR(255) → VARCHAR.
    let base = t.split('(').next().unwrap_or(t).trim();
    base.to_uppercase()
}

fn is_temporal_type(t: &str) -> bool {
    let t = normalize_type(t);
    t == "DATE" || t == "DATETIME" || t.starts_with("TIMESTAMP")
}

fn is_numeric_type(t: &str) -> bool {
    matches!(
        normalize_type(t).as_str(),
        "INT"
            | "INTEGER"
            | "BIGINT"
            | "HUGEINT"
            | "UHUGEINT"
            | "UBIGINT"
            | "UINTEGER"
            | "USMALLINT"
            | "UTINYINT"
            | "SMALLINT"
            | "TINYINT"
            | "DECIMAL"
            | "NUMERIC"
            | "DOUBLE"
            | "FLOAT"
            | "REAL"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn additivity_heuristic() {
        assert_eq!(infer_additivity("SUM(amount)"), None);
        assert_eq!(infer_additivity("sum(amount)"), None);
        assert_eq!(infer_additivity("COUNT(*)"), None);
        assert_eq!(
            infer_additivity("COUNT(DISTINCT customer_id)"),
            Some(Additivity::NonAdditive)
        );
        assert_eq!(
            infer_additivity("SUM(DISTINCT amount)"),
            Some(Additivity::NonAdditive)
        );
        assert_eq!(
            infer_additivity("AVG(amount)"),
            Some(Additivity::NonAdditive)
        );
        assert_eq!(
            infer_additivity("MIN(amount)"),
            Some(Additivity::NonAdditive)
        );
        assert_eq!(
            infer_additivity("MAX(amount)"),
            Some(Additivity::NonAdditive)
        );
        // ratio
        assert_eq!(
            infer_additivity("SUM(a) / SUM(b)"),
            Some(Additivity::NonAdditive)
        );
        assert_eq!(
            infer_additivity("SUM(amount) / COUNT(*)"),
            Some(Additivity::NonAdditive)
        );
        assert_eq!(
            infer_additivity("SUM(amount) / NULLIF(COUNT(*), 0)"),
            Some(Additivity::NonAdditive)
        );
        assert_eq!(infer_additivity("SUM(amount) / 2"), None);
        assert_eq!(infer_additivity("SUM(amount) / NULLIF(2, 0)"), None);
        assert_eq!(infer_additivity("SUM(distinct_count)"), None);
        assert_eq!(
            infer_additivity("SUM(CASE WHEN label = 'distinct' THEN amount ELSE 0 END)"),
            None
        );
        assert_eq!(
            infer_additivity("SUM(CASE WHEN path = '/' THEN amount ELSE 0 END)"),
            None
        );
        // Unrecognized functions and bare columns need authored dimensional semantics.
        assert_eq!(infer_additivity("weird(x)"), None);
        assert_eq!(infer_additivity("bare_column"), None);
    }

    #[test]
    fn cubeless_manifest_cannot_answer_metric_additive() {
        use warble::ContextLoader;
        use wren_core_base::mdl::manifest::Manifest;

        // A cube-less manifest: numeric columns make has_metric hold, but no declared measure ⇒
        // additivity is not expressible ⇒ can_answer("metric_additive") is false.
        let json = r#"{
          "catalog":"wren","schema":"public",
          "models":[{"name":"orders","tableReference":{"schema":"main","table":"orders"},
            "columns":[{"name":"amount","type":"DOUBLE"},{"name":"status","type":"TEXT"}]}],
          "relationships":[],"cubes":[],"views":[]
        }"#;
        let manifest: Manifest = serde_json::from_str(json).unwrap();
        let ctx = MdlContext::from_manifest(&manifest);
        assert!(!ctx.metrics().is_empty(), "amount is an implicit metric");
        assert!(
            !ctx.can_answer("metric_additive"),
            "no declared measure ⇒ additivity unanswerable"
        );
        assert!(ctx
            .metrics()
            .iter()
            .all(|m| !m.declared && m.additivity.is_none()));
    }

    #[test]
    fn type_classification() {
        assert!(is_temporal_type("DATE"));
        assert!(is_temporal_type("timestamp"));
        assert!(is_temporal_type("TIMESTAMP WITH TIME ZONE"));
        assert!(!is_temporal_type("TEXT"));
        assert!(is_numeric_type("INT"));
        assert!(is_numeric_type("BIGINT"));
        for numeric in [
            "HUGEINT",
            "UHUGEINT",
            "UBIGINT",
            "UINTEGER",
            "USMALLINT",
            "UTINYINT",
        ] {
            assert!(is_numeric_type(numeric), "{numeric} is numeric in DuckDB");
        }
        assert!(is_numeric_type("DECIMAL(10,2)"));
        assert!(!is_numeric_type("TEXT"));
        assert!(!is_numeric_type("DATE"));
    }

    #[test]
    fn duplicate_declared_measure_names_are_not_resolved_by_cube_order() {
        use warble::ContextLoader;
        use wren_core_base::mdl::manifest::Manifest;

        let manifest: Manifest = serde_json::from_str(
            r#"{
              "catalog":"wren","schema":"public","models":[],"relationships":[],
              "cubes":[
                {"name":"first","baseObject":"orders","measures":[{"name":"shared","expression":"AVG(amount)","type":"DOUBLE"}],"dimensions":[],"timeDimensions":[],"hierarchies":{}},
                {"name":"second","baseObject":"orders","measures":[{"name":"shared","expression":"SUM(amount)","type":"DOUBLE"}],"dimensions":[],"timeDimensions":[],"hierarchies":{}}
              ],"views":[]
            }"#,
        )
        .unwrap();
        let reverse: Manifest = serde_json::from_str(
            r#"{
              "catalog":"wren","schema":"public","models":[],"relationships":[],
              "cubes":[
                {"name":"second","baseObject":"orders","measures":[{"name":"shared","expression":"SUM(amount)","type":"DOUBLE"}],"dimensions":[],"timeDimensions":[],"hierarchies":{}},
                {"name":"first","baseObject":"orders","measures":[{"name":"shared","expression":"AVG(amount)","type":"DOUBLE"}],"dimensions":[],"timeDimensions":[],"hierarchies":{}}
              ],"views":[]
            }"#,
        )
        .unwrap();

        for manifest in [&manifest, &reverse] {
            let ctx = MdlContext::from_manifest(manifest);
            assert_eq!(
                ctx.metric_additivity("shared"),
                None,
                "an unqualified duplicate must not inherit either cube's answer"
            );
            assert!(ctx.can_answer("metric_additive"));
            assert_eq!(
                ctx.metrics().iter().filter(|m| m.name == "shared").count(),
                2
            );
            let prepared = warble::PreparedContext::from_json(
                &crate::prepared_document(&ctx).expect("prepared document"),
            )
            .expect("published context parses");
            assert_eq!(
                prepared.metric_additivity("shared"),
                None,
                "the prepared-context wire must preserve the same conservative ambiguity"
            );
        }
    }
}
