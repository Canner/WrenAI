//! Assemble an on-disk **wren project** (the split-file, `schema_version: 2` layout: a
//! `wren_project.yml` + per-model `models/<name>/metadata.yml` + `relationships.yml` + optional
//! `cubes.yml` + `views/<name>/{metadata,sql}.yml`) into a canonical [`wren_core_base::mdl::Manifest`].
//!
//! The engine-consumed MDL format is the single camelCase `Manifest`; a wren *project* is the
//! authored, split, snake_case form the `wren` CLI compiles into that manifest. This loader does
//! the structural slice of that compilation the compiler needs for introspection (models, columns,
//! relationships, cubes, views) — it does not expand `ref_sql` or resolve calculated columns
//! (execution concerns that never enter the sans-IO front-end). Parse is pure over already-read
//! bytes; the host owns the actual file reads.

use serde::Deserialize;
use std::collections::BTreeMap;
use thiserror::Error;
use wren_core_base::mdl::manifest::Manifest;

/// A wren project assembled into a canonical MDL manifest.
pub struct LoadedProject {
    pub manifest: Manifest,
}

#[derive(Debug, Error)]
pub enum LoadError {
    #[error("{0}")]
    Message(String),
}

fn msg(s: impl Into<String>) -> LoadError {
    LoadError::Message(s.into())
}

// --- on-disk (authored, snake_case) shapes ------------------------------------------------------

#[derive(Debug, Deserialize)]
struct ProjectFile {
    #[serde(default)]
    catalog: Option<String>,
    #[serde(default)]
    schema: Option<String>,
    #[serde(default)]
    data_source: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ModelFile {
    name: String,
    #[serde(default)]
    table_reference: Option<serde_yaml::Value>,
    #[serde(default)]
    base_object: Option<String>,
    #[serde(default)]
    ref_sql: Option<String>,
    #[serde(default)]
    primary_key: Option<serde_yaml::Value>,
    #[serde(default)]
    columns: Vec<ColumnFile>,
}

#[derive(Debug, Deserialize)]
struct ColumnFile {
    name: String,
    r#type: String,
    #[serde(default)]
    not_null: Option<bool>,
    #[serde(default)]
    relationship: Option<String>,
    #[serde(default)]
    is_calculated: Option<bool>,
    #[serde(default)]
    expression: Option<String>,
    #[serde(default)]
    is_hidden: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct RelationshipFile {
    name: String,
    models: Vec<String>,
    join_type: String,
    condition: String,
}

/// `relationships.yml` has two authored shapes: the original bare list, and the
/// `relationships:` keyed mapping that the wren CLI (project schema_version 5) scaffolds
/// and requires. Accept both; rejecting the keyed form would silently strip every join
/// from any project authored with the current CLI.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum RelationshipsDoc {
    Bare(Vec<RelationshipFile>),
    Keyed {
        relationships: Vec<RelationshipFile>,
    },
}

impl RelationshipsDoc {
    fn into_vec(self) -> Vec<RelationshipFile> {
        match self {
            RelationshipsDoc::Bare(v) => v,
            RelationshipsDoc::Keyed { relationships } => relationships,
        }
    }
}

#[derive(Debug, Deserialize)]
struct CubeFile {
    name: String,
    base_object: String,
    #[serde(default)]
    measures: Vec<CubeMemberFile>,
    #[serde(default)]
    dimensions: Vec<CubeMemberFile>,
    #[serde(default)]
    time_dimensions: Vec<CubeMemberFile>,
}

#[derive(Debug, Deserialize)]
struct CubeMemberFile {
    name: String,
    expression: String,
    r#type: String,
}

#[derive(Debug, Deserialize)]
struct ViewMetaFile {
    name: String,
}

#[derive(Debug, Deserialize)]
struct ViewSqlFile {
    statement: String,
}

// --- native host convenience ---------------------------------------------------------------------

/// Read a wren project directory into [`ProjectSources`] (native host only; the pure `assemble`
/// path is what a WASM host feeds directly). Returns `None` if the directory has no
/// `wren_project.yml` — i.e. it is not a wren project — so the caller can build an unparseable
/// context. Model, cube, and view sub-directories are read in sorted order for deterministic
/// output.
#[cfg(not(target_arch = "wasm32"))]
pub fn read_project_dir(dir: &std::path::Path) -> std::io::Result<Option<ProjectSources>> {
    use std::fs;

    let wren_project_path = dir.join("wren_project.yml");
    if !wren_project_path.is_file() {
        return Ok(None);
    }
    let wren_project_yml = fs::read_to_string(&wren_project_path)?;

    let mut model_ymls = Vec::new();
    let models_dir = dir.join("models");
    if models_dir.is_dir() {
        let mut entries: Vec<_> = fs::read_dir(&models_dir)?
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect();
        entries.sort();
        for model_dir in entries {
            let meta = model_dir.join("metadata.yml");
            if meta.is_file() {
                model_ymls.push(fs::read_to_string(meta)?);
            }
        }
    }

    let relationships_yml = read_if_exists(&dir.join("relationships.yml"))?;
    let cubes_yml = read_if_exists(&dir.join("cubes.yml"))?;

    let mut cube_ymls = Vec::new();
    let cubes_dir = dir.join("cubes");
    if cubes_dir.is_dir() {
        let mut entries: Vec<_> = fs::read_dir(&cubes_dir)?
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect();
        entries.sort();
        for cube_dir in entries {
            let meta = cube_dir.join("metadata.yml");
            if meta.is_file() {
                cube_ymls.push(fs::read_to_string(meta)?);
            }
        }
    }

    let mut views = Vec::new();
    let views_dir = dir.join("views");
    if views_dir.is_dir() {
        let mut entries: Vec<_> = fs::read_dir(&views_dir)?
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect();
        entries.sort();
        for view_dir in entries {
            let meta = view_dir.join("metadata.yml");
            let sql = view_dir.join("sql.yml");
            if meta.is_file() && sql.is_file() {
                views.push((fs::read_to_string(meta)?, fs::read_to_string(sql)?));
            }
        }
    }

    let mut knowledge_sql_mds = Vec::new();
    let knowledge_sql_dir = dir.join("knowledge").join("sql");
    if knowledge_sql_dir.is_dir() {
        let mut entries: Vec<_> = fs::read_dir(&knowledge_sql_dir)?
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| p.is_file() && p.extension().is_some_and(|ext| ext == "md"))
            .collect();
        entries.sort();
        for md in entries {
            let slug = md
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            knowledge_sql_mds.push((slug, fs::read_to_string(&md)?));
        }
    }

