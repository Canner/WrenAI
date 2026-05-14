use crate::logical_plan::analyze::access_control::validate_clac_rule;
use crate::logical_plan::error::WrenError;
use crate::logical_plan::utils::{from_qualified_name_str, try_map_data_type};
use crate::mdl::builder::ManifestBuilder;
use crate::mdl::context::{apply_wren_on_ctx, Mode, WrenDataSource};
use crate::mdl::dialect::inner_dialect::get_inner_dialect;
use crate::mdl::function::{
    ByPassAggregateUDF, ByPassScalarUDF, ByPassWindowFunction, FunctionType,
    RemoteFunction,
};
use crate::mdl::manifest::{Column, Manifest, Model, View};
use crate::mdl::utils::{dequote_identifier, quoted, to_field};
use crate::DataFusionError;
use context::SessionPropertiesRef;
use datafusion::arrow::datatypes::Field;
use datafusion::common::{internal_datafusion_err, plan_err};
use datafusion::datasource::TableProvider;
use datafusion::error::Result;
use datafusion::execution::context::SessionState;
use datafusion::execution::{SessionStateBuilder, SessionStateDefaults};
use datafusion::logical_expr::{AggregateUDF, ScalarUDF, WindowUDF};
use datafusion::prelude::{SessionConfig, SessionContext};
use datafusion::sql::parser::DFParser;
use datafusion::sql::sqlparser::ast::{Expr, ExprWithAlias, Ident};
use datafusion::sql::sqlparser::dialect::dialect_from_str;
use datafusion::sql::unparser::Unparser;
use datafusion::sql::TableReference;
pub use dataset::Dataset;
use dialect::WrenDialect;
use log::{debug, info, warn};
use manifest::Relationship;
use parking_lot::RwLock;
use std::hash::Hash;
use std::{collections::HashMap, sync::Arc};
use wren_core_base::mdl::DataSource;

pub mod builder {
    pub use wren_core_base::mdl::builder::*;
}
pub mod context;
pub(crate) mod cube;
pub use cube::{cube_query_to_sql, CubeQuery};
pub(crate) mod dataset;
mod dialect;
pub mod function;
pub mod lineage;
pub mod manifest {
    pub use wren_core_base::mdl::manifest::*;
}
pub mod type_planner;
pub mod utils;

pub type SessionStateRef = Arc<RwLock<SessionState>>;

pub struct AnalyzedWrenMDL {
    pub wren_mdl: Arc<WrenMDL>,
    pub lineage: Arc<lineage::Lineage>,
}

impl Hash for AnalyzedWrenMDL {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.wren_mdl.hash(state);
    }
}

impl Default for AnalyzedWrenMDL {
    fn default() -> Self {
        let manifest = ManifestBuilder::default().build();
        let wren_mdl = WrenMDL::new(manifest);
        let lineage = lineage::Lineage::new(&wren_mdl).unwrap();
        AnalyzedWrenMDL {
            wren_mdl: Arc::new(wren_mdl),
            lineage: Arc::new(lineage),
        }
    }
}

impl AnalyzedWrenMDL {
    pub fn analyze(
        manifest: Manifest,
        properties: SessionPropertiesRef,
        mode: Mode,
    ) -> Result<Self> {
        let wren_mdl = Arc::new(WrenMDL::infer_and_register_remote_table(
            manifest, properties, mode,
        )?);
        lineage::validate_cubes(&wren_mdl)?;
        let lineage = Arc::new(lineage::Lineage::new(&wren_mdl)?);
        Ok(AnalyzedWrenMDL { wren_mdl, lineage })
    }

    pub fn analyze_with_tables(
        manifest: Manifest,
        register_tables: HashMap<String, Arc<dyn TableProvider>>,
    ) -> Result<Self> {
        let mut wren_mdl = WrenMDL::new(manifest);
        for (name, table) in register_tables {
            wren_mdl.register_table(name, table);
        }
        lineage::validate_cubes(&wren_mdl)?;
        let lineage = lineage::Lineage::new(&wren_mdl)?;
        Ok(AnalyzedWrenMDL {
            wren_mdl: Arc::new(wren_mdl),
            lineage: Arc::new(lineage),
        })
    }

    /// Analyze MDL with URL-based table references.
    ///
    /// Instead of using `DynamicListTableFactory` (which requires WebDAV PROPFIND),
    /// directly creates `ListingTable` for each model by:
    /// 1. Parsing the tableReference as a URL
    /// 2. Setting format to Parquet (known from file extension)
    /// 3. Only calling `infer_schema` (uses GET + Range to read Parquet footer)
    ///
    /// This follows the DuckDB-WASM pattern: known URL + known format = no listing needed.
    pub async fn analyze_with_url_tables(
        manifest: Manifest,
        ctx: &SessionContext,
    ) -> Result<Self> {
        use datafusion::datasource::file_format::parquet::ParquetFormat;
        use datafusion::datasource::listing::{
            ListingOptions, ListingTable, ListingTableConfig, ListingTableUrl,
        };

        let mut wren_mdl = WrenMDL::new(manifest);
        // Allow manifests that omit `dataSource` (treat as file-backed). Only
        // reject when `dataSource` is explicitly set to a non-file backend.
        if let Some(data_source) = wren_mdl.data_source() {
            match data_source {
                DataSource::LocalFile
                | DataSource::MinioFile
                | DataSource::S3File
                | DataSource::GcsFile => {}
                _ => {
                    return plan_err!(
                        "Only file-based data source is supported for analyze_with_url_tables"
                    )
                }
            }
        }

        let state = ctx.state();
        for model in wren_mdl.models().to_vec() {
            let Some(table_reference) = model.table_reference() else {
                warn!("Model '{}' does not have a table reference, skipping URL-based analysis", model.name());
                continue;
            };
            let url_str = dequote_identifier(table_reference);
            let table_url = ListingTableUrl::parse(url_str)?;

            // Skip infer_options (which does PROPFIND/list).
            // We know the format is Parquet from the tableReference extension.
            let options = ListingOptions::new(Arc::new(ParquetFormat::default()))
                .with_file_extension(".parquet");

            let config = ListingTableConfig::new(table_url)
                .with_listing_options(options)
                .infer_schema(&state)
                .await?;

            let table = ListingTable::try_new(config)?;
            wren_mdl.register_table(table_reference.to_string(), Arc::new(table));
        }

        lineage::validate_cubes(&wren_mdl)?;
        let lineage = lineage::Lineage::new(&wren_mdl)?;
        Ok(AnalyzedWrenMDL {
            wren_mdl: Arc::new(wren_mdl),
            lineage: Arc::new(lineage),
        })
    }

    pub fn wren_mdl(&self) -> Arc<WrenMDL> {
        Arc::clone(&self.wren_mdl)
    }

    pub fn lineage(&self) -> &lineage::Lineage {
        &self.lineage
    }
}

pub type RegisterTables = HashMap<String, Arc<dyn TableProvider>>;
// This is the main struct that holds the manifest and provides methods to access the models
pub struct WrenMDL {
    pub manifest: Manifest,
    pub qualified_references: HashMap<datafusion::common::Column, ColumnReference>,
    pub register_tables: RegisterTables,
    pub catalog_schema_prefix: String,
}

impl Hash for WrenMDL {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.manifest.hash(state);
    }
}

impl WrenMDL {
    pub fn new(manifest: Manifest) -> Self {
        let mut qualifed_references = HashMap::new();
        manifest.models.iter().for_each(|model| {
            model.get_visible_columns().for_each(|column| {
                qualifed_references.insert(
                    from_qualified_name_str(
                        &manifest.catalog,
                        &manifest.schema,
                        model.name(),
                        column.name(),
                    ),
                    ColumnReference::new(
                        Dataset::Model(Arc::clone(model)),
                        Arc::clone(&column),
                    ),
                );
            });
        });
        WrenMDL {
            catalog_schema_prefix: format!("{}.{}.", &manifest.catalog, &manifest.schema),
            manifest,
            qualified_references: qualifed_references,
            register_tables: HashMap::new(),
        }
    }

    pub fn new_ref(manifest: Manifest) -> Arc<Self> {
        Arc::new(WrenMDL::new(manifest))
    }

    /// Create a WrenMDL from a manifest and register the table reference of the model as a remote table.
    /// All the column without expression will be considered a column
    pub fn infer_and_register_remote_table(
        manifest: Manifest,
        properties: SessionPropertiesRef,
        mode: Mode,
    ) -> Result<Self> {
        use wren_core_base::mdl::ModelSource;

        let mut mdl = WrenMDL::new(manifest);
        let sources: Vec<_> =
            mdl.models()
                .iter()
                .map(|model| match model.source() {
                    ModelSource::TableReference => {
                        let name = TableReference::from(model.table_reference().expect(
                            "table_reference must exist for TableReference source",
                        ));
                        let available_columns = model
                            .columns
                            .iter()
                            .map(|column| {
                                if mode.is_permission_analyze()
                                    || validate_clac_rule(
                                        model.name(),
                                        column,
                                        &properties,
                                        None,
                                    )?
                                    .0
                                {
                                    Ok(Some(Arc::clone(column)))
                                } else {
                                    Ok(None)
                                }
                            })
                            .collect::<Result<Vec<_>>>()?;
                        let fields: Vec<_> = available_columns
                            .into_iter()
                            .filter(|c| c.is_some())
                            .filter_map(|column| {
                                Self::infer_source_column(&column.unwrap()).ok().flatten()
                            })
                            .collect();
                        let schema =
                            Arc::new(datafusion::arrow::datatypes::Schema::new(fields));
                        let datasource = WrenDataSource::new_with_schema(schema);
                        Ok(Some((name.to_quoted_string(), Arc::new(datasource))))
                    }
                    ModelSource::RefSql => {
                        let fields: Vec<_> = model
                            .get_physical_columns(false)
                            .iter()
                            .filter_map(|column| to_field(column).ok())
                            .collect();
                        let schema =
                            Arc::new(datafusion::arrow::datatypes::Schema::new(fields));
                        let datasource = WrenDataSource::new_with_schema(schema);
                        Ok(Some((quoted(model.name()), Arc::new(datasource))))
                    }
                    ModelSource::Invalid(reason) => {
                        Err(datafusion::error::DataFusionError::Plan(reason))
                    }
                })
                .collect::<Result<Vec<_>>>()?;
        sources
            .into_iter()
            .flatten()
            .for_each(|(name, ds_ref)| mdl.register_table(name, ds_ref));
        Ok(mdl)
    }

    /// Infer the source column from the column expression.
    ///
    /// If the column is calculated or has a relationship, it's not a source column.
    /// If the column without expression, it's a source column.
    /// If the column has an expression, it will try to infer the source column from the expression.
    /// If the expression is a simple column reference, it's the source column name.
    /// If the expression is a complex expression, it can't be inferred.
    ///
    fn infer_source_column(column: &Column) -> Result<Option<Field>> {
        if column.is_calculated || column.relationship.is_some() {
            return Ok(None);
        }

        if let Some(expression) = column.expression() {
            let ExprWithAlias { expr, alias } = WrenMDL::sql_to_expr(expression)?;
            // if the column is a simple column reference, we can infer the column name
            if let Some(name) = Self::collect_one_column(&expr) {
                Ok(Some(Field::new(
                    alias.map(|a| a.value).unwrap_or_else(|| name.value.clone()),
                    try_map_data_type(&column.r#type)?,
                    column.not_null,
                )))
            } else {
                Ok(None)
            }
        } else {
            Ok(Some(to_field(column)?))
        }
    }

    fn sql_to_expr(sql: &str) -> Result<ExprWithAlias> {
        let dialect = dialect_from_str("generic").ok_or_else(|| {
            internal_datafusion_err!("Failed to create dialect from generic")
        })?;

        let expr = DFParser::parse_sql_into_expr_with_dialect(sql, dialect.as_ref())?;
        Ok(expr)
    }

    /// Collect the last identifier of the expression
    /// e.g. "a"."b"."c" -> c
    /// e.g. "a" -> a
    /// others -> None
    fn collect_one_column(expr: &Expr) -> Option<&Ident> {
        match expr {
            Expr::CompoundIdentifier(idents) => idents.last(),
            Expr::Identifier(ident) => Some(ident),
            _ => None,
        }
    }

    pub fn register_table(&mut self, name: String, table: Arc<dyn TableProvider>) {
        self.register_tables.insert(name, table);
    }

    pub fn get_table(&self, name: &str) -> Option<Arc<dyn TableProvider>> {
        self.register_tables.get(name).cloned()
    }

    pub fn get_register_tables(&self) -> &RegisterTables {
        &self.register_tables
    }

    pub fn catalog(&self) -> &str {
        &self.manifest.catalog
    }

    pub fn schema(&self) -> &str {
        &self.manifest.schema
    }

    pub fn models(&self) -> &[Arc<Model>] {
        &self.manifest.models
    }

    pub fn views(&self) -> &[Arc<View>] {
        &self.manifest.views
    }

    pub fn relationships(&self) -> &[Arc<Relationship>] {
        &self.manifest.relationships
    }

    pub fn data_source(&self) -> Option<DataSource> {
        self.manifest.data_source
    }

    pub fn get_model(&self, name: &str) -> Option<Arc<Model>> {
        self.manifest
            .models
            .iter()
            .find(|model| model.name == name)
            .cloned()
    }

    pub fn get_view(&self, name: &str) -> Option<Arc<View>> {
        self.manifest
            .views
            .iter()
            .find(|view| view.name == name)
            .cloned()
    }

    pub fn get_relationship(&self, name: &str) -> Option<Arc<Relationship>> {
        self.manifest
            .relationships
            .iter()
            .find(|relationship| relationship.name == name)
            .cloned()
    }

    pub fn get_column_reference(
        &self,
        column: &datafusion::common::Column,
    ) -> Option<ColumnReference> {
        self.qualified_references.get(column).cloned()
    }

    pub fn catalog_schema_prefix(&self) -> &str {
        &self.catalog_schema_prefix
    }
}

/// Create a SessionContext with the default functions registered
pub fn create_wren_ctx(
    config: Option<SessionConfig>,
    data_source: Option<&DataSource>,
) -> SessionContext {
    let builder = SessionStateBuilder::new()
        .with_expr_planners(SessionStateDefaults::default_expr_planners())
        .with_table_function_list(crate::mdl::function::table_functions());

    let builder = if let Some(data_source) = data_source {
        let dialect = get_inner_dialect(data_source);
        builder
            .with_scalar_functions(dialect.supported_udfs())
            .with_aggregate_functions(dialect.supported_udafs())
            .with_window_functions(dialect.supported_udwfs())
    } else {
        builder
            .with_scalar_functions(crate::mdl::function::scalar_functions())
            .with_aggregate_functions(crate::mdl::function::aggregate_functions())
            .with_window_functions(crate::mdl::function::window_functions())
    };

    let mut config = config.unwrap_or_default();

    if config.options().execution.time_zone.is_none() {
        // Set default time zone to UTC to avoid time zone related issues in timestamp inference and comparison. It can be overridden by the user config.
        config
            .options_mut()
            .set("datafusion.execution.time_zone", "+00:00")
            .unwrap();
    }

    let builder = builder.with_config(config);

    SessionContext::new_with_state(builder.build())
}

/// Transform the SQL based on the MDL (sync wrapper, requires multi-thread tokio runtime).
///
/// Not available on WASM — use [`transform_sql_with_ctx`] directly in async context.
#[cfg(feature = "multi-thread")]
pub fn transform_sql(
    analyzed_mdl: Arc<AnalyzedWrenMDL>,
    remote_functions: &[RemoteFunction],
    properties: HashMap<String, Option<String>>,
    sql: &str,
) -> Result<String> {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(transform_sql_with_ctx(
        &create_wren_ctx(None, analyzed_mdl.wren_mdl().data_source().as_ref()),
        analyzed_mdl,
        remote_functions,
        Arc::new(properties),
        sql,
    ))
}

/// Transform the SQL based on the MDL with the SessionContext
pub async fn transform_sql_with_ctx(
    ctx: &SessionContext,
    analyzed_mdl: Arc<AnalyzedWrenMDL>,
    remote_functions: &[RemoteFunction],
    properties: SessionPropertiesRef,
    sql: &str,
) -> Result<String> {
    info!("wren-core received SQL: {sql}");
    remote_functions.iter().try_for_each(|remote_function| {
        debug!("Registering remote function: {remote_function:?}");
        register_remote_function(ctx, remote_function)?;
        Ok::<_, DataFusionError>(())
    })?;
    let ctx = apply_wren_on_ctx(
        ctx,
        Arc::clone(&analyzed_mdl),
        Arc::clone(&properties),
        Mode::Unparse,
    )
    .await?;
    let plan = match ctx.state().create_logical_plan(sql).await {
        Ok(plan) => plan,
        Err(e) => {
            eprintln!("Failed to create logical plan: {e}");
            match permission_analyze(
                analyzed_mdl.wren_mdl().manifest.clone(),
                sql,
                remote_functions,
                properties,
            )
            .await
            {
                Ok(_) => {
                    return Err(e);
                }
                Err(e) => {
                    return Err(e);
                }
            }
        }
    };
    debug!("wren-core original plan:\n {plan}");
    let analyzed = ctx.state().optimize(&plan)?;
    debug!("wren-core final planned:\n {analyzed}");

    let data_source = analyzed_mdl.wren_mdl().data_source().unwrap_or_default();
    let wren_dialect = WrenDialect::new(&data_source);
    let unparser = Unparser::new(&wren_dialect)
        .with_pretty(true)
        .with_extension_unparsers(vec![Arc::new(
            crate::logical_plan::unparser::SqlReferenceNodeUnparser,
        )]);
    // show the planned sql
    match unparser.plan_to_sql(&analyzed) {
        Ok(sql) => {
            // TODO: workaround to remove unnecessary catalog and schema of mdl
            let replaced = sql
                .to_string()
                .replace(analyzed_mdl.wren_mdl().catalog_schema_prefix(), "");
            info!("wren-core planned SQL: {replaced}");
            Ok(replaced)
        }
        Err(e) => Err(e),
    }
}

/// Try to check if the fail reason is a permission denied error.
///
/// In a normal exeuction flow, if a column is not allowed to be used in the model plan,
/// it will return an column not found error because the column won't be registered in the [WrenDataSource].
/// Through this function, we can check if the error is a permission denied error, then provide a more user-friendly error message.
async fn permission_analyze(
    manifest: Manifest,
    sql: &str,
    remote_functions: &[RemoteFunction],
    properties: SessionPropertiesRef,
) -> Result<()> {
    let ctx = create_wren_ctx(None, manifest.data_source.as_ref());
    let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
        manifest,
        Arc::clone(&properties),
        Mode::PermissionAnalyze,
    )?);
    remote_functions.iter().try_for_each(|remote_function| {
        debug!("Registering remote function: {remote_function:?}");
        register_remote_function(&ctx, remote_function)?;
        Ok::<_, DataFusionError>(())
    })?;
    let ctx = apply_wren_on_ctx(&ctx, analyzed_mdl, properties, Mode::PermissionAnalyze)
        .await?;

    let plan = match ctx.state().create_logical_plan(sql).await {
        Ok(plan) => plan,
        Err(e) => {
            debug!("Failed to create logical plan: {e}");
            return Ok(());
        }
    };
    debug!("wren-core start to anlayze:\n {plan}");
    match ctx.state().optimize(&plan) {
        Ok(_) => {
            info!("SQL is allowed to be planned");
        }
        // If the error is a permission denied error, we throw it instead. Otherwise, we throw the original error.
        Err(e) => {
            if let DataFusionError::Context(_, ee) = &e {
                if let DataFusionError::External(we) = ee.as_ref() {
                    if we.downcast_ref::<WrenError>().is_some() {
                        return Err(e);
                    }
                }
            }
        }
    }
    Ok(())
}

