//! SQL generation from `CubeQuery` to plain `SELECT … GROUP BY` SQL.
//!
//! This is a Rust port of `wren-engine-saas` `ibis-server/app/mdl/cube.py`.
//! Output strings should match the Python implementation 1:1 so existing
//! integration tests can be re-used.

use std::collections::HashMap;

use datafusion::common::{plan_err, Result};
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::mdl::manifest::{Cube, CubeDimension, Manifest, Measure, TimeDimension};

/// A structured cube query — the input to [`cube_query_to_sql`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CubeQuery {
    pub cube: String,
    pub measures: Vec<String>,
    #[serde(default)]
    pub dimensions: Vec<String>,
    #[serde(default)]
    pub time_dimensions: Vec<TimeDimensionFilter>,
    #[serde(default)]
    pub filters: Vec<CubeFilter>,
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub offset: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeDimensionFilter {
    pub dimension: String,
    pub granularity: Granularity,
    #[serde(default, deserialize_with = "deserialize_date_range")]
    pub date_range: Option<(String, String)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Granularity {
    Year,
    Quarter,
    Month,
    Week,
    Day,
    Hour,
    Minute,
}

impl std::fmt::Display for Granularity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            Granularity::Year => "year",
            Granularity::Quarter => "quarter",
            Granularity::Month => "month",
            Granularity::Week => "week",
            Granularity::Day => "day",
            Granularity::Hour => "hour",
            Granularity::Minute => "minute",
        };
        f.write_str(s)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CubeFilter {
    pub dimension: String,
    pub operator: FilterOperator,
    #[serde(default)]
    pub value: Option<FilterValue>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterOperator {
    Eq,
    Neq,
    In,
    NotIn,
    Gt,
    Gte,
    Lt,
    Lte,
    Contains,
    StartsWith,
    IsNull,
    IsNotNull,
}

/// A JSON-typed filter value. Mirrors the Pydantic `Any | None` shape in saas.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FilterValue {
    Bool(bool),
    Number(f64),
    String(String),
    List(Vec<FilterValue>),
}

fn deserialize_date_range<'de, D>(
    deserializer: D,
) -> std::result::Result<Option<(String, String)>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let opt: Option<Vec<String>> = Option::deserialize(deserializer)?;
    match opt {
        None => Ok(None),
        Some(v) if v.len() == 2 => Ok(Some((v[0].clone(), v[1].clone()))),
        Some(v) => Err(serde::de::Error::custom(format!(
            "dateRange must have exactly 2 elements, got {}",
            v.len()
        ))),
    }
}

/// Translate a [`CubeQuery`] into a SQL string.
///
/// The generated SQL references the cube's `base_object` by name so that
/// wren-core MDL analysis can resolve the underlying model or view.
pub fn cube_query_to_sql(query: &CubeQuery, manifest: &Manifest) -> Result<String> {
    let cube = find_cube(&query.cube, manifest)?;

    let measure_map: HashMap<&str, &Measure> = cube
        .measures
        .iter()
        .map(|m| (m.name.as_str(), m.as_ref()))
        .collect();
    let dimension_map: HashMap<&str, &CubeDimension> = cube
        .dimensions
        .iter()
        .map(|d| (d.name.as_str(), d.as_ref()))
        .collect();
    let time_dim_map: HashMap<&str, &TimeDimension> = cube
        .time_dimensions
        .iter()
        .map(|td| (td.name.as_str(), td.as_ref()))
        .collect();

    validate_query(query, &measure_map, &dimension_map, &time_dim_map)?;
    let resolved_exprs = resolve_measures(&measure_map)?;

    build_sql(query, cube, &resolved_exprs, &dimension_map, &time_dim_map)
}

fn find_cube<'a>(cube_name: &str, manifest: &'a Manifest) -> Result<&'a Cube> {
    if let Some(c) = manifest.cubes.iter().find(|c| c.name == cube_name) {
        return Ok(c.as_ref());
    }
    let known: Vec<&str> = manifest.cubes.iter().map(|c| c.name.as_str()).collect();
    plan_err!(
        "Cube '{}' not found in manifest. Known cubes: [{}]",
        cube_name,
        known.join(", ")
    )
}