    let dashboards_yml = read_if_exists(&dir.join("dashboards.yml"))?;

    Ok(Some(ProjectSources {
        wren_project_yml,
        model_ymls,
        relationships_yml,
        cubes_yml,
        cube_ymls,
        views,
        knowledge_sql_mds,
        dashboards_yml,
    }))
}

/// Read the business-rule slice used by `wren context instructions`, without invoking `wren`.
///
/// The native host owns these filesystem reads; dispatchers receive only the normalized string.
/// Current `knowledge/rules/*.md` files are sorted by path and concatenated first, followed by the
/// legacy root `instructions.md` when present. Empty files contribute nothing.
#[cfg(not(target_arch = "wasm32"))]
pub fn read_knowledge_rules(dir: &std::path::Path) -> std::io::Result<KnowledgeRules> {
    use std::fs;

    let rules_dir = dir.join("knowledge").join("rules");
    let mut paths = if rules_dir.is_dir() {
        fs::read_dir(&rules_dir)?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.is_file() && path.extension().is_some_and(|ext| ext == "md"))
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    paths.sort();

    let mut parts = Vec::new();
    for path in paths {
        let contents = fs::read_to_string(path)?;
        if !contents.trim().is_empty() {
            parts.push(contents.trim().to_string());
        }
    }

    let legacy_path = dir.join("instructions.md");
    let used_legacy = legacy_path.is_file();
    if used_legacy {
        let contents = fs::read_to_string(legacy_path)?;
        if !contents.trim().is_empty() {
            parts.push(contents.trim().to_string());
        }
    }

    Ok(KnowledgeRules {
        content: parts.join("\n\n"),
        used_legacy,
    })
}

/// Normalized business rules loaded by a native host for dispatch-time injection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KnowledgeRules {
    pub content: String,
    pub used_legacy: bool,
}

#[cfg(not(target_arch = "wasm32"))]
fn read_if_exists(path: &std::path::Path) -> std::io::Result<Option<String>> {
    if path.is_file() {
        Ok(Some(std::fs::read_to_string(path)?))
    } else {
        Ok(None)
    }
}

// --- assembly -----------------------------------------------------------------------------------

/// The raw file contents of a wren project, read by the host. `assemble` operates purely over
/// these bytes (WASM-friendly); the native [`read_project_dir`] convenience fills them from disk.
pub struct ProjectSources {
    pub wren_project_yml: String,
    pub model_ymls: Vec<String>,
    pub relationships_yml: Option<String>,
    pub cubes_yml: Option<String>,
    /// Per-cube `cubes/<name>/metadata.yml` contents (wren CLI layout). Used only when
    /// `cubes_yml` is `None` — a root `cubes.yml` takes precedence.
    pub cube_ymls: Vec<String>,
    /// Each view as `(metadata.yml, sql.yml)` contents.
    pub views: Vec<(String, String)>,
    /// Confirmed saved queries from the wren CLI's `knowledge/sql/<slug>.md` store, as
    /// `(slug, file contents)`. Consumer sources: they never enter the MDL manifest — they only
    /// enrich the lineage graph with `query:<slug>` consumer nodes.
    pub knowledge_sql_mds: Vec<(String, String)>,
    /// The root `dashboards.yml` contents (the minimal declarative dashboard-spec convention:
    /// `dashboards[].name` + `panels[].sql` or `panels[].cube`+`measures`). Consumer source, like
    /// `knowledge_sql_mds`.
    pub dashboards_yml: Option<String>,
}

