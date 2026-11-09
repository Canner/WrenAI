//! Assemble an on-disk **wren project** (the split-file, `schema_version: 2` layout: a
//! `wren_project.yml` + per-model `models/<name>/metadata.yml` + `relationships.yml` +
//! per-cube `cubes/<name>/metadata.yml` + `views/<name>/{metadata,sql}.yml`) into a canonical
//! [`wren_core_base::mdl::Manifest`]. Native project reads require the per-cube layout; the pure
//! [`ProjectSources`] API also accepts a root `cubes.yml` list for library callers.
//!
//! The engine-consumed MDL format is the single camelCase `Manifest`; a wren *project* is the
//! authored, split, snake_case form the `wren` CLI compiles into that manifest. This loader does
//! the structural slice of that compilation the compiler needs for introspection (models, columns,
//! relationships, cubes, views) — it does not expand `ref_sql` or resolve calculated columns
//! (execution concerns that never enter the sans-IO front-end). Parse is pure over already-read
//! bytes; the host owns the actual file reads.

use serde::Deserialize;
use std::collections::BTreeMap;
#[cfg(not(target_arch = "wasm32"))]
use std::io::Read;
use thiserror::Error;
#[cfg(not(target_arch = "wasm32"))]
use unicode_properties::{GeneralCategory, UnicodeGeneralCategory};
use wren_core_base::mdl::manifest::Manifest;

#[cfg(not(target_arch = "wasm32"))]
use sha2::{Digest, Sha256};

/// A wren project assembled into a canonical MDL manifest.
pub struct LoadedProject {
    pub manifest: Manifest,
}

/// A single native read of the inputs that feed both loader documents. Only semantic and rule
/// files are retained; other digest-covered files are streamed directly into [`Self::digest`].
#[cfg(not(target_arch = "wasm32"))]
pub struct ProjectSnapshot {
    pub sources: Option<ProjectSources>,
    pub rules: KnowledgeRules,
    pub digest: String,
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

#[derive(Debug, Default, Deserialize)]
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
    #[serde(default, alias = "refSql")]
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
pub(crate) struct RelationshipFile {
    pub(crate) name: String,
    pub(crate) models: Vec<String>,
    pub(crate) join_type: String,
    pub(crate) condition: String,
}

/// Parse a YAML document the way wren's own reader does (`yaml.safe_load(...) or {}`): an empty
/// file, a comment-only file, or a bare key with no value (all YAML null) is the type's empty
/// default rather than a parse failure. Anything else must deserialize as `T`.
pub(crate) fn parse_doc_or_default<T>(yml: &str) -> Result<T, serde_yaml::Error>
where
    T: serde::de::DeserializeOwned + Default,
{
    let value: serde_yaml::Value = serde_yaml::from_str(yml)?;
    if value.is_null() {
        return Ok(T::default());
    }
    serde_yaml::from_value(value)
}

/// Like [`parse_doc_or_default`] for a document that holds one optional record (a cube's
/// `metadata.yml`): null and non-mapping documents are `None`, as wren skips them.
pub(crate) fn parse_mapping_doc<T>(yml: &str) -> Result<Option<T>, serde_yaml::Error>
where
    T: serde::de::DeserializeOwned,
{
    let value: serde_yaml::Value = serde_yaml::from_str(yml)?;
    if !value.is_mapping() {
        return Ok(None);
    }
    serde_yaml::from_value(value).map(Some)
}

/// Match the native CLI's supported project-schema gate without changing the pure
/// [`ProjectSources`]/[`assemble`] contract. Missing schema versions default to 1; otherwise the
/// conversion follows the CLI's `int(...)` behavior before checking the supported 1..=5 range.
#[cfg(not(target_arch = "wasm32"))]
fn validate_native_schema_version(yml: &str) -> std::io::Result<bool> {
    let Ok(serde_yaml::Value::Mapping(project)) = serde_yaml::from_str::<serde_yaml::Value>(yml)
    else {
        // Keep malformed and non-mapping documents on the existing assembly/unparseable-context
        // path. This guard is only the native layout-version check.
        return Ok(false);
    };
    let Some(raw) = project.get("schema_version") else {
        return Ok(true);
    };
    let version = match raw {
        serde_yaml::Value::Bool(value) => Ok(i64::from(*value)),
        serde_yaml::Value::Number(value) => value
            .as_i64()
            .or_else(|| {
                value
                    .as_f64()
                    .filter(|value| value.is_finite())
                    .and_then(|value| {
                        (value >= i64::MIN as f64 && value <= i64::MAX as f64)
                            .then_some(value as i64)
                    })
            })
            .ok_or(()),
        serde_yaml::Value::String(value) => parse_cli_integer(value),
        _ => Err(()),
    }
    .map_err(|()| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "invalid schema_version in wren_project.yml: expected an integer",
        )
    })?;
    if !(1..=5).contains(&version) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!(
                "unsupported schema_version {version} in wren_project.yml; please upgrade wren CLI"
            ),
        ));
    }
    Ok(version == 1)
}

#[cfg(not(target_arch = "wasm32"))]
fn reject_native_flat_v1_sources(
    legacy_or_default_v1: bool,
    flat_source_paths: &[String],
) -> std::io::Result<()> {
    if !legacy_or_default_v1 || flat_source_paths.is_empty() {
        return Ok(());
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::InvalidInput,
        format!(
            "legacy flat-only schema_version 1 sources ({}) are unsupported by the native loader; add corresponding directory layout sources (models/<name>/metadata.yml, cubes/<name>/metadata.yml, views/<name>/metadata.yml) before native loading",
            flat_source_paths.join(", ")
        ),
    ))
}

#[cfg(not(target_arch = "wasm32"))]
fn is_flat_v1_source_path(path: &str) -> bool {
    path == "views.yml"
        || direct_file_in(path, "models").is_some_and(|name| name.ends_with(".yml"))
        || direct_file_in(path, "cubes").is_some_and(|name| name.ends_with(".yml"))
}

/// Parse the string forms accepted by Python's `int(value)`: optional ASCII sign, Unicode decimal
/// digits, and underscores only between digits. This deliberately excludes other Unicode numeric
/// characters (such as superscripts and Roman numerals), matching Python's integer conversion.
#[cfg(not(target_arch = "wasm32"))]
fn parse_cli_integer(value: &str) -> Result<i64, ()> {
    let value = value.trim();
    let (negative, value) = match value.strip_prefix('-') {
        Some(value) => (true, value),
        None => (false, value.strip_prefix('+').unwrap_or(value)),
    };
    let mut total = 0i64;
    let mut previous_was_digit = false;
    let mut saw_digit = false;
    for character in value.chars() {
        if character == '_' {
            if !previous_was_digit {
                return Err(());
            }
            previous_was_digit = false;
            continue;
        }
        let digit = unicode_decimal_digit(character).ok_or(())?;
        total = total
            .checked_mul(10)
            .and_then(|total| total.checked_add(i64::from(digit)))
            .ok_or(())?;
        previous_was_digit = true;
        saw_digit = true;
    }
    if !saw_digit || !previous_was_digit {
        return Err(());
    }
    if negative {
        total.checked_neg().ok_or(())
    } else {
        Ok(total)
    }
}

/// All Unicode `Nd` digit sets encode zero through nine contiguously. Consecutive mathematical
/// digit styles may form a longer run, so the offset is reduced modulo ten.
#[cfg(not(target_arch = "wasm32"))]
fn unicode_decimal_digit(character: char) -> Option<u8> {
    if character.general_category() != GeneralCategory::DecimalNumber {
        return None;
    }
    let mut start = character as u32;
    while let Some(previous) = start
        .checked_sub(1)
        .and_then(char::from_u32)
        .filter(|previous| previous.general_category() == GeneralCategory::DecimalNumber)
    {
        start = previous as u32;
    }
    Some(((character as u32 - start) % 10) as u8)
}

/// `relationships.yml` has two authored shapes: the original bare list, and the
/// `relationships:` keyed mapping that the wren CLI (project schema_version 5) scaffolds and
/// requires. Accept both; rejecting the keyed form would silently strip every join from any
/// project authored with the current CLI. Wren treats an empty file, a comment-only file, a bare
/// `relationships:` key (null) and `{}` as "no relationships"; so does this. Any other shape
/// (a scalar, a mapping with other keys, a list of non-mappings) is an error naming the reason.
pub(crate) fn parse_relationships(yml: &str) -> Result<Vec<RelationshipFile>, String> {
    use serde_yaml::Value;
    let value: Value = serde_yaml::from_str(yml).map_err(|e| e.to_string())?;
    let list = match value {
        Value::Null => return Ok(Vec::new()),
        Value::Sequence(_) => value,
        Value::Mapping(map) => match map.get("relationships") {
            Some(Value::Null) => return Ok(Vec::new()),
            Some(inner) => inner.clone(),
            None if map.is_empty() => return Ok(Vec::new()),
            None => {
                return Err(
                    "expected a `relationships:` list (or a bare list); found a mapping without a `relationships` key"
                        .to_string(),
                )
            }
        },
        other => {
            return Err(format!(
                "expected a list of relationships or a `relationships:` list, found {}",
                yaml_kind(&other)
            ))
        }
    };
    if !list.is_sequence() {
        return Err(format!(
            "`relationships` must be a list, found {}",
            yaml_kind(&list)
        ));
    }
    serde_yaml::from_value(list).map_err(|e| e.to_string())
}

fn yaml_kind(v: &serde_yaml::Value) -> &'static str {
    match v {
        serde_yaml::Value::Null => "null",
        serde_yaml::Value::Bool(_) => "a boolean",
        serde_yaml::Value::Number(_) => "a number",
        serde_yaml::Value::String(_) => "a string",
        serde_yaml::Value::Sequence(_) => "a list",
        serde_yaml::Value::Mapping(_) => "a mapping",
        serde_yaml::Value::Tagged(_) => "a tagged value",
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
    #[serde(default)]
    hierarchies: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct CubeMemberFile {
    name: String,
    expression: String,
    r#type: String,
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Debug, Eq, Ord, PartialEq, PartialOrd)]
struct CubeMemberSignature {
    name: String,
    expression: String,
    r#type: String,
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Debug, Eq, Ord, PartialEq, PartialOrd)]
struct CubeSignature {
    name: String,
    base_object: String,
    measures: Vec<CubeMemberSignature>,
    dimensions: Vec<CubeMemberSignature>,
    time_dimensions: Vec<CubeMemberSignature>,
    hierarchies: BTreeMap<String, Vec<String>>,
}

