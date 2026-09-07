//! Project a wren [`Manifest`] into Warble's narrow Info types + infer measure additivity.
//!
//! The projection is deliberately **loose for existence, strict for semantics** (the Phase 2
//! predicate-semantics decision): a queryable quantity is either a declared cube measure *or* a
//! plain numeric column (so `has_metric` holds on cube-less projects), but additivity is only
//! expressible for a declared measure — an implicit column carries `additivity: None`, which is
//! what makes `metric_additive` unanswerable (a `can_answer=false` loud-fail) rather than silently
//! `false`.

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

        // Declared cube members: measures are metrics (additivity determinable); cube dimensions
        // and time-dimensions are dimensions.
        for cube in &manifest.cubes {
            for measure in &cube.measures {
                metrics.push(MetricInfo {
                    name: measure.name.clone(),
                    owner: cube.name.clone(),
                    declared: true,
                    additivity: Some(infer_additivity(&measure.expression)),
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
    fn lineage_diagnostics(&self) -> &[String] {
        &self.lineage_diagnostics
    }
}

/// Classify a measure's additivity from the leading aggregation of its expression.
///
/// Additive (delta attributes cleanly to per-dimension contributions that sum to the whole):
/// `SUM`, non-distinct `COUNT`. Everything else — `AVG`/`MIN`/`MAX`/`MEDIAN`/`STDDEV`/`VARIANCE`,
/// any `DISTINCT`, and any ratio (`/`) — is non-additive: decomposing it along dimensions can
/// mislead. Unrecognized aggregations are treated as non-additive (conservative: never green-light
/// a decomposition we cannot vouch for). `SemiAdditive` is not produced here — it needs
/// knowledge-layer input (a later vocabulary batch).
pub fn infer_additivity(expression: &str) -> Additivity {
    let upper = expression.to_uppercase();
    if upper.contains("DISTINCT") || upper.contains('/') {
        return Additivity::NonAdditive;
    }
    match leading_function(&upper).as_deref() {
        Some("SUM") | Some("COUNT") => Additivity::Additive,
        _ => Additivity::NonAdditive,
    }
}

/// The leading function name of an expression, e.g. `"SUM(amount)"` → `Some("SUM")`. Returns `None`
/// when the expression is not a `fn(...)` call (a bare column reference).
fn leading_function(upper_expr: &str) -> Option<String> {
    let open = upper_expr.find('(')?;
    let name = upper_expr[..open].trim();
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return None;
    }
    Some(name.to_string())
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
        assert_eq!(infer_additivity("SUM(amount)"), Additivity::Additive);
        assert_eq!(infer_additivity("sum(amount)"), Additivity::Additive);
        assert_eq!(infer_additivity("COUNT(*)"), Additivity::Additive);
        assert_eq!(
            infer_additivity("COUNT(DISTINCT customer_id)"),
            Additivity::NonAdditive
        );
        assert_eq!(infer_additivity("AVG(amount)"), Additivity::NonAdditive);
        assert_eq!(infer_additivity("MIN(amount)"), Additivity::NonAdditive);
        assert_eq!(infer_additivity("MAX(amount)"), Additivity::NonAdditive);
        // ratio
        assert_eq!(infer_additivity("SUM(a) / SUM(b)"), Additivity::NonAdditive);
        // unrecognized → conservative non-additive
        assert_eq!(infer_additivity("weird(x)"), Additivity::NonAdditive);
        assert_eq!(infer_additivity("bare_column"), Additivity::NonAdditive);
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
        assert!(is_numeric_type("DECIMAL(10,2)"));
        assert!(!is_numeric_type("TEXT"));
        assert!(!is_numeric_type("DATE"));
    }
}