/// Assemble read project sources into a canonical [`Manifest`]. Returns a [`LoadError`] if any file
/// fails to parse or the assembled manifest is not a valid MDL manifest.
pub fn assemble(sources: &ProjectSources) -> Result<LoadedProject, LoadError> {
    let project: ProjectFile = serde_yaml::from_str(&sources.wren_project_yml)
        .map_err(|e| msg(format!("wren_project.yml: {e}")))?;

    let mut models = Vec::with_capacity(sources.model_ymls.len());
    for yml in &sources.model_ymls {
        let m: ModelFile = serde_yaml::from_str(yml).map_err(|e| msg(format!("model: {e}")))?;
        models.push(model_to_json(m)?);
    }

    let relationships = match &sources.relationships_yml {
        Some(yml) => {
            // A project with no relationships (e.g. a single-table onboarding scaffolded by the
            // wren CLI) ships a comment-only / empty relationships.yml, which parses to YAML null
            // and matches neither RelationshipsDoc variant. Treat an empty/null document as "no
            // relationships" rather than failing the whole project's parse.
            let is_empty = serde_yaml::from_str::<serde_yaml::Value>(yml)
                .map(|v| v.is_null())
                .unwrap_or(false);
            if is_empty {
                Vec::new()
            } else {
                let doc: RelationshipsDoc = serde_yaml::from_str(yml)
                    .map_err(|e| msg(format!("relationships.yml: {e}")))?;
                doc.into_vec()
                    .into_iter()
                    .map(relationship_to_json)
                    .collect()
            }
        }
        None => Vec::new(),
    };

    // A root `cubes.yml` (bare list) wins when present; otherwise fall back to the wren CLI's
    // per-cube layout (`cubes/<name>/metadata.yml`, one cube per file). Never both, so a project
    // that keeps a root mirror alongside the directory doesn't get every cube twice.
    let cubes = match &sources.cubes_yml {
        Some(yml) => {
            let cubes: Vec<CubeFile> =
                serde_yaml::from_str(yml).map_err(|e| msg(format!("cubes.yml: {e}")))?;
            cubes.into_iter().map(cube_to_json).collect()
        }
        None => sources
            .cube_ymls
            .iter()
            .map(|yml| {
                let cube: CubeFile =
                    serde_yaml::from_str(yml).map_err(|e| msg(format!("cube metadata: {e}")))?;
                Ok(cube_to_json(cube))
            })
            .collect::<Result<Vec<_>, LoadError>>()?,
    };

    let mut views = Vec::with_capacity(sources.views.len());
    for (meta_yml, sql_yml) in &sources.views {
        let meta: ViewMetaFile =
            serde_yaml::from_str(meta_yml).map_err(|e| msg(format!("view metadata: {e}")))?;
        let sql: ViewSqlFile =
            serde_yaml::from_str(sql_yml).map_err(|e| msg(format!("view sql: {e}")))?;
        views.push(serde_json::json!({ "name": meta.name, "statement": sql.statement }));
    }

    let mut manifest_json = serde_json::Map::new();
    if let Some(c) = project.catalog {
        manifest_json.insert("catalog".into(), serde_json::Value::String(c));
    }
    if let Some(s) = project.schema {
        manifest_json.insert("schema".into(), serde_json::Value::String(s));
    }
    if let Some(ds) = project.data_source {
        manifest_json.insert("dataSource".into(), serde_json::Value::String(ds));
    }
    manifest_json.insert("models".into(), serde_json::Value::Array(models));
    manifest_json.insert(
        "relationships".into(),
        serde_json::Value::Array(relationships),
    );
    manifest_json.insert("cubes".into(), serde_json::Value::Array(cubes));
    manifest_json.insert("views".into(), serde_json::Value::Array(views));

    // `catalog`/`schema` are required by the Manifest schema; default them so a minimal project
    // (test fixtures) still assembles rather than failing on a missing namespace field.
    manifest_json
        .entry("catalog")
        .or_insert_with(|| serde_json::Value::String("wren".into()));
    manifest_json
        .entry("schema")
        .or_insert_with(|| serde_json::Value::String("public".into()));

    let manifest: Manifest = serde_json::from_value(serde_json::Value::Object(manifest_json))
        .map_err(|e| msg(format!("assembled manifest is not valid MDL: {e}")))?;
    manifest
        .validate_layout_version()
        .map_err(|e| msg(e.to_string()))?;
    Ok(LoadedProject { manifest })
}