#[cfg(not(target_arch = "wasm32"))]
impl From<CubeFile> for CubeSignature {
    fn from(cube: CubeFile) -> Self {
        let members = |members: Vec<CubeMemberFile>| {
            let mut members = members
                .into_iter()
                .map(|member| CubeMemberSignature {
                    name: member.name,
                    expression: member.expression.trim().to_string(),
                    r#type: member.r#type,
                })
                .collect::<Vec<_>>();
            members.sort();
            members
        };
        Self {
            name: cube.name,
            base_object: cube.base_object,
            measures: members(cube.measures),
            dimensions: members(cube.dimensions),
            time_dimensions: members(cube.time_dimensions),
            hierarchies: cube.hierarchies,
        }
    }
}

#[derive(Debug, Deserialize)]
struct ViewMetaFile {
    name: String,
    /// The statement may be written inline; a non-empty `sql.yml` statement takes precedence.
    #[serde(default)]
    statement: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct ViewSqlFile {
    #[serde(default)]
    statement: Option<String>,
}

/// The statement in a view's `sql.yml`, if it has a non-empty one. An empty or comment-only file
/// is "no statement", as the wren CLI reads it.
pub(crate) fn sql_yml_statement(sql_yml: &str) -> Result<Option<String>, serde_yaml::Error> {
    let sql: ViewSqlFile = parse_doc_or_default(sql_yml)?;
    Ok(sql.statement.filter(|statement| !statement.is_empty()))
}

// --- native host convenience ---------------------------------------------------------------------

#[cfg(all(unix, not(target_arch = "wasm32")))]
fn read_metadata_if_file(dir: &crate::source_fs::SourceDir) -> std::io::Result<Option<String>> {
    if dir.entry_kind("metadata.yml".as_ref())? == crate::source_fs::EntryKind::Directory {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "metadata_directory_unsupported",
        ));
    }
    dir.read_string_if_file("metadata.yml".as_ref())
}

/// Read a model's metadata and apply the non-empty sibling `ref_sql.sql`, which is the authored
/// source that takes precedence over an inline `ref_sql` field.
#[cfg(all(unix, not(target_arch = "wasm32")))]
fn read_model_metadata_if_file(
    dir: &crate::source_fs::SourceDir,
) -> std::io::Result<Option<String>> {
    let Some(metadata) = read_metadata_if_file(dir)? else {
        return Ok(None);
    };
    if dir.entry_kind("ref_sql.sql".as_ref())? == crate::source_fs::EntryKind::Directory {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "ref_sql_directory_unsupported",
        ));
    }
    Ok(Some(apply_ref_sql_file(
        metadata,
        dir.read_string_if_file("ref_sql.sql".as_ref())?,
    )?))
}

fn apply_ref_sql_file(metadata: String, ref_sql_file: Option<String>) -> std::io::Result<String> {
    let Some(ref_sql) = ref_sql_file else {
        return Ok(metadata);
    };
    let ref_sql = ref_sql.trim();
    if ref_sql.is_empty() {
        return Ok(metadata);
    }

    // Keep malformed/non-mapping metadata on the existing assembly-error path. The sibling file
    // only overrides a valid mapping, as the native reader never turns a non-model into a model.
    let Ok(serde_yaml::Value::Mapping(mut document)) = serde_yaml::from_str(&metadata) else {
        return Ok(metadata);
    };
    document.remove(serde_yaml::Value::String("ref_sql".into()));
    document.remove(serde_yaml::Value::String("refSql".into()));
    document.insert(
        serde_yaml::Value::String("ref_sql".into()),
        serde_yaml::Value::String(ref_sql.into()),
    );
    serde_yaml::to_string(&document).map_err(std::io::Error::other)
}

/// Read a wren project directory into [`ProjectSources`] (native host only; the pure `assemble`
/// path is what a WASM host feeds directly). Returns `None` if the directory has no
/// `wren_project.yml` — i.e. it is not a wren project — so the caller can build an unparseable
/// context. Model, cube, and view sub-directories are read in sorted order for deterministic
/// output. Entries that cannot be read are an error; dot-named entries are not inputs.
///
/// A model's non-empty `ref_sql.sql` sibling overrides the inline `ref_sql` in its `metadata.yml`,
/// matching the project reader used by the CLI.
///
/// A view directory is a view when it has a `metadata.yml`, with or without a `sql.yml` — the
/// same rule as `wren`, which also ignores a directory that holds only a `sql.yml`.
///
/// The native engine reads cubes from `cubes/<name>/metadata.yml`; a non-empty root `cubes.yml`
/// may mirror those files but cannot be the only native cube source.
/// Mirror validation compares executable cube semantics, not descriptive properties. A non-empty
/// root list remains the catalog authority, so its cube and member descriptions intentionally
/// override directory prose without requiring an engine rebuild.
/// Schema versions 1 through 5 are accepted for this directory layout, but the legacy v1 flat
/// `models/*.yml`, `cubes/*.yml`, and `views.yml` sources need corresponding directory-layout
/// counterparts before native loading. Existing mixed projects retain their directory sources;
/// the later host coherence check detects non-mirroring content.
#[cfg(all(unix, not(target_arch = "wasm32")))]
pub fn read_project_dir(dir: &std::path::Path) -> std::io::Result<Option<ProjectSources>> {
    let root = crate::source_fs::SourceDir::open_root(dir)?;
    let Some(wren_project_yml) = root.read_root_string("wren_project.yml".as_ref())? else {
        return Ok(None);
    };
    crate::digest::validate_source_directories(dir)?;
    let legacy_or_default_v1 = validate_native_schema_version(&wren_project_yml)?;
    if legacy_or_default_v1 {
        reject_native_flat_v1_sources(true, &native_flat_v1_sources_without_counterparts(&root)?)?;
    }
    let read_metadata = |parent: &crate::source_fs::SourceDir| -> std::io::Result<Vec<String>> {
        let mut values = Vec::new();
        for name in parent.names()? {
            if crate::digest::is_hidden(&name) {
                continue;
            }
            if let Some(child) = parent.open_nested_dir(&name)? {
                if let Some(contents) = read_metadata_if_file(&child)? {
                    values.push(contents);
                }
            }
        }
        Ok(values)
    };
    let model_ymls = match root.open_dir_if_exists("models".as_ref())? {
        Some(dir) => {
            let mut values = Vec::new();
            for name in dir.names()? {
                if crate::digest::is_hidden(&name) {
                    continue;
                }
                if let Some(model) = dir.open_nested_dir(&name)? {
                    if let Some(contents) = read_model_metadata_if_file(&model)? {
                        values.push(contents);
                    }
                }
            }
            values
        }
        None => Vec::new(),
    };
    let cube_ymls = match root.open_dir_if_exists("cubes".as_ref())? {
        Some(dir) => read_metadata(&dir)?,
        None => Vec::new(),
    };
    let relationships_yml = root.read_root_string("relationships.yml".as_ref())?;
    let cubes_yml = root.read_root_string("cubes.yml".as_ref())?;
    let dashboards_yml = root.read_root_string("dashboards.yml".as_ref())?;
    let mut views = Vec::new();
    if let Some(view_root) = root.open_dir_if_exists("views".as_ref())? {
        for name in view_root.names()? {
            if crate::digest::is_hidden(&name) {
                continue;
            }
            if let Some(view) = view_root.open_nested_dir(&name)? {
                if let Some(meta) = read_metadata_if_file(&view)? {
                    if view.entry_kind("sql.yml".as_ref())?
                        == crate::source_fs::EntryKind::Directory
                    {
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::InvalidInput,
                            "sql_yml_directory_unsupported",
                        ));
                    }
                    views.push((
                        meta,
                        view.read_string_if_file("sql.yml".as_ref())?
                            .unwrap_or_default(),
                    ));
                }
            }
        }
    }
    let mut knowledge_sql_mds = Vec::new();
    if let Some(knowledge) = root.open_dir_if_exists("knowledge".as_ref())? {
        if let Some(sql) = knowledge.open_dir_if_exists("sql".as_ref())? {
            for name in sql.names()? {
                if crate::digest::is_hidden(&name)
                    || std::path::Path::new(&name)
                        .extension()
                        .is_none_or(|ext| ext != "md")
                {
                    continue;
                }
                if let Some(contents) = sql.read_string_if_file(&name)? {
                    knowledge_sql_mds.push((
                        std::path::Path::new(&name)
                            .file_stem()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into_owned(),
                        contents,
                    ));
                }
            }
        }
    }
    let sources = ProjectSources {
        wren_project_yml,
        model_ymls,
        relationships_yml,
        cubes_yml,
        cube_ymls,
        views,
        knowledge_sql_mds,
        dashboards_yml,
    };
    validate_native_cube_source(&sources)?;
    Ok(Some(sources))
}

#[cfg(all(unix, not(target_arch = "wasm32")))]
fn native_flat_v1_sources_without_counterparts(
    root: &crate::source_fs::SourceDir,
) -> std::io::Result<Vec<String>> {
    let mut paths = Vec::new();
    for parent in ["models", "cubes"] {
        let Some(dir) = root.open_dir_if_exists(parent.as_ref())? else {
            continue;
        };
        for name in dir.names()? {
            if crate::digest::is_hidden(&name) {
                continue;
            }
            let name_text = crate::digest::source_name(&name)?;
            let path = format!("{parent}/{name_text}");
            let Some(stem) = name_text.strip_suffix(".yml") else {
                continue;
            };
            let has_counterpart = dir
                .open_nested_dir(std::ffi::OsStr::new(stem))?
                .map(|child| child.open_regular_file("metadata.yml".as_ref()))
                .transpose()?
                .flatten()
                .is_some();
            if is_flat_v1_source_path(&path)
                && dir.open_regular_file(&name)?.is_some()
                && !has_counterpart
            {
                paths.push(path);
            }
        }
    }
    let has_view_counterpart = root
        .open_dir_if_exists("views".as_ref())?
        .map(|views| {
            views.names()?.into_iter().try_fold(false, |found, name| {
                if found || crate::digest::is_hidden(&name) {
                    return Ok::<bool, std::io::Error>(found);
                }
                Ok(views
                    .open_nested_dir(&name)?
                    .map(|view| view.open_regular_file("metadata.yml".as_ref()))
                    .transpose()?
                    .flatten()
                    .is_some())
            })
        })
        .transpose()?
        .unwrap_or(false);
    if root.open_regular_file("views.yml".as_ref())?.is_some() && !has_view_counterpart {
        paths.push("views.yml".to_string());
    }
    paths.sort();
    Ok(paths)
}