fn validate_query(
    query: &CubeQuery,
    measure_map: &HashMap<&str, &Measure>,
    dimension_map: &HashMap<&str, &CubeDimension>,
    time_dim_map: &HashMap<&str, &TimeDimension>,
) -> Result<()> {
    for name in &query.measures {
        if !measure_map.contains_key(name.as_str()) {
            return plan_err!("Unknown measure '{}' in cube '{}'", name, query.cube);
        }
    }
    for name in &query.dimensions {
        if !dimension_map.contains_key(name.as_str())
            && !time_dim_map.contains_key(name.as_str())
        {
            return plan_err!("Unknown dimension '{}' in cube '{}'", name, query.cube);
        }
    }
    for td_filter in &query.time_dimensions {
        if !time_dim_map.contains_key(td_filter.dimension.as_str()) {
            return plan_err!(
                "Unknown time dimension '{}' in cube '{}'",
                td_filter.dimension,
                query.cube
            );
        }
    }
    for f in &query.filters {
        if !dimension_map.contains_key(f.dimension.as_str())
            && !time_dim_map.contains_key(f.dimension.as_str())
        {
            return plan_err!(
                "Unknown filter dimension '{}' in cube '{}'",
                f.dimension,
                query.cube
            );
        }
    }
    Ok(())
}

/// Inline derived measure expressions by substituting referenced measure names.
///
/// Longer dependency names are substituted first to avoid partial-token
/// replacement (e.g. `revenue_2` before `revenue`).
fn resolve_measures(
    measure_map: &HashMap<&str, &Measure>,
) -> Result<HashMap<String, String>> {
    let mut resolved: HashMap<String, String> = HashMap::new();
    let mut remaining: Vec<&str> = measure_map.keys().copied().collect();

    while !remaining.is_empty() {
        let mut progressed = false;
        let mut next_remaining: Vec<&str> = Vec::new();

        for &name in &remaining {
            let expr = &measure_map[name].expression;
            let deps = find_measure_refs(expr, measure_map, name);

            if deps.iter().all(|dep| resolved.contains_key(*dep)) {
                let mut resolved_expr = expr.clone();
                let mut sorted_deps = deps.clone();
                sorted_deps.sort_by_key(|d| std::cmp::Reverse(d.len()));
                for dep in sorted_deps {
                    let pattern = format!(r"\b{}\b", regex::escape(dep));
                    let re = Regex::new(&pattern).map_err(|e| {
                        datafusion::common::DataFusionError::Plan(format!(
                            "invalid regex for measure '{dep}': {e}"
                        ))
                    })?;
                    let replacement = format!("({})", &resolved[dep]);
                    resolved_expr = re
                        .replace_all(&resolved_expr, replacement.as_str())
                        .into_owned();
                }
                resolved.insert(name.to_string(), resolved_expr);
                progressed = true;
            } else {
                next_remaining.push(name);
            }
        }

        remaining = next_remaining;
        if !progressed && !remaining.is_empty() {
            return plan_err!(
                "Cannot resolve measure dependencies — possible cycle: {:?}",
                remaining
            );
        }
    }

    Ok(resolved)
}

fn find_measure_refs<'a>(
    expr: &str,
    measure_map: &HashMap<&'a str, &Measure>,
    self_name: &str,
) -> Vec<&'a str> {
    measure_map
        .keys()
        .filter(|&&name| name != self_name)
        .filter(|&&name| {
            let pattern = format!(r"\b{}\b", regex::escape(name));
            Regex::new(&pattern)
                .map(|re| re.is_match(expr))
                .unwrap_or(false)
        })
        .copied()
        .collect()
}