fn yaml_to_json(v: serde_yaml::Value) -> Result<serde_json::Value, LoadError> {
    serde_json::to_value(v).map_err(|e| msg(format!("value conversion: {e}")))
}

/// Pad a partial `table_reference` mapping so `wren-core-base`'s `TableReference {
/// catalog: Option<String>, schema: Option<String>, table: Option<String> }` custom deserializer
/// accepts it.
///
/// The `wren generate-mdl` CLI emits file-backed sources (duckdb/csv/local_file) with a bare
/// `table_reference: { table: /abs/path.parquet }` — no `catalog`/`schema` keys at all. Even
/// though those fields are `Option<String>`, `wren-core-base`'s custom serde module has no
/// `#[serde(default)]` on them, so a wholly-absent key is a hard "missing field `catalog`"
/// deserialize error rather than defaulting to `None`. Filling in the missing keys as explicit
/// JSON `null` (which `Option<String>` always deserializes as `None`, with no `default` attribute
/// needed) makes a bare `{table: ...}` object parse the same as a fully-specified one.
///
/// Only a YAML *mapping* is padded. The CLI's other authored shapes for this field — a dotted
/// string (`catalog.schema.table`) or a bare table-name string — go through a different (string)
/// deserialization path on the `wren-core-base` side and never hit the missing-field case, so
/// they pass through [`yaml_to_json`] unchanged.
fn normalize_table_reference(tref: serde_yaml::Value) -> Result<serde_json::Value, LoadError> {
    let mut json = yaml_to_json(tref)?;
    if let serde_json::Value::Object(obj) = &mut json {
        for key in ["catalog", "schema", "table"] {
            obj.entry(key).or_insert(serde_json::Value::Null);
        }
    }
    Ok(json)
}

fn model_to_json(m: ModelFile) -> Result<serde_json::Value, LoadError> {
    let mut obj = serde_json::Map::new();
    obj.insert("name".into(), serde_json::Value::String(m.name));
    if let Some(tref) = m.table_reference {
        obj.insert("tableReference".into(), normalize_table_reference(tref)?);
    }
    if let Some(base) = m.base_object {
        obj.insert("baseObject".into(), serde_json::Value::String(base));
    }
    if let Some(sql) = m.ref_sql {
        obj.insert("refSql".into(), serde_json::Value::String(sql));
    }
    if let Some(pk) = m.primary_key {
        obj.insert("primaryKey".into(), yaml_to_json(pk)?);
    }
    let columns: Vec<serde_json::Value> = m.columns.into_iter().map(column_to_json).collect();
    obj.insert("columns".into(), serde_json::Value::Array(columns));
    Ok(serde_json::Value::Object(obj))
}

fn column_to_json(c: ColumnFile) -> serde_json::Value {
    let mut obj = serde_json::Map::new();
    obj.insert("name".into(), serde_json::Value::String(c.name));
    obj.insert("type".into(), serde_json::Value::String(c.r#type));
    if let Some(b) = c.not_null {
        obj.insert("notNull".into(), serde_json::Value::Bool(b));
    }
    if let Some(rel) = c.relationship {
        obj.insert("relationship".into(), serde_json::Value::String(rel));
    }
    if let Some(b) = c.is_calculated {
        obj.insert("isCalculated".into(), serde_json::Value::Bool(b));
    }
    if let Some(expr) = c.expression {
        obj.insert("expression".into(), serde_json::Value::String(expr));
    }
    if let Some(b) = c.is_hidden {
        obj.insert("isHidden".into(), serde_json::Value::Bool(b));
    }
    serde_json::Value::Object(obj)
}

fn relationship_to_json(r: RelationshipFile) -> serde_json::Value {
    serde_json::json!({
        "name": r.name,
        "models": r.models,
        "joinType": r.join_type,
        "condition": r.condition,
    })
}

fn cube_member_to_json(m: CubeMemberFile) -> serde_json::Value {
    serde_json::json!({ "name": m.name, "expression": m.expression, "type": m.r#type })
}

fn cube_to_json(c: CubeFile) -> serde_json::Value {
    // `hierarchies` is a BTreeMap in the Manifest; an empty map keeps deterministic output.
    let empty: BTreeMap<String, Vec<String>> = BTreeMap::new();
    serde_json::json!({
        "name": c.name,
        "baseObject": c.base_object,
        "measures": c.measures.into_iter().map(cube_member_to_json).collect::<Vec<_>>(),
        "dimensions": c.dimensions.into_iter().map(cube_member_to_json).collect::<Vec<_>>(),
        "timeDimensions": c.time_dimensions.into_iter().map(cube_member_to_json).collect::<Vec<_>>(),
        "hierarchies": empty,
    })
}