/// Capture the project inputs once for the CLI's prepared document, catalog, and digest. This
/// makes those outputs mutually coherent; it does not claim an atomic filesystem snapshot.
#[cfg(all(unix, not(target_arch = "wasm32")))]
pub fn capture_project(dir: &std::path::Path) -> std::io::Result<ProjectSnapshot> {
    let root = crate::source_fs::SourceDir::open_root(dir)?;
    let mut capture = SourceCapture::default();
    let mut entries: Vec<(String, bool)> = [
        ("wren_project.yml".to_string(), false),
        ("relationships.yml".to_string(), false),
        ("cubes.yml".to_string(), false),
        ("dashboards.yml".to_string(), false),
        ("instructions.md".to_string(), false),
        ("views.yml".to_string(), false),
        ("models/".to_string(), true),
        ("cubes/".to_string(), true),
        ("views/".to_string(), true),
        ("knowledge/".to_string(), true),
    ]
    .into();
    entries.sort_by(|left, right| left.0.as_bytes().cmp(right.0.as_bytes()));
    for (entry, is_dir) in entries {
        let name = entry.trim_end_matches('/');
        if is_dir {
            if let Some(child) = root.open_dir_if_exists(name.as_ref())? {
                capture.capture_dir(&child, name)?;
            }
        } else if name == "views.yml" {
            // Root views.yml is only a legacy-v1 source. Defer looking at it until the project
            // configuration is captured, so newer projects preserve the longstanding ignore rule.
        } else if let Some(file) = root.open_root_file(name.as_ref())? {
            capture.capture_file(name, file)?;
        }
    }
    let legacy_or_default_v1 = capture
        .text
        .get("wren_project.yml")
        .map(|project| validate_native_schema_version(project))
        .transpose()?
        .unwrap_or(false);
    if legacy_or_default_v1 && root.open_regular_file("views.yml".as_ref())?.is_some() {
        capture.flat_v1_source_paths.push("views.yml".to_string());
    }
    let digest = capture.digest();
    let sources = captured_sources(&capture.text, &capture.flat_v1_source_paths)?;
    let rules = captured_rules(&capture.text);
    Ok(ProjectSnapshot {
        sources,
        rules,
        digest,
    })
}

#[cfg(all(not(target_arch = "wasm32"), not(unix)))]
pub fn capture_project(dir: &std::path::Path) -> std::io::Result<ProjectSnapshot> {
    use std::fs;

    validate_nonunix_file_slots(dir)?;
    crate::digest::validate_source_directories(dir)?;
    let mut files = Vec::new();
    for name in [
        "wren_project.yml",
        "relationships.yml",
        "cubes.yml",
        "dashboards.yml",
        "instructions.md",
    ] {
        let path = dir.join(name);
        if path.is_file() {
            files.push((name.to_string(), path));
        }
    }
    files.extend(crate::digest::source_files(dir)?);
    files.sort_by(|left, right| left.0.as_bytes().cmp(right.0.as_bytes()));
    let mut capture = SourceCapture::default();
    for (relative, path) in files {
        capture.capture_file(&relative, fs::File::open(path)?)?;
    }
    let legacy_or_default_v1 = capture
        .text
        .get("wren_project.yml")
        .map(|project| validate_native_schema_version(project))
        .transpose()?
        .unwrap_or(false);
    if legacy_or_default_v1 && dir.join("views.yml").is_file() {
        capture.flat_v1_source_paths.push("views.yml".to_string());
    }
    let sources = captured_sources(&capture.text, &capture.flat_v1_source_paths)?;
    let rules = captured_rules(&capture.text);
    let digest = capture.digest();
    Ok(ProjectSnapshot {
        sources,
        rules,
        digest,
    })
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Default)]
struct SourceCapture {
    hasher: Sha256,
    text: BTreeMap<String, String>,
    flat_v1_source_paths: Vec<String>,
}

#[cfg(all(unix, not(target_arch = "wasm32")))]
impl SourceCapture {
    fn capture_dir(
        &mut self,
        dir: &crate::source_fs::SourceDir,
        prefix: &str,
    ) -> std::io::Result<()> {
        let mut entries = Vec::new();
        for name in dir.names()? {
            if crate::digest::is_hidden(&name) {
                continue;
            }
            let name_text = crate::digest::source_name(&name)?;
            let kind = dir.entry_kind(&name)?;
            let path = format!(
                "{prefix}/{name_text}{}",
                if kind == crate::source_fs::EntryKind::Directory {
                    "/"
                } else {
                    ""
                }
            );
            entries.push((path, name, kind));
        }
        entries.sort_by(|left, right| left.0.as_bytes().cmp(right.0.as_bytes()));
        for (path, name, kind) in entries {
            match kind {
                crate::source_fs::EntryKind::Directory => {
                    reject_directory_file_slot(path.trim_end_matches('/'), &self.text)?;
                    self.capture_dir(&dir.open_dir(&name)?, path.trim_end_matches('/'))?;
                }
                crate::source_fs::EntryKind::Regular | crate::source_fs::EntryKind::Symlink => {
                    let Some(file) = dir.open_regular_file(&name)? else {
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::InvalidInput,
                            "directory_symlink_unsupported",
                        ));
                    };
                    self.capture_file(&path, file)?;
                }
                crate::source_fs::EntryKind::Missing | crate::source_fs::EntryKind::Other => {}
            }
        }
        Ok(())
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl SourceCapture {
    fn capture_file(&mut self, relative: &str, mut file: std::fs::File) -> std::io::Result<()> {
        if is_flat_v1_source_path(relative) {
            self.flat_v1_source_paths.push(relative.to_string());
        }
        let expected = file.metadata()?.len();
        self.hasher.update(relative.as_bytes());
        self.hasher.update([0]);
        self.hasher.update(expected.to_string().as_bytes());
        self.hasher.update([0]);
        let retain = captured_text_file(relative);
        let mut retained = retain.then(Vec::new);
        let mut total = 0;
        let mut buffer = [0; 8192];
        loop {
            let count = file.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            total += count as u64;
            self.hasher.update(&buffer[..count]);
            if let Some(retained) = &mut retained {
                retained.extend_from_slice(&buffer[..count]);
            }
        }
        if total != expected {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("file changed while hashing: {relative}"),
            ));
        }
        if let Some(bytes) = retained {
            self.text.insert(
                relative.to_string(),
                String::from_utf8(bytes).map_err(std::io::Error::other)?,
            );
        }
        Ok(())
    }

    fn digest(&self) -> String {
        self.hasher
            .clone()
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn captured_text_file(path: &str) -> bool {
    matches!(
        path,
        "wren_project.yml"
            | "relationships.yml"
            | "cubes.yml"
            | "dashboards.yml"
            | "instructions.md"
    ) || direct_source_file(path, "models", "metadata.yml").is_some()
        || direct_source_file(path, "models", "ref_sql.sql").is_some()
        || direct_source_file(path, "cubes", "metadata.yml").is_some()
        || direct_source_file(path, "views", "metadata.yml").is_some()
        || direct_source_file(path, "views", "sql.yml").is_some()
        || direct_file_in(path, "knowledge/sql").is_some_and(|name| name.ends_with(".md"))
        || direct_file_in(path, "knowledge/rules").is_some_and(|name| name.ends_with(".md"))
}

#[cfg(not(target_arch = "wasm32"))]
fn direct_source_file<'a>(path: &'a str, parent: &str, file: &str) -> Option<&'a str> {
    let prefix = format!("{parent}/");
    let rest = path.strip_prefix(&prefix)?;
    let (child, leaf) = rest.split_once('/')?;
    if leaf == file || (file.is_empty() && !leaf.contains('/')) {
        Some(child)
    } else {
        None
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn reject_directory_file_slot(
    path: &str,
    captured_text: &BTreeMap<String, String>,
) -> std::io::Result<()> {
    let error = if direct_source_file(path, "models", "metadata.yml").is_some()
        || direct_source_file(path, "cubes", "metadata.yml").is_some()
        || direct_source_file(path, "views", "metadata.yml").is_some()
    {
        Some("metadata_directory_unsupported")
    } else if let Some(model) = direct_source_file(path, "models", "ref_sql.sql") {
        captured_text
            .contains_key(&format!("models/{model}/metadata.yml"))
            .then_some("ref_sql_directory_unsupported")
    } else if let Some(view) = direct_source_file(path, "views", "sql.yml") {
        captured_text
            .contains_key(&format!("views/{view}/metadata.yml"))
            .then_some("sql_yml_directory_unsupported")
    } else {
        None
    };
    error.map_or(Ok(()), |message| {
        Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            message,
        ))
    })
}

#[cfg(not(target_arch = "wasm32"))]
fn captured_sources(
    text: &BTreeMap<String, String>,
    flat_v1_source_paths: &[String],
) -> std::io::Result<Option<ProjectSources>> {
    let Some(wren_project_yml) = text.get("wren_project.yml").cloned() else {
        return Ok(None);
    };
    let legacy_or_default_v1 = validate_native_schema_version(&wren_project_yml)?;
    if legacy_or_default_v1 {
        reject_native_flat_v1_sources(
            true,
            &captured_flat_v1_sources_without_counterparts(text, flat_v1_source_paths),
        )?;
    }
    let mut model_ymls = Vec::new();
    let mut cube_ymls = Vec::new();
    let mut views = Vec::new();
    for (path, contents) in text {
        if let Some(name) = direct_source_file(path, "models", "metadata.yml") {
            model_ymls.push(apply_ref_sql_file(
                contents.clone(),
                text.get(&format!("models/{name}/ref_sql.sql")).cloned(),
            )?);
        }
        if direct_source_file(path, "cubes", "metadata.yml").is_some() {
            cube_ymls.push(contents.clone());
        }
        if let Some(name) = direct_source_file(path, "views", "metadata.yml") {
            views.push((
                contents.clone(),
                text.get(&format!("views/{name}/sql.yml"))
                    .cloned()
                    .unwrap_or_default(),
            ));
        }
    }
    let mut knowledge_sql_mds = Vec::new();
    for (path, contents) in text {
        if let Some(name) = direct_file_in(path, "knowledge/sql") {
            if let Some(slug) = name.strip_suffix(".md") {
                knowledge_sql_mds.push((slug.to_string(), contents.clone()));
            }
        }
    }
    let sources = ProjectSources {
        wren_project_yml,
        model_ymls,
        relationships_yml: text.get("relationships.yml").cloned(),
        cubes_yml: text.get("cubes.yml").cloned(),
        cube_ymls,
        views,
        knowledge_sql_mds,
        dashboards_yml: text.get("dashboards.yml").cloned(),
    };
    validate_native_cube_source(&sources)?;
    Ok(Some(sources))
}

