//! # wren-core-wasm
//!
//! Wren Engine compiled to WebAssembly for browser-native analytics.
//!
//! This crate provides a WASM-compatible version of the Wren Engine that runs
//! entirely in the browser. It uses **upstream DataFusion** (not the Canner fork)
//! because the WASM version executes queries directly via DataFusion — no SQL
//! unparser or dialect transpilation is needed.
//!
//! ## Architecture
//!
//! ```text
//! JS (browser)
//!   │
//!   ├── loadMDL(mdl_json, source)       → analyze manifest; URL mode registers
//!   │                                      ListingTables, local mode expects
//!   │                                      pre-registered tables
//!   ├── registerParquet(table_name, data) → Arrow RecordBatch → DataFusion MemTable
//!   └── query(sql)                       → DataFusion executes → JSON result
//! ```
//!
//! ## Milestone Roadmap
//!
//! - **M1**: DataFusion WASM compilation + in-memory query (this milestone)
//! - **M2**: Parquet file upload + query from browser
//! - **M3**: wren-core semantic layer (MDL plan rewriting)
//! - **M4**: npm package + TypeScript API wrapper

use wasm_bindgen::prelude::*;

// wasm-bindgen-test macros are used in the test module below

/// Wren Engine WASM instance.
///
/// Holds a DataFusion SessionContext and (after `loadMDL`) the analyzed
/// MDL. `analyzed_mdl` is kept so the cube API (`cubeQuery`, `listCubes`)
/// can read the manifest after `loadMDL` returns. All query execution
/// happens in-browser via DataFusion.
#[wasm_bindgen]
pub struct WrenEngine {
    ctx: datafusion::execution::context::SessionContext,
    analyzed_mdl: Option<std::sync::Arc<wren_core::mdl::AnalyzedWrenMDL>>,
}

#[wasm_bindgen]
impl WrenEngine {
    /// Initialize a new WrenEngine instance.
    ///
    /// Creates a DataFusion SessionContext with default configuration
    /// suitable for single-threaded WASM execution. The session time zone
    /// defaults to UTC (`+00:00`) so browser timestamp inference and
    /// comparisons match `create_wren_ctx` on the native side.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Result<WrenEngine, JsError> {
        // Configure DataFusion for single-threaded WASM environment
        let mut config =
            datafusion::execution::context::SessionConfig::new().with_target_partitions(1); // Single-threaded in WASM
        config
            .options_mut()
            .set("datafusion.execution.time_zone", "+00:00")
            .map_err(|e| JsError::new(&format!("Failed to set default time zone: {e}")))?;

        let ctx = datafusion::execution::context::SessionContext::new_with_config(config);