fn build_sql(
    query: &CubeQuery,
    cube: &Cube,
    resolved_exprs: &HashMap<String, String>,
    dimension_map: &HashMap<&str, &CubeDimension>,
    time_dim_map: &HashMap<&str, &TimeDimension>,
) -> Result<String> {
    let mut select_parts: Vec<String> = Vec::new();
    let mut group_ordinals: Vec<String> = Vec::new();
    let mut order_ordinals: Vec<String> = Vec::new();
    let mut pos: usize = 1;

    // 1. Time dimensions (appear first; drive ORDER BY)
    for td_filter in &query.time_dimensions {
        let td = time_dim_map[td_filter.dimension.as_str()];
        let alias = format!("{}__{}", td_filter.dimension, td_filter.granularity);
        let expr = format!("DATE_TRUNC('{}', {})", td_filter.granularity, td.expression);
        select_parts.push(format!("{expr} AS {alias}"));
        group_ordinals.push(pos.to_string());
        if order_ordinals.is_empty() {
            order_ordinals.push(pos.to_string());
        }
        pos += 1;
    }

    // 2. Regular dimensions (may include time dimension names — check both maps)
    for dim_name in &query.dimensions {
        let expr = resolve_dim_expr(dim_name, dimension_map, time_dim_map);
        select_parts.push(format!("{expr} AS {dim_name}"));
        group_ordinals.push(pos.to_string());
        pos += 1;
    }

    // 3. Measures (not grouped)
    for measure_name in &query.measures {
        let expr = &resolved_exprs[measure_name];
        select_parts.push(format!("{expr} AS {measure_name}"));
    }

    let mut sql = format!(
        "SELECT {} FROM {}",
        select_parts.join(", "),
        cube.base_object
    );

    // 4. WHERE: date-range predicates + dimension filters
    let mut where_parts: Vec<String> = Vec::new();
    for td_filter in &query.time_dimensions {
        if let Some((start, end)) = &td_filter.date_range {
            let col = &time_dim_map[td_filter.dimension.as_str()].expression;
            where_parts.push(format!("{col} >= '{start}'"));
            where_parts.push(format!("{col} < '{end}'"));
        }
    }
    for f in &query.filters {
        let col_expr = resolve_dim_expr(&f.dimension, dimension_map, time_dim_map);
        where_parts.push(filter_to_sql(f, &col_expr)?);
    }
    if !where_parts.is_empty() {
        sql.push_str(&format!(" WHERE {}", where_parts.join(" AND ")));
    }

    // 5. GROUP BY / ORDER BY
    if !group_ordinals.is_empty() {
        sql.push_str(&format!(" GROUP BY {}", group_ordinals.join(", ")));
    }
    if !order_ordinals.is_empty() {
        sql.push_str(&format!(" ORDER BY {}", order_ordinals.join(", ")));
    }

    // 6. LIMIT / OFFSET
    if let Some(limit) = query.limit {
        sql.push_str(&format!(" LIMIT {limit}"));
    }
    if let Some(offset) = query.offset {
        sql.push_str(&format!(" OFFSET {offset}"));
    }

    Ok(sql)
}

fn resolve_dim_expr(
    dim_name: &str,
    dimension_map: &HashMap<&str, &CubeDimension>,
    time_dim_map: &HashMap<&str, &TimeDimension>,
) -> String {
    if let Some(dim) = dimension_map.get(dim_name) {
        dim.expression.clone()
    } else {
        time_dim_map[dim_name].expression.clone()
    }
}