#[cfg(not(target_arch = "wasm32"))]
fn captured_flat_v1_sources_without_counterparts(
    text: &BTreeMap<String, String>,
    flat_v1_source_paths: &[String],
) -> Vec<String> {
    flat_v1_source_paths
        .iter()
        .filter(|path| {
            if path.as_str() == "views.yml" {
                !text
                    .keys()
                    .any(|path| direct_source_file(path, "views", "metadata.yml").is_some())
            } else {
                let counterpart = direct_file_in(path, "models")
                    .or_else(|| direct_file_in(path, "cubes"))
                    .and_then(|name| name.strip_suffix(".yml"))
                    .map(|name| {
                        if path.starts_with("models/") {
                            format!("models/{name}/metadata.yml")
                        } else {
                            format!("cubes/{name}/metadata.yml")
                        }
                    });
                counterpart.is_none_or(|path| !text.contains_key(&path))
            }
        })
        .cloned()
        .collect()
}

#[cfg(not(target_arch = "wasm32"))]
fn validate_native_cube_source(sources: &ProjectSources) -> std::io::Result<()> {
    let Some(root) = &sources.cubes_yml else {
        return Ok(());
    };
    let Ok(root_cubes) = parse_doc_or_default::<Vec<CubeFile>>(root) else {
        // Preserve the existing assembly diagnostic for malformed root input.
        return Ok(());
    };
    if root_cubes.is_empty() {
        return Ok(());
    }
    let directory_cubes = sources
        .cube_ymls
        .iter()
        .filter_map(|yml| parse_mapping_doc::<CubeFile>(yml).transpose())
        .collect::<Result<Vec<_>, _>>();
    let Ok(directory_cubes) = directory_cubes else {
        return Err(native_cube_mirror_error());
    };

    let mut root_signatures = root_cubes
        .into_iter()
        .map(CubeSignature::from)
        .collect::<Vec<_>>();
    let mut directory_signatures = directory_cubes
        .into_iter()
        .map(CubeSignature::from)
        .collect::<Vec<_>>();
    root_signatures.sort();
    directory_signatures.sort();
    if root_signatures == directory_signatures {
        Ok(())
    } else {
        Err(native_cube_mirror_error())
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn native_cube_mirror_error() -> std::io::Error {
    std::io::Error::new(
        std::io::ErrorKind::InvalidInput,
        "non-empty cubes.yml requires an exact semantic mirror in cubes/<name>/metadata.yml for native projects",
    )
}

#[cfg(not(target_arch = "wasm32"))]
fn direct_file_in<'a>(path: &'a str, parent: &str) -> Option<&'a str> {
    let name = path.strip_prefix(&format!("{parent}/"))?;
    (!name.contains('/')).then_some(name)
}

#[cfg(not(target_arch = "wasm32"))]
fn captured_rules(text: &BTreeMap<String, String>) -> KnowledgeRules {
    let mut files = Vec::new();
    for (path, contents) in text {
        if let Some(name) = direct_file_in(path, "knowledge/rules") {
            if name.ends_with(".md") && !contents.trim().is_empty() {
                files.push(KnowledgeRuleFile {
                    path: format!("knowledge/rules/{name}"),
                    content: contents.trim().to_string(),
                });
            }
        }
    }
    let used_legacy = text.contains_key("instructions.md");
    if let Some(contents) = text
        .get("instructions.md")
        .filter(|contents| !contents.trim().is_empty())
    {
        files.push(KnowledgeRuleFile {
            path: "instructions.md".to_string(),
            content: contents.trim().to_string(),
        });
    }
    let content = files
        .iter()
        .map(|file| file.content.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    let (declared_defaults, warnings) = declared_default_ids(&files);
    for warning in warnings {
        eprintln!("wren-context-loader: {warning}");
    }
    KnowledgeRules {
        content,
        used_legacy,
        files,
        declared_defaults,
    }
}

#[cfg(all(not(target_arch = "wasm32"), not(unix)))]
fn validate_nonunix_file_slots(dir: &std::path::Path) -> std::io::Result<()> {
    for parent in ["models", "cubes", "views"] {
        let root = dir.join(parent);
        if !root.is_dir() {
            continue;
        }
        for child in list_dir(&root)?.into_iter().filter(|path| path.is_dir()) {
            let metadata = child.join("metadata.yml");
            if metadata.is_dir() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "metadata_directory_unsupported",
                ));
            }
            if parent == "models" && metadata.is_file() && child.join("ref_sql.sql").is_dir() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "ref_sql_directory_unsupported",
                ));
            }
            if parent == "views" && metadata.is_file() && child.join("sql.yml").is_dir() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "sql_yml_directory_unsupported",
                ));
            }
        }
    }
    Ok(())
}

#[cfg(all(not(target_arch = "wasm32"), not(unix)))]
fn native_flat_v1_sources_without_counterparts(
    dir: &std::path::Path,
) -> std::io::Result<Vec<String>> {
    let mut paths = Vec::new();
    for parent in ["models", "cubes"] {
        let root = dir.join(parent);
        if !root.is_dir() {
            continue;
        }
        for path in list_dir(&root)? {
            if path.is_file() && path.extension().is_some_and(|extension| extension == "yml") {
                let Some(name) = path.file_name().and_then(std::ffi::OsStr::to_str) else {
                    continue;
                };
                let Some(stem) = name.strip_suffix(".yml") else {
                    continue;
                };
                if !root.join(stem).join("metadata.yml").is_file() {
                    paths.push(format!("{parent}/{name}"));
                }
            }
        }
    }
    let has_view_counterpart = dir.join("views").is_dir()
        && list_dir(&dir.join("views"))?
            .into_iter()
            .filter(|path| path.is_dir())
            .any(|path| path.join("metadata.yml").is_file());
    if dir.join("views.yml").is_file() && !has_view_counterpart {
        paths.push("views.yml".to_string());
    }
    paths.sort();
    Ok(paths)
}

#[cfg(all(not(target_arch = "wasm32"), not(unix)))]
fn read_metadata_if_file(path: &std::path::Path) -> std::io::Result<Option<String>> {
    if path.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "metadata_directory_unsupported",
        ));
    }
    if path.is_file() {
        return std::fs::read_to_string(path).map(Some);
    }
    Ok(None)
}

#[cfg(all(not(target_arch = "wasm32"), not(unix)))]
fn read_model_metadata_if_file(path: &std::path::Path) -> std::io::Result<Option<String>> {
    let Some(metadata) = read_metadata_if_file(&path.join("metadata.yml"))? else {
        return Ok(None);
    };
    let ref_sql = path.join("ref_sql.sql");
    if ref_sql.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "ref_sql_directory_unsupported",
        ));
    }
    let contents = ref_sql
        .is_file()
        .then(|| std::fs::read_to_string(ref_sql))
        .transpose()?;
    Ok(Some(apply_ref_sql_file(metadata, contents)?))
}

#[cfg(all(not(target_arch = "wasm32"), not(unix)))]
pub fn read_project_dir(dir: &std::path::Path) -> std::io::Result<Option<ProjectSources>> {
    use std::fs;

    let wren_project_path = dir.join("wren_project.yml");
    if !wren_project_path.is_file() {
        return Ok(None);
    }
    crate::digest::validate_source_directories(dir)?;
    let wren_project_yml = fs::read_to_string(&wren_project_path)?;
    let legacy_or_default_v1 = validate_native_schema_version(&wren_project_yml)?;
    if legacy_or_default_v1 {
        reject_native_flat_v1_sources(true, &native_flat_v1_sources_without_counterparts(dir)?)?;
    }

    let mut model_ymls = Vec::new();
    let models_dir = dir.join("models");
    if models_dir.is_dir() {
        for model_dir in list_dir(&models_dir)?.into_iter().filter(|p| p.is_dir()) {
            if let Some(contents) = read_model_metadata_if_file(&model_dir)? {
                model_ymls.push(contents);
            }
        }
    }

    let relationships_yml = read_if_exists(&dir.join("relationships.yml"))?;
    let cubes_yml = read_if_exists(&dir.join("cubes.yml"))?;

    let mut cube_ymls = Vec::new();
    let cubes_dir = dir.join("cubes");
    if cubes_dir.is_dir() {
        for cube_dir in list_dir(&cubes_dir)?.into_iter().filter(|p| p.is_dir()) {
            let meta = cube_dir.join("metadata.yml");
            if let Some(contents) = read_metadata_if_file(&meta)? {
                cube_ymls.push(contents);
            }
        }
    }

    let mut views = Vec::new();
    let views_dir = dir.join("views");
    if views_dir.is_dir() {
        for view_dir in list_dir(&views_dir)?.into_iter().filter(|p| p.is_dir()) {
            let meta = view_dir.join("metadata.yml");
            if let Some(contents) = read_metadata_if_file(&meta)? {
                let sql_path = view_dir.join("sql.yml");
                if sql_path.is_dir() {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidInput,
                        "sql_yml_directory_unsupported",
                    ));
                }
                let sql = read_if_exists(&sql_path)?.unwrap_or_default();
                views.push((contents, sql));
            }
        }
    }

    let mut knowledge_sql_mds = Vec::new();
    let knowledge_sql_dir = dir.join("knowledge").join("sql");
    if knowledge_sql_dir.is_dir() {
        let markdown = list_dir(&knowledge_sql_dir)?
            .into_iter()
            .filter(|p| p.is_file() && p.extension().is_some_and(|ext| ext == "md"));
        for md in markdown {
            let slug = md
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            knowledge_sql_mds.push((slug, fs::read_to_string(&md)?));
        }
    }

    let dashboards_yml = read_if_exists(&dir.join("dashboards.yml"))?;

    let sources = ProjectSources {
        wren_project_yml,
        model_ymls,
        relationships_yml,
        cubes_yml,
        cube_ymls,
        views,
        knowledge_sql_mds,
        dashboards_yml,
    };
    validate_native_cube_source(&sources)?;
    Ok(Some(sources))
}