        Ok(WrenEngine {
            ctx,
            analyzed_mdl: None,
        })
    }

    /// Register an in-memory table from a JSON array of objects.
    ///
    /// This is a convenience method for M1 testing. In M2+, use
    /// `register_parquet` to load Parquet files from the browser.
    ///
    /// # Arguments
    /// * `table_name` - Name to register the table under
    /// * `json_data` - JSON string: array of objects, e.g. `[{"a":1,"b":"x"},...]`
    #[wasm_bindgen(js_name = registerJson)]
    pub async fn register_json(&self, table_name: &str, json_data: &str) -> Result<(), JsError> {
        use arrow::json::reader::infer_json_schema;
        use arrow::json::ReaderBuilder;
        use datafusion::datasource::MemTable;
        use std::io::BufReader;
        use std::sync::Arc;

        // Arrow JSON reader expects NDJSON (one object per line), not a JSON array.
        // Convert JSON array to NDJSON format.
        let ndjson = json_array_to_ndjson(json_data)?;

        // Infer schema from NDJSON data
        let buf_reader = BufReader::new(ndjson.as_bytes());
        let (schema, _) = infer_json_schema(buf_reader, None)
            .map_err(|e| JsError::new(&format!("Failed to infer JSON schema: {e}")))?;

        // Parse NDJSON into Arrow RecordBatch
        let buf_reader = BufReader::new(ndjson.as_bytes());
        let reader = ReaderBuilder::new(Arc::new(schema))
            .with_batch_size(8192)
            .build(buf_reader)
            .map_err(|e| JsError::new(&format!("Failed to parse JSON: {e}")))?;

        let batches: Vec<_> = reader
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| JsError::new(&format!("Failed to read JSON batches: {e}")))?;

        if batches.is_empty() {
            return Err(JsError::new("No data in JSON input"));
        }

        let schema = batches[0].schema();
        let table = MemTable::try_new(schema, vec![batches])
            .map_err(|e| JsError::new(&format!("Failed to create table: {e}")))?;

        self.ctx
            .register_table(table_name, Arc::new(table))
            .map_err(|e| JsError::new(&format!("Failed to register table: {e}")))?;

        Ok(())
    }

    /// Register a Parquet file from bytes uploaded via JS.
    ///
    /// Reads the Parquet data into Arrow RecordBatches and registers as a MemTable.
    /// The JS side should pass the file contents as a `Uint8Array`.
    #[wasm_bindgen(js_name = registerParquet)]
    pub async fn register_parquet(&self, table_name: &str, data: &[u8]) -> Result<(), JsError> {
        use datafusion::datasource::MemTable;
        use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
        use std::sync::Arc;

        let builder = ParquetRecordBatchReaderBuilder::try_new(bytes::Bytes::from(data.to_vec()))
            .map_err(|e| JsError::new(&format!("Failed to open Parquet: {e}")))?;

        let schema = builder.schema().clone();

        let reader = builder
            .build()
            .map_err(|e| JsError::new(&format!("Failed to build Parquet reader: {e}")))?;

        let batches: Vec<_> = reader
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| JsError::new(&format!("Failed to read Parquet batches: {e}")))?;

        if batches.is_empty() {
            return Err(JsError::new("No data in Parquet file"));
        }

        let table = MemTable::try_new(schema, vec![batches])
            .map_err(|e| JsError::new(&format!("Failed to create table: {e}")))?;

        self.ctx
            .register_table(table_name, Arc::new(table))
            .map_err(|e| JsError::new(&format!("Failed to register table: {e}")))?;

        Ok(())
    }

    /// Register an in-memory table from CSV bytes.
    ///
    /// CSV is read with `arrow::csv::ReaderBuilder`. Schema is inferred from
    /// the first `inferRows` rows (default 1000) unless an explicit schema is
    /// provided in `options.schema`.
    ///
    /// # Arguments
    /// * `table_name` - Name to register the table under
    /// * `data` - CSV bytes
    /// * `options_json` - Optional JSON-encoded `CsvReadOptions`. Empty / `""`
    ///   uses defaults (header on, comma delimiter, double-quote, batch 8192).
    ///
    /// # Options shape (camelCase)
    /// ```json
    /// {
    ///   "header": true,
    ///   "delimiter": ",",
    ///   "quote": "\"",
    ///   "escape": "\\",
    ///   "terminator": "\n",
    ///   "batchSize": 8192,
    ///   "inferRows": 1000,
    ///   "schema": [
    ///     {"name": "id", "type": "int64"},
    ///     {"name": "amount", "type": "float64"}
    ///   ]
    /// }
    /// ```
    /// All fields are optional. Single-character options (delimiter/quote/…)
    /// take only the first byte of the supplied string.
    #[wasm_bindgen(js_name = registerCsv)]
    pub async fn register_csv(
        &self,
        table_name: &str,
        data: &[u8],
        options_json: &str,
    ) -> Result<(), JsError> {
        use arrow::csv::reader::Format;
        use arrow::csv::ReaderBuilder;
        use datafusion::datasource::MemTable;
        use std::io::Cursor;
        use std::sync::Arc;

        let opts: CsvReadOptions = if options_json.trim().is_empty() {
            CsvReadOptions::default()
        } else {
            serde_json::from_str(options_json).map_err(|e| {
                JsError::new(&format!("Invalid CSV options JSON: {e}"))
            })?
        };

        let header = opts.header.unwrap_or(true);
        let mut format = Format::default().with_header(header);
        if let Some(c) = single_byte(&opts.delimiter, "delimiter")? {
            format = format.with_delimiter(c);
        }
        if let Some(c) = single_byte(&opts.quote, "quote")? {
            format = format.with_quote(c);
        }
        if let Some(c) = single_byte(&opts.escape, "escape")? {
            format = format.with_escape(c);
        }
        if let Some(c) = single_byte(&opts.terminator, "terminator")? {
            format = format.with_terminator(c);
        }

        let schema = if let Some(cols) = &opts.schema {
            Arc::new(arrow_schema_from_columns(cols)?)
        } else {
            let infer_rows = opts.infer_rows.or(Some(1000));
            let (inferred, _) = format
                .infer_schema(Cursor::new(data), infer_rows)
                .map_err(|e| JsError::new(&format!("Failed to infer CSV schema: {e}")))?;
            Arc::new(inferred)
        };

        let mut builder = ReaderBuilder::new(Arc::clone(&schema)).with_format(format);
        if let Some(n) = opts.batch_size {
            builder = builder.with_batch_size(n);
        }

        let reader = builder
            .build(Cursor::new(data))
            .map_err(|e| JsError::new(&format!("Failed to build CSV reader: {e}")))?;

        let batches: Vec<_> = reader
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| JsError::new(&format!("Failed to read CSV batches: {e}")))?;

        if batches.is_empty() {
            return Err(JsError::new("No data in CSV input"));
        }

        let table = MemTable::try_new(schema, vec![batches])
            .map_err(|e| JsError::new(&format!("Failed to create table: {e}")))?;

        self.ctx
            .register_table(table_name, Arc::new(table))
            .map_err(|e| JsError::new(&format!("Failed to register table: {e}")))?;

        Ok(())
    }

    /// Load an MDL (Modeling Definition Language) manifest.
    ///
    /// Parses the MDL JSON, builds the semantic layer (AnalyzedWrenMDL),
    /// and reconfigures the SessionContext with Wren analyzer rules in
    /// LocalRuntime mode (direct DataFusion execution, no SQL generation).
    ///
    /// The `source` parameter selects how physical tables are resolved:
    ///
    /// - `http://…/`, `https://…/` → **URL mode**. For each model, registers a
    ///   DataFusion `ListingTable` at `{source}/{table_name}.parquet`. Tables
    ///   do not need pre-registering. (`s3://` and `gs://` schemes are Phase 4
    ///   and fall through to local mode today.)
    /// - `""` (empty) → **fallback mode**: the M3+ behaviour of auto-detecting
    ///   URL vs local tables from each model's `tableReference`. Preserved for
    ///   backwards compatibility with MDLs that still embed URLs in
    ///   `tableReference`.
    /// - anything else → **local mode**. The caller is expected to have
    ///   pre-registered each model's physical table via
    ///   `registerParquet`/`registerJson`. If any model's physical table is
    ///   missing, `loadMDL` returns an `Unresolved models: [...]` error up
    ///   front instead of deferring to query time.
    ///
    /// After loading, bare model names resolve under the MDL's catalog/schema
    /// (typically `wren.public`), so queries can reference models without a
    /// catalog prefix.
    #[wasm_bindgen(js_name = loadMDL)]
    pub async fn load_mdl(&mut self, mdl_json: &str, source: &str) -> Result<(), JsError> {
        use std::collections::HashMap;
        use std::sync::Arc;
        use wren_core::mdl::context::{apply_wren_on_ctx, Mode};
        use wren_core::mdl::AnalyzedWrenMDL;
        use wren_core_base::mdl::manifest::Manifest;

        let manifest: Manifest = serde_json::from_str(mdl_json)
            .map_err(|e| JsError::new(&format!("Failed to parse MDL JSON: {e}")))?;

        let source = source.trim();

        let analyzed_mdl: Arc<AnalyzedWrenMDL> = if is_url_source(source) {
            self.load_mdl_url_mode(&manifest, source).await?
        } else if source.is_empty() {
            self.load_mdl_fallback(manifest.clone()).await?
        } else {
            self.load_mdl_local_mode(&manifest).await?
        };

        let properties: Arc<HashMap<String, Option<String>>> = Arc::new(HashMap::new());

        // Clone the Arc so `apply_wren_on_ctx` can take ownership while
        // we keep a handle on `self` for cubeQuery/listCubes access.
        let new_ctx = apply_wren_on_ctx(
            &self.ctx,
            Arc::clone(&analyzed_mdl),
            properties,
            Mode::LocalRuntime,
        )
        .await
        .map_err(|e| JsError::new(&format!("Failed to apply MDL rules: {e}")))?;

        self.ctx = new_ctx;
        self.analyzed_mdl = Some(analyzed_mdl);
        Ok(())
    }

    /// URL mode: register a `ListingTable` per model under the `source` URL
    /// and collect them into `register_tables` for `analyze_with_tables`.
    ///
    /// The per-model URL is always `{source}/{bare_name}.parquet`. If two
    /// models share the same bare table name across different schemas (e.g.
    /// `"raw"."orders"` and `"staging"."orders"`), they both resolve to
    /// `{source}/orders.parquet` — a silent collision at the file-naming
    /// level. Phase 2 assumes a flat Parquet layout; richer schema mapping
    /// (`{source}/{schema}/{name}.parquet`) is tracked as Phase 4 work.
    async fn load_mdl_url_mode(
        &mut self,
        manifest: &wren_core_base::mdl::manifest::Manifest,
        source: &str,
    ) -> Result<std::sync::Arc<wren_core::mdl::AnalyzedWrenMDL>, JsError> {
        use std::collections::{HashMap, HashSet};
        use std::sync::Arc;
        use wren_core::mdl::AnalyzedWrenMDL;

        let base_url = source.trim_end_matches('/');
        let parsed_base = url::Url::parse(base_url)
            .map_err(|e| JsError::new(&format!("Invalid source URL '{source}': {e}")))?;
        let scheme = parsed_base.scheme();

        // Register one HTTP object store per unique origin. Subsequent calls
        // with the same origin are no-ops. (`s3://`/`gs://` are out of scope
        // for Phase 2 — see `is_url_source`; they never reach this branch.)
        if scheme == "http" || scheme == "https" {
            let mut registered_origins: HashSet<String> = HashSet::new();
            let origin = parsed_base.origin().unicode_serialization();
            if registered_origins.insert(origin.clone()) {
                let http_store = object_store::http::HttpBuilder::new()
                    .with_url(&origin)
                    .build()
                    .map_err(|e| {
                        JsError::new(&format!("Failed to create HTTP store for {origin}: {e}"))
                    })?;
                let store_url = url::Url::parse(&format!("{origin}/"))
                    .map_err(|e| JsError::new(&format!("Invalid base URL: {e}")))?;
                self.ctx
                    .register_object_store(&store_url, Arc::new(http_store));
            }
        }

        // Stage every model's schema inference first. Only after all models
        // succeed do we mutate `self.ctx`, so a failed `loadMDL` does not
        // leave partially-registered tables behind for the next retry.
        let mut staged: Vec<(
            String,
            String,
            Arc<dyn datafusion::datasource::TableProvider>,
        )> = Vec::with_capacity(manifest.models.len());

        for model in &manifest.models {
            let table_ref = model.table_reference().unwrap_or_default();
            let bare = extract_bare_table_name(table_ref);
            let name: &str = if bare.is_empty() { model.name() } else { bare };
            let parquet_url = format!("{base_url}/{name}.parquet");

            // Inference can fail (unreachable URL, bad Parquet) — propagated
            // as a JsError with the model context. Nothing has been committed
            // to `self.ctx` yet.
            let table = self.build_listing_table(name, &parquet_url).await?;
            staged.push((name.to_string(), table_ref.to_string(), table));
        }

        let mut register_tables: HashMap<String, Arc<dyn datafusion::datasource::TableProvider>> =
            HashMap::with_capacity(staged.len());

        for (name, table_ref, table) in staged {
            self.ctx
                .register_table(name.as_str(), Arc::clone(&table))
                .map_err(|e| JsError::new(&format!("Failed to register table '{name}': {e}")))?;
            // Key must match `model.table_reference()` so
            // `WrenMDL::get_table` finds it during plan analysis.
            register_tables.insert(table_ref, table);
        }

        AnalyzedWrenMDL::analyze_with_tables(manifest.clone(), register_tables)
            .map(Arc::new)
            .map_err(|e| JsError::new(&format!("Failed to analyze MDL: {e}")))
    }

    /// Local mode: tables must already be registered via
    /// `registerParquet`/`registerJson`. Collect them into `register_tables`
    /// and raise a clear error if any model's backing table is missing.
    async fn load_mdl_local_mode(
        &self,
        manifest: &wren_core_base::mdl::manifest::Manifest,
    ) -> Result<std::sync::Arc<wren_core::mdl::AnalyzedWrenMDL>, JsError> {
        use std::collections::HashMap;
        use std::sync::Arc;
        use wren_core::mdl::AnalyzedWrenMDL;

        let mut register_tables: HashMap<String, Arc<dyn datafusion::datasource::TableProvider>> =
            HashMap::new();
        let mut missing: Vec<String> = Vec::new();

        for model in &manifest.models {
            let table_ref = model.table_reference().unwrap_or_default();
            let bare = extract_bare_table_name(table_ref);
            let name: &str = if bare.is_empty() { model.name() } else { bare };

            let mut found = false;
            if let Some(catalog) = self.ctx.catalog("datafusion") {
                if let Some(schema) = catalog.schema("public") {
                    if let Ok(Some(table)) = schema.table(name).await {
                        // Key must match `model.table_reference()` so
                        // `WrenMDL::get_table` finds it during plan analysis.
                        register_tables.insert(table_ref.to_string(), table);
                        found = true;
                    }
                }
            }
            if !found {
                missing.push(name.to_string());
            }
        }

        if !missing.is_empty() {
            return Err(JsError::new(&format!(
                "Unresolved models: [{}]. Register physical tables first via \
                 registerParquet/registerJson, or call loadMDL with a URL source.",
                missing.join(", ")
            )));
        }

        AnalyzedWrenMDL::analyze_with_tables(manifest.clone(), register_tables)
            .map(Arc::new)
            .map_err(|e| JsError::new(&format!("Failed to analyze MDL: {e}")))
    }

    /// M3+ fallback: when `source=""`, auto-detect URL vs local tables from
    /// each model's `tableReference`. Kept for backwards compatibility with
    /// MDLs that still embed URLs in `tableReference`.
    async fn load_mdl_fallback(
        &mut self,
        manifest: wren_core_base::mdl::manifest::Manifest,
    ) -> Result<std::sync::Arc<wren_core::mdl::AnalyzedWrenMDL>, JsError> {
        use std::collections::{HashMap, HashSet};
        use std::sync::Arc;
        use wren_core::mdl::AnalyzedWrenMDL;

        let use_url_tables = manifest.models.iter().any(|m| {
            let raw = m.table_reference().unwrap_or_default();
            let url_str = raw.trim_matches('"');
            url::Url::parse(url_str).is_ok()
        });

        if use_url_tables {
            let mut registered_origins: HashSet<String> = HashSet::new();
            for model in &manifest.models {
                let raw = model.table_reference().unwrap_or_default();
                let url_str = raw.trim_matches('"');
                if let Ok(parsed) = url::Url::parse(url_str) {
                    let scheme = parsed.scheme();
                    if scheme == "http" || scheme == "https" {
                        let origin = parsed.origin().unicode_serialization();
                        if registered_origins.insert(origin.clone()) {
                            let http_store = object_store::http::HttpBuilder::new()
                                .with_url(&origin)
                                .build()
                                .map_err(|e| {
                                    JsError::new(&format!(
                                        "Failed to create HTTP store for {origin}: {e}"
                                    ))
                                })?;
                            let base_url = url::Url::parse(&format!("{origin}/"))
                                .map_err(|e| JsError::new(&format!("Invalid base URL: {e}")))?;
                            self.ctx
                                .register_object_store(&base_url, Arc::new(http_store));
                        }
                    }
                }
            }

            AnalyzedWrenMDL::analyze_with_url_tables(manifest, &self.ctx)
                .await
                .map(Arc::new)
                .map_err(|e| JsError::new(&format!("Failed to analyze MDL with URL tables: {e}")))
        } else {
            let mut register_tables: HashMap<
                String,
                Arc<dyn datafusion::datasource::TableProvider>,
            > = HashMap::new();

            for model in &manifest.models {
                let table_ref = model.table_reference().unwrap_or_default();
                let bare = extract_bare_table_name(table_ref);
                if bare.is_empty() {
                    continue;
                }
                if let Some(catalog) = self.ctx.catalog("datafusion") {
                    if let Some(schema) = catalog.schema("public") {
                        if let Ok(Some(table)) = schema.table(bare).await {
                            // Key must match `model.table_reference()` so
                            // `WrenMDL::get_table` finds it during plan analysis.
                            register_tables.insert(table_ref.to_string(), table);
                        }
                    }
                }
            }

            AnalyzedWrenMDL::analyze_with_tables(manifest, register_tables)
                .map(Arc::new)
                .map_err(|e| JsError::new(&format!("Failed to analyze MDL: {e}")))
        }
    }

    /// Build a `ListingTable` backed by a single Parquet URL. Schema is
    /// inferred via a Range GET on the Parquet footer. Does not mutate
    /// `self.ctx` — caller is responsible for registering the returned
    /// table once all staged builds succeed.
    async fn build_listing_table(
        &self,
        name: &str,
        url: &str,
    ) -> Result<std::sync::Arc<dyn datafusion::datasource::TableProvider>, JsError> {
        use datafusion::datasource::file_format::parquet::ParquetFormat;
        use datafusion::datasource::listing::{
            ListingOptions, ListingTable, ListingTableConfig, ListingTableUrl,
        };
        use std::sync::Arc;

        let table_url = ListingTableUrl::parse(url)
            .map_err(|e| JsError::new(&format!("Invalid table URL '{url}': {e}")))?;
        let options =
            ListingOptions::new(Arc::new(ParquetFormat::default())).with_file_extension(".parquet");
        let state = self.ctx.state();
        let config = ListingTableConfig::new(table_url)
            .with_listing_options(options)
            .infer_schema(&state)
            .await
            .map_err(|e| {
                JsError::new(&format!(
                    "Failed to infer schema for model '{name}' at '{url}': {e}"
                ))
            })?;
        let table = ListingTable::try_new(config).map_err(|e| {
            JsError::new(&format!("Failed to create ListingTable for '{name}': {e}"))
        })?;
        Ok(Arc::new(table))
    }

    /// Execute a SQL query and return results as a JSON string.
    ///
    /// Returns a JSON array of objects, e.g. `[{"count":42,"avg":3.14},...]`
    #[wasm_bindgen]
    pub async fn query(&self, sql: &str) -> Result<String, JsError> {
        use arrow::json::writer::JsonArray;
        use arrow::json::WriterBuilder;

        let df = self
            .ctx
            .sql(sql)
            .await
            .map_err(|e| JsError::new(&format!("SQL error: {e}")))?;

        let batches = df
            .collect()
            .await
            .map_err(|e| JsError::new(&format!("Execution error: {e}")))?;

        let mut buf = Vec::new();
        let mut writer = WriterBuilder::new()
            .with_explicit_nulls(true)
            .build::<_, JsonArray>(&mut buf);

        for batch in &batches {
            writer
                .write(batch)
                .map_err(|e| JsError::new(&format!("JSON serialization error: {e}")))?;
        }
        writer
            .finish()
            .map_err(|e| JsError::new(&format!("JSON writer finish error: {e}")))?;

        String::from_utf8(buf).map_err(|e| JsError::new(&format!("UTF-8 encoding error: {e}")))
    }

    /// Execute a structured CubeQuery against the loaded MDL.
    ///
    /// Takes a JSON-encoded `CubeQuery` (matching the camelCase shape used
    /// by the Python binding), translates it to SQL via wren-core, and
    /// runs the SQL through the existing `query()` path. Returns a JSON
    /// array of result rows.
    ///
    /// Requires `loadMDL` to have been called first.
    #[wasm_bindgen(js_name = cubeQuery)]
    pub async fn cube_query(&self, cube_query_json: &str) -> Result<String, JsError> {
        let analyzed = self
            .analyzed_mdl
            .as_ref()
            .ok_or_else(|| JsError::new("No MDL loaded. Call loadMDL() first."))?;
        let wren_mdl = analyzed.wren_mdl();
        let manifest = &wren_mdl.manifest;

        let query: wren_core::mdl::CubeQuery = serde_json::from_str(cube_query_json)
            .map_err(|e| JsError::new(&format!("Invalid CubeQuery JSON: {e}")))?;

        let sql = wren_core::mdl::cube_query_to_sql(&query, manifest)
            .map_err(|e| JsError::new(&format!("CubeQuery error: {e}")))?;

        self.query(&sql).await
    }

    /// List the cubes defined in the loaded MDL.
    ///
    /// Returns a JSON array of `{ name, baseObject, measures, dimensions,
    /// timeDimensions, hierarchies }` records. Requires `loadMDL` to have
    /// been called first.
    #[wasm_bindgen(js_name = listCubes)]
    pub fn list_cubes(&self) -> Result<String, JsError> {
        let analyzed = self
            .analyzed_mdl
            .as_ref()
            .ok_or_else(|| JsError::new("No MDL loaded. Call loadMDL() first."))?;
        let wren_mdl = analyzed.wren_mdl();
        let manifest = &wren_mdl.manifest;

        let cubes: Vec<serde_json::Value> = manifest
            .cubes
            .iter()
            .map(|c| {
                serde_json::json!({
                    "name": c.name,
                    "baseObject": c.base_object,
                    "measures": c.measures.iter().map(|m| serde_json::json!({
                        "name": m.name,
                        "expression": m.expression,
                        "type": m.r#type,
                    })).collect::<Vec<_>>(),
                    "dimensions": c.dimensions.iter().map(|d| serde_json::json!({
                        "name": d.name,
                        "expression": d.expression,
                        "type": d.r#type,
                    })).collect::<Vec<_>>(),
                    "timeDimensions": c.time_dimensions.iter().map(|td| serde_json::json!({
                        "name": td.name,
                        "expression": td.expression,
                        "type": td.r#type,
                    })).collect::<Vec<_>>(),
                    "hierarchies": c.hierarchies,
                })
            })
            .collect();

        serde_json::to_string(&cubes)
            .map_err(|e| JsError::new(&format!("Serialization error: {e}")))
    }
}