fn register_remote_function(
    ctx: &SessionContext,
    remote_function: &RemoteFunction,
) -> Result<()> {
    // DataFusion normalizes function names to lowercase during SQL parsing,
    // but we need to register with the original name for SQL generation
    // and add the lowercase name as an alias for parsing.
    let normalized_name = remote_function.name.to_lowercase();
    let original_name = &remote_function.name;

    match &remote_function.function_type {
        FunctionType::Scalar => ctx.register_udf(ScalarUDF::new_from_impl(
            ByPassScalarUDF::new_with_original_name(
                original_name,
                &normalized_name,
                try_map_data_type(&remote_function.return_type)?,
            ),
        )),
        FunctionType::Aggregate => ctx.register_udaf(AggregateUDF::new_from_impl(
            ByPassAggregateUDF::new_with_return_type(
                &normalized_name,
                try_map_data_type(&remote_function.return_type)?,
            ),
        )),
        FunctionType::Window => ctx.register_udwf(WindowUDF::new_from_impl(
            ByPassWindowFunction::new_with_return_type(
                &normalized_name,
                try_map_data_type(&remote_function.return_type)?,
            ),
        )),
    };
    Ok(())
}

/// Analyze the decision point. It's same as the /v1/analysis/sql API in wren engine
pub fn decision_point_analyze(_wren_mdl: Arc<WrenMDL>, _sql: &str) {}

/// Cheap clone of the ColumnReference
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct ColumnReference {
    pub dataset: Dataset,
    pub column: Arc<Column>,
}

impl ColumnReference {
    fn new(dataset: Dataset, column: Arc<Column>) -> Self {
        ColumnReference { dataset, column }
    }

    pub fn get_qualified_name(&self) -> String {
        format!("{}.{}", self.dataset.name(), self.column.name)
    }
}

#[cfg(test)]
mod test {
    use core::panic;
    use std::collections::HashMap;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Arc;

    use crate::mdl::builder::{ColumnBuilder, ManifestBuilder, ModelBuilder};
    use crate::mdl::context::{apply_wren_on_ctx, Mode, SessionPropertiesRef};
    use crate::mdl::function::RemoteFunction;
    use crate::mdl::manifest::DataSource::MySQL;
    use crate::mdl::manifest::Manifest;
    use crate::mdl::{self, create_wren_ctx, transform_sql_with_ctx, AnalyzedWrenMDL};
    use datafusion::arrow::array::{
        ArrayRef, Int64Array, RecordBatch, StringArray, TimestampNanosecondArray,
    };
    use datafusion::arrow::util::pretty::pretty_format_batches_with_options;
    use datafusion::common::format::DEFAULT_FORMAT_OPTIONS;
    use datafusion::common::not_impl_err;
    use datafusion::common::Result;
    use datafusion::sql::unparser::plan_to_sql;
    use insta::assert_snapshot;
    use wren_core_base::mdl::{
        ColumnLevelOperator, DataSource, JoinType, RelationshipBuilder, SessionProperty,
    };

    #[cfg(feature = "multi-thread")]
    #[test]
    fn test_sync_transform() -> Result<()> {
        let test_data: PathBuf =
            [env!("CARGO_MANIFEST_DIR"), "tests", "data", "mdl.json"]
                .iter()
                .collect();
        let mdl_json = fs::read_to_string(test_data.as_path())?;
        let mdl = match serde_json::from_str::<Manifest>(&mdl_json) {
            Ok(mdl) => mdl,
            Err(e) => return not_impl_err!("Failed to parse mdl json: {}", e),
        };
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            mdl,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let _ = mdl::transform_sql(
            Arc::clone(&analyzed_mdl),
            &[],
            HashMap::new(),
            "select o_orderkey + o_orderkey from test.test.orders",
        )?;
        Ok(())
    }

    #[tokio::test]
    async fn test_access_model() -> Result<()> {
        let test_data: PathBuf =
            [env!("CARGO_MANIFEST_DIR"), "tests", "data", "mdl.json"]
                .iter()
                .collect();
        let mdl_json = fs::read_to_string(test_data.as_path())?;
        let mdl = match serde_json::from_str::<Manifest>(&mdl_json) {
            Ok(mdl) => mdl,
            Err(e) => return not_impl_err!("Failed to parse mdl json: {}", e),
        };
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            mdl,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);

        let tests: Vec<&str> = vec![
                "select o_orderkey + o_orderkey from test.test.orders",
                "select o_orderkey from test.test.orders where orders.o_totalprice > 10",
                "select orders.o_orderkey from test.test.orders left join test.test.customer on (orders.o_custkey = customer.c_custkey) where orders.o_totalprice > 10",
                "select o_orderkey, sum(o_totalprice) from test.test.orders group by 1",
                "select o_orderkey, count(*) from test.test.orders where orders.o_totalprice > 10 group by 1",
                "select totalcost from test.test.profile",
                "select totalcost from profile",
                "select sum(c_custkey) over (order by c_name) from test.test.customer limit 1",
        // TODO: support calculated without relationship
        //     "select orderkey_plus_custkey from orders",
        ];

        for sql in tests {
            println!("Original: {sql}");
            let actual = mdl::transform_sql_with_ctx(
                &create_wren_ctx(None, analyzed_mdl.wren_mdl().data_source().as_ref()),
                Arc::clone(&analyzed_mdl),
                &[],
                Arc::new(HashMap::new()),
                sql,
            )
            .await?;
            println!("After transform: {actual}");
            assert_sql_valid_executable(&actual).await?;
        }