/// Read the business-rule slice used by `wren context instructions`, without invoking `wren`.
///
/// The native host owns these filesystem reads; dispatchers receive only the normalized string.
/// Current `knowledge/rules/*.md` files are sorted by path and concatenated first, followed by the
/// legacy root `instructions.md` when present. Empty files contribute nothing. The same files are
/// also returned one by one in [`KnowledgeRules::files`], in that order, so a host can show where
/// each rule came from.
#[cfg(all(unix, not(target_arch = "wasm32")))]
pub fn read_knowledge_rules(dir: &std::path::Path) -> std::io::Result<KnowledgeRules> {
    crate::digest::validate_source_directories(dir)?;
    let root = crate::source_fs::SourceDir::open_root(dir)?;
    let mut files = Vec::new();
    if let Some(knowledge) = root.open_dir_if_exists("knowledge".as_ref())? {
        if let Some(rules) = knowledge.open_dir_if_exists("rules".as_ref())? {
            for name in rules.names()? {
                if crate::digest::is_hidden(&name)
                    || std::path::Path::new(&name)
                        .extension()
                        .is_none_or(|ext| ext != "md")
                {
                    continue;
                }
                if let Some(contents) = rules.read_string_if_file(&name)? {
                    if !contents.trim().is_empty() {
                        files.push(KnowledgeRuleFile {
                            path: format!("knowledge/rules/{}", name.to_string_lossy()),
                            content: contents.trim().to_string(),
                        });
                    }
                }
            }
        }
    }
    let legacy = root.read_root_string("instructions.md".as_ref())?;
    let used_legacy = legacy.is_some();
    if let Some(contents) = legacy.filter(|contents| !contents.trim().is_empty()) {
        files.push(KnowledgeRuleFile {
            path: "instructions.md".to_string(),
            content: contents.trim().to_string(),
        });
    }
    let content = files
        .iter()
        .map(|file| file.content.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    let (declared_defaults, warnings) = declared_default_ids(&files);
    for warning in warnings {
        eprintln!("wren-context-loader: {warning}");
    }
    Ok(KnowledgeRules {
        content,
        used_legacy,
        files,
        declared_defaults,
    })
}

#[cfg(all(not(target_arch = "wasm32"), not(unix)))]
pub fn read_knowledge_rules(dir: &std::path::Path) -> std::io::Result<KnowledgeRules> {
    use std::fs;

    crate::digest::validate_source_directories(dir)?;
    let rules_dir = dir.join("knowledge").join("rules");
    let paths = if rules_dir.is_dir() {
        list_dir(&rules_dir)?
            .into_iter()
            .filter(|path| path.is_file() && path.extension().is_some_and(|ext| ext == "md"))
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    let mut files = Vec::new();
    for path in paths {
        let contents = fs::read_to_string(&path)?;
        if !contents.trim().is_empty() {
            let name = path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default();
            files.push(KnowledgeRuleFile {
                path: format!("knowledge/rules/{name}"),
                content: contents.trim().to_string(),
            });
        }
    }

    let legacy_path = dir.join("instructions.md");
    let used_legacy = legacy_path.is_file();
    if used_legacy {
        let contents = fs::read_to_string(legacy_path)?;
        if !contents.trim().is_empty() {
            files.push(KnowledgeRuleFile {
                path: "instructions.md".to_string(),
                content: contents.trim().to_string(),
            });
        }
    }

    let content = files
        .iter()
        .map(|file| file.content.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    let (declared_defaults, warnings) = declared_default_ids(&files);
    for warning in warnings {
        eprintln!("wren-context-loader: {warning}");
    }
    Ok(KnowledgeRules {
        content,
        used_legacy,
        files,
        declared_defaults,
    })
}

const FRONT_MATTER_FENCE: &str = "---";
const DECLARED_DEFAULT_KINDS: [&str; 3] = ["exclude_rows", "require_rate_join", "sale_statuses"];

/// The declared default rule ids in `files`, in declaration order, plus warnings for anything
/// that could not be read.
///
/// A rule file may open with a `---` fenced YAML block whose `defaults:` list declares rules the
/// `wren` CLI enforces. This reads the ids only: validating the declarations is the CLI's job
/// (it refuses to start on an invalid one), so a malformed block here yields no ids and a
/// warning rather than an error. The id contract mirrors `wren.declared_defaults`: a leading
/// fence as the first line, a closing fence, `defaults[].id` matching
/// `^[a-z0-9][a-z0-9_-]{0,63}$`.
///
/// A leading block is read as declarations only when it carries a declaration signal (a
/// `defaults`, `denied_columns` or `semantics` key, or `id:` with `kind:`); without one it is
/// ordinary text, such as a markdown horizontal rule followed by prose, and the file declares
/// nothing and warns about nothing.
///
/// The outcome is all-or-nothing, like the CLI's: when a declaring block is malformed (a bad id,
/// an unknown kind, a repeated id, `defaults` not a list, a declaration-shaped sequence root or
/// unknown mapping value, invalid YAML, an unclosed fence) the id list is empty and the warnings
/// say why, because the CLI voids the whole set and refuses to start, so a partial list could
/// never match what it reports.
pub fn declared_default_ids(files: &[KnowledgeRuleFile]) -> (Vec<String>, Vec<String>) {
    let mut ids: Vec<String> = Vec::new();
    let mut warnings = Vec::new();
    for file in files {
        let Some((block, closed)) = leading_block(&file.content) else {
            continue;
        };
        if !declares(&block, closed) {
            continue;
        }
        if !closed {
            warnings.push(format!(
                "{}: {UNCLOSED_FRONT_MATTER}; declared defaults void",
                file.path
            ));
            continue;
        }
        let front = block.join("\n");
        let data: serde_yaml::Value = match serde_yaml::from_str(&front) {
            Ok(data) => data,
            Err(_) => {
                warnings.push(format!(
                    "{}: front-matter is not valid YAML; declared defaults void",
                    file.path
                ));
                continue;
            }
        };
        let Some(entries) = data.get("defaults") else {
            if declaration_shaped_sequence(&data) {
                warnings.push(format!(
                    "{}: declaration-shaped front-matter sequence; declared defaults void",
                    file.path
                ));
            } else if data
                .as_mapping()
                .is_some_and(|mapping| mapping.values().any(declaration_shaped_sequence))
            {
                warnings.push(format!(
                    "{}: declaration-shaped front-matter mapping; declared defaults void",
                    file.path
                ));
            }
            continue;
        };
        let Some(entries) = entries.as_sequence() else {
            warnings.push(format!(
                "{}: 'defaults' is not a list; declared defaults void",
                file.path
            ));
            continue;
        };
        for (position, entry) in entries.iter().enumerate() {
            let label = format!("{} defaults[{position}]", file.path);
            let id = entry.get("id").and_then(serde_yaml::Value::as_str);
            let Some(id) = id.filter(|id| is_declared_default_id(id)) else {
                warnings.push(format!(
                    "{label}: missing or malformed id; declared defaults void"
                ));
                continue;
            };
            let kind = entry.get("kind").and_then(serde_yaml::Value::as_str);
            if !kind.is_some_and(|kind| DECLARED_DEFAULT_KINDS.contains(&kind)) {
                warnings.push(format!("{label}: unknown kind; declared defaults void"));
                continue;
            }
            if ids.iter().any(|seen| seen == id) {
                warnings.push(format!(
                    "{label}: duplicate id '{id}'; declared defaults void"
                ));
                continue;
            }
            ids.push(id.to_string());
        }
    }
    if warnings.is_empty() {
        (ids, warnings)
    } else {
        (Vec::new(), warnings)
    }
}

const DECLARATION_KEYS: [&str; 3] = ["defaults", "denied_columns", "semantics"];

/// Whether a leading `---` block carries a declaration signal, mirroring `wren.declared_defaults`:
/// a line opening with a declaration key (`defaults`, `denied_columns`, `semantics`, optionally
/// quoted); an `id:` line together with a `kind:` line (bare or as list items); for an unclosed
/// block, one line naming both `id:` and `kind:`; for a closed block that parses, a mapping with a
/// declaration key or a declaration-shaped list. A key line may be indented.
fn declares(block: &[&str], closed: bool) -> bool {
    if block.iter().any(|line| starts_with_declaration_key(line)) {
        return true;
    }
    if block.iter().any(|line| starts_with_item_key(line, "id"))
        && block.iter().any(|line| starts_with_item_key(line, "kind"))
    {
        return true;
    }
    if !closed {
        return block
            .iter()
            .any(|line| names_word_key(line, "id") && names_word_key(line, "kind"));
    }
    let Ok(data) = serde_yaml::from_str::<serde_yaml::Value>(&block.join("\n")) else {
        return false;
    };
    match &data {
        serde_yaml::Value::Sequence(_) => declaration_shaped_sequence(&data),
        serde_yaml::Value::Mapping(mapping) => {
            mapping.keys().any(|key| {
                key.as_str()
                    .is_some_and(|key| DECLARATION_KEYS.contains(&key))
            }) || mapping.values().any(declaration_shaped_sequence)
        }
        _ => false,
    }
}

/// `^\s*["']?(defaults|denied_columns|semantics)["']?\s*:`
fn starts_with_declaration_key(line: &str) -> bool {
    let line = line.trim_start();
    let rest = line.strip_prefix(['"', '\'']).unwrap_or(line);
    DECLARATION_KEYS.iter().any(|key| {
        rest.strip_prefix(key).is_some_and(|rest| {
            rest.strip_prefix(['"', '\''])
                .unwrap_or(rest)
                .trim_start()
                .starts_with(':')
        })
    })
}

/// `^\s*(-\s+)?<key>\s*:`
fn starts_with_item_key(line: &str, key: &str) -> bool {
    let line = line.trim_start();
    let line = match line.strip_prefix('-') {
        Some(rest) if rest.starts_with(char::is_whitespace) => rest.trim_start(),
        _ => line,
    };
    line.strip_prefix(key)
        .is_some_and(|rest| rest.trim_start().starts_with(':'))
}

/// `\b<key>\s*:` anywhere in the line.
fn names_word_key(line: &str, key: &str) -> bool {
    line.match_indices(key).any(|(at, found)| {
        let before = line[..at].chars().next_back();
        !before.is_some_and(|c| c.is_alphanumeric() || c == '_')
            && line[at + found.len()..].trim_start().starts_with(':')
    })
}

fn declaration_shaped_sequence(value: &serde_yaml::Value) -> bool {
    value.as_sequence().is_some_and(|items| {
        items
            .iter()
            .any(|item| item.get("id").is_some() && item.get("kind").is_some())
    })
}

const SEMANTICS_KEY: &str = "semantics";
const SEMANTICS_LIMIT: usize = 32;
const SEMANTIC_NOTE_LIMIT: usize = 400;
const SEMANTIC_MODELS_LIMIT: usize = 8;

/// One entry of a rule file's `semantics:` list: a business meaning no host check covers, bound to
/// the models (or views) whose queries it concerns. Carried to the catalog as written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SemanticEntry {
    pub id: String,
    pub models: Vec<String>,
    pub note: String,
}

/// The `semantics:` declarations of `files` and what could not be read.
///
/// All or nothing, like the declared defaults: any problem (not a list, an entry that is not a
/// mapping with exactly `id`, `models` and `note`, a malformed or repeated id, an empty or
/// oversized `models` / `note`, more than the entry cap) is reported as `(path, description)` and
/// the caller drops every entry, because a host that enforces a part of a list cannot tell the
/// caller which meanings it left unchecked. A file whose front-matter cannot be read declares
/// nothing here; the declared-default reading already voids that case.
pub(crate) fn semantic_declarations(
    files: &[KnowledgeRuleFile],
) -> (Vec<SemanticEntry>, Vec<(String, String)>) {
    let mut entries: Vec<SemanticEntry> = Vec::new();
    let mut problems: Vec<(String, String)> = Vec::new();
    for file in files {
        let Ok(Some(front)) = front_matter(&file.content) else {
            continue;
        };
        let Ok(data) = serde_yaml::from_str::<serde_yaml::Value>(&front) else {
            continue;
        };
        let Some(value) = data.get(SEMANTICS_KEY) else {
            continue;
        };
        let Some(items) = value.as_sequence() else {
            problems.push((file.path.clone(), "semantics is not a list".to_string()));
            continue;
        };
        for (position, item) in items.iter().enumerate() {
            let label = format!("semantics[{position}]");
            let mut bad = |why: &str| {
                problems.push((file.path.clone(), format!("{label}: {why}")));
            };
            let Some(mapping) = item.as_mapping() else {
                bad("entry is not a mapping");
                continue;
            };
            if mapping
                .keys()
                .any(|key| !matches!(key.as_str(), Some("id" | "models" | "note")))
            {
                bad("unknown field");
                continue;
            }
            let id = item
                .get("id")
                .and_then(serde_yaml::Value::as_str)
                .filter(|id| is_declared_default_id(id));
            let Some(id) = id else {
                bad("missing or malformed id");
                continue;
            };
            let models: Option<Vec<String>> = item
                .get("models")
                .and_then(serde_yaml::Value::as_sequence)
                .filter(|list| !list.is_empty() && list.len() <= SEMANTIC_MODELS_LIMIT)
                .and_then(|list| {
                    list.iter()
                        .map(|name| {
                            name.as_str()
                                .filter(|name| !name.trim().is_empty())
                                .map(str::to_owned)
                        })
                        .collect()
                });
            let Some(models) = models else {
                bad("models must be a short non-empty list of names");
                continue;
            };
            let note = item
                .get("note")
                .and_then(serde_yaml::Value::as_str)
                .map(str::trim)
                .filter(|note| !note.is_empty() && note.chars().count() <= SEMANTIC_NOTE_LIMIT);
            let Some(note) = note else {
                bad("note must be a non-empty string of at most 400 characters");
                continue;
            };
            if entries.iter().any(|seen| seen.id == id) {
                bad(&format!("duplicate id '{id}'"));
                continue;
            }
            entries.push(SemanticEntry {
                id: id.to_string(),
                models,
                note: note.to_string(),
            });
        }
    }
    if entries.len() > SEMANTICS_LIMIT {
        problems.push((
            "knowledge/rules".to_string(),
            format!("at most {SEMANTICS_LIMIT} semantics entries are supported"),
        ));
    }
    if problems.is_empty() {
        (entries, problems)
    } else {
        (Vec::new(), problems)
    }
}

/// One `denied_columns` declaration read from a rule file's front-matter.
pub(crate) enum DeniedDeclaration {
    /// An entry as written (not yet checked against the project's models).
    Entry { path: String, entry: String },
    /// The file's front-matter is missing or could not be read, and the file mentions
    /// `denied_columns`, so a declaration may have been lost.
    Unreadable { path: String, reason: &'static str },
}

const DENIED_COLUMNS_KEY: &str = "denied_columns";

/// The `denied_columns` entries declared in the front-matter of `files`, in file order.
///
/// Fail closed: a file whose front-matter cannot be read (unclosed fence, invalid YAML) but whose
/// text mentions `denied_columns` yields [`DeniedDeclaration::Unreadable`], because the author
/// plainly meant to declare something and a denylist that was only partly read must not be used.
/// The same holds for a file with no front-matter at all that mentions the key. A front-matter
/// key that only nearly spells `denied_columns` (other case, `-` for `_`, singular) is reported as
/// an invalid entry rather than ignored, at the top level or nested at any depth. So is a file whose text mentions `denied_columns` but
/// whose front-matter has no top-level key of exactly that name (a merge key, a nested mapping, a
/// top-level sequence, a comment, a typo): the declaration, if any, was not read. A scalar value
/// is read as a one-entry list; a value that is not a name, or a bare key, is reported entry by
/// entry.
pub(crate) fn denied_column_declarations(files: &[KnowledgeRuleFile]) -> Vec<DeniedDeclaration> {
    let mut out = Vec::new();
    for file in files {
        let mentions_key = mentions_denied_key_or_near_miss(&file.content);
        let front = match front_matter(&file.content) {
            Ok(Some(front)) => front,
            Ok(None) => {
                if mentions_key {
                    out.push(DeniedDeclaration::Unreadable {
                        path: file.path.clone(),
                        reason: "front-matter is missing",
                    });
                }
                continue;
            }
            Err(_) => {
                if mentions_key {
                    out.push(DeniedDeclaration::Unreadable {
                        path: file.path.clone(),
                        reason: "front-matter is unreadable",
                    });
                }
                continue;
            }
        };
        let data: serde_yaml::Value = match serde_yaml::from_str(&front) {
            Ok(data) => data,
            Err(_) => {
                if mentions_key {
                    out.push(DeniedDeclaration::Unreadable {
                        path: file.path.clone(),
                        reason: "front-matter is unreadable",
                    });
                }
                continue;
            }
        };
        let mut near_misses = Vec::new();
        collect_near_miss_keys(&data, &mut near_misses);
        for key in near_misses {
            out.push(DeniedDeclaration::Entry {
                path: file.path.clone(),
                entry: format!("near-miss key: {key}"),
            });
        }
        let Some(value) = data.get(DENIED_COLUMNS_KEY) else {
            if mentions_key_as_a_word(&file.content) {
                out.push(DeniedDeclaration::Unreadable {
                    path: file.path.clone(),
                    reason: "denied_columns mentioned but not declared at top level",
                });
            }
            continue;
        };
        let entries: Vec<&serde_yaml::Value> = match value {
            serde_yaml::Value::Sequence(items) => items.iter().collect(),
            other => vec![other],
        };
        for item in entries {
            let entry = match item {
                serde_yaml::Value::String(s) => s.clone(),
                other => serde_yaml::to_string(other)
                    .unwrap_or_default()
                    .trim()
                    .to_string(),
            };
            out.push(DeniedDeclaration::Entry {
                path: file.path.clone(),
                entry,
            });
        }
    }
    out
}

/// Whether `text` contains `denied_columns` as a whole word: not as part of a longer name such as
/// `denied_columns_note` or `undenied_columns`, which are other keys, not a mention of this one.
fn mentions_key_as_a_word(text: &str) -> bool {
    let part_of_a_name = |c: char| c.is_ascii_alphanumeric() || c == '_' || c == '-';
    text.match_indices(DENIED_COLUMNS_KEY).any(|(at, found)| {
        let before = text[..at].chars().next_back();
        let after = text[at + found.len()..].chars().next();
        !before.is_some_and(part_of_a_name) && !after.is_some_and(part_of_a_name)
    })
}

/// Whether raw text contains the exact key or an ASCII-token near-miss. This is used only when
/// front-matter cannot be parsed: a declaration must not become a silent no-op merely because
/// the spelling that would have been rejected in parsed YAML made that YAML unreadable.
fn mentions_denied_key_or_near_miss(text: &str) -> bool {
    text.contains(DENIED_COLUMNS_KEY)
        || text
            .split(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '-'))
            .any(is_near_miss_key)
}

/// Every mapping key at any depth of `value` (through nested mappings and sequences) that only
/// nearly spells `denied_columns`, in document order.
fn collect_near_miss_keys<'a>(value: &'a serde_yaml::Value, out: &mut Vec<&'a str>) {
    match value {
        serde_yaml::Value::Mapping(mapping) => {
            for (key, child) in mapping {
                if let Some(key) = key.as_str().filter(|key| is_near_miss_key(key)) {
                    out.push(key);
                }
                collect_near_miss_keys(child, out);
            }
        }
        serde_yaml::Value::Sequence(items) => {
            for item in items {
                collect_near_miss_keys(item, out);
            }
        }
        serde_yaml::Value::Tagged(tagged) => collect_near_miss_keys(&tagged.value, out),
        _ => {}
    }
}

/// A key that case-insensitively matches `denied[_-]?columns?` without being `denied_columns`.
fn is_near_miss_key(key: &str) -> bool {
    if key == DENIED_COLUMNS_KEY {
        return false;
    }
    let lowered = key.to_ascii_lowercase();
    let Some(rest) = lowered.strip_prefix("denied") else {
        return false;
    };
    let rest = rest.strip_prefix(['_', '-']).unwrap_or(rest);
    matches!(rest, "column" | "columns")
}

const UNCLOSED_FRONT_MATTER: &str = "front-matter is not closed by a '---' line";

/// Split a leading `---` fenced block off `text`: `Ok(None)` when the text does not open with
/// one, an error when the fence never closes.
fn front_matter(text: &str) -> Result<Option<String>, &'static str> {
    match leading_block(text) {
        None => Ok(None),
        Some((block, true)) => Ok(Some(block.join("\n"))),
        Some((_, false)) => Err(UNCLOSED_FRONT_MATTER),
    }
}