/// Returns true if `source` starts with a URL scheme that `load_mdl`
/// recognises as URL mode. Only `http(s)://` is supported in Phase 2;
/// `s3://` / `gs://` are Phase 4 work and intentionally fall through to
/// local mode (where they'll fail fast with an `Unresolved models` error).
fn is_url_source(source: &str) -> bool {
    source.starts_with("http://") || source.starts_with("https://")
}

/// Strip dot-separated quoted identifier parts from a MDL `tableReference`
/// string and return the final segment unquoted.
///
/// Only splits on dots that are **outside** double-quoted segments so a name
/// like `"\"my.weird\".orders"` returns `orders`, not `weird"`. Phase 2 uses
/// this only to derive the bare physical table name (e.g. for the Parquet file
/// name under `source`, and for the catalog lookup). The full
/// `model.table_reference()` string is still used as the key into
/// `register_tables`, so qualified references remain distinguishable there.
///
/// Examples:
/// - `"\"datafusion\".\"public\".\"Orders\""` → `"Orders"`
/// - `"\"orders\""` → `"orders"`
/// - `""` → `""`
fn extract_bare_table_name(table_ref: &str) -> &str {
    if table_ref.is_empty() {
        return table_ref;
    }
    // Walk from the end and find the first `.` that is outside quotes.
    let bytes = table_ref.as_bytes();
    let mut in_quote = false;
    let mut split_at: Option<usize> = None;
    for (i, &b) in bytes.iter().enumerate().rev() {
        match b {
            b'"' => in_quote = !in_quote,
            b'.' if !in_quote => {
                split_at = Some(i);
                break;
            }
            _ => {}
        }
    }
    let last = match split_at {
        Some(i) => &table_ref[i + 1..],
        None => table_ref,
    };
    last.trim_matches('"')
}