        Ok(())
    }

    #[tokio::test]
    async fn test_access_view() -> Result<()> {
        let test_data: PathBuf =
            [env!("CARGO_MANIFEST_DIR"), "tests", "data", "mdl.json"]
                .iter()
                .collect();
        let mdl_json = fs::read_to_string(test_data.as_path())?;
        let mdl = match serde_json::from_str::<Manifest>(&mdl_json) {
            Ok(mdl) => mdl,
            Err(e) => return not_impl_err!("Failed to parse mdl json: {e}"),
        };
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            mdl,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let sql = "select * from test.test.customer_view";
        println!("Original: {sql}");
        let _ = transform_sql_with_ctx(
            &create_wren_ctx(None, analyzed_mdl.wren_mdl().data_source().as_ref()),
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        // TODO: There are some issues for round trip of the view plan
        // Disable the roundtrip testing before fixed.
        // see https://github.com/apache/datafusion/issues/13272
        // assert_sql_valid_executable(&actual).await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_plan_calculation_without_unnamed_subquery() -> Result<()> {
        let test_data: PathBuf =
            [env!("CARGO_MANIFEST_DIR"), "tests", "data", "mdl.json"]
                .iter()
                .collect();
        let mdl_json = fs::read_to_string(test_data.as_path())?;
        let mdl = match serde_json::from_str::<Manifest>(&mdl_json) {
            Ok(mdl) => mdl,
            Err(e) => return not_impl_err!("Failed to parse mdl json: {e}"),
        };
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            mdl,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let sql = "select totalcost from profile";
        let result = transform_sql_with_ctx(
            &create_wren_ctx(None, analyzed_mdl.wren_mdl().data_source().as_ref()),
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(result, @r#"SELECT "profile".totalcost FROM (SELECT __relation__1.totalcost FROM (SELECT totalcost.p_custkey, totalcost.totalcost FROM (SELECT __relation__2.p_custkey AS p_custkey, sum(CAST(__relation__2.o_totalprice AS BIGINT)) AS totalcost FROM (SELECT __relation__1.c_custkey, orders.o_custkey, orders.o_totalprice, __relation__1.p_custkey FROM (SELECT orders.o_custkey, orders.o_totalprice FROM (SELECT orders.o_custkey, orders.o_totalprice FROM (SELECT __source.o_custkey AS o_custkey, __source.o_totalprice AS o_totalprice FROM orders AS __source) AS orders) AS orders) AS orders RIGHT OUTER JOIN (SELECT customer.c_custkey, "profile".p_custkey FROM (SELECT customer.c_custkey FROM (SELECT customer.c_custkey FROM (SELECT __source.c_custkey AS c_custkey FROM customer AS __source) AS customer) AS customer) AS customer RIGHT OUTER JOIN (SELECT __source.p_custkey AS p_custkey FROM "profile" AS __source) AS "profile" ON customer.c_custkey = "profile".p_custkey) AS __relation__1 ON orders.o_custkey = __relation__1.c_custkey) AS __relation__2 GROUP BY __relation__2.p_custkey) AS totalcost RIGHT OUTER JOIN (SELECT __source.p_custkey AS p_custkey FROM "profile" AS __source) AS "profile" ON totalcost.p_custkey = "profile".p_custkey) AS __relation__1) AS "profile""#);

        let sql = "select totalcost from profile where p_sex = 'M'";
        let result = transform_sql_with_ctx(
            &create_wren_ctx(None, analyzed_mdl.wren_mdl().data_source().as_ref()),
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(result,
          @r#"SELECT "profile".totalcost FROM (SELECT __relation__1.p_sex, __relation__1.totalcost FROM (SELECT totalcost.p_custkey, "profile".p_sex, totalcost.totalcost FROM (SELECT __relation__2.p_custkey AS p_custkey, sum(CAST(__relation__2.o_totalprice AS BIGINT)) AS totalcost FROM (SELECT __relation__1.c_custkey, orders.o_custkey, orders.o_totalprice, __relation__1.p_custkey FROM (SELECT orders.o_custkey, orders.o_totalprice FROM (SELECT orders.o_custkey, orders.o_totalprice FROM (SELECT __source.o_custkey AS o_custkey, __source.o_totalprice AS o_totalprice FROM orders AS __source) AS orders) AS orders) AS orders RIGHT OUTER JOIN (SELECT customer.c_custkey, "profile".p_custkey FROM (SELECT customer.c_custkey FROM (SELECT customer.c_custkey FROM (SELECT __source.c_custkey AS c_custkey FROM customer AS __source) AS customer) AS customer) AS customer RIGHT OUTER JOIN (SELECT __source.p_custkey AS p_custkey FROM "profile" AS __source) AS "profile" ON customer.c_custkey = "profile".p_custkey) AS __relation__1 ON orders.o_custkey = __relation__1.c_custkey) AS __relation__2 GROUP BY __relation__2.p_custkey) AS totalcost RIGHT OUTER JOIN (SELECT __source.p_custkey AS p_custkey, __source.p_sex AS p_sex FROM "profile" AS __source) AS "profile" ON totalcost.p_custkey = "profile".p_custkey) AS __relation__1) AS "profile" WHERE "profile".p_sex = 'M'"#);
        Ok(())
    }

    #[tokio::test]
    async fn test_uppercase_catalog_schema() -> Result<()> {
        let manifest = ManifestBuilder::new()
            .catalog("CTest")
            .schema("STest")
            .model(
                ModelBuilder::new("Customer")
                    .table_reference("datafusion.public.customer")
                    .column(ColumnBuilder::new("Custkey", "int").build())
                    .column(ColumnBuilder::new("Name", "string").build())
                    .build(),
            )
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let sql = r#"select * from CTest.STest.Customer"#;
        let actual = mdl::transform_sql_with_ctx(
            &create_wren_ctx(None, analyzed_mdl.wren_mdl().data_source().as_ref()),
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(actual,
            @"SELECT \"Customer\".\"Custkey\", \"Customer\".\"Name\" FROM \
            (SELECT \"Customer\".\"Custkey\", \"Customer\".\"Name\" FROM \
            (SELECT __source.\"Custkey\" AS \"Custkey\", __source.\"Name\" AS \"Name\" FROM datafusion.\"public\".customer AS __source) AS \"Customer\") AS \"Customer\"");
        Ok(())
    }

    #[tokio::test]
    async fn test_remote_function() -> Result<()> {
        env_logger::init();
        let test_data: PathBuf =
            [env!("CARGO_MANIFEST_DIR"), "tests", "data", "functions.csv"]
                .iter()
                .collect();
        let functions = csv::Reader::from_path(test_data)
            .unwrap()
            .into_deserialize::<RemoteFunction>()
            .filter_map(Result::ok)
            .collect::<Vec<_>>();
        let manifest = ManifestBuilder::new()
            .catalog("CTest")
            .schema("STest")
            .model(
                ModelBuilder::new("Customer")
                    .table_reference("datafusion.public.customer")
                    .column(ColumnBuilder::new("Custkey", "int").build())
                    .column(ColumnBuilder::new("Name", "string").build())
                    .build(),
            )
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let ctx = create_wren_ctx(None, analyzed_mdl.wren_mdl().data_source().as_ref());
        let actual = transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &functions,
            Arc::new(HashMap::new()),
            r#"select add_two(Custkey) from Customer"#,
        )
        .await?;
        assert_snapshot!(actual, @"SELECT add_two(\"Customer\".\"Custkey\") FROM (SELECT \"Customer\".\"Custkey\" \
        FROM (SELECT __source.\"Custkey\" AS \"Custkey\" FROM datafusion.\"public\".customer AS __source) AS \"Customer\") AS \"Customer\"");

        let actual = transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &functions,
            Arc::new(HashMap::new()),
            r#"select median("Custkey") from "CTest"."STest"."Customer" group by "Name""#,
        )
        .await?;
        assert_snapshot!(actual, @"SELECT median(\"Customer\".\"Custkey\") FROM (SELECT \"Customer\".\"Custkey\", \"Customer\".\"Name\" \
        FROM (SELECT __source.\"Custkey\" AS \"Custkey\", __source.\"Name\" AS \"Name\" FROM datafusion.\"public\".customer AS __source) AS \"Customer\") AS \"Customer\" \
        GROUP BY \"Customer\".\"Name\"");

        // TODO: support window functions analysis
        // let actual = transform_sql_with_ctx(
        //     &ctx,
        //     Arc::clone(&analyzed_mdl),
        //     &functions,
        //     r#"select max_if("Custkey") OVER (PARTITION BY "Name") from "Customer""#,
        // ).await?;
        // assert_eq!(actual, "");

        Ok(())
    }

    #[tokio::test]
    async fn test_unicode_remote_column_name() -> Result<()> {
        let ctx = create_wren_ctx(None, None);
        ctx.register_batch("artist", artist())?;
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("artist")
                    .table_reference("artist")
                    .column(ColumnBuilder::new("名字", "string").build())
                    .column(
                        ColumnBuilder::new("name_append", "string")
                            .expression(r#"名字 || 名字"#)
                            .build(),
                    )
                    .column(
                        ColumnBuilder::new("group", "string")
                            .expression(r#"組別"#)
                            .build(),
                    )
                    .column(
                        ColumnBuilder::new("subscribe", "int")
                            .expression(r#"訂閱數"#)
                            .build(),
                    )
                    .column(
                        ColumnBuilder::new("subscribe_plus", "int")
                            .expression(r#"訂閱數 + 1"#)
                            .build(),
                    )
                    .build(),
            )
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let sql = r#"select * from wren.test.artist"#;
        let actual = transform_sql_with_ctx(
            &create_wren_ctx(None, None),
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(actual,
                           @r#"SELECT artist."名字", artist.name_append, artist."group", artist.subscribe, artist.subscribe_plus FROM (SELECT artist."group", artist.name_append, artist.subscribe, artist.subscribe_plus, artist."名字" FROM (SELECT __source."名字" AS "名字", __source."名字" || __source."名字" AS name_append, __source."組別" AS "group", __source."訂閱數" + 1 AS subscribe_plus, __source."訂閱數" AS subscribe FROM artist AS __source) AS artist) AS artist"#
        );
        ctx.sql(&actual).await?.show().await?;

        let sql = r#"select group from wren.test.artist"#;
        let actual = transform_sql_with_ctx(
            &create_wren_ctx(None, None),
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(actual,
                   @"SELECT artist.\"group\" FROM (SELECT artist.\"group\" FROM (SELECT __source.\"組別\" AS \"group\" FROM artist AS __source) AS artist) AS artist");
        ctx.sql(&actual).await?.show().await?;

        let sql = r#"select subscribe_plus from wren.test.artist"#;
        let actual = mdl::transform_sql_with_ctx(
            &create_wren_ctx(None, None),
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(actual,
                   @r#"SELECT artist.subscribe_plus FROM (SELECT artist.subscribe_plus FROM (SELECT __source."訂閱數" + 1 AS subscribe_plus FROM artist AS __source) AS artist) AS artist"#);
        ctx.sql(&actual).await?.show().await
    }

    #[tokio::test]
    async fn test_invalid_infer_remote_table() -> Result<()> {
        let ctx = create_wren_ctx(None, None);
        ctx.register_batch("artist", artist())?;
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("artist")
                    .table_reference("artist")
                    .column(
                        ColumnBuilder::new("name_append", "string")
                            .expression(r#"名字 || 名字"#)
                            .build(),
                    )
                    .column(
                        ColumnBuilder::new("lower_name", "string")
                            .expression(r#"lower(名字)"#)
                            .build(),
                    )
                    .build(),
            )
            .build();

        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let sql = r#"select name_append from wren.test.artist"#;
        let _ = transform_sql_with_ctx(
            &create_wren_ctx(None, None),
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await
        .map_err(|e| {
            assert_snapshot!(
                e.to_string(),
                @"ModelAnalyzeRule\ncaused by\nSchema error: No field named \"名字\"."
            )
        });

        let sql = r#"select lower_name from wren.test.artist"#;
        let _ = transform_sql_with_ctx(
            &create_wren_ctx(None, None),
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await
        .map_err(|e| {
            assert_snapshot!(
                e.to_string(),
                @"ModelAnalyzeRule\ncaused by\nSchema error: No field named \"名字\"."
            )
        });
        Ok(())
    }

    #[tokio::test]
    async fn test_query_hidden_column() -> Result<()> {
        let ctx = create_wren_ctx(None, None);
        ctx.register_batch("artist", artist())?;
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("artist")
                    .table_reference("artist")
                    .column(ColumnBuilder::new("名字", "string").hidden(true).build())
                    .column(
                        ColumnBuilder::new("串接名字", "string")
                            .expression(r#"名字 || 名字"#)
                            .build(),
                    )
                    .build(),
            )
            .build();

        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let sql = r#"select 串接名字 from wren.test.artist"#;
        let actual = transform_sql_with_ctx(
            &create_wren_ctx(None, None),
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(actual,
                   @"SELECT artist.\"串接名字\" FROM (SELECT artist.\"串接名字\" FROM (SELECT __source.\"名字\" || __source.\"名字\" AS \"串接名字\" FROM artist AS __source) AS artist) AS artist");
        let sql = r#"select * from wren.test.artist"#;
        let actual = transform_sql_with_ctx(
            &create_wren_ctx(None, None),
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(actual,
                   @"SELECT artist.\"串接名字\" FROM (SELECT artist.\"串接名字\" FROM (SELECT __source.\"名字\" || __source.\"名字\" AS \"串接名字\" FROM artist AS __source) AS artist) AS artist");

        let sql = r#"select "名字" from wren.test.artist"#;
        let _ = transform_sql_with_ctx(
            &create_wren_ctx(None, None),
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
            .await.map_err(|e| {
                assert_snapshot!(
                    e.to_string(),
                    @"Schema error: No field named \"名字\". Valid fields are wren.test.artist.\"串接名字\"."
                )
            });
        Ok(())
    }

    #[tokio::test]
    async fn test_disable_simplify_expression() -> Result<()> {
        let sql = "select current_date";
        let actual = transform_sql_with_ctx(
            &create_wren_ctx(None, None),
            Arc::new(AnalyzedWrenMDL::default()),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(actual, @"SELECT current_date()");
        Ok(())
    }

    #[tokio::test]
    async fn test_disable_decorrelate_predicate_subquery() -> Result<()> {
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("artist")
                    .table_reference("artist")
                    .column(ColumnBuilder::new("出道時間", "timestamp").build())
                    .column(ColumnBuilder::new("名字", "string").build())
                    .build(),
            )
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let sql = r#"select * from wren.test.artist where 名字 in (SELECT 名字 FROM wren.test.artist)"#;
        let actual = transform_sql_with_ctx(
            &create_wren_ctx(None, None),
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(actual,
                   @r#"SELECT artist."出道時間", artist."名字" FROM (SELECT artist."出道時間", artist."名字" FROM (SELECT __source."出道時間" AS "出道時間", __source."名字" AS "名字" FROM artist AS __source) AS artist) AS artist WHERE artist."名字" IN (SELECT artist."名字" FROM (SELECT artist."名字" FROM (SELECT __source."名字" AS "名字" FROM artist AS __source) AS artist) AS artist)"#);
        Ok(())
    }

    /// This test will be failed if the `出道時間` is not inferred as a timestamp column correctly.
    #[tokio::test]
    async fn test_infer_timestamp_column() -> Result<()> {
        let ctx = create_wren_ctx(None, None);
        ctx.register_batch("artist", artist())?;
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("artist")
                    .table_reference("artist")
                    .column(ColumnBuilder::new("出道時間", "timestamp").build())
                    .build(),
            )
            .build();

        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let sql = r#"select current_date > "出道時間" from wren.test.artist"#;
        let actual = transform_sql_with_ctx(
            &create_wren_ctx(None, None),
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(actual,
                   @"SELECT CAST(current_date() AS TIMESTAMP) > artist.\"出道時間\" FROM \
                   (SELECT artist.\"出道時間\" FROM (SELECT __source.\"出道時間\" AS \"出道時間\" FROM artist AS __source) AS artist) AS artist");
        Ok(())
    }

    #[tokio::test]
    async fn test_disable_count_wildcard_rule() -> Result<()> {
        let ctx = create_wren_ctx(None, None);

        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::default());
        let sql = "select count(*) from (select 1)";
        let actual = transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        // TODO: BigQuery doesn't support the alias include invalid characters (e.g. `*`, `()`).
        //      We should remove the invalid characters for the alias.
        assert_snapshot!(actual, @"SELECT count(1) AS \"count(*)\" FROM (SELECT 1)");
        Ok(())
    }

    async fn assert_sql_valid_executable(sql: &str) -> Result<()> {
        let ctx = create_wren_ctx(None, None);
        // To roundtrip testing, we should register the mock table for the planned sql.
        ctx.register_batch("orders", orders())?;
        ctx.register_batch("customer", customer())?;
        ctx.register_batch("profile", profile())?;

        // show the planned sql
        let df = ctx.sql(sql).await?;
        let plan = df.into_optimized_plan()?;
        let after_roundtrip = plan_to_sql(&plan).map(|sql| sql.to_string())?;
        println!("After roundtrip: {after_roundtrip}");
        match ctx.sql(sql).await?.collect().await {
            Ok(_) => Ok(()),
            Err(e) => {
                eprintln!("Error: {e}");
                Err(e)
            }
        }
    }

    #[tokio::test]
    async fn test_mysql_style_interval() -> Result<()> {
        let ctx = create_wren_ctx(None, Some(&DataSource::MySQL));
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::default());
        let sql = "select interval 1 day";
        let actual = transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(actual, @"SELECT INTERVAL 1 DAY");

        let sql = "SELECT INTERVAL '1 YEAR 1 MONTH'";
        let actual = transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(actual, @"SELECT INTERVAL 13 MONTH");

        let sql = "SELECT INTERVAL '1' YEAR + INTERVAL '2' MONTH + INTERVAL '3' DAY";
        let actual = transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(
            actual,
            @"SELECT INTERVAL 12 MONTH + INTERVAL 2 MONTH + INTERVAL 3 DAY"
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_unnest_as_table_factor() -> Result<()> {
        let ctx = create_wren_ctx(None, None);
        let manifest = ManifestBuilder::new().build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let sql = "select * from unnest([1, 2, 3])";
        let actual = transform_sql_with_ctx(
            &ctx,
            analyzed_mdl,
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(actual, @r#"SELECT "UNNEST(make_array(Int64(1),Int64(2),Int64(3)))" FROM (SELECT UNNEST([1, 2, 3]) AS "UNNEST(make_array(Int64(1),Int64(2),Int64(3)))") AS derived_projection ("UNNEST(make_array(Int64(1),Int64(2),Int64(3)))")"#);

        let manifest = ManifestBuilder::new()
            .data_source(DataSource::BigQuery)
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let sql = "select * from unnest([1, 2, 3])";
        let actual = transform_sql_with_ctx(
            &ctx,
            analyzed_mdl,
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(actual, @r#"SELECT "UNNEST_40make_array_40Int64_401_41_44Int64_402_41_44Int64_403_41_41_41" FROM UNNEST([1, 2, 3])"#);
        Ok(())
    }

    #[tokio::test]
    async fn test_simplify_timestamp() -> Result<()> {
        let ctx = create_wren_ctx(None, None);
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::default());
        let sql = "select timestamp '2011-01-01 18:00:00 +08:00'";
        let actual = transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(actual, @"SELECT CAST('2011-01-01 10:00:00' AS TIMESTAMP) AS \"Utf8(\"\"2011-01-01 18:00:00 +08:00\"\")\"");

        let sql = "select timestamp '2011-01-01 18:00:00 Asia/Taipei'";
        let actual = transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(actual, @"SELECT CAST('2011-01-01 10:00:00' AS TIMESTAMP) AS \"Utf8(\"\"2011-01-01 18:00:00 Asia/Taipei\"\")\"");
        Ok(())
    }

    #[tokio::test]
    async fn test_eval_timestamp_with_session_timezone() -> Result<()> {
        let mut headers = HashMap::new();
        headers.insert("x-wren-timezone".to_string(), Some("+08:00".to_string()));
        let headers_ref = Arc::new(headers);
        let ctx = create_wren_ctx(None, None);
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::default());
        let sql = "select timestamp '2011-01-01 18:00:00'";
        let actual = transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::clone(&headers_ref),
            sql,
        )
        .await?;
        // TIMESTAMP doesn't have timezone, so the timezone will be ignored
        assert_snapshot!(actual, @"SELECT CAST('2011-01-01 18:00:00' AS TIMESTAMP) AS \"Utf8(\"\"2011-01-01 18:00:00\"\")\"");

        let sql = "select timestamp with time zone '2011-01-01 18:00:00'";
        let actual = transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::clone(&headers_ref),
            sql,
        )
        .await?;
        // TIMESTAMP WITH TIME ZONE will be converted to the session timezone
        assert_snapshot!(actual, @"SELECT CAST('2011-01-01 10:00:00' AS TIMESTAMP) AS \"Utf8(\"\"2011-01-01 18:00:00\"\")\"");

        let ctx = create_wren_ctx(None, None);
        let mut headers = HashMap::new();
        headers.insert(
            "x-wren-timezone".to_string(),
            Some("America/New_York".to_string()),
        );
        let headers_ref = Arc::new(headers);
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::default());
        // TIMESTAMP WITH TIME ZONE will be converted to the session timezone with daylight saving (UTC -5)
        let sql = "select timestamp with time zone '2024-01-15 18:00:00'";
        let actual = transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::clone(&headers_ref),
            sql,
        )
        .await?;
        assert_snapshot!(actual, @"SELECT CAST('2024-01-15 23:00:00' AS TIMESTAMP) AS \"Utf8(\"\"2024-01-15 18:00:00\"\")\"");

        // TIMESTAMP WITH TIME ZONE will be converted to the session timezone without daylight saving (UTC -4)
        let sql = "select timestamp with time zone '2024-07-15 18:00:00'";
        let actual = transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::clone(&headers_ref),
            sql,
        )
        .await?;
        assert_snapshot!(actual, @"SELECT CAST('2024-07-15 22:00:00' AS TIMESTAMP) AS \"Utf8(\"\"2024-07-15 18:00:00\"\")\"");

        let headers = HashMap::new();
        let headers_ref = Arc::new(headers);
        let ctx = create_wren_ctx(None, None);
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::default());
        let sql = "select timestamp with time zone '2011-01-01 18:00:00' - timestamp with time zone '2011-01-01 10:00:00'";
        let actual = transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::clone(&headers_ref),
            sql,
        )
        .await?;
        // TIMESTAMP doesn't have timezone, so the timezone will be ignored
        assert_snapshot!(actual, @"SELECT CAST('2011-01-01 18:00:00' AS TIMESTAMP) - CAST('2011-01-01 10:00:00' AS TIMESTAMP)");

        Ok(())
    }

    #[tokio::test]
    async fn test_disable_pushdown_filter() -> Result<()> {
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("artist")
                    .table_reference("artist")
                    .column(
                        ColumnBuilder::new("出道時間", "timestamp")
                            .hidden(true)
                            .build(),
                    )
                    .column(
                        ColumnBuilder::new("cast_timestamptz", "timestamptz")
                            .expression(r#"cast(出道時間 as timestamp with time zone)"#)
                            .build(),
                    )
                    .build(),
            )
            .build();

        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let sql = r#"select count(*) from wren.test.artist where cast(cast_timestamptz as timestamp) > timestamp '2011-01-01 21:00:00'"#;
        let actual = transform_sql_with_ctx(
            &create_wren_ctx(None, None),
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(actual,
                   // TODO: BigQuery doesn't support the alias include invalid characters (e.g. `*`, `()`).
                   //      We should remove the invalid characters for the alias.
                   @"SELECT count(1) AS \"count(*)\" FROM (SELECT artist.cast_timestamptz FROM \
                   (SELECT CAST(__source.\"出道時間\" AS TIMESTAMP WITH TIME ZONE) AS cast_timestamptz \
                   FROM artist AS __source) AS artist) AS artist WHERE CAST(artist.cast_timestamptz AS TIMESTAMP) > CAST('2011-01-01 21:00:00' AS TIMESTAMP)");
        Ok(())
    }

    #[tokio::test]
    async fn test_register_timestamptz() -> Result<()> {
        let ctx = create_wren_ctx(None, None);
        ctx.register_batch("timestamp_table", timestamp_table())?;
        let provider = ctx
            .catalog("datafusion")
            .unwrap()
            .schema("public")
            .unwrap()
            .table("timestamp_table")
            .await?
            .unwrap();
        let mut registers = HashMap::new();
        registers.insert(
            "datafusion.public.timestamp_table".to_string(),
            Arc::clone(&provider),
        );
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("timestamp_table")
                    .table_reference("datafusion.public.timestamp_table")
                    .column(ColumnBuilder::new("timestamp_col", "timestamp").build())
                    .column(ColumnBuilder::new("timestamptz_col", "timestamptz").build())
                    .build(),
            )
            .build();

        let analyzed_mdl =
            Arc::new(AnalyzedWrenMDL::analyze_with_tables(manifest, registers)?);
        let properties_ref = Arc::new(HashMap::new());
        let ctx = apply_wren_on_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            properties_ref,
            Mode::LocalRuntime,
        )
        .await?;
        let sql = r#"select arrow_typeof(timestamp_col), arrow_typeof(timestamptz_col) from wren.test.timestamp_table limit 1"#;
        let result = ctx.sql(sql).await?.collect().await?;
        assert_snapshot!(batches_to_string(&result), @r#"
        +---------------------------------------------+-----------------------------------------------+
        | arrow_typeof(timestamp_table.timestamp_col) | arrow_typeof(timestamp_table.timestamptz_col) |
        +---------------------------------------------+-----------------------------------------------+
        | Timestamp(ns)                               | Timestamp(ns, "UTC")                          |
        +---------------------------------------------+-----------------------------------------------+
        "#);
        Ok(())
    }

    #[tokio::test]
    async fn test_coercion_timestamptz() -> Result<()> {
        let ctx = create_wren_ctx(None, None);
        ctx.register_batch("timestamp_table", timestamp_table())?;
        for timezone_type in [
            "timestamptz",
            "timestamp_with_timezone",
            "timestamp_with_time_zone",
        ] {
            let manifest = ManifestBuilder::new()
                .catalog("wren")
                .schema("test")
                .model(
                    ModelBuilder::new("timestamp_table")
                        .table_reference("datafusion.public.timestamp_table")
                        .column(ColumnBuilder::new("timestamp_col", "timestamp").build())
                        .column(
                            ColumnBuilder::new("timestamptz_col", timezone_type).build(),
                        )
                        .build(),
                )
                .build();
            let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
                manifest,
                Arc::new(HashMap::default()),
                Mode::Unparse,
            )?);
            let sql = r#"select timestamp_col = timestamptz_col from wren.test.timestamp_table"#;
            let actual = transform_sql_with_ctx(
                &create_wren_ctx(None, None),
                Arc::clone(&analyzed_mdl),
                &[],
                Arc::new(HashMap::new()),
                sql,
            )
            .await?;
            assert_eq!(actual,
                       "SELECT CAST(timestamp_table.timestamp_col AS TIMESTAMP WITH TIME ZONE) = timestamp_table.timestamptz_col \
                       FROM (SELECT timestamp_table.timestamp_col, timestamp_table.timestamptz_col FROM \
                       (SELECT __source.timestamp_col AS timestamp_col, __source.timestamptz_col AS timestamptz_col \
                       FROM datafusion.\"public\".timestamp_table AS __source) AS timestamp_table) AS timestamp_table");

            let sql = r#"select timestamptz_col > cast('2011-01-01 18:00:00' as TIMESTAMP WITH TIME ZONE) from wren.test.timestamp_table"#;
            let actual = transform_sql_with_ctx(
                &create_wren_ctx(None, None),
                Arc::clone(&analyzed_mdl),
                &[],
                Arc::new(HashMap::new()),
                sql,
            )
            .await?;
            // assert the simplified literal will be casted to the timestamp tz
            assert_eq!(actual,
              "SELECT timestamp_table.timestamptz_col > CAST(CAST('2011-01-01 18:00:00' AS TIMESTAMP) AS TIMESTAMP WITH TIME ZONE) FROM (SELECT timestamp_table.timestamptz_col FROM (SELECT __source.timestamptz_col AS timestamptz_col FROM datafusion.\"public\".timestamp_table AS __source) AS timestamp_table) AS timestamp_table"
);

            let sql = r#"select timestamptz_col > '2011-01-01 18:00:00' from wren.test.timestamp_table"#;
            let actual = transform_sql_with_ctx(
                &create_wren_ctx(None, None),
                Arc::clone(&analyzed_mdl),
                &[],
                Arc::new(HashMap::new()),
                sql,
            )
            .await?;
            // assert the string literal will be casted to the timestamp tz
            assert_eq!(actual,
                       "SELECT timestamp_table.timestamptz_col > CAST('2011-01-01 18:00:00' AS TIMESTAMP WITH TIME ZONE) \
                       FROM (SELECT timestamp_table.timestamptz_col FROM (SELECT __source.timestamptz_col AS timestamptz_col \
                       FROM datafusion.\"public\".timestamp_table AS __source) AS timestamp_table) AS timestamp_table");

            let sql = r#"select timestamp_col > cast('2011-01-01 18:00:00' as TIMESTAMP WITH TIME ZONE) from wren.test.timestamp_table"#;
            let actual = transform_sql_with_ctx(
                &create_wren_ctx(None, None),
                Arc::clone(&analyzed_mdl),
                &[],
                Arc::new(HashMap::new()),
                sql,
            )
            .await?;
            // assert the simplified literal won't be casted to the timestamp tz
            assert_eq!(actual,
                "SELECT timestamp_table.timestamp_col > CAST('2011-01-01 18:00:00' AS TIMESTAMP) FROM (SELECT timestamp_table.timestamp_col FROM (SELECT __source.timestamp_col AS timestamp_col FROM datafusion.\"public\".timestamp_table AS __source) AS timestamp_table) AS timestamp_table");
        }
        Ok(())
    }

    #[tokio::test]
    async fn test_list() -> Result<()> {
        let ctx = create_wren_ctx(None, None);
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("list_table")
                    .table_reference("list_table")
                    .column(ColumnBuilder::new("list_col", "array<int>").build())
                    .build(),
            )
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let sql = "select list_col[1] from wren.test.list_table";
        let actual = transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(actual, @"SELECT list_table.list_col[1] FROM (SELECT list_table.list_col FROM \
        (SELECT __source.list_col AS list_col FROM list_table AS __source) AS list_table) AS list_table");
        Ok(())
    }

    #[tokio::test]
    async fn test_disable_eliminate_nested_union() -> Result<()> {
        let ctx = create_wren_ctx(None, None);
        let sql = r#"SELECT * FROM (SELECT 1 x, 'a' y UNION ALL
    SELECT 1 x, 'b' y UNION ALL
    SELECT 2 x, 'a' y UNION ALL
    SELECT 2 x, 'c' y)"#;
        let result = transform_sql_with_ctx(
            &ctx,
            Arc::new(AnalyzedWrenMDL::default()),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(
            result,
            @"SELECT x, y FROM (SELECT 1 AS x, 'a' AS y \
        UNION ALL SELECT 1 AS x, 'b' AS y \
        UNION ALL SELECT 2 AS x, 'a' AS y \
        UNION ALL SELECT 2 AS x, 'c' AS y)"
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_dialect_specific_function_rewrite() -> Result<()> {
        let manifest = ManifestBuilder::default().data_source(MySQL).build();
        let mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let ctx = create_wren_ctx(None, None);
        let sql = "SELECT trim(' abc')";
        let actual = transform_sql_with_ctx(
            &ctx,
            Arc::clone(&mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(actual, @"SELECT trim(' abc')");
        Ok(())
    }

    #[tokio::test]
    async fn test_disable_single_distinct_to_group_by() -> Result<()> {
        let ctx = create_wren_ctx(None, None);
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_custkey", "int").build())
                    .column(ColumnBuilder::new("c_name", "string").build())
                    .build(),
            )
            .build();
        let sql = r#"SELECT c_custkey, count(distinct c_name) FROM customer GROUP BY c_custkey"#;
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let result = transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(
            result,
            @"SELECT customer.c_custkey, count(DISTINCT customer.c_name) FROM \
            (SELECT customer.c_custkey, customer.c_name FROM \
            (SELECT __source.c_custkey AS c_custkey, __source.c_name AS c_name FROM customer AS __source) AS customer) AS customer \
            GROUP BY customer.c_custkey"
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_disable_distinct_to_group_by() -> Result<()> {
        let ctx = create_wren_ctx(None, None);
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_custkey", "int").build())
                    .column(ColumnBuilder::new("c_name", "string").build())
                    .build(),
            )
            .build();
        let sql = r#"SELECT DISTINCT c_custkey, c_name FROM customer"#;
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let result = transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(
            result,
            @"SELECT DISTINCT customer.c_custkey, customer.c_name FROM (SELECT customer.c_custkey, customer.c_name FROM (SELECT __source.c_custkey AS c_custkey, __source.c_name AS c_name FROM customer AS __source) AS customer) AS customer"
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_disable_scalar_subquery() -> Result<()> {
        let ctx = create_wren_ctx(None, None);
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_custkey", "int").build())
                    .column(ColumnBuilder::new("c_name", "string").build())
                    .build(),
            )
            .build();
        let sql = r#"SELECT c_custkey, (SELECT c_name FROM customer WHERE c_custkey = 1) FROM customer"#;
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let result = transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(
            result,
            @"SELECT customer.c_custkey, (SELECT customer.c_name FROM (SELECT customer.c_custkey, customer.c_name FROM (SELECT __source.c_custkey AS c_custkey, __source.c_name AS c_name FROM customer AS __source) AS customer) AS customer WHERE customer.c_custkey = 1) FROM (SELECT customer.c_custkey FROM (SELECT __source.c_custkey AS c_custkey FROM customer AS __source) AS customer) AS customer"
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_wildcard_where() -> Result<()> {
        let ctx = create_wren_ctx(None, None);
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_custkey", "int").build())
                    .column(ColumnBuilder::new("c_name", "string").build())
                    .build(),
            )
            .build();
        let sql = r#"SELECT * FROM customer WHERE c_custkey = 1"#;
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let result = transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(
            result,
            @"SELECT customer.c_custkey, customer.c_name FROM (SELECT customer.c_custkey, customer.c_name FROM (SELECT __source.c_custkey AS c_custkey, __source.c_name AS c_name FROM customer AS __source) AS customer) AS customer WHERE customer.c_custkey = 1"
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_uppercase_table_reference() -> Result<()> {
        let mdl_json = r#"
        {
            "catalog": "wren",
            "schema": "test",
            "models": [
                {
                    "name": "customer",
                    "tableReference": {
                        "table": "CUSTOMER",
                        "schema": "test",
                        "catalog": "remote"
                    },
                    "columns": [
                        {
                            "name": "c_custkey",
                            "type": "int"
                        },
                        {
                            "name": "c_name",
                            "type": "string"
                        }
                    ]
                }
            ]
        }
        "#;
        let manifest: Manifest = serde_json::from_str(mdl_json).unwrap();
        let ctx = create_wren_ctx(None, None);
        let sql = r#"SELECT * FROM customer WHERE c_custkey = 1"#;
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let result = transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(
            result,
            @r#"SELECT customer.c_custkey, customer.c_name FROM (SELECT customer.c_custkey, customer.c_name FROM (SELECT __source.c_custkey AS c_custkey, __source.c_name AS c_name FROM "remote".test."CUSTOMER" AS __source) AS customer) AS customer WHERE customer.c_custkey = 1"#
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_unicode_table_reference() -> Result<()> {
        let mdl_json = r#"
        {
            "catalog": "wren",
            "schema": "test",
            "models": [
                {
                    "name": "customer",
                    "tableReference": {
                        "table": "客戶",
                        "schema": "test",
                        "catalog": "遠端"
                    },
                    "columns": [
                        {
                            "name": "c_custkey",
                            "type": "int"
                        },
                        {
                            "name": "c_name",
                            "type": "string"
                        }
                    ]
                }
            ]
        }
        "#;
        let manifest: Manifest = serde_json::from_str(mdl_json).unwrap();
        let ctx = create_wren_ctx(None, None);
        let sql = r#"SELECT * FROM customer WHERE c_custkey = 1"#;
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let result = transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert_snapshot!(
            result,
            @r#"SELECT customer.c_custkey, customer.c_name FROM (SELECT customer.c_custkey, customer.c_name FROM (SELECT __source.c_custkey AS c_custkey, __source.c_name AS c_name FROM "遠端".test."客戶" AS __source) AS customer) AS customer WHERE customer.c_custkey = 1"#
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_rlac_with_requried_properties() -> Result<()> {
        let ctx = create_wren_ctx(None, None);

        // test required property
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_nationkey", "int").build())
                    .column(ColumnBuilder::new("c_name", "string").build())
                    .add_row_level_access_control(
                        "nation",
                        vec![SessionProperty::new_required("session_nation")],
                        "c_nationkey = @session_nation",
                    )
                    .build(),
            )
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let sql = "SELECT * FROM customer";
        let headers =
            build_headers(&[("session_nation".to_string(), Some("1".to_string()))]);
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::new(headers), sql).await?,
            @"SELECT customer.c_nationkey, customer.c_name FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer WHERE customer.c_nationkey = 1) AS customer"
        );

        match transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await
        {
            Err(e) => {
                assert_snapshot!(
                    e.to_string(),
                    @r"
                ModelAnalyzeRule
                caused by
                Error during planning: session property session_nation is required for `nation` rule but not found in headers
                "
                )
            }
            _ => panic!("Expected error"),
        }

        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_custkey", "int").build())
                    .column(ColumnBuilder::new("c_nationkey", "int").build())
                    .column(ColumnBuilder::new("c_name", "string").build())
                    .add_row_level_access_control(
                        "nation",
                        vec![SessionProperty::new_required("session_nation")],
                        "c_nationkey = @session_nation",
                    )
                    .add_row_level_access_control(
                        "name",
                        vec![SessionProperty::new_required("session_user")],
                        "c_name = @session_user",
                    )
                    .build(),
            )
            .model(
                ModelBuilder::new("orders")
                    .table_reference("orders")
                    .column(ColumnBuilder::new("o_orderkey", "int").build())
                    .column(ColumnBuilder::new("o_custkey", "int").build())
                    .build(),
            )
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let sql = "SELECT * FROM customer";
        let headers = Arc::new(build_headers(&[
            ("session_nation".to_string(), Some("1".to_string())),
            ("session_user".to_string(), Some("'Gura'".to_string())),
        ]));
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers.clone(), sql,).await?,
            @"SELECT customer.c_custkey, customer.c_nationkey, customer.c_name FROM (SELECT customer.c_custkey, customer.c_name, customer.c_nationkey FROM (SELECT customer.c_custkey, customer.c_name, customer.c_nationkey FROM (SELECT __source.c_custkey AS c_custkey, __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer WHERE customer.c_nationkey = 1 AND customer.c_name = 'Gura') AS customer"
        );

        let sql = "SELECT * FROM customer WHERE c_custkey = 1";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql).await?,
            @"SELECT customer.c_custkey, customer.c_nationkey, customer.c_name FROM (SELECT customer.c_custkey, customer.c_name, customer.c_nationkey FROM (SELECT customer.c_custkey, customer.c_name, customer.c_nationkey FROM (SELECT __source.c_custkey AS c_custkey, __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer WHERE customer.c_nationkey = 1 AND customer.c_name = 'Gura') AS customer WHERE customer.c_custkey = 1"
        );

        // test other model won't be affected
        let sql = "SELECT o_orderkey FROM orders";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx,Arc::clone(&analyzed_mdl),&[],Arc::new(HashMap::new()),sql).await?,
            @"SELECT orders.o_orderkey FROM (SELECT orders.o_orderkey FROM (SELECT __source.o_orderkey AS o_orderkey FROM orders AS __source) AS orders) AS orders"
        );

        let sql = "SELECT o_orderkey FROM customer JOIN orders ON customer.c_custkey = orders.o_custkey";
        let headers = Arc::new(build_headers(&[
            ("session_nation".to_string(), Some("1".to_string())),
            ("session_user".to_string(), Some("'Gura'".to_string())),
        ]));
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql).await?,
            @"SELECT orders.o_orderkey FROM (SELECT customer.c_custkey, customer.c_name, customer.c_nationkey FROM (SELECT customer.c_custkey, customer.c_name, customer.c_nationkey FROM (SELECT __source.c_custkey AS c_custkey, __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer WHERE customer.c_nationkey = 1 AND customer.c_name = 'Gura') AS customer INNER JOIN (SELECT orders.o_custkey, orders.o_orderkey FROM (SELECT __source.o_custkey AS o_custkey, __source.o_orderkey AS o_orderkey FROM orders AS __source) AS orders) AS orders ON customer.c_custkey = orders.o_custkey"
        );

        // test property is required
        let headers = Arc::new(build_headers(&[(
            "session_nation".to_string(),
            Some("1".to_string()),
        )]));
        let sql = "SELECT * FROM customer";
        match transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql)
            .await
        {
            Err(e) => {
                assert_snapshot!(
                    e.to_string(),
                    @r"
                ModelAnalyzeRule
                caused by
                Error during planning: session property session_user is required for `name` rule but not found in headers
                "
                )
            }
            _ => panic!("Expected error"),
        }

        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_nationkey", "int").build())
                    .column(ColumnBuilder::new("c_name", "string").build())
                    .add_row_level_access_control(
                        "nation",
                        vec![
                            SessionProperty::new_required("session_nation"),
                            SessionProperty::new_optional("session_user", None),
                        ],
                        "c_nationkey = @session_nation AND c_name = @session_user",
                    )
                    .build(),
            )
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let sql = "SELECT * FROM customer";

        let headers = Arc::new(build_headers(&[
            ("session_nation".to_string(), Some("1".to_string())),
            ("session_user".to_string(), Some("'Peko'".to_string())),
        ]));
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql).await?,
            @"SELECT customer.c_nationkey, customer.c_name FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer WHERE customer.c_nationkey = 1 AND customer.c_name = 'Peko') AS customer"
        );

        // expect ignore the rule because session_user is optional without default value
        let headers = Arc::new(build_headers(&[(
            "session_nation".to_string(),
            Some("1".to_string()),
        )]));
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql).await?,
            @"SELECT customer.c_nationkey, customer.c_name FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer"
        );
        // expect error because session_user is required
        let headers = Arc::new(build_headers(&[(
            "session_user".to_string(),
            Some("'Peko'".to_string()),
        )]));
        match transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql)
            .await
        {
            Err(e) => {
                assert_snapshot!(
                    e.to_string(),
                    @r"
                ModelAnalyzeRule
                caused by
                Error during planning: session property session_nation is required for `nation` rule but not found in headers
                "
                )
            }
            _ => panic!("Expected error"),
        }
        Ok(())
    }

    #[tokio::test]
    async fn test_rlac_with_optional_properties() -> Result<()> {
        let ctx = create_wren_ctx(None, None);

        // test required property
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_nationkey", "int").build())
                    .column(ColumnBuilder::new("c_name", "string").build())
                    .add_row_level_access_control(
                        "nation",
                        vec![SessionProperty::new_optional(
                            "session_nation",
                            Some("3".to_string()),
                        )],
                        "c_nationkey = @session_nation",
                    )
                    .build(),
            )
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let sql = "SELECT * FROM customer";
        let headers = Arc::new(build_headers(&[(
            "session_nation".to_string(),
            Some("1".to_string()),
        )]));
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql)
                .await?,
            @"SELECT customer.c_nationkey, customer.c_name FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer WHERE customer.c_nationkey = 1) AS customer"
        );
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::new(HashMap::new()), sql)
                .await?,
            @"SELECT customer.c_nationkey, customer.c_name FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer WHERE customer.c_nationkey = 3) AS customer"
        );

        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_nationkey", "int").build())
                    .column(ColumnBuilder::new("c_name", "string").build())
                    .add_row_level_access_control(
                        "nation",
                        vec![SessionProperty::new_optional("session_nation", None)],
                        "c_nationkey = @session_nation",
                    )
                    .build(),
            )
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let headers = Arc::new(build_headers(&[(
            "session_nation".to_string(),
            Some("1".to_string()),
        )]));
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql)
                .await?,
            @"SELECT customer.c_nationkey, customer.c_name FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer WHERE customer.c_nationkey = 1) AS customer"
        );
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::new(HashMap::new()), sql)
                .await?,
            @"SELECT customer.c_nationkey, customer.c_name FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer"
        );

        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_nationkey", "int").build())
                    .column(ColumnBuilder::new("c_name", "string").build())
                    .add_row_level_access_control(
                        "nation",
                        vec![
                            SessionProperty::new_optional("session_nation", None),
                            SessionProperty::new_optional(
                                "session_user",
                                Some("'Gura'".to_string()),
                            ),
                        ],
                        "c_nationkey = @session_nation and c_name = @session_user",
                    )
                    .build(),
            )
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let headers = Arc::new(build_headers(&[(
            "session_nation".to_string(),
            Some("1".to_string()),
        )]));
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql)
                .await?,
            @"SELECT customer.c_nationkey, customer.c_name FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer WHERE customer.c_nationkey = 1 AND customer.c_name = 'Gura') AS customer"
        );
        // the rule is expected to be skipped because the optional property is None without default value
        let headers = Arc::new(build_headers(&[(
            "session_user".to_string(),
            Some("'Peko'".to_string()),
        )]));
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql)
                .await?,
            @"SELECT customer.c_nationkey, customer.c_name FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer"
        );
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::new(HashMap::new()), sql)
                .await?,
            @"SELECT customer.c_nationkey, customer.c_name FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer"
        );

        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_nationkey", "int").build())
                    .column(ColumnBuilder::new("c_name", "string").build())
                    .add_row_level_access_control(
                        "nation",
                        vec![
                            // if the default value is empty, it will be skipped
                            SessionProperty::new_optional(
                                "session_nation",
                                Some("".to_string()),
                            ),
                            SessionProperty::new_optional(
                                "session_user",
                                Some("'Gura'".to_string()),
                            ),
                        ],
                        "c_nationkey = @session_nation and c_name = @session_user",
                    )
                    .build(),
            )
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let headers = Arc::new(build_headers(&[(
            "session_nation".to_string(),
            Some("1".to_string()),
        )]));
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql)
                .await?,
            @"SELECT customer.c_nationkey, customer.c_name FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer WHERE customer.c_nationkey = 1 AND customer.c_name = 'Gura') AS customer"
        );
        // the rule is expected to be skipped because the optional property is None without default value
        let headers = Arc::new(build_headers(&[(
            "session_user".to_string(),
            Some("'Peko'".to_string()),
        )]));
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql)
                .await?,
            @"SELECT customer.c_nationkey, customer.c_name FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer"
        );
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::new(HashMap::new()), sql)
                .await?,
            @"SELECT customer.c_nationkey, customer.c_name FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer"
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_rlac_on_calculated_field() -> Result<()> {
        let ctx = create_wren_ctx(None, None);

        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_custkey", "int").build())
                    .column(ColumnBuilder::new("c_nationkey", "int").build())
                    .column(ColumnBuilder::new("c_name", "string").build())
                    .primary_key("c_custkey")
                    .build(),
            )
            .model(
                ModelBuilder::new("orders")
                    .table_reference("orders")
                    .column(ColumnBuilder::new("o_orderkey", "int").build())
                    .column(ColumnBuilder::new("o_custkey", "int").build())
                    .column(
                        ColumnBuilder::new("customer", "customer")
                            .relationship("customer_orders")
                            .build(),
                    )
                    .column(
                        ColumnBuilder::new("customer_name", "string")
                            .calculated(true)
                            .expression("customer.c_name")
                            .build(),
                    )
                    .primary_key("o_orderkey")
                    .add_row_level_access_control(
                        "customer name",
                        vec![SessionProperty::new_required("session_user")],
                        "customer_name = @session_user",
                    )
                    .build(),
            )
            .relationship(
                RelationshipBuilder::new("customer_orders")
                    .model("customer")
                    .model("orders")
                    .join_type(JoinType::OneToMany)
                    .condition("customer.c_custkey = orders.o_custkey")
                    .build(),
            )
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let headers = Arc::new(build_headers(&[(
            "session_user".to_string(),
            Some("'Gura'".to_string()),
        )]));
        let sql = "SELECT * FROM orders";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers.clone(), sql).await?,
            @"SELECT orders.o_orderkey, orders.o_custkey, orders.customer_name FROM (SELECT orders.customer_name, orders.o_custkey, orders.o_orderkey FROM (SELECT __relation__1.c_name AS customer_name, __relation__1.o_custkey, __relation__1.o_orderkey FROM (SELECT customer.c_custkey, customer.c_name, orders.o_custkey, orders.o_orderkey FROM (SELECT customer.c_custkey, customer.c_name FROM (SELECT customer.c_custkey, customer.c_name FROM (SELECT __source.c_custkey AS c_custkey, __source.c_name AS c_name FROM customer AS __source) AS customer) AS customer) AS customer RIGHT OUTER JOIN (SELECT __source.o_custkey AS o_custkey, __source.o_orderkey AS o_orderkey FROM orders AS __source) AS orders ON customer.c_custkey = orders.o_custkey) AS __relation__1) AS orders WHERE orders.customer_name = 'Gura') AS orders"
        );

        let sql = "SELECT * FROM orders where o_orderkey > 10";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql).await?,
            @"SELECT orders.o_orderkey, orders.o_custkey, orders.customer_name FROM (SELECT orders.customer_name, orders.o_custkey, orders.o_orderkey FROM (SELECT __relation__1.c_name AS customer_name, __relation__1.o_custkey, __relation__1.o_orderkey FROM (SELECT customer.c_custkey, customer.c_name, orders.o_custkey, orders.o_orderkey FROM (SELECT customer.c_custkey, customer.c_name FROM (SELECT customer.c_custkey, customer.c_name FROM (SELECT __source.c_custkey AS c_custkey, __source.c_name AS c_name FROM customer AS __source) AS customer) AS customer) AS customer RIGHT OUTER JOIN (SELECT __source.o_custkey AS o_custkey, __source.o_orderkey AS o_orderkey FROM orders AS __source) AS orders ON customer.c_custkey = orders.o_custkey) AS __relation__1) AS orders WHERE orders.customer_name = 'Gura') AS orders WHERE orders.o_orderkey > 10"
        );

        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_custkey", "int").build())
                    .column(ColumnBuilder::new("c_nationkey", "int").build())
                    .column(ColumnBuilder::new("c_name", "string").build())
                    .column(
                        ColumnBuilder::new_relationship(
                            "orders",
                            "orders",
                            "customer_orders",
                        )
                        .build(),
                    )
                    .column(
                        ColumnBuilder::new_calculated("totalprice", "int")
                            .expression("sum(orders.o_totalprice)")
                            .build(),
                    )
                    .primary_key("c_custkey")
                    .add_row_level_access_control(
                        "nation rule",
                        vec![SessionProperty::new_optional("session_nation", None)],
                        "c_nationkey = @session_nation",
                    )
                    .build(),
            )
            .model(
                ModelBuilder::new("orders")
                    .table_reference("orders")
                    .column(ColumnBuilder::new("o_orderkey", "int").build())
                    .column(ColumnBuilder::new("o_custkey", "int").build())
                    .column(ColumnBuilder::new("o_totalprice", "int").build())
                    .column(
                        ColumnBuilder::new_relationship(
                            "customer",
                            "customer",
                            "customer_orders",
                        )
                        .build(),
                    )
                    .column(
                        ColumnBuilder::new_calculated("customer_name", "string")
                            .expression("customer.c_name")
                            .build(),
                    )
                    .primary_key("o_orderkey")
                    .add_row_level_access_control(
                        "user rule",
                        vec![SessionProperty::new_optional("session_user", None)],
                        "o_custkey = @session_user",
                    )
                    .build(),
            )
            .relationship(
                RelationshipBuilder::new("customer_orders")
                    .model("customer")
                    .model("orders")
                    .join_type(JoinType::OneToMany)
                    .condition("customer.c_custkey = orders.o_custkey")
                    .build(),
            )
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let headers = Arc::new(build_headers(&[(
            "session_nation".to_string(),
            Some("1".to_string()),
        )]));
        let sql = "SELECT customer_name FROM orders";
        // test custoer model used by customer_name should be filtered by nation rule.
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql).await?,
            @"SELECT orders.customer_name FROM (SELECT __relation__1.c_name AS customer_name FROM (SELECT customer.c_custkey, customer.c_name, orders.o_custkey FROM (SELECT customer.c_custkey, customer.c_name FROM (SELECT customer.c_custkey, customer.c_name, customer.c_nationkey FROM (SELECT customer.c_custkey, customer.c_name, customer.c_nationkey FROM (SELECT __source.c_custkey AS c_custkey, __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer WHERE customer.c_nationkey = 1) AS customer) AS customer RIGHT OUTER JOIN (SELECT __source.o_custkey AS o_custkey FROM orders AS __source) AS orders ON customer.c_custkey = orders.o_custkey) AS __relation__1) AS orders"
        );
        let headers = Arc::new(build_headers(&[(
            "session_user".to_string(),
            Some("1".to_string()),
        )]));
        let sql = "SELECT totalprice FROM customer";
        // test orders model used by totalprice should be filtered by user rule.
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @"SELECT customer.totalprice FROM (SELECT __relation__1.totalprice FROM (SELECT totalprice.c_custkey, totalprice.totalprice FROM (SELECT __relation__1.c_custkey AS c_custkey, sum(CAST(__relation__1.o_totalprice AS BIGINT)) AS totalprice FROM (SELECT customer.c_custkey, orders.o_custkey, orders.o_totalprice FROM (SELECT orders.o_custkey, orders.o_totalprice FROM (SELECT orders.o_custkey, orders.o_totalprice FROM (SELECT orders.o_custkey, orders.o_totalprice FROM (SELECT __source.o_custkey AS o_custkey, __source.o_totalprice AS o_totalprice FROM orders AS __source) AS orders) AS orders WHERE orders.o_custkey = 1) AS orders) AS orders RIGHT OUTER JOIN (SELECT __source.c_custkey AS c_custkey FROM customer AS __source) AS customer ON orders.o_custkey = customer.c_custkey) AS __relation__1 GROUP BY __relation__1.c_custkey) AS totalprice RIGHT OUTER JOIN (SELECT __source.c_custkey AS c_custkey FROM customer AS __source) AS customer ON totalprice.c_custkey = customer.c_custkey) AS __relation__1) AS customer",
        );

        let sql = "SELECT totalprice FROM customer c";
        // test orders model used by totalprice should be filtered by user rule.
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql).await?,
            @"SELECT c.totalprice FROM (SELECT __relation__1.totalprice FROM (SELECT totalprice.c_custkey, totalprice.totalprice FROM (SELECT __relation__1.c_custkey AS c_custkey, sum(CAST(__relation__1.o_totalprice AS BIGINT)) AS totalprice FROM (SELECT customer.c_custkey, orders.o_custkey, orders.o_totalprice FROM (SELECT orders.o_custkey, orders.o_totalprice FROM (SELECT orders.o_custkey, orders.o_totalprice FROM (SELECT orders.o_custkey, orders.o_totalprice FROM (SELECT __source.o_custkey AS o_custkey, __source.o_totalprice AS o_totalprice FROM orders AS __source) AS orders) AS orders WHERE orders.o_custkey = 1) AS orders) AS orders RIGHT OUTER JOIN (SELECT __source.c_custkey AS c_custkey FROM customer AS __source) AS customer ON orders.o_custkey = customer.c_custkey) AS __relation__1 GROUP BY __relation__1.c_custkey) AS totalprice RIGHT OUTER JOIN (SELECT __source.c_custkey AS c_custkey FROM customer AS __source) AS customer ON totalprice.c_custkey = customer.c_custkey) AS __relation__1) AS c",
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_rlac_alias_model() -> Result<()> {
        let ctx = create_wren_ctx(None, None);
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_nationkey", "int").build())
                    .column(ColumnBuilder::new("c_custkey", "int").build())
                    .column(ColumnBuilder::new("c_name", "string").build())
                    .add_row_level_access_control(
                        "nation",
                        vec![SessionProperty::new_optional("session_nation", None)],
                        "c_nationkey = @session_nation",
                    )
                    .build(),
            )
            .model(
                ModelBuilder::new("orders")
                    .table_reference("orders")
                    .column(ColumnBuilder::new("o_orderkey", "int").build())
                    .column(ColumnBuilder::new("o_custkey", "int").build())
                    .column(ColumnBuilder::new("o_totalprice", "int").build())
                    .add_row_level_access_control(
                        "user rule",
                        vec![SessionProperty::new_optional("session_user", None)],
                        "o_custkey = @session_user",
                    )
                    .build(),
            )
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let headers = Arc::new(build_headers(&[(
            "session_nation".to_string(),
            Some("1".to_string()),
        )]));
        let sql = "SELECT c_name FROM customer c";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql)
                .await?,
            @"SELECT c.c_name FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer WHERE customer.c_nationkey = 1) AS c"
        );

        let headers = Arc::new(build_headers(&[
            ("session_nation".to_string(), Some("1".to_string())),
            ("session_user".to_string(), Some("1".to_string())),
        ]));
        let sql =
            "SELECT c_name FROM customer c JOIN orders o ON c.c_custkey = o.o_custkey";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql)
                .await?,
            @"SELECT c.c_name FROM (SELECT customer.c_custkey, customer.c_name, customer.c_nationkey FROM (SELECT customer.c_custkey, customer.c_name, customer.c_nationkey FROM (SELECT __source.c_custkey AS c_custkey, __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer WHERE customer.c_nationkey = 1) AS c INNER JOIN (SELECT orders.o_custkey FROM (SELECT orders.o_custkey FROM (SELECT __source.o_custkey AS o_custkey FROM orders AS __source) AS orders) AS orders WHERE orders.o_custkey = 1) AS o ON c.c_custkey = o.o_custkey"
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_rlac_unicode_model_column_name() -> Result<()> {
        let ctx = create_wren_ctx(None, None);
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("VTU藝人")
                    .table_reference("artist")
                    .column(ColumnBuilder::new("名字", "string").build())
                    .column(ColumnBuilder::new("組別", "string").build())
                    .column(ColumnBuilder::new("訂閱數", "int").build())
                    .add_row_level_access_control(
                        "rule",
                        vec![SessionProperty::new_required("預定組別A")],
                        "組別 = @預定組別A",
                    )
                    .build(),
            )
            .build();
        let headers = Arc::new(build_headers(&[(
            "預定組別A".to_string(),
            Some("'JP'".to_string()),
        )]));

        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::clone(&headers),
            Mode::Unparse,
        )?);

        let sql = r#"SELECT 名字, 組別, 訂閱數 FROM VTU藝人"#;
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql)
                .await?,
            @r#"SELECT "VTU藝人"."名字", "VTU藝人"."組別", "VTU藝人"."訂閱數" FROM (SELECT "VTU藝人"."名字", "VTU藝人"."組別", "VTU藝人"."訂閱數" FROM (SELECT "VTU藝人"."名字", "VTU藝人"."組別", "VTU藝人"."訂閱數" FROM (SELECT __source."名字" AS "名字", __source."組別" AS "組別", __source."訂閱數" AS "訂閱數" FROM artist AS __source) AS "VTU藝人") AS "VTU藝人" WHERE "VTU藝人"."組別" = 'JP') AS "VTU藝人""#
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_ralc_condition_contain_hidden() -> Result<()> {
        let ctx = create_wren_ctx(None, None);

        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_custkey", "int").build())
                    .column(ColumnBuilder::new("c_name", "string").hidden(true).build())
                    .add_row_level_access_control(
                        "hidden condition",
                        vec![],
                        "c_name = 'Peko'",
                    )
                    .build(),
            )
            .build();

        let headers = SessionPropertiesRef::default();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest.clone(),
            headers.clone(),
            Mode::Unparse,
        )?);
        let sql = "SELECT * FROM customer";

        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @"SELECT customer.c_custkey FROM (SELECT customer.c_custkey, customer.c_name FROM (SELECT customer.c_custkey, customer.c_name FROM (SELECT __source.c_custkey AS c_custkey, __source.c_name AS c_name FROM customer AS __source) AS customer) AS customer WHERE customer.c_name = 'Peko') AS customer"
        );

        // assert the hidden column can't be used directly
        let sql = "SELECT c_name FROm customer";
        match transform_sql_with_ctx(&ctx, analyzed_mdl, &[], headers, sql).await {
            Ok(_) => panic!("Expected error"),
            Err(e) => {
                assert_snapshot!(
                    e.to_string(),
                    @"Schema error: No field named c_name. Valid fields are customer.c_custkey."
                )
            }
        }
        Ok(())
    }

    #[tokio::test]
    async fn test_clac_with_required_properties() -> Result<()> {
        let ctx = create_wren_ctx(None, None);

        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_custkey", "int").build())
                    .column(
                        ColumnBuilder::new("c_name", "string")
                            .column_level_access_control(
                                "cls rule",
                                vec![SessionProperty::new_required("Session_level")],
                                ColumnLevelOperator::Equals,
                                "1",
                            )
                            .build(),
                    )
                    .build(),
            )
            .build();
        let headers = Arc::new(build_headers(&[(
            "session_level".to_string(),
            Some("1".to_string()),
        )]));
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest.clone(),
            headers.clone(),
            Mode::Unparse,
        )?);
        let sql = "SELECT * FROM customer";

        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql).await?,
            @"SELECT customer.c_custkey, customer.c_name FROM (SELECT customer.c_custkey, customer.c_name FROM (SELECT __source.c_custkey AS c_custkey, __source.c_name AS c_name FROM customer AS __source) AS customer) AS customer"
        );

        let headers = Arc::new(build_headers(&[(
            "session_level".to_string(),
            Some("0".to_string()),
        )]));
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest.clone(),
            headers.clone(),
            Mode::Unparse,
        )?);
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql).await?,
            @"SELECT customer.c_custkey FROM (SELECT customer.c_custkey FROM (SELECT __source.c_custkey AS c_custkey FROM customer AS __source) AS customer) AS customer"
        );

        let headers = Arc::new(HashMap::default());
        match AnalyzedWrenMDL::analyze(manifest.clone(), headers.clone(), Mode::Unparse) {
            Err(e) => {
                assert_snapshot!(
                    e.to_string(),
                    @"Error during planning: session property Session_level is required for `cls rule` rule but not found in headers"
                )
            }
            _ => panic!("Expected error"),
        }

        let headers = Arc::new(build_headers(&[(
            "session_level".to_string(),
            Some("0".to_string()),
        )]));
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest.clone(),
            headers.clone(),
            Mode::Unparse,
        )?);
        let sql = "SELECT c_name FROM customer";

        match transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql)
            .await
        {
            Err(e) => {
                assert_snapshot!(
                    e.to_string(),
                    @r#"
                ModelAnalyzeRule
                caused by
                External error: Permission Denied: Access denied to column "customer"."c_name": violates access control rule "cls rule"
                "#
                )
            }
            Ok(sql) => {
                panic!("Expected error, but got SQL: {sql}");
            }
        }

        Ok(())
    }

    #[tokio::test]
    async fn test_clac_permission_denied() -> Result<()> {
        let ctx = create_wren_ctx(None, None);
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_custkey", "int").build())
                    .column(
                        ColumnBuilder::new("c_name", "string")
                            .column_level_access_control(
                                "cls rule",
                                vec![SessionProperty::new_required("session_level")],
                                ColumnLevelOperator::Equals,
                                "1",
                            )
                            .build(),
                    )
                    .column(
                        ColumnBuilder::new("c_name_2", "string")
                            .column_level_access_control(
                                "cls rule",
                                vec![SessionProperty::new_required("session_level")],
                                ColumnLevelOperator::Equals,
                                "2",
                            )
                            .build(),
                    )
                    .add_row_level_access_control(
                        "rls",
                        vec![SessionProperty::new_optional(
                            "session_role",
                            Some("'member'".to_string()),
                        )],
                        "@session_role = c_name_2",
                    )
                    .build(),
            )
            .build();

        let headers = Arc::new(build_headers(&[(
            "session_level".to_string(),
            Some("1".to_string()),
        )]));
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest.clone(),
            headers.clone(),
            Mode::Unparse,
        )?);
        let sql = "SELECT c_name FROM customer";

        match transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql)
            .await
        {
            Err(e) => {
                assert_snapshot!(
                    e.to_string(),
                    @r#"
                ModelAnalyzeRule
                caused by
                External error: Permission Denied: Access denied to column "customer"."c_name_2": violates access control rule "cls rule"
                "#
                )
            }
            Ok(sql) => {
                panic!("Expected error, but got SQL: {sql}");
            }
        }
        Ok(())
    }

    #[tokio::test]
    async fn test_calc_primary_key() -> Result<()> {
        let ctx = create_wren_ctx(None, None);
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_custkey", "int").build())
                    .column(
                        ColumnBuilder::new("c_name", "string")
                            .column_level_access_control(
                                "cls rule",
                                vec![SessionProperty::new_required("session_level")],
                                ColumnLevelOperator::Equals,
                                "1",
                            )
                            .build(),
                    )
                    .primary_key("c_name")
                    .build(),
            )
            .build();
        let headers = Arc::new(build_headers(&[(
            "session_level".to_string(),
            Some("0".to_string()),
        )]));
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest.clone(),
            headers.clone(),
            Mode::Unparse,
        )?);
        let sql = "SELECT c_custkey FROM customer";

        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql).await?,
            @"SELECT customer.c_custkey FROM (SELECT customer.c_custkey FROM (SELECT __source.c_custkey AS c_custkey FROM customer AS __source) AS customer) AS customer"
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_clac_with_optional_properties() -> Result<()> {
        let ctx = create_wren_ctx(None, None);

        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_custkey", "int").build())
                    .column(
                        ColumnBuilder::new("c_name", "string")
                            .column_level_access_control(
                                "cls rule",
                                vec![SessionProperty::new_optional(
                                    "session_level",
                                    Some("2".to_string()),
                                )],
                                ColumnLevelOperator::Equals,
                                "1",
                            )
                            .build(),
                    )
                    .build(),
            )
            .build();
        let headers = Arc::new(build_headers(&[(
            "session_level".to_string(),
            Some("1".to_string()),
        )]));
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest.clone(),
            headers.clone(),
            Mode::Unparse,
        )?);
        let sql = "SELECT * FROM customer";

        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql).await?,
            @"SELECT customer.c_custkey, customer.c_name FROM (SELECT customer.c_custkey, customer.c_name FROM (SELECT __source.c_custkey AS c_custkey, __source.c_name AS c_name FROM customer AS __source) AS customer) AS customer"
        );

        let headers = Arc::new(build_headers(&[(
            "session_level".to_string(),
            Some("0".to_string()),
        )]));
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest.clone(),
            headers.clone(),
            Mode::Unparse,
        )?);
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql).await?,
            @"SELECT customer.c_custkey FROM (SELECT customer.c_custkey FROM (SELECT __source.c_custkey AS c_custkey FROM customer AS __source) AS customer) AS customer"
        );

        // test the rule is applied the default value if the optional property is None
        let headers = Arc::new(HashMap::default());
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest.clone(),
            headers.clone(),
            Mode::Unparse,
        )?);
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql).await?,
            @"SELECT customer.c_custkey FROM (SELECT customer.c_custkey FROM (SELECT __source.c_custkey AS c_custkey FROM customer AS __source) AS customer) AS customer"
        );

        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_custkey", "int").build())
                    .column(
                        ColumnBuilder::new("c_name", "string")
                            .column_level_access_control(
                                "cls rule",
                                vec![SessionProperty::new_optional(
                                    "session_level",
                                    None,
                                )],
                                ColumnLevelOperator::Equals,
                                "1",
                            )
                            .build(),
                    )
                    .build(),
            )
            .build();
        let sql = "SELECT * FROM customer";

        // test the rule is skipped when the optional property is None
        let headers = Arc::new(HashMap::default());
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest.clone(),
            headers.clone(),
            Mode::Unparse,
        )?);
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql).await?,
            @"SELECT customer.c_custkey, customer.c_name FROM (SELECT customer.c_custkey, customer.c_name FROM (SELECT __source.c_custkey AS c_custkey, __source.c_name AS c_name FROM customer AS __source) AS customer) AS customer"
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_clac_on_calculated_field() -> Result<()> {
        let ctx = create_wren_ctx(None, None);

        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_custkey", "int").build())
                    .column(
                        ColumnBuilder::new("c_name", "string")
                            .column_level_access_control(
                                "cls rule",
                                vec![SessionProperty::new_required("session_level")],
                                ColumnLevelOperator::Equals,
                                "1",
                            )
                            .build(),
                    )
                    .column(
                        ColumnBuilder::new_calculated("c_name_upper", "string")
                            .expression("upper(c_name)")
                            .build(),
                    )
                    .build(),
            )
            .build();
        let headers = Arc::new(build_headers(&[(
            "session_level".to_string(),
            Some("1".to_string()),
        )]));
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest.clone(),
            headers.clone(),
            Mode::Unparse,
        )?);
        let sql = "SELECT c_name_upper FROM customer";

        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql).await?,
            @"SELECT customer.c_name_upper FROM (SELECT upper(customer.c_name) AS c_name_upper FROM (SELECT __source.c_name AS c_name FROM customer AS __source) AS customer) AS customer"
        );

        let headers = Arc::new(build_headers(&[(
            "session_level".to_string(),
            Some("0".to_string()),
        )]));
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest.clone(),
            headers.clone(),
            Mode::Unparse,
        )?);

        match transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::clone(&headers),
            sql,
        )
        .await
        {
            Err(e) => {
                assert_snapshot!(
                    e.to_string(),
                    @r#"
                ModelAnalyzeRule
                caused by
                External error: Permission Denied: Access denied to column "customer"."c_name_upper": violates access control rule "cls rule"
                "#
                )
            }
            _ => panic!("Expected error"),
        }

        let sql = "SELECT * FROM customer";

        assert_snapshot!(transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @"SELECT customer.c_custkey FROM (SELECT customer.c_custkey FROM (SELECT __source.c_custkey AS c_custkey FROM customer AS __source) AS customer) AS customer"
        );

        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_custkey", "int").build())
                    .column(
                        ColumnBuilder::new("c_name", "string")
                            .column_level_access_control(
                                "cls rule",
                                vec![SessionProperty::new_required("session_level")],
                                ColumnLevelOperator::Equals,
                                "1",
                            )
                            .build(),
                    )
                    .build(),
            )
            .model(
                ModelBuilder::new("orders")
                    .table_reference("orders")
                    .column(ColumnBuilder::new("o_orderkey", "int").build())
                    .column(ColumnBuilder::new("o_custkey", "int").build())
                    .column(
                        ColumnBuilder::new("customer", "customer")
                            .relationship("customer_orders")
                            .build(),
                    )
                    .column(
                        ColumnBuilder::new_calculated("customer_name", "string")
                            .expression("customer.c_name")
                            .build(),
                    )
                    .build(),
            )
            .relationship(
                RelationshipBuilder::new("customer_orders")
                    .model("customer")
                    .model("orders")
                    .join_type(JoinType::OneToMany)
                    .condition("customer.c_custkey = orders.o_custkey")
                    .build(),
            )
            .build();

        let headers = Arc::new(build_headers(&[(
            "session_level".to_string(),
            Some("0".to_string()),
        )]));
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest.clone(),
            headers.clone(),
            Mode::Unparse,
        )?);

        let sql = "SELECT * FROM orders";
        let headers = Arc::new(build_headers(&[(
            "session_level".to_string(),
            Some("0".to_string()),
        )]));
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql).await?,
            @"SELECT orders.o_orderkey, orders.o_custkey FROM (SELECT orders.o_custkey, orders.o_orderkey FROM (SELECT __source.o_custkey AS o_custkey, __source.o_orderkey AS o_orderkey FROM orders AS __source) AS orders) AS orders"
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_rlac_case_insensitive() -> Result<()> {
        let ctx = create_wren_ctx(None, None);

        // test required property
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_nationkey", "int").build())
                    .column(ColumnBuilder::new("c_name", "string").build())
                    .add_row_level_access_control(
                        "nation",
                        vec![SessionProperty::new_required("session_nation")],
                        "c_nationkey = @session_nation",
                    )
                    .build(),
            )
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let sql = "SELECT * FROM customer";
        let headers = Arc::new(build_headers(&[(
            "SESSION_NATION".to_string(),
            Some("1".to_string()),
        )]));
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql).await?,
            @"SELECT customer.c_nationkey, customer.c_name FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer WHERE customer.c_nationkey = 1) AS customer"
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_disable_eliminate_limit() -> Result<()> {
        let ctx = create_wren_ctx(None, None);

        // test required property
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_nationkey", "int").build())
                    .column(ColumnBuilder::new("c_name", "string").build())
                    .build(),
            )
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let sql = "SELECT * FROM customer limit 0";
        let headers = Arc::new(HashMap::default());
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql).await?,
            @"SELECT customer.c_nationkey, customer.c_name FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer LIMIT 0"
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_default_nulls_last() -> Result<()> {
        let ctx = create_wren_ctx(None, None);

        // test required property
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_nationkey", "int").build())
                    .column(ColumnBuilder::new("c_name", "string").build())
                    .build(),
            )
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let headers = Arc::new(HashMap::default());
        let sql = "SELECT c_name FROM customer order by c_nationkey";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @"SELECT customer.c_name FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer ORDER BY customer.c_nationkey ASC NULLS LAST"
        );

        let sql = "SELECT c_name FROM customer order by c_nationkey asc";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @"SELECT customer.c_name FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer ORDER BY customer.c_nationkey ASC NULLS LAST"
        );

        let sql = "SELECT c_name FROM customer order by c_nationkey desc";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @"SELECT customer.c_name FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer ORDER BY customer.c_nationkey DESC NULLS LAST"
        );

        let sql = "SELECT c_name FROM customer order by c_nationkey asc nulls first";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @"SELECT customer.c_name FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer ORDER BY customer.c_nationkey ASC NULLS FIRST"
        );

        let sql = "SELECT c_name FROM customer order by c_nationkey, c_name";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @"SELECT customer.c_name FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer ORDER BY customer.c_nationkey ASC NULLS LAST, customer.c_name ASC NULLS LAST"
        );

        let sql =
            "SELECT c_name FROM customer order by c_nationkey, c_name desc nulls first";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @"SELECT customer.c_name FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer ORDER BY customer.c_nationkey ASC NULLS LAST, customer.c_name DESC NULLS FIRST"
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_extract_roundtrip_bigquery() -> Result<()> {
        let ctx = create_wren_ctx(None, Some(&DataSource::BigQuery));
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("orders")
                    .table_reference("orders")
                    .column(ColumnBuilder::new("o_orderdate", "date").build())
                    .build(),
            )
            .data_source(DataSource::BigQuery)
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let headers = Arc::new(HashMap::default());
        let sql = "SELECT EXTRACT(YEAR FROM o_orderdate) FROM orders";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @"SELECT EXTRACT(YEAR FROM orders.o_orderdate) FROM (SELECT orders.o_orderdate FROM (SELECT __source.o_orderdate AS o_orderdate FROM orders AS __source) AS orders) AS orders"
        );

        let sql = "SELECT EXTRACT(WEEK FROM o_orderdate) FROM orders";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @"SELECT EXTRACT(WEEK FROM orders.o_orderdate) FROM (SELECT orders.o_orderdate FROM (SELECT __source.o_orderdate AS o_orderdate FROM orders AS __source) AS orders) AS orders"
        );

        let sql = "SELECT EXTRACT(WEEK(MONDAY) FROM o_orderdate) FROM orders";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @"SELECT EXTRACT(WEEK(MONDAY) FROM orders.o_orderdate) FROM (SELECT orders.o_orderdate FROM (SELECT __source.o_orderdate AS o_orderdate FROM orders AS __source) AS orders) AS orders"
        );

        let sql = "SELECT EXTRACT(WEEK(NOTFOUND) FROM o_orderdate) FROM orders";
        match transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::clone(&headers),
            sql,
        )
        .await
        {
            Ok(_) => {
                panic!("Expected error, but got SQL");
            }
            Err(e) => assert_snapshot!(
                e.to_string(),
                @"Error during planning: Invalid weekday 'NOTFOUND' for WEEK. Valid values are SUNDAY, MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, and SATURDAY"
            ),
        }
        Ok(())
    }

    #[tokio::test]
    async fn test_window_function_frame() -> Result<()> {
        let ctx = create_wren_ctx(None, None);
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("orders")
                    .table_reference("orders")
                    .column(ColumnBuilder::new("o_orderkey", "int").build())
                    .column(ColumnBuilder::new("o_custkey", "int").build())
                    .column(ColumnBuilder::new("o_orderdate", "date").build())
                    .build(),
            )
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let headers = Arc::new(HashMap::default());
        // assert default won't generate the window frame
        let sql = "SELECT rank() OVER (PARTITION BY o_custkey ORDER BY o_orderdate) FROM orders";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @"SELECT rank() OVER (PARTITION BY orders.o_custkey ORDER BY orders.o_orderdate ASC NULLS LAST) FROM (SELECT orders.o_custkey, orders.o_orderdate FROM (SELECT __source.o_custkey AS o_custkey, __source.o_orderdate AS o_orderdate FROM orders AS __source) AS orders) AS orders"
        );

        // assert generate window frame if given
        let sql = "SELECT count(*) OVER (PARTITION BY o_custkey ORDER BY o_orderdate ROWS BETWEEN 1 PRECEDING AND 2 FOLLOWING) as window_col FROM orders";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @"SELECT count(1) OVER (PARTITION BY orders.o_custkey ORDER BY orders.o_orderdate ASC NULLS LAST ROWS BETWEEN 1 PRECEDING AND 2 FOLLOWING) AS window_col FROM (SELECT orders.o_custkey, orders.o_orderdate FROM (SELECT __source.o_custkey AS o_custkey, __source.o_orderdate AS o_orderdate FROM orders AS __source) AS orders) AS orders"
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_window_functions_without_frame_bigquery() -> Result<()> {
        let ctx = create_wren_ctx(None, None);
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("orders")
                    .table_reference("orders")
                    .column(ColumnBuilder::new("o_orderkey", "int").build())
                    .column(ColumnBuilder::new("o_custkey", "int").build())
                    .column(ColumnBuilder::new("o_orderdate", "date").build())
                    .build(),
            )
            .data_source(DataSource::BigQuery)
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let headers = Arc::new(HashMap::default());
        let sql = "SELECT rank() OVER (PARTITION BY o_custkey ORDER BY o_orderdate) FROM orders";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @"SELECT rank() OVER (PARTITION BY orders.o_custkey ORDER BY orders.o_orderdate ASC NULLS LAST) FROM (SELECT orders.o_custkey, orders.o_orderdate FROM (SELECT __source.o_custkey AS o_custkey, __source.o_orderdate AS o_orderdate FROM orders AS __source) AS orders) AS orders"
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_cte_used_in_scalar_subquery() -> Result<()> {
        let ctx = create_wren_ctx(None, None);
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("orders")
                    .table_reference("orders")
                    .column(ColumnBuilder::new("o_orderkey", "int").build())
                    .column(ColumnBuilder::new("o_custkey", "int").build())
                    .build(),
            )
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_custkey", "int").build())
                    .column(ColumnBuilder::new("c_name", "string").build())
                    .build(),
            )
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let headers = Arc::new(HashMap::default());
        let sql = r#"
        with cte1 as (
            select c_custkey from customer
        ),
        cte2 as (
            select o_orderkey from orders where o_custkey in (select c_custkey from cte1)
        )
        select * from cte2
        "#;
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @"SELECT cte2.o_orderkey FROM (SELECT orders.o_orderkey FROM (SELECT orders.o_custkey, orders.o_orderkey FROM (SELECT __source.o_custkey AS o_custkey, __source.o_orderkey AS o_orderkey FROM orders AS __source) AS orders) AS orders WHERE orders.o_custkey IN (SELECT cte1.c_custkey FROM (SELECT customer.c_custkey FROM (SELECT customer.c_custkey FROM (SELECT __source.c_custkey AS c_custkey FROM customer AS __source) AS customer) AS customer) AS cte1)) AS cte2"
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_ambiguous_table_name() -> Result<()> {
        let ctx = create_wren_ctx(None, None);
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_name", "int").build())
                    .column(ColumnBuilder::new("C_name", "string").build())
                    .build(),
            )
            .model(
                ModelBuilder::new("Customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_name", "int").build())
                    .column(ColumnBuilder::new("C_name", "string").build())
                    .build(),
            )
            .build();

        let headers = Arc::new(HashMap::default());
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::clone(&headers),
            Mode::Unparse,
        )?);

        let sql = "select c_name, C_name from customer";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @r#"SELECT customer.c_name, customer."C_name" FROM (SELECT customer."C_name", customer.c_name FROM (SELECT __source."C_name" AS "C_name", __source.c_name AS c_name FROM customer AS __source) AS customer) AS customer"#
        );

        let sql = "select c_name, C_name from Customer";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @r#"SELECT "Customer".c_name, "Customer"."C_name" FROM (SELECT "Customer"."C_name", "Customer".c_name FROM (SELECT __source."C_name" AS "C_name", __source.c_name AS c_name FROM customer AS __source) AS "Customer") AS "Customer""#
        );

        let sql = "select * from CUSTOMER";
        match transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::clone(&headers),
            sql,
        )
        .await
        {
            Ok(_) => {
                panic!("Expected error, but got SQL");
            }
            Err(e) => assert_snapshot!(
                e.to_string(),
                @"Error during planning: table 'wren.test.CUSTOMER' not found"
            ),
        }

        Ok(())
    }

    #[tokio::test]
    async fn test_unicode_literal() -> Result<()> {
        let ctx = create_wren_ctx(None, None);

        let manifest = ManifestBuilder::default().build();
        let properties = SessionPropertiesRef::default();
        let mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::clone(&properties),
            Mode::Unparse,
        )?);
        let sql = "select 'ZUTOMAYO', '永遠是深夜有多好'";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&mdl), &[], Arc::clone(&properties), sql).await?,
            @"SELECT 'ZUTOMAYO', '永遠是深夜有多好'"
        );

        let manifest = ManifestBuilder::default()
            .data_source(DataSource::MSSQL)
            .build();
        let properties = SessionPropertiesRef::default();
        let mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::clone(&properties),
            Mode::Unparse,
        )?);
        let sql = "select 'ZUTOMAYO', '永遠是深夜有多好'";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&mdl), &[], Arc::clone(&properties), sql).await?,
            @"SELECT 'ZUTOMAYO', '永遠是深夜有多好'"
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_compatible_type() -> Result<()> {
        let ctx = create_wren_ctx(None, None);

        let manifest = ManifestBuilder::default().build();
        let properties = SessionPropertiesRef::default();
        let mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::clone(&properties),
            Mode::Unparse,
        )?);
        let sql = "select cast(1 as int64)";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&mdl), &[], Arc::clone(&properties), sql).await?,
            @"SELECT CAST(1 AS BIGINT)"
        );
        Ok(())
    }

    // bigquery and mssql will transform trim to trim, others to btrim
    #[tokio::test]
    async fn test_trim_function_bigquery_and_mssql() -> Result<()> {
        let ctx = create_wren_ctx(None, Some(&DataSource::BigQuery));
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_custkey", "int").build())
                    .column(ColumnBuilder::new("c_name", "string").build())
                    .build(),
            )
            .data_source(DataSource::BigQuery)
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let headers = Arc::new(HashMap::default());
        let sql = "SELECT trim(c_name) FROM customer";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @"SELECT trim(customer.c_name) FROM (SELECT customer.c_name FROM (SELECT __source.c_name AS c_name FROM customer AS __source) AS customer) AS customer"
        );

        let ctx = create_wren_ctx(None, Some(&DataSource::MSSQL));
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_custkey", "int").build())
                    .column(ColumnBuilder::new("c_name", "string").build())
                    .build(),
            )
            .data_source(DataSource::MSSQL)
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);

        let headers = Arc::new(HashMap::default());
        let sql = "SELECT trim(c_name) FROM customer";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @"SELECT trim(customer.c_name) FROM (SELECT customer.c_name FROM (SELECT __source.c_name AS c_name FROM customer AS __source) AS customer) AS customer"
        );

        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_custkey", "int").build())
                    .column(ColumnBuilder::new("c_name", "string").build())
                    .build(),
            )
            .data_source(DataSource::MSSQL)
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);

        let headers = Arc::new(HashMap::default());
        let sql = "SELECT trim(c_name) FROM customer";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @"SELECT trim(customer.c_name) FROM (SELECT customer.c_name FROM (SELECT __source.c_name AS c_name FROM customer AS __source) AS customer) AS customer"
        );

        let ctx = create_wren_ctx(None, None);
        // normal data source will be transformed to btrim
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_custkey", "int").build())
                    .column(ColumnBuilder::new("c_name", "string").build())
                    .build(),
            )
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let headers = Arc::new(HashMap::default());
        let sql = "SELECT trim(c_name) FROM customer";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @"SELECT btrim(customer.c_name) FROM (SELECT customer.c_name FROM (SELECT __source.c_name AS c_name FROM customer AS __source) AS customer) AS customer"
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_to_char() -> Result<()> {
        let ctx = create_wren_ctx(None, None);
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_date", "date").build())
                    .column(ColumnBuilder::new("c_timestamp", "timestamp").build())
                    .column(ColumnBuilder::new("c_timestamptz", "timestamptz").build())
                    .column(ColumnBuilder::new("c_int", "int").build())
                    .column(ColumnBuilder::new("c_bigint", "bigint").build())
                    .column(ColumnBuilder::new("c_float", "float").build())
                    .column(ColumnBuilder::new("c_double", "double").build())
                    .column(ColumnBuilder::new("c_decimal", "decimal").build())
                    .build(),
            )
            .data_source(DataSource::BigQuery)
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let headers = Arc::new(HashMap::default());
        let sql = "SELECT to_char(c_date, '%Y-%m-%d'), to_char(c_timestamp, '%Y-%m-%d'), to_char(c_timestamptz, '%Y-%m-%d') FROM customer";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @"SELECT to_char(customer.c_date, '%Y-%m-%d'), to_char(customer.c_timestamp, '%Y-%m-%d'), to_char(customer.c_timestamptz, '%Y-%m-%d') FROM (SELECT customer.c_date, customer.c_timestamp, customer.c_timestamptz FROM (SELECT __source.c_date AS c_date, __source.c_timestamp AS c_timestamp, __source.c_timestamptz AS c_timestamptz FROM customer AS __source) AS customer) AS customer"
        );

        let sql = "SELECT to_char(c_int, '999'), to_char(c_bigint, '999'), to_char(c_float, '999.99'), to_char(c_double, '999.99'), to_char(c_decimal, '999.99') FROM customer";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @"SELECT to_char(customer.c_int, '999'), to_char(customer.c_bigint, '999'), to_char(customer.c_float, '999.99'), to_char(customer.c_double, '999.99'), to_char(customer.c_decimal, '999.99') FROM (SELECT customer.c_bigint, customer.c_decimal, customer.c_double, customer.c_float, customer.c_int FROM (SELECT __source.c_bigint AS c_bigint, __source.c_decimal AS c_decimal, __source.c_double AS c_double, __source.c_float AS c_float, __source.c_int AS c_int FROM customer AS __source) AS customer) AS customer"
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_disable_eliminate_cross_join() -> Result<()> {
        let ctx = create_wren_ctx(None, None);

        // test required property
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_nationkey", "int").build())
                    .column(ColumnBuilder::new("c_name", "string").build())
                    .build(),
            )
            .model(
                ModelBuilder::new("nation")
                    .table_reference("nation")
                    .column(ColumnBuilder::new("n_nationkey", "int").build())
                    .column(ColumnBuilder::new("n_name", "string").build())
                    .build(),
            )
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let sql = "SELECT * FROM customer, nation WHERE customer.c_nationkey = nation.n_nationkey";
        let headers = Arc::new(HashMap::default());
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], headers, sql).await?,
            @"SELECT customer.c_nationkey, customer.c_name, nation.n_nationkey, nation.n_name FROM (SELECT customer.c_name, customer.c_nationkey FROM (SELECT __source.c_name AS c_name, __source.c_nationkey AS c_nationkey FROM customer AS __source) AS customer) AS customer CROSS JOIN (SELECT nation.n_name, nation.n_nationkey FROM (SELECT __source.n_name AS n_name, __source.n_nationkey AS n_nationkey FROM nation AS __source) AS nation) AS nation WHERE customer.c_nationkey = nation.n_nationkey"
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_snowflake_unnest() -> Result<()> {
        let ctx = create_wren_ctx(None, Some(&DataSource::Snowflake));
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("orders")
                    .table_reference("orders")
                    .column(ColumnBuilder::new("o_items", "array<string>").build())
                    .build(),
            )
            .data_source(DataSource::Snowflake)
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let headers = Arc::new(HashMap::default());
        let sql = "SELECT item FROM orders o, unnest(o.o_items) as t(item)";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @"SELECT t.item FROM (SELECT orders.o_items FROM (SELECT __source.o_items AS o_items FROM orders AS __source) AS orders) AS o CROSS JOIN UNNEST(o.o_items) AS t (item)"
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_extract_roundtrip_mysql() -> Result<()> {
        let ctx = create_wren_ctx(None, Some(&DataSource::MySQL));
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("orders")
                    .table_reference("orders")
                    .column(ColumnBuilder::new("o_orderdate", "date").build())
                    .build(),
            )
            .data_source(DataSource::MySQL)
            .build();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let headers = Arc::new(HashMap::default());
        let sql = "SELECT EXTRACT(YEAR FROM o_orderdate) FROM orders";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @"SELECT EXTRACT(YEAR FROM orders.o_orderdate) FROM (SELECT orders.o_orderdate FROM (SELECT __source.o_orderdate AS o_orderdate FROM orders AS __source) AS orders) AS orders"
        );

        let sql = "SELECT EXTRACT(WEEK FROM o_orderdate) FROM orders";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @"SELECT EXTRACT(WEEK FROM orders.o_orderdate) FROM (SELECT orders.o_orderdate FROM (SELECT __source.o_orderdate AS o_orderdate FROM orders AS __source) AS orders) AS orders"
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_bigquery_json() -> Result<()> {
        let ctx = create_wren_ctx(None, Some(&DataSource::BigQuery));
        let manifest = ManifestBuilder::new()
            .catalog("wren")
            .schema("test")
            .model(
                ModelBuilder::new("json_table")
                    .table_reference("json_table")
                    .column(ColumnBuilder::new("json_col", "json").build())
                    .build(),
            )
            .data_source(DataSource::BigQuery)
            .build();
        let headers = SessionPropertiesRef::default();
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);
        let sql = "SELECT GET_PATH(json_col, '$.field') FROM json_table";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @r#"SELECT JSON_EXTRACT("json_table".json_col, '$.field') FROM (SELECT "json_table".json_col FROM (SELECT __source.json_col AS json_col FROM "json_table" AS __source) AS "json_table") AS "json_table""#
        );

        let sql = "SELECT AS_ARRAY(GET_PATH(json_col, '$.field')) FROM json_table";
        assert_snapshot!(
            transform_sql_with_ctx(&ctx, Arc::clone(&analyzed_mdl), &[], Arc::clone(&headers), sql).await?,
            @r#"SELECT JSON_EXTRACT_ARRAY("json_table".json_col, '$.field') FROM (SELECT "json_table".json_col FROM (SELECT __source.json_col AS json_col FROM "json_table" AS __source) AS "json_table") AS "json_table""#
        );
        Ok(())
    }

    /// Return a RecordBatch with made up data about customer
    fn customer() -> RecordBatch {
        let custkey: ArrayRef = Arc::new(Int64Array::from(vec![1, 2, 3]));
        let name: ArrayRef =
            Arc::new(StringArray::from_iter_values(["Gura", "Azki", "Ina"]));
        RecordBatch::try_from_iter(vec![("c_custkey", custkey), ("c_name", name)])
            .unwrap()
    }

    /// Return a RecordBatch with made up data about profile
    fn profile() -> RecordBatch {
        let custkey: ArrayRef = Arc::new(Int64Array::from(vec![1, 2, 3]));
        let phone: ArrayRef = Arc::new(StringArray::from_iter_values([
            "123456", "234567", "345678",
        ]));
        let sex: ArrayRef = Arc::new(StringArray::from_iter_values(["M", "M", "F"]));
        RecordBatch::try_from_iter(vec![
            ("p_custkey", custkey),
            ("p_phone", phone),
            ("p_sex", sex),
        ])
        .unwrap()
    }

    /// Return a RecordBatch with made up data about orders
    fn orders() -> RecordBatch {
        let orderkey: ArrayRef = Arc::new(Int64Array::from(vec![1, 2, 3]));
        let custkey: ArrayRef = Arc::new(Int64Array::from(vec![1, 2, 3]));
        let totalprice: ArrayRef = Arc::new(Int64Array::from(vec![100, 200, 300]));
        RecordBatch::try_from_iter(vec![
            ("o_orderkey", orderkey),
            ("o_custkey", custkey),
            ("o_totalprice", totalprice),
        ])
        .unwrap()
    }

    fn artist() -> RecordBatch {
        let name: ArrayRef =
            Arc::new(StringArray::from_iter_values(["Ina", "Azki", "Kaela"]));
        let group: ArrayRef = Arc::new(StringArray::from_iter_values(["EN", "JP", "ID"]));
        let subscribe: ArrayRef = Arc::new(Int64Array::from(vec![100, 200, 300]));
        let debut_time: ArrayRef =
            Arc::new(TimestampNanosecondArray::from(vec![1, 2, 3]));
        RecordBatch::try_from_iter(vec![
            ("名字", name),
            ("組別", group),
            ("訂閱數", subscribe),
            ("出道時間", debut_time),
        ])
        .unwrap()
    }

    fn timestamp_table() -> RecordBatch {
        let timestamp: ArrayRef = Arc::new(TimestampNanosecondArray::from(vec![1, 2, 3]));
        let timestamptz: ArrayRef =
            Arc::new(TimestampNanosecondArray::from(vec![1, 2, 3]).with_timezone("UTC"));
        RecordBatch::try_from_iter(vec![
            ("timestamp_col", timestamp),
            ("timestamptz_col", timestamptz),
        ])
        .unwrap()
    }

    fn batches_to_string(batches: &[RecordBatch]) -> String {
        let actual = pretty_format_batches_with_options(batches, &DEFAULT_FORMAT_OPTIONS)
            .unwrap()
            .to_string();

        actual.trim().to_string()
    }

    fn build_headers(
        field: &[(String, Option<String>)],
    ) -> HashMap<String, Option<String>> {
        let mut headers = HashMap::new();
        for (key, value) in field {
            headers.insert(key.to_lowercase(), value.clone());
        }
        headers
    }

    #[tokio::test]
    async fn test_analyze_with_url_tables_rejects_non_file_datasource() {
        let manifest = ManifestBuilder::new()
            .data_source(DataSource::BigQuery)
            .model(
                ModelBuilder::new("test")
                    .table_reference(r#""file:///tmp/test.parquet""#)
                    .column(ColumnBuilder::new("id", "int").build())
                    .build(),
            )
            .build();

        let ctx = datafusion::prelude::SessionContext::new();
        let result = AnalyzedWrenMDL::analyze_with_url_tables(manifest, &ctx).await;
        match result {
            Err(e) => assert!(
                e.to_string().contains("Only file-based data source"),
                "unexpected error: {e}"
            ),
            Ok(_) => panic!("expected error for non-file data source"),
        }
    }

    #[tokio::test]
    async fn test_analyze_with_url_tables_allows_no_datasource() {
        use datafusion::arrow::array::Int32Array;
        use datafusion::arrow::datatypes::{DataType, Schema};
        use datafusion::parquet::arrow::ArrowWriter;

        // Write a small Parquet file to a temp path
        let dir = std::env::temp_dir().join("wren_test_url_tables_no_ds");
        let _ = std::fs::create_dir_all(&dir);
        let parquet_path = dir.join("data.parquet");

        let schema =
            Arc::new(Schema::new(vec![datafusion::arrow::datatypes::Field::new(
                "id",
                DataType::Int32,
                false,
            )]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(Int32Array::from(vec![1, 2, 3])) as ArrayRef],
        )
        .unwrap();
        let file = std::fs::File::create(&parquet_path).unwrap();
        let mut writer = ArrowWriter::try_new(file, schema, None).unwrap();
        writer.write(&batch).unwrap();
        writer.close().unwrap();

        // Manifest with NO data_source set — should be allowed
        let url = format!("\"{}\"", parquet_path.display());
        let manifest = ManifestBuilder::new()
            .model(
                ModelBuilder::new("test")
                    .table_reference(&url)
                    .column(ColumnBuilder::new("id", "int").build())
                    .build(),
            )
            .build();

        let ctx = datafusion::prelude::SessionContext::new();
        let result = AnalyzedWrenMDL::analyze_with_url_tables(manifest, &ctx).await;
        assert!(result.is_ok(), "expected Ok, got: {:?}", result.err());
        let analyzed = result.unwrap();
        assert!(analyzed.wren_mdl().get_model("test").is_some());

        // Cleanup
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn test_analyze_with_url_tables_local_file_datasource() {
        use datafusion::arrow::array::Int32Array;
        use datafusion::arrow::datatypes::{DataType, Schema};
        use datafusion::parquet::arrow::ArrowWriter;

        let dir = std::env::temp_dir().join("wren_test_url_tables_local");
        let _ = std::fs::create_dir_all(&dir);
        let parquet_path = dir.join("orders.parquet");

        let schema = Arc::new(Schema::new(vec![
            datafusion::arrow::datatypes::Field::new("order_id", DataType::Int32, false),
            datafusion::arrow::datatypes::Field::new("amount", DataType::Int32, false),
        ]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int32Array::from(vec![1, 2])) as ArrayRef,
                Arc::new(Int32Array::from(vec![100, 200])) as ArrayRef,
            ],
        )
        .unwrap();
        let file = std::fs::File::create(&parquet_path).unwrap();
        let mut writer = ArrowWriter::try_new(file, schema, None).unwrap();
        writer.write(&batch).unwrap();
        writer.close().unwrap();

        let url = format!("\"{}\"", parquet_path.display());
        let manifest = ManifestBuilder::new()
            .data_source(DataSource::LocalFile)
            .model(
                ModelBuilder::new("orders")
                    .table_reference(&url)
                    .column(ColumnBuilder::new("order_id", "int").build())
                    .column(ColumnBuilder::new("amount", "int").build())
                    .build(),
            )
            .build();

        let ctx = datafusion::prelude::SessionContext::new();
        let analyzed = AnalyzedWrenMDL::analyze_with_url_tables(manifest, &ctx)
            .await
            .expect("analyze_with_url_tables should succeed for LocalFile");

        // Verify the model exists and the table is registered
        assert!(analyzed.wren_mdl().get_model("orders").is_some());
        assert!(
            analyzed.wren_mdl().register_tables.contains_key(&url),
            "table should be registered with its quoted table_reference"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn test_ref_sql_model() -> Result<()> {
        let mdl_json = r#"
        {
            "catalog": "wren",
            "schema": "test",
            "models": [
                {
                    "name": "revenue_summary",
                    "refSql": "SELECT region, SUM(amount) AS total FROM raw_sales GROUP BY region",
                    "columns": [
                        {
                            "name": "region",
                            "type": "string"
                        },
                        {
                            "name": "total",
                            "type": "int"
                        }
                    ]
                }
            ]
        }
        "#;
        let manifest: Manifest = serde_json::from_str(mdl_json).unwrap();
        let ctx = create_wren_ctx(None, None);
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);

        // Simple SELECT on refSql model
        let sql = r#"SELECT region, total FROM revenue_summary"#;
        let result = transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        // The refSql should appear as a subquery in the output
        assert!(
            result.contains(
                "SELECT region, SUM(amount) AS total FROM raw_sales GROUP BY region"
            ),
            "Expected refSql subquery in output, got: {result}"
        );

        // SELECT with WHERE filter on refSql model
        let sql = r#"SELECT region FROM revenue_summary WHERE total > 100"#;
        let result = transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert!(
            result.contains(
                "SELECT region, SUM(amount) AS total FROM raw_sales GROUP BY region"
            ),
            "Expected refSql subquery in filtered output, got: {result}"
        );
        assert!(
            result.contains("total > 100"),
            "Expected WHERE filter in output, got: {result}"
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_ref_sql_model_with_table_ref_model() -> Result<()> {
        let mdl_json = r#"
        {
            "catalog": "wren",
            "schema": "test",
            "models": [
                {
                    "name": "orders",
                    "tableReference": {
                        "table": "orders"
                    },
                    "columns": [
                        {
                            "name": "o_orderkey",
                            "type": "int"
                        },
                        {
                            "name": "o_totalprice",
                            "type": "float"
                        }
                    ]
                },
                {
                    "name": "order_summary",
                    "refSql": "SELECT o_orderkey, SUM(o_totalprice) AS total FROM orders GROUP BY o_orderkey",
                    "columns": [
                        {
                            "name": "o_orderkey",
                            "type": "int"
                        },
                        {
                            "name": "total",
                            "type": "float"
                        }
                    ]
                }
            ]
        }
        "#;
        let manifest: Manifest = serde_json::from_str(mdl_json).unwrap();
        let ctx = create_wren_ctx(None, None);
        let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        )?);

        // Query the refSql model — coexistence with table_reference model
        let sql = r#"SELECT o_orderkey, total FROM order_summary"#;
        let result = transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert!(
            result.contains("SELECT o_orderkey, SUM(o_totalprice) AS total FROM orders GROUP BY o_orderkey"),
            "Expected refSql subquery in output, got: {result}"
        );

        // Query the table_reference model — should still work normally
        let sql = r#"SELECT o_orderkey FROM orders"#;
        let result = transform_sql_with_ctx(
            &ctx,
            Arc::clone(&analyzed_mdl),
            &[],
            Arc::new(HashMap::new()),
            sql,
        )
        .await?;
        assert!(
            !result.contains("refSql"),
            "Table reference model output should not contain refSql, got: {result}"
        );

        Ok(())
    }
}