/// The lines after a leading `---` fence up to the closing one, and whether it closed; `None`
/// when the text does not open with a fence. An unclosed block holds every remaining line.
fn leading_block(text: &str) -> Option<(Vec<&str>, bool)> {
    let text = text.trim_start_matches('\u{feff}').trim_start();
    let mut lines = text.lines();
    if lines.next().map(str::trim_end) != Some(FRONT_MATTER_FENCE) {
        return None;
    }
    let mut block = Vec::new();
    for line in lines {
        if line.trim_end() == FRONT_MATTER_FENCE {
            return Some((block, true));
        }
        block.push(line);
    }
    Some((block, false))
}

/// `^[a-z0-9][a-z0-9_-]{0,63}$`
fn is_declared_default_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    let allowed = |b: &u8| b.is_ascii_lowercase() || b.is_ascii_digit();
    !bytes.is_empty()
        && bytes.len() <= 64
        && allowed(&bytes[0])
        && bytes[1..]
            .iter()
            .all(|b| allowed(b) || *b == b'_' || *b == b'-')
}

/// Normalized business rules loaded by a native host for dispatch-time injection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KnowledgeRules {
    pub content: String,
    pub used_legacy: bool,
    /// The non-empty rule files behind `content`, trimmed, in the same order: current
    /// `knowledge/rules/*.md` sorted by path, then the legacy `instructions.md`.
    pub files: Vec<KnowledgeRuleFile>,
    /// Ids of the declared default rules in the front-matter of `files`, in declaration order
    /// (files in order, then in-file order). Ids only: the `wren` CLI validates the declarations.
    pub declared_defaults: Vec<String>,
}