/// Convert a JSON array string to NDJSON (one object per line).
/// Arrow's JSON reader expects NDJSON format.
fn json_array_to_ndjson(json_data: &str) -> Result<String, JsError> {
    let parsed: serde_json::Value =
        serde_json::from_str(json_data).map_err(|e| JsError::new(&format!("Invalid JSON: {e}")))?;

    match parsed {
        serde_json::Value::Array(arr) => {
            let lines: Result<Vec<String>, _> = arr.iter().map(serde_json::to_string).collect();
            lines
                .map(|l| l.join("\n"))
                .map_err(|e| JsError::new(&format!("JSON serialization error: {e}")))
        }
        serde_json::Value::Object(_) => {
            // Already a single object, return as-is
            Ok(json_data.to_string())
        }
        _ => Err(JsError::new("Expected JSON array or object")),
    }
}

impl Default for WrenEngine {
    fn default() -> Self {
        Self::new().expect("Failed to create default WrenEngine")
    }
}

// ---------------------------------------------------------------------------
// register_csv supporting types
// ---------------------------------------------------------------------------

/// User-supplied CSV reader options, deserialized from JSON. All fields are
/// optional — omit a field to take the arrow-csv default.
#[derive(Debug, Default, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
struct CsvReadOptions {
    header: Option<bool>,
    delimiter: Option<String>,
    quote: Option<String>,
    escape: Option<String>,
    terminator: Option<String>,
    batch_size: Option<usize>,
    infer_rows: Option<usize>,
    schema: Option<Vec<CsvColumn>>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct CsvColumn {
    name: String,
    #[serde(rename = "type")]
    ty: String,
    #[serde(default)]
    nullable: Option<bool>,
}

/// Single-character option helper: the arrow CSV reader takes a `u8`, but the
/// JS side passes a string. We accept any non-empty string and use its first
/// byte — single ASCII characters cover every realistic CSV separator. Reject
/// strings that start with a multi-byte UTF-8 char to avoid silently slicing
/// a codepoint.
fn single_byte(s: &Option<String>, field: &str) -> Result<Option<u8>, JsError> {
    match s {
        None => Ok(None),
        Some(v) if v.is_empty() => Err(JsError::new(&format!(
            "CSV option '{field}' must be a single character, got empty string"
        ))),
        Some(v) => {
            let bytes = v.as_bytes();
            if bytes[0] >= 0x80 {
                return Err(JsError::new(&format!(
                    "CSV option '{field}' must be a single ASCII character"
                )));
            }
            Ok(Some(bytes[0]))
        }
    }
}

/// Build an Arrow `Schema` from the user-supplied `[{name, type}]` list.
/// Mirrors a small subset of Arrow types — enough for the common CSV column
/// shapes (numeric / string / boolean / date / timestamp).
fn arrow_schema_from_columns(cols: &[CsvColumn]) -> Result<arrow::datatypes::Schema, JsError> {
    use arrow::datatypes::{DataType, Field, Schema, TimeUnit};

    if cols.is_empty() {
        return Err(JsError::new("CSV schema must have at least one column"));
    }

    let fields = cols
        .iter()
        .map(|c| {
            let dt = match c.ty.to_ascii_lowercase().as_str() {
                "int8" => DataType::Int8,
                "int16" => DataType::Int16,
                "int32" | "int" | "integer" => DataType::Int32,
                "int64" | "bigint" | "long" => DataType::Int64,
                "uint8" => DataType::UInt8,
                "uint16" => DataType::UInt16,
                "uint32" => DataType::UInt32,
                "uint64" => DataType::UInt64,
                "float32" | "float" | "real" => DataType::Float32,
                "float64" | "double" | "number" => DataType::Float64,
                "boolean" | "bool" => DataType::Boolean,
                "utf8" | "string" | "varchar" | "text" => DataType::Utf8,
                "date" | "date32" => DataType::Date32,
                "date64" => DataType::Date64,
                "timestamp" | "timestamp_ns" => {
                    DataType::Timestamp(TimeUnit::Nanosecond, None)
                }
                "timestamp_us" => DataType::Timestamp(TimeUnit::Microsecond, None),
                "timestamp_ms" => DataType::Timestamp(TimeUnit::Millisecond, None),
                "timestamp_s" => DataType::Timestamp(TimeUnit::Second, None),
                other => {
                    return Err(JsError::new(&format!(
                        "Unsupported CSV column type '{other}' (column '{}')",
                        c.name
                    )));
                }
            };
            Ok(Field::new(&c.name, dt, c.nullable.unwrap_or(true)))
        })
        .collect::<Result<Vec<_>, JsError>>()?;

    Ok(Schema::new(fields))
}

// =============================================================================
// Tests (run via wasm-bindgen-test in browser/node)
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