fn filter_to_sql(f: &CubeFilter, col_expr: &str) -> Result<String> {
    match f.operator {
        FilterOperator::IsNull => Ok(format!("{col_expr} IS NULL")),
        FilterOperator::IsNotNull => Ok(format!("{col_expr} IS NOT NULL")),
        FilterOperator::Eq => Ok(format!("{col_expr} = {}", quote_value(&f.value))),
        FilterOperator::Neq => Ok(format!("{col_expr} <> {}", quote_value(&f.value))),
        FilterOperator::Gt => Ok(format!("{col_expr} > {}", quote_value(&f.value))),
        FilterOperator::Gte => Ok(format!("{col_expr} >= {}", quote_value(&f.value))),
        FilterOperator::Lt => Ok(format!("{col_expr} < {}", quote_value(&f.value))),
        FilterOperator::Lte => Ok(format!("{col_expr} <= {}", quote_value(&f.value))),
        FilterOperator::In => match &f.value {
            Some(FilterValue::List(items)) => {
                let vals: Vec<String> = items
                    .iter()
                    .map(|v| quote_value(&Some(v.clone())))
                    .collect();
                Ok(format!("{col_expr} IN ({})", vals.join(", ")))
            }
            _ => plan_err!("IN filter requires a list value"),
        },
        FilterOperator::NotIn => match &f.value {
            Some(FilterValue::List(items)) => {
                let vals: Vec<String> = items
                    .iter()
                    .map(|v| quote_value(&Some(v.clone())))
                    .collect();
                Ok(format!("{col_expr} NOT IN ({})", vals.join(", ")))
            }
            _ => plan_err!("NOT IN filter requires a list value"),
        },
        FilterOperator::Contains => {
            let raw = raw_string_value(&f.value)?;
            let quoted = quote_string(&format!("%{raw}%"));
            Ok(format!("{col_expr} LIKE {quoted}"))
        }
        FilterOperator::StartsWith => {
            let raw = raw_string_value(&f.value)?;
            let quoted = quote_string(&format!("{raw}%"));
            Ok(format!("{col_expr} LIKE {quoted}"))
        }
    }
}

/// Render a filter value as a SQL literal, matching saas `_quote_value`.
pub fn quote_value(val: &Option<FilterValue>) -> String {
    match val {
        None => "NULL".to_string(),
        Some(FilterValue::Bool(true)) => "TRUE".to_string(),
        Some(FilterValue::Bool(false)) => "FALSE".to_string(),
        Some(FilterValue::Number(n)) => format_number(*n),
        Some(FilterValue::String(s)) => quote_string(s),
        // Nested lists fall back to a SQL NULL — saas would str() the list
        // here, which produces broken SQL anyway. Returning NULL matches the
        // "unsupported" semantics without leaking Python repr into SQL.
        Some(FilterValue::List(_)) => "NULL".to_string(),
    }
}

fn quote_string(s: &str) -> String {
    let escaped = s.replace('\'', "''");
    format!("'{escaped}'")
}

/// Format a number the way Python's `str(int|float)` would for whole-number
/// floats: `42.0` → `"42"`, `3.14` → `"3.14"`.
fn format_number(n: f64) -> String {
    if n.is_finite() && n.fract() == 0.0 && n.abs() < 1e16 {
        format!("{}", n as i64)
    } else {
        n.to_string()
    }
}