/// One business-rule file: its project-relative path and trimmed contents.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KnowledgeRuleFile {
    pub path: String,
    pub content: String,
}

/// The entries of `dir` that are project inputs, sorted by path: dot-named entries are skipped by
/// the same rule the digest applies ([`crate::digest::is_hidden`]), so the catalog, the prepared
/// document and the digest agree on what the project is. An entry that cannot be read is an error
/// naming the directory: a project the loader could not read completely must not load as a
/// smaller one.
#[cfg(all(not(target_arch = "wasm32"), not(unix)))]
fn list_dir(dir: &std::path::Path) -> std::io::Result<Vec<std::path::PathBuf>> {
    let mut paths = sorted_paths(
        std::fs::read_dir(dir)?.map(|entry| entry.map(|entry| entry.path())),
        dir,
    )?;
    paths.retain(|path| {
        path.file_name()
            .is_none_or(|name| !crate::digest::is_hidden(name))
    });
    Ok(paths)
}

#[cfg(all(not(target_arch = "wasm32"), any(not(unix), test)))]
fn sorted_paths(
    entries: impl Iterator<Item = std::io::Result<std::path::PathBuf>>,
    dir: &std::path::Path,
) -> std::io::Result<Vec<std::path::PathBuf>> {
    let mut paths = Vec::new();
    for entry in entries {
        paths.push(entry.map_err(|e| {
            std::io::Error::new(
                e.kind(),
                format!("cannot read an entry of {}: {e}", dir.display()),
            )
        })?);
    }
    paths.sort();
    Ok(paths)
}

#[cfg(all(not(target_arch = "wasm32"), not(unix)))]
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
    /// Optional root cube list for pure/in-memory callers. A native directory project may use it
    /// as a mirror only when it also has per-cube metadata files. Its cube and member descriptions
    /// intentionally override directory prose; mirror validation covers executable semantics only.
    pub cubes_yml: Option<String>,
    /// Per-cube `cubes/<name>/metadata.yml` contents (wren CLI layout). Used unless the root
    /// `cubes.yml` yields at least one cube, which then takes precedence (see `authored_cubes`).
    pub cube_ymls: Vec<String>,
    /// Each view as `(metadata.yml, sql.yml)` contents; `sql.yml` is empty when the view directory
    /// has none, because the statement may be written inline in `metadata.yml` (a non-empty
    /// `sql.yml` statement wins, as in the wren CLI).
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

/// The cubes a project declares, parsed as `T`, and the errors (`(label, error)`, label
/// `cubes.yml` or `cube[<index>]`) for the files that did not parse.
///
/// Precedence: a root `cubes.yml` that yields at least one cube wins and the per-cube files
/// (`cubes/<name>/metadata.yml`, the layout the wren CLI reads) are ignored, never merged, so a
/// project that keeps a root mirror beside the directory does not get every cube twice. Root cube
/// and member descriptions intentionally win over directory prose; the native mirror check only
/// requires executable semantics to agree. A root file that is absent, empty, comment-only or
/// `[]` declares nothing, so the per-cube files are used. A root file that does not parse is an
/// error and yields no cubes. A per-cube file that is empty or not a mapping is skipped, as wren
/// skips it.
///
/// `assemble` and the catalog both read cubes through this one function, so they cannot disagree
/// about which cubes exist.
pub(crate) fn authored_cubes<T>(
    sources: &ProjectSources,
) -> (Vec<T>, Vec<(String, serde_yaml::Error)>)
where
    T: serde::de::DeserializeOwned,
{
    if let Some(yml) = &sources.cubes_yml {
        match parse_doc_or_default::<Vec<T>>(yml) {
            Ok(root) if !root.is_empty() => return (root, Vec::new()),
            Ok(_) => {}
            Err(e) => return (Vec::new(), vec![("cubes.yml".to_string(), e)]),
        }
    }
    let mut cubes = Vec::new();
    let mut errors = Vec::new();
    for (index, yml) in sources.cube_ymls.iter().enumerate() {
        match parse_mapping_doc::<T>(yml) {
            Ok(Some(cube)) => cubes.push(cube),
            Ok(None) => {}
            Err(e) => errors.push((format!("cube[{index}]"), e)),
        }
    }
    (cubes, errors)
}