    // Configure tests to run in Node.js (no browser needed for CI)
    wasm_bindgen_test_configure!(run_in_node_experimental);

    #[wasm_bindgen_test]
    async fn test_basic_query() {
        let engine = WrenEngine::new().unwrap();

        let json_data = r#"[
            {"id": 1, "name": "Alice", "amount": 100.0},
            {"id": 2, "name": "Bob", "amount": 200.0},
            {"id": 3, "name": "Charlie", "amount": 150.0}
        ]"#;

        engine.register_json("test_table", json_data).await.unwrap();

        let result = engine
            .query("SELECT count(*) as cnt, avg(amount) as avg_amount FROM test_table")
            .await
            .unwrap();

        // Parse and verify
        let rows: Vec<serde_json::Value> = serde_json::from_str(&result).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["cnt"], 3);
    }

    #[wasm_bindgen_test]
    fn test_is_url_source() {
        assert!(is_url_source("http://localhost/"));
        assert!(is_url_source("https://cdn.example.com/data/"));
        // Phase 4: s3:// and gs:// are not URL mode yet.
        assert!(!is_url_source("s3://bucket/key/"));
        assert!(!is_url_source("gs://bucket/key/"));
        assert!(!is_url_source(""));
        assert!(!is_url_source("./data/"));
        assert!(!is_url_source("/var/data"));
        assert!(!is_url_source("data/"));
    }

    #[wasm_bindgen_test]
    fn test_extract_bare_table_name() {
        assert_eq!(extract_bare_table_name(""), "");
        assert_eq!(extract_bare_table_name("\"orders\""), "orders");
        assert_eq!(
            extract_bare_table_name("\"datafusion\".\"public\".\"Orders\""),
            "Orders"
        );
        assert_eq!(
            extract_bare_table_name("\"public\".\"customers\""),
            "customers"
        );
        // Bare lowercase names skip quoting in the MDL serializer.
        assert_eq!(extract_bare_table_name("orders"), "orders");
        assert_eq!(
            extract_bare_table_name("datafusion.public.orders"),
            "orders"
        );
        // Dots inside quoted segments must not split the name.
        assert_eq!(extract_bare_table_name("\"my.weird\".orders"), "orders");
        assert_eq!(
            extract_bare_table_name("\"schema\".\"has.dot\""),
            "has.dot"
        );
    }

    fn minimal_mdl(model_name: &str, physical_table: &str) -> String {
        // Minimal single-model MDL. `tableReference` is a bare table name;
        // `catalog`/`schema` default to `wren`/`public` so loadMDL will align
        // the session default catalog to that.
        serde_json::json!({
            "catalog": "wren",
            "schema": "public",
            "models": [{
                "name": model_name,
                "tableReference": { "table": physical_table },
                "columns": [
                    { "name": "id", "type": "INTEGER" },
                    { "name": "amount", "type": "DOUBLE" }
                ],
                "primaryKey": "id"
            }],
            "relationships": [],
            "views": []
        })
        .to_string()
    }

    #[wasm_bindgen_test]
    async fn test_bare_model_name_query() {
        // Proves §2.5.2: bare model names resolve without a `wren.public.`
        // prefix after loadMDL aligns the default catalog/schema.
        let mut engine = WrenEngine::new().unwrap();
        engine
            .register_json(
                "customers",
                r#"[
                    {"id": 1, "amount": 100.0},
                    {"id": 2, "amount": 50.0}
                ]"#,
            )
            .await
            .unwrap();

        let mdl = minimal_mdl("Customers", "customers");
        engine.load_mdl(&mdl, "").await.unwrap();

        // Bare model name — no `wren.public.` prefix.
        let result = engine
            .query(r#"SELECT count(*) AS cnt FROM "Customers""#)
            .await
            .unwrap();
        let rows: Vec<serde_json::Value> = serde_json::from_str(&result).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["cnt"], 2);
    }

    #[wasm_bindgen_test]
    async fn test_empty_source_fallback() {
        // source="" falls back to M3+ behaviour (auto-detect from tableReference).
        let mut engine = WrenEngine::new().unwrap();
        engine
            .register_json("test_orders", r#"[{"id": 1, "amount": 100.0}]"#)
            .await
            .unwrap();

        let mdl = minimal_mdl("Orders", "test_orders");
        engine.load_mdl(&mdl, "").await.unwrap();

        let result = engine
            .query(r#"SELECT count(*) AS cnt FROM "Orders""#)
            .await
            .unwrap();
        let rows: Vec<serde_json::Value> = serde_json::from_str(&result).unwrap();
        assert_eq!(rows[0]["cnt"], 1);
    }

    #[wasm_bindgen_test]
    async fn test_local_source_with_preregistered_tables() {
        // Local mode (non-empty, non-URL) resolves tables registered beforehand.
        let mut engine = WrenEngine::new().unwrap();
        engine
            .register_json(
                "orders",
                r#"[
                    {"id": 1, "amount": 50.0},
                    {"id": 2, "amount": 75.0}
                ]"#,
            )
            .await
            .unwrap();

        let mdl = minimal_mdl("Orders", "orders");
        engine.load_mdl(&mdl, "./data/").await.unwrap();

        let result = engine
            .query(r#"SELECT sum(amount) AS total FROM "Orders""#)
            .await
            .unwrap();
        let rows: Vec<serde_json::Value> = serde_json::from_str(&result).unwrap();
        assert_eq!(rows[0]["total"], 125.0);
    }

    #[wasm_bindgen_test]
    async fn test_local_source_missing_table_error() {
        // Proves §2.5.1 (local mode): unresolved models become a clear error
        // at loadMDL time instead of panicking at query time.
        let mut engine = WrenEngine::new().unwrap();
        // NOTE: no registerJson/registerParquet — intentionally leave tables missing.

        let mdl = serde_json::json!({
            "catalog": "wren",
            "schema": "public",
            "models": [
                {
                    "name": "Orders",
                    "tableReference": { "table": "orders" },
                    "columns": [{ "name": "id", "type": "INTEGER" }]
                },
                {
                    "name": "LineItem",
                    "tableReference": { "table": "lineitem" },
                    "columns": [{ "name": "id", "type": "INTEGER" }]
                }
            ],
            "relationships": [],
            "views": []
        })
        .to_string();

        let err = engine.load_mdl(&mdl, "./").await.unwrap_err();
        // Pull the error message via js_sys::Error to assert against it.
        let msg = js_sys::Error::from(JsValue::from(err))
            .message()
            .as_string()
            .unwrap_or_default();
        assert!(
            msg.contains("Unresolved models"),
            "expected Unresolved models error, got: {msg}"
        );
        assert!(msg.contains("orders"), "expected 'orders' in error: {msg}");
        assert!(
            msg.contains("lineitem"),
            "expected 'lineitem' in error: {msg}"
        );
    }

    // ── register_csv ────────────────────────────────────────────────────────

    #[wasm_bindgen_test]
    async fn test_register_csv_basic() {
        let engine = WrenEngine::new().unwrap();
        let csv = "id,name,amount\n1,Alice,100.5\n2,Bob,200\n3,Carol,300.25\n";

        engine
            .register_csv("orders", csv.as_bytes(), "")
            .await
            .unwrap();

        let json = engine
            .query("SELECT count(*) AS cnt, sum(amount) AS total FROM orders")
            .await
            .unwrap();
        let rows: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();
        assert_eq!(rows[0]["cnt"], 3);
        // Allow either float or int formatting for the total.
        let total = rows[0]["total"].as_f64().unwrap_or_default();
        assert!((total - 600.75).abs() < 1e-6, "total={total}");
    }

    #[wasm_bindgen_test]
    async fn test_register_csv_custom_delimiter_and_quote() {
        let engine = WrenEngine::new().unwrap();
        let csv = "id;label;amount\n1;'hello;world';10\n2;'plain';20\n";
        let options = r#"{"delimiter":";","quote":"'"}"#;

        engine
            .register_csv("t", csv.as_bytes(), options)
            .await
            .unwrap();

        let json = engine
            .query("SELECT label FROM t WHERE id = 1")
            .await
            .unwrap();
        let rows: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();
        assert_eq!(rows[0]["label"], "hello;world");
    }

    #[wasm_bindgen_test]
    async fn test_register_csv_no_header_with_schema() {
        let engine = WrenEngine::new().unwrap();
        let csv = "1,100\n2,200\n3,300\n";
        let options = r#"{
            "header": false,
            "schema": [
                {"name": "id", "type": "int64"},
                {"name": "amount", "type": "int64"}
            ]
        }"#;

        engine
            .register_csv("t", csv.as_bytes(), options)
            .await
            .unwrap();

        let json = engine
            .query("SELECT sum(amount) AS total FROM t")
            .await
            .unwrap();
        let rows: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();
        assert_eq!(rows[0]["total"], 600);
    }

    #[wasm_bindgen_test]
    async fn test_register_csv_rejects_unknown_type() {
        let engine = WrenEngine::new().unwrap();
        let csv = "id\n1\n";
        let options = r#"{"schema":[{"name":"id","type":"bogus"}]}"#;
        let err = engine
            .register_csv("t", csv.as_bytes(), options)
            .await
            .unwrap_err();
        let msg = js_sys::Error::from(JsValue::from(err))
            .message()
            .as_string()
            .unwrap_or_default();
        assert!(msg.contains("Unsupported CSV column type"), "msg={msg}");
    }

    #[wasm_bindgen_test]
    async fn test_register_csv_rejects_invalid_options_json() {
        let engine = WrenEngine::new().unwrap();
        let err = engine
            .register_csv("t", b"a\n1\n", "{not json")
            .await
            .unwrap_err();
        let msg = js_sys::Error::from(JsValue::from(err))
            .message()
            .as_string()
            .unwrap_or_default();
        assert!(msg.contains("Invalid CSV options JSON"), "msg={msg}");
    }

    #[wasm_bindgen_test]
    async fn test_register_csv_rejects_empty_body() {
        // Header-only CSV — schema infers, but the body has no rows.
        let engine = WrenEngine::new().unwrap();
        let err = engine
            .register_csv("t", b"id,amount\n", "")
            .await
            .unwrap_err();
        let msg = js_sys::Error::from(JsValue::from(err))
            .message()
            .as_string()
            .unwrap_or_default();
        assert!(msg.contains("No data in CSV input"), "msg={msg}");
    }

    #[wasm_bindgen_test]
    async fn test_register_csv_rejects_multibyte_delimiter() {
        let engine = WrenEngine::new().unwrap();
        let csv = "a,b\n1,2\n";
        let options = r#"{"delimiter":"，"}"#;
        let err = engine
            .register_csv("t", csv.as_bytes(), options)
            .await
            .unwrap_err();
        let msg = js_sys::Error::from(JsValue::from(err))
            .message()
            .as_string()
            .unwrap_or_default();
        assert!(msg.contains("single ASCII character"), "msg={msg}");
    }

    #[test]
    fn test_arrow_schema_from_columns_maps_aliases() {
        use arrow::datatypes::DataType;
        let cols = vec![
            CsvColumn {
                name: "a".into(),
                ty: "int".into(),
                nullable: None,
            },
            CsvColumn {
                name: "b".into(),
                ty: "DOUBLE".into(),
                nullable: Some(false),
            },
            CsvColumn {
                name: "c".into(),
                ty: "string".into(),
                nullable: None,
            },
        ];
        let schema = arrow_schema_from_columns(&cols).unwrap();
        assert_eq!(schema.field(0).data_type(), &DataType::Int32);
        assert_eq!(schema.field(1).data_type(), &DataType::Float64);
        assert!(!schema.field(1).is_nullable());
        assert_eq!(schema.field(2).data_type(), &DataType::Utf8);
    }
}