fn raw_string_value(val: &Option<FilterValue>) -> Result<String> {
    match val {
        Some(FilterValue::String(s)) => Ok(s.clone()),
        Some(FilterValue::Number(n)) => Ok(format_number(*n)),
        Some(FilterValue::Bool(true)) => Ok("True".to_string()),
        Some(FilterValue::Bool(false)) => Ok("False".to_string()),
        _ => plan_err!("Expected scalar value for LIKE filter"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mdl::builder::{
        ColumnBuilder, CubeBuilder, CubeDimensionBuilder, ManifestBuilder,
        MeasureBuilder, ModelBuilder, TimeDimensionBuilder,
    };

    fn orders_manifest() -> Manifest {
        ManifestBuilder::new()
            .model(
                ModelBuilder::new("orders")
                    .table_reference("orders")
                    .column(ColumnBuilder::new("amount", "double").build())
                    .column(ColumnBuilder::new("status", "varchar").build())
                    .column(ColumnBuilder::new("created_at", "timestamp").build())
                    .build(),
            )
            .cube(
                CubeBuilder::new("OrdersCube", "orders")
                    .measure(
                        MeasureBuilder::new("revenue", "SUM(amount)", "number").build(),
                    )
                    .measure(
                        MeasureBuilder::new("order_count", "COUNT(*)", "number").build(),
                    )
                    .measure(
                        MeasureBuilder::new(
                            "avg_order_value",
                            "revenue / order_count",
                            "number",
                        )
                        .build(),
                    )
                    .dimension(
                        CubeDimensionBuilder::new("status", "status", "string").build(),
                    )
                    .dimension(
                        CubeDimensionBuilder::new(
                            "customer_country",
                            "customer.country",
                            "string",
                        )
                        .build(),
                    )
                    .time_dimension(
                        TimeDimensionBuilder::new(
                            "created_at",
                            "created_at",
                            "timestamp",
                        )
                        .build(),
                    )
                    .build(),
            )
            .build()
    }

    fn query(cube: &str) -> CubeQuery {
        CubeQuery {
            cube: cube.to_string(),
            measures: vec![],
            dimensions: vec![],
            time_dimensions: vec![],
            filters: vec![],
            limit: None,
            offset: None,
        }
    }

    fn s(v: &str) -> Option<FilterValue> {
        Some(FilterValue::String(v.to_string()))
    }

    fn n(v: f64) -> Option<FilterValue> {
        Some(FilterValue::Number(v))
    }

    fn list(items: Vec<FilterValue>) -> Option<FilterValue> {
        Some(FilterValue::List(items))
    }

    // ── SELECT / FROM ────────────────────────────────────────────────────────

    #[test]
    fn test_measures_only() {
        let mut q = query("OrdersCube");
        q.measures = vec!["revenue".to_string(), "order_count".to_string()];
        let sql = cube_query_to_sql(&q, &orders_manifest()).unwrap();
        assert_eq!(
            sql,
            "SELECT SUM(amount) AS revenue, COUNT(*) AS order_count FROM orders"
        );
    }

    #[test]
    fn test_measures_and_dimensions() {
        let mut q = query("OrdersCube");
        q.measures = vec!["revenue".to_string()];
        q.dimensions = vec!["status".to_string()];
        let sql = cube_query_to_sql(&q, &orders_manifest()).unwrap();
        assert_eq!(
            sql,
            "SELECT status AS status, SUM(amount) AS revenue FROM orders GROUP BY 1"
        );
    }

    #[test]
    fn test_dimension_expression_used_not_name() {
        let mut q = query("OrdersCube");
        q.measures = vec!["revenue".to_string()];
        q.dimensions = vec!["customer_country".to_string()];
        let sql = cube_query_to_sql(&q, &orders_manifest()).unwrap();
        assert!(
            sql.contains("customer.country AS customer_country"),
            "sql={sql}"
        );
    }

    // ── TIME DIMENSIONS ──────────────────────────────────────────────────────

    #[test]
    fn test_time_dimension_date_trunc() {
        let mut q = query("OrdersCube");
        q.measures = vec!["revenue".to_string()];
        q.time_dimensions = vec![TimeDimensionFilter {
            dimension: "created_at".to_string(),
            granularity: Granularity::Month,
            date_range: None,
        }];
        let sql = cube_query_to_sql(&q, &orders_manifest()).unwrap();
        assert!(
            sql.contains("DATE_TRUNC('month', created_at) AS created_at__month"),
            "sql={sql}"
        );
        assert!(sql.contains("GROUP BY 1"), "sql={sql}");
        assert!(sql.contains("ORDER BY 1"), "sql={sql}");
    }

    #[test]
    fn test_time_dimension_with_date_range() {
        let mut q = query("OrdersCube");
        q.measures = vec!["revenue".to_string()];
        q.time_dimensions = vec![TimeDimensionFilter {
            dimension: "created_at".to_string(),
            granularity: Granularity::Month,
            date_range: Some(("2024-01-01".to_string(), "2025-01-01".to_string())),
        }];
        let sql = cube_query_to_sql(&q, &orders_manifest()).unwrap();
        assert!(sql.contains("created_at >= '2024-01-01'"), "sql={sql}");
        assert!(sql.contains("created_at < '2025-01-01'"), "sql={sql}");
    }

    #[test]
    fn test_time_dimension_without_date_range_no_where() {
        let mut q = query("OrdersCube");
        q.measures = vec!["revenue".to_string()];
        q.time_dimensions = vec![TimeDimensionFilter {
            dimension: "created_at".to_string(),
            granularity: Granularity::Day,
            date_range: None,
        }];
        let sql = cube_query_to_sql(&q, &orders_manifest()).unwrap();
        assert!(!sql.contains("WHERE"), "sql={sql}");
    }

    #[test]
    fn test_select_order_time_dims_first() {
        let mut q = query("OrdersCube");
        q.measures = vec!["revenue".to_string()];
        q.dimensions = vec!["status".to_string()];
        q.time_dimensions = vec![TimeDimensionFilter {
            dimension: "created_at".to_string(),
            granularity: Granularity::Month,
            date_range: None,
        }];
        let sql = cube_query_to_sql(&q, &orders_manifest()).unwrap();
        let td_idx = sql.find("created_at__month").expect("time dim missing");
        let dim_idx = sql.find("status AS status").expect("dim missing");
        assert!(td_idx < dim_idx, "sql={sql}");
    }

    // ── DERIVED MEASURES ─────────────────────────────────────────────────────

    #[test]
    fn test_derived_measure_inlined() {
        let mut q = query("OrdersCube");
        q.measures = vec!["avg_order_value".to_string()];
        let sql = cube_query_to_sql(&q, &orders_manifest()).unwrap();
        assert!(sql.contains("(SUM(amount))"), "sql={sql}");
        assert!(sql.contains("(COUNT(*))"), "sql={sql}");
        assert!(sql.contains("AS avg_order_value"), "sql={sql}");
    }

    #[test]
    fn test_derived_measure_alongside_base() {
        let mut q = query("OrdersCube");
        q.measures = vec!["revenue".to_string(), "avg_order_value".to_string()];
        let sql = cube_query_to_sql(&q, &orders_manifest()).unwrap();
        assert!(sql.contains("SUM(amount) AS revenue"), "sql={sql}");
        assert!(sql.contains("AS avg_order_value"), "sql={sql}");
    }

    // ── FILTERS ──────────────────────────────────────────────────────────────

    fn filter(dim: &str, op: FilterOperator, value: Option<FilterValue>) -> CubeFilter {
        CubeFilter {
            dimension: dim.to_string(),
            operator: op,
            value,
        }
    }

    #[test]
    fn test_filter_eq() {
        let mut q = query("OrdersCube");
        q.measures = vec!["revenue".to_string()];
        q.filters = vec![filter("status", FilterOperator::Eq, s("completed"))];
        let sql = cube_query_to_sql(&q, &orders_manifest()).unwrap();
        assert!(sql.contains("WHERE status = 'completed'"), "sql={sql}");
    }

    #[test]
    fn test_filter_neq() {
        let mut q = query("OrdersCube");
        q.measures = vec!["revenue".to_string()];
        q.filters = vec![filter("status", FilterOperator::Neq, s("cancelled"))];
        let sql = cube_query_to_sql(&q, &orders_manifest()).unwrap();
        assert!(sql.contains("status <> 'cancelled'"), "sql={sql}");
    }

    #[test]
    fn test_filter_in() {
        let mut q = query("OrdersCube");
        q.measures = vec!["revenue".to_string()];
        q.filters = vec![filter(
            "status",
            FilterOperator::In,
            list(vec![
                FilterValue::String("a".to_string()),
                FilterValue::String("b".to_string()),
            ]),
        )];
        let sql = cube_query_to_sql(&q, &orders_manifest()).unwrap();
        assert!(sql.contains("status IN ('a', 'b')"), "sql={sql}");
    }

    #[test]
    fn test_filter_not_in() {
        let mut q = query("OrdersCube");
        q.measures = vec!["revenue".to_string()];
        q.filters = vec![filter(
            "status",
            FilterOperator::NotIn,
            list(vec![FilterValue::String("x".to_string())]),
        )];
        let sql = cube_query_to_sql(&q, &orders_manifest()).unwrap();
        assert!(sql.contains("status NOT IN ('x')"), "sql={sql}");
    }

    #[test]
    fn test_filter_is_null() {
        let mut q = query("OrdersCube");
        q.measures = vec!["revenue".to_string()];
        q.filters = vec![filter("status", FilterOperator::IsNull, None)];
        let sql = cube_query_to_sql(&q, &orders_manifest()).unwrap();
        assert!(sql.contains("status IS NULL"), "sql={sql}");
    }

    #[test]
    fn test_filter_is_not_null() {
        let mut q = query("OrdersCube");
        q.measures = vec!["revenue".to_string()];
        q.filters = vec![filter("status", FilterOperator::IsNotNull, None)];
        let sql = cube_query_to_sql(&q, &orders_manifest()).unwrap();
        assert!(sql.contains("status IS NOT NULL"), "sql={sql}");
    }

    #[test]
    fn test_filter_contains() {
        let mut q = query("OrdersCube");
        q.measures = vec!["revenue".to_string()];
        q.filters = vec![filter("status", FilterOperator::Contains, s("comp"))];
        let sql = cube_query_to_sql(&q, &orders_manifest()).unwrap();
        assert!(sql.contains("status LIKE '%comp%'"), "sql={sql}");
    }

    #[test]
    fn test_filter_starts_with() {
        let mut q = query("OrdersCube");
        q.measures = vec!["revenue".to_string()];
        q.filters = vec![filter("status", FilterOperator::StartsWith, s("comp"))];
        let sql = cube_query_to_sql(&q, &orders_manifest()).unwrap();
        assert!(sql.contains("status LIKE 'comp%'"), "sql={sql}");
    }

    #[test]
    fn test_filter_numeric_value() {
        let mut q = query("OrdersCube");
        q.measures = vec!["revenue".to_string()];
        q.filters = vec![filter("status", FilterOperator::Gt, n(100.0))];
        let sql = cube_query_to_sql(&q, &orders_manifest()).unwrap();
        assert!(sql.contains("status > 100"), "sql={sql}");
    }

    #[test]
    fn test_filter_uses_dimension_expression() {
        let mut q = query("OrdersCube");
        q.measures = vec!["revenue".to_string()];
        q.filters = vec![filter("customer_country", FilterOperator::Eq, s("US"))];
        let sql = cube_query_to_sql(&q, &orders_manifest()).unwrap();
        assert!(sql.contains("customer.country = 'US'"), "sql={sql}");
    }

    #[test]
    fn test_multiple_filters_joined_with_and() {
        let mut q = query("OrdersCube");
        q.measures = vec!["revenue".to_string()];
        q.filters = vec![
            filter("status", FilterOperator::Eq, s("completed")),
            filter("status", FilterOperator::Neq, s("cancelled")),
        ];
        let sql = cube_query_to_sql(&q, &orders_manifest()).unwrap();
        assert!(sql.contains(" AND "), "sql={sql}");
    }

    // ── TIME DIMENSION NAME IN dto.dimensions ────────────────────────────────

    #[test]
    fn test_time_dim_name_in_dimensions_no_keyerror() {
        let mut q = query("OrdersCube");
        q.measures = vec!["revenue".to_string()];
        q.dimensions = vec!["created_at".to_string()];
        let sql = cube_query_to_sql(&q, &orders_manifest()).unwrap();
        assert!(sql.contains("created_at AS created_at"), "sql={sql}");
        assert!(sql.contains("GROUP BY 1"), "sql={sql}");
    }

    // ── LIMIT / OFFSET ───────────────────────────────────────────────────────

    #[test]
    fn test_limit() {
        let mut q = query("OrdersCube");
        q.measures = vec!["revenue".to_string()];
        q.limit = Some(50);
        let sql = cube_query_to_sql(&q, &orders_manifest()).unwrap();
        assert!(sql.ends_with("LIMIT 50"), "sql={sql}");
    }

    #[test]
    fn test_offset() {
        let mut q = query("OrdersCube");
        q.measures = vec!["revenue".to_string()];
        q.limit = Some(10);
        q.offset = Some(20);
        let sql = cube_query_to_sql(&q, &orders_manifest()).unwrap();
        assert!(sql.contains("LIMIT 10 OFFSET 20"), "sql={sql}");
    }

    // ── VALIDATION ERRORS ────────────────────────────────────────────────────

    #[test]
    fn test_unknown_cube() {
        let mut q = query("NoSuchCube");
        q.measures = vec!["revenue".to_string()];
        let err = cube_query_to_sql(&q, &orders_manifest()).unwrap_err();
        assert!(err.to_string().contains("not found"), "err={err}");
    }

    #[test]
    fn test_unknown_measure() {
        let mut q = query("OrdersCube");
        q.measures = vec!["no_such_measure".to_string()];
        let err = cube_query_to_sql(&q, &orders_manifest()).unwrap_err();
        assert!(err.to_string().contains("Unknown measure"), "err={err}");
    }

    #[test]
    fn test_unknown_dimension() {
        let mut q = query("OrdersCube");
        q.measures = vec!["revenue".to_string()];
        q.dimensions = vec!["no_dim".to_string()];
        let err = cube_query_to_sql(&q, &orders_manifest()).unwrap_err();
        assert!(err.to_string().contains("Unknown dimension"), "err={err}");
    }

    #[test]
    fn test_unknown_time_dimension() {
        let mut q = query("OrdersCube");
        q.measures = vec!["revenue".to_string()];
        q.time_dimensions = vec![TimeDimensionFilter {
            dimension: "no_td".to_string(),
            granularity: Granularity::Day,
            date_range: None,
        }];
        let err = cube_query_to_sql(&q, &orders_manifest()).unwrap_err();
        assert!(
            err.to_string().contains("Unknown time dimension"),
            "err={err}"
        );
    }

    #[test]
    fn test_unknown_filter_dimension() {
        let mut q = query("OrdersCube");
        q.measures = vec!["revenue".to_string()];
        q.filters = vec![filter("ghost", FilterOperator::Eq, s("x"))];
        let err = cube_query_to_sql(&q, &orders_manifest()).unwrap_err();
        assert!(
            err.to_string().contains("Unknown filter dimension"),
            "err={err}"
        );
    }

    // ── quote_value ──────────────────────────────────────────────────────────

    #[test]
    fn test_quote_value() {
        assert_eq!(quote_value(&s("hello")), "'hello'");
        assert_eq!(quote_value(&s("it's")), "'it''s'");
        assert_eq!(quote_value(&n(42.0)), "42");
        assert_eq!(quote_value(&n(2.5)), "2.5");
        assert_eq!(quote_value(&Some(FilterValue::Bool(true))), "TRUE");
        assert_eq!(quote_value(&Some(FilterValue::Bool(false))), "FALSE");
        assert_eq!(quote_value(&None), "NULL");
    }

    // ── JSON deserialization ─────────────────────────────────────────────────

    #[test]
    fn test_deserialize_camel_case() {
        let json = r#"{
            "cube": "OrdersCube",
            "measures": ["revenue"],
            "timeDimensions": [{
                "dimension": "created_at",
                "granularity": "month",
                "dateRange": ["2024-01-01", "2024-12-31"]
            }]
        }"#;
        let q: CubeQuery = serde_json::from_str(json).unwrap();
        assert_eq!(q.cube, "OrdersCube");
        assert_eq!(q.measures, vec!["revenue"]);
        assert_eq!(q.time_dimensions.len(), 1);
        assert_eq!(q.time_dimensions[0].granularity, Granularity::Month);
        assert_eq!(
            q.time_dimensions[0].date_range,
            Some(("2024-01-01".to_string(), "2024-12-31".to_string()))
        );
    }

    #[test]
    fn test_deserialize_date_range_wrong_length_fails() {
        let json = r#"{
            "cube": "x",
            "measures": ["m"],
            "timeDimensions": [{
                "dimension": "d",
                "granularity": "day",
                "dateRange": ["only-one"]
            }]
        }"#;
        let err = serde_json::from_str::<CubeQuery>(json).unwrap_err();
        assert!(err.to_string().contains("exactly 2 elements"), "err={err}");
    }
}