/// Assemble read project sources into a canonical [`Manifest`]. Returns a [`LoadError`] if any file
/// fails to parse or the assembled manifest is not a valid MDL manifest.
pub fn assemble(sources: &ProjectSources) -> Result<LoadedProject, LoadError> {
    let project: ProjectFile = parse_doc_or_default(&sources.wren_project_yml)
        .map_err(|e| msg(format!("wren_project.yml: {e}")))?;

    let mut models = Vec::with_capacity(sources.model_ymls.len());
    for yml in &sources.model_ymls {
        let m: ModelFile = serde_yaml::from_str(yml).map_err(|e| msg(format!("model: {e}")))?;
        models.push(model_to_json(m)?);
    }

    let relationships = match &sources.relationships_yml {
        Some(yml) => parse_relationships(yml)
            .map_err(|e| msg(format!("relationships.yml: {e}")))?
            .into_iter()
            .map(relationship_to_json)
            .collect(),
        None => Vec::new(),
    };

    let (declared, cube_errors) = authored_cubes::<CubeFile>(sources);
    if let Some((label, error)) = cube_errors.into_iter().next() {
        return Err(msg(format!("{label}: {error}")));
    }
    let cubes: Vec<serde_json::Value> = declared.into_iter().map(cube_to_json).collect();

    let mut views = Vec::with_capacity(sources.views.len());
    for (meta_yml, sql_yml) in &sources.views {
        let meta: ViewMetaFile =
            serde_yaml::from_str(meta_yml).map_err(|e| msg(format!("view metadata: {e}")))?;
        let sql = sql_yml_statement(sql_yml).map_err(|e| msg(format!("view sql: {e}")))?;
        let statement = sql
            .or_else(|| meta.statement.filter(|statement| !statement.is_empty()))
            .ok_or_else(|| {
                msg(format!(
                    "view '{}': no statement (define it in metadata.yml or sql.yml)",
                    meta.name
                ))
            })?;
        views.push(serde_json::json!({ "name": meta.name, "statement": statement }));
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
    serde_json::json!({
        "name": c.name,
        "baseObject": c.base_object,
        "measures": c.measures.into_iter().map(cube_member_to_json).collect::<Vec<_>>(),
        "dimensions": c.dimensions.into_iter().map(cube_member_to_json).collect::<Vec<_>>(),
        "timeDimensions": c.time_dimensions.into_iter().map(cube_member_to_json).collect::<Vec<_>>(),
        "hierarchies": c.hierarchies,
    })
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    #[cfg(unix)]
    use std::fs;
    use std::io;
    use std::path::{Path, PathBuf};

    use super::{assemble, sorted_paths, validate_native_schema_version, ProjectSources};

    #[test]
    fn an_unreadable_directory_entry_is_an_error_naming_the_directory() {
        let entries: Vec<io::Result<PathBuf>> = vec![
            Ok(PathBuf::from("models/orders")),
            Err(io::Error::new(io::ErrorKind::PermissionDenied, "denied")),
        ];

        let error = sorted_paths(entries.into_iter(), Path::new("models"))
            .expect_err("a skipped entry would silently drop a model");

        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
        assert!(
            error.to_string().contains("models"),
            "the error names the directory: {error}"
        );
    }

    #[test]
    fn readable_entries_come_back_sorted() {
        let entries: Vec<io::Result<PathBuf>> =
            vec![Ok(PathBuf::from("b")), Ok(PathBuf::from("a"))];
        let paths = sorted_paths(entries.into_iter(), Path::new(".")).unwrap();
        assert_eq!(paths, [PathBuf::from("a"), PathBuf::from("b")]);
    }

    #[test]
    fn native_schema_version_matches_cli_defaults_and_conversion() {
        for yml in [
            "name: demo\n",
            "schema_version: 1\n",
            "schema_version: 5\n",
            "schema_version: true\n",
            "schema_version: 2.5\n",
            "schema_version: '2'\n",
            "schema_version: '0_2'\n",
            "schema_version: '+٢'\n",
            "schema_version: '２'\n",
            "schema_version: '٢'\n",
            "schema_version: '𝟚'\n",
        ] {
            assert!(validate_native_schema_version(yml).is_ok(), "{yml:?}");
        }
        for yml in [
            "schema_version: 0\n",
            "schema_version: 6\n",
            "schema_version: false\n",
            "schema_version: null\n",
            "schema_version: '2.0'\n",
            "schema_version: [2]\n",
            "schema_version: '1__2'\n",
            "schema_version: '_2'\n",
            "schema_version: '2_'\n",
            "schema_version: '²'\n",
            "schema_version: 'Ⅱ'\n",
        ] {
            assert!(validate_native_schema_version(yml).is_err(), "{yml:?}");
        }
        let error = validate_native_schema_version("schema_version: '99'\n").unwrap_err();
        assert!(error.to_string().contains("unsupported schema_version 99"));

        let sources = ProjectSources {
            wren_project_yml: "schema_version: 99\n".to_string(),
            model_ymls: Vec::new(),
            relationships_yml: None,
            cubes_yml: None,
            cube_ymls: Vec::new(),
            views: Vec::new(),
            knowledge_sql_mds: Vec::new(),
            dashboards_yml: None,
        };
        assert!(
            assemble(&sources).is_ok(),
            "pure source assembly stays version-agnostic"
        );
    }

    #[test]
    #[cfg(unix)]
    fn native_reader_and_capture_reject_unsupported_schema_versions() {
        let project = tempfile::tempdir().unwrap();
        fs::write(
            project.path().join("wren_project.yml"),
            "schema_version: 99\n",
        )
        .unwrap();

        let reader_error = match super::read_project_dir(project.path()) {
            Err(error) => error,
            Ok(_) => panic!("unsupported schema version must be rejected by native reader"),
        };
        let capture_error = match super::capture_project(project.path()) {
            Err(error) => error,
            Ok(_) => panic!("unsupported schema version must be rejected by native capture"),
        };
        for error in [reader_error, capture_error] {
            assert_eq!(error.kind(), io::ErrorKind::InvalidData);
            assert!(error.to_string().contains("unsupported schema_version 99"));
        }
    }

    #[test]
    #[cfg(unix)]
    fn directory_swap_after_open_never_reads_the_replacement_symlink() {
        use std::os::unix::fs::symlink;

        let project = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(
            project.path().join("wren_project.yml"),
            "schema_version: 5\n",
        )
        .unwrap();
        fs::create_dir_all(project.path().join("models/orders")).unwrap();
        fs::write(
            project.path().join("models/orders/metadata.yml"),
            "name: safe\ntable_reference: safe\ncolumns: []\n",
        )
        .unwrap();
        fs::create_dir_all(outside.path().join("orders")).unwrap();
        fs::write(
            outside.path().join("orders/metadata.yml"),
            "name: outside\ntable_reference: outside\ncolumns: []\n",
        )
        .unwrap();
        let source = project.path().join("models");
        let moved = project.path().join("models-original");
        let replacement = outside.path().to_path_buf();
        crate::source_fs::set_after_open_directory_hook(move || {
            fs::rename(&source, &moved).unwrap();
            symlink(&replacement, &source).unwrap();
        });

        let error = match super::read_project_dir(project.path()) {
            Ok(_) => panic!("reader must use the opened directory or fail"),
            Err(error) => error.to_string(),
        };
        assert!(error.contains("directory_symlink_unsupported"), "{error}");
    }

    #[test]
    #[cfg(unix)]
    fn nested_regular_file_symlink_is_ignored_like_an_ordinary_readme() {
        use std::os::unix::fs::symlink;

        let project = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(
            project.path().join("wren_project.yml"),
            "schema_version: 5\n",
        )
        .unwrap();
        fs::create_dir_all(project.path().join("models/orders")).unwrap();
        fs::write(
            project.path().join("models/orders/metadata.yml"),
            "name: safe\ntable_reference: safe\ncolumns: []\n",
        )
        .unwrap();
        fs::write(outside.path().join("README.md"), "external notes").unwrap();
        symlink(
            outside.path().join("README.md"),
            project.path().join("models/README.md"),
        )
        .unwrap();
        let loaded = super::read_project_dir(project.path()).unwrap().unwrap();
        assert_eq!(loaded.model_ymls.len(), 1);
    }

    #[test]
    #[cfg(unix)]
    fn nested_directory_swap_after_reader_parent_open_is_not_silently_skipped() {
        use std::os::unix::fs::symlink;
        let project = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(
            project.path().join("wren_project.yml"),
            "schema_version: 5\n",
        )
        .unwrap();
        let orders = project.path().join("models/orders");
        fs::create_dir_all(&orders).unwrap();
        fs::write(
            orders.join("metadata.yml"),
            "name: safe\ntable_reference: safe\ncolumns: []\n",
        )
        .unwrap();
        let moved = project.path().join("models/orders-original");
        let outside_dir = outside.path().to_path_buf();
        crate::source_fs::set_after_nth_open_directory_hook(3, move || {
            fs::rename(&orders, &moved).unwrap();
            symlink(&outside_dir, &orders).unwrap();
        });
        assert!(super::read_project_dir(project.path()).is_err());
    }

    #[test]
    #[cfg(unix)]
    fn model_ref_sql_file_overrides_inline_metadata() {
        let project = tempfile::tempdir().unwrap();
        fs::write(
            project.path().join("wren_project.yml"),
            "schema_version: 5\n",
        )
        .unwrap();
        let model = project.path().join("models/orders");
        fs::create_dir_all(&model).unwrap();
        fs::write(
            model.join("metadata.yml"),
            "name: orders\nref_sql: SELECT * FROM inline_orders\ncolumns: []\n",
        )
        .unwrap();
        fs::write(model.join("ref_sql.sql"), " SELECT * FROM file_orders \n").unwrap();

        let sources = super::read_project_dir(project.path()).unwrap().unwrap();
        let loaded = super::assemble(&sources).unwrap();
        assert_eq!(
            loaded.manifest.models[0].ref_sql(),
            Some("SELECT * FROM file_orders")
        );
    }

    #[test]
    #[cfg(unix)]
    fn model_ref_sql_file_supplies_a_model_source() {
        let project = tempfile::tempdir().unwrap();
        fs::write(
            project.path().join("wren_project.yml"),
            "schema_version: 5\n",
        )
        .unwrap();
        let model = project.path().join("models/orders");
        fs::create_dir_all(&model).unwrap();
        fs::write(model.join("metadata.yml"), "name: orders\ncolumns: []\n").unwrap();
        fs::write(model.join("ref_sql.sql"), "SELECT * FROM raw_orders\n").unwrap();

        let sources = super::read_project_dir(project.path()).unwrap().unwrap();
        let loaded = super::assemble(&sources).unwrap();
        assert!(matches!(
            loaded.manifest.models[0].source(),
            wren_core_base::mdl::manifest::ModelSource::RefSql
        ));
        assert_eq!(
            loaded.manifest.models[0].ref_sql(),
            Some("SELECT * FROM raw_orders")
        );
    }

    #[test]
    #[cfg(unix)]
    fn model_ref_sql_file_is_optional_and_ignores_empty_contents() {
        let project = tempfile::tempdir().unwrap();
        fs::write(
            project.path().join("wren_project.yml"),
            "schema_version: 5\n",
        )
        .unwrap();

        let no_file = project.path().join("models/no_file");
        fs::create_dir_all(&no_file).unwrap();
        fs::write(
            no_file.join("metadata.yml"),
            "name: no_file\nref_sql: SELECT * FROM inline_no_file\ncolumns: []\n",
        )
        .unwrap();

        let empty_file = project.path().join("models/empty_file");
        fs::create_dir_all(&empty_file).unwrap();
        fs::write(
            empty_file.join("metadata.yml"),
            "name: empty_file\nref_sql: SELECT * FROM inline_empty_file\ncolumns: []\n",
        )
        .unwrap();
        fs::write(empty_file.join("ref_sql.sql"), " \n").unwrap();

        let sources = super::read_project_dir(project.path()).unwrap().unwrap();
        let loaded = super::assemble(&sources).unwrap();
        assert_eq!(
            loaded.manifest.models[0].ref_sql(),
            Some("SELECT * FROM inline_empty_file")
        );
        assert_eq!(
            loaded.manifest.models[1].ref_sql(),
            Some("SELECT * FROM inline_no_file")
        );
    }

    #[test]
    #[cfg(unix)]
    fn model_ref_sql_camel_case_is_retained_or_overridden_by_a_file() {
        let project = tempfile::tempdir().unwrap();
        fs::write(
            project.path().join("wren_project.yml"),
            "schema_version: 5\n",
        )
        .unwrap();

        for (name, file) in [
            ("absent", None),
            ("empty", Some(" \n")),
            ("file", Some("SELECT * FROM file_orders\n")),
        ] {
            let model = project.path().join("models").join(name);
            fs::create_dir_all(&model).unwrap();
            fs::write(
                model.join("metadata.yml"),
                format!("name: {name}\nrefSql: SELECT * FROM inline_{name}\ncolumns: []\n"),
            )
            .unwrap();
            if let Some(file) = file {
                fs::write(model.join("ref_sql.sql"), file).unwrap();
            }
        }

        let sources = super::read_project_dir(project.path()).unwrap().unwrap();
        let loaded = super::assemble(&sources).unwrap();
        let ref_sql = |name: &str| {
            loaded
                .manifest
                .models
                .iter()
                .find(|model| model.name == name)
                .and_then(|model| model.ref_sql())
        };
        assert_eq!(ref_sql("absent"), Some("SELECT * FROM inline_absent"));
        assert_eq!(ref_sql("empty"), Some("SELECT * FROM inline_empty"));
        assert_eq!(ref_sql("file"), Some("SELECT * FROM file_orders"));
    }

    #[test]
    #[cfg(unix)]
    fn model_ref_sql_directory_is_an_error() {
        let project = tempfile::tempdir().unwrap();
        fs::write(
            project.path().join("wren_project.yml"),
            "schema_version: 5\n",
        )
        .unwrap();
        let model = project.path().join("models/orders");
        fs::create_dir_all(model.join("ref_sql.sql")).unwrap();
        fs::write(
            model.join("metadata.yml"),
            "name: orders\nref_sql: SELECT * FROM inline_orders\ncolumns: []\n",
        )
        .unwrap();

        let error = match super::read_project_dir(project.path()) {
            Ok(_) => panic!("a ref_sql.sql directory must not be ignored"),
            Err(error) => error,
        };
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert!(error.to_string().contains("ref_sql_directory_unsupported"));
    }
}
