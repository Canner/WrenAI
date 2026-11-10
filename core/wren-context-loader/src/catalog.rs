//! The **capability catalog**: the authored, descriptive slice of a wren project that a host may
//! hand to a planner outside the data zone. Names, types, descriptions, relationships, cube
//! members, declared time grains and date ranges — the things the schema says about itself.
//!
//! It is read from the authored project files (not from the assembled `Manifest`, which keeps no
//! `properties`) with lenient, allow-listed structs: every field that is not named here is dropped
//! on read, so a new authored field never reaches the catalog by default. Nothing in the catalog
//! is computed from data, and no query SQL — `ref_sql`, view statements, calculated-column or
//! measure expressions, saved queries — is carried. Authored relationship join conditions are the
//! deliberate structural exception: a planner needs them to form a declared join. The one free-text
//! slice is the project's business rules (`knowledge/rules/*.md`, legacy `instructions.md`),
//! carried whole as authored prose; the prepared-context document cannot carry them because Warble
//! owns that format.
//!
//! The consuming host applies its own allow-list again when it renders the catalog into a card;
//! this module is the first of the two layers, not the only one.

use serde::{Deserialize, Serialize};

use crate::project::{
    authored_cubes, parse_doc_or_default, parse_relationships, sql_yml_statement, ProjectSources,
};

/// Bumped when the shape below changes incompatibly; the host checks it before reading.
pub const CATALOG_VERSION: u32 = 1;

// --- authored (lenient) shapes -----------------------------------------------------------------

#[derive(Debug, Default, Deserialize)]
struct Properties {
    #[serde(default, deserialize_with = "optional_description")]
    description: Option<String>,
    /// Authored enum meanings, `{ "A": "active", "I": "inactive" }`. Free-form keys are kept as
    /// written; the host renders them as `value = meaning`.
    #[serde(default)]
    enum_values: Option<serde_yaml::Value>,
}

/// Descriptions are optional catalog prose. A malformed prose value must not discard the semantic
/// object that owns it; only scalar text is retained for the JSON catalog.
fn optional_description<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(
        Option::<serde_yaml::Value>::deserialize(deserializer)?.and_then(|value| match value {
            serde_yaml::Value::String(description) => Some(description),
            _ => None,
        }),
    )
}

#[derive(Debug, Default, Deserialize)]
struct ProjectFile {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    data_source: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ColumnFile {
    name: String,
    r#type: String,
    #[serde(default)]
    not_null: Option<bool>,
    #[serde(default)]
    is_calculated: Option<bool>,
    #[serde(default)]
    is_hidden: Option<bool>,
    #[serde(default)]
    relationship: Option<String>,
    #[serde(default)]
    properties: Properties,
}

#[derive(Debug, Deserialize)]
struct ModelFile {
    name: String,
    #[serde(default)]
    primary_key: Option<serde_yaml::Value>,
    #[serde(default)]
    columns: Vec<ColumnFile>,
    #[serde(default)]
    properties: Properties,
}

#[derive(Debug, Deserialize)]
struct CubeMemberFile {
    name: String,
    r#type: String,
    /// Declared time grains, e.g. `[day, month, year]`; only meaningful on a time dimension.
    #[serde(default)]
    granularities: Option<Vec<String>>,
    /// Declared inclusive date range `[start, end]`; only meaningful on a time dimension.
    #[serde(default)]
    date_range: Option<Vec<String>>,
    #[serde(default)]
    properties: Properties,
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
    properties: Properties,
}

#[derive(Debug, Deserialize)]
struct ViewMetaFile {
    name: String,
    /// Ids of declared default rules the view's definition guarantees (carried, not interpreted).
    #[serde(default)]
    guarantees: Option<Vec<serde_yaml::Value>>,
    /// Declared output columns, `[{name, type, description?}]`. Kept raw so one malformed entry
    /// is a diagnostic for the host to refuse, not a view that silently drops out of the catalog.
    /// An explicit `columns: null` is kept as a value (and refused as not a list), while an
    /// omitted key stays absent.
    #[serde(default, deserialize_with = "present_value")]
    columns: Option<serde_yaml::Value>,
    #[serde(default)]
    statement: Option<String>,
    #[serde(default)]
    properties: Properties,
}

/// Deserialize any present value, null included, as `Some`; `#[serde(default)]` alone folds an
/// explicit null into `None`.
fn present_value<'de, D>(deserializer: D) -> Result<Option<serde_yaml::Value>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    serde_yaml::Value::deserialize(deserializer).map(Some)
}

// --- catalog (emitted) shapes ------------------------------------------------------------------

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct CatalogEnumValue {
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meaning: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct CatalogColumn {
    pub name: String,
    pub r#type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub not_null: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_calculated: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_hidden: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relationship: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub enum_values: Vec<CatalogEnumValue>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct CatalogModel {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub primary_key: Vec<String>,
    pub columns: Vec<CatalogColumn>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct CatalogRelationship {
    pub name: String,
    pub models: Vec<String>,
    pub join_type: String,
    pub condition: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct CatalogCubeMember {
    pub name: String,
    pub r#type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub granularities: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_range: Option<[String; 2]>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct CatalogCube {
    pub name: String,
    pub base_object: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub measures: Vec<CatalogCubeMember>,
    pub dimensions: Vec<CatalogCubeMember>,
    pub time_dimensions: Vec<CatalogCubeMember>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct CatalogView {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Declared default rule ids the view's definition guarantees, from `guarantees:` in
    /// `views/<name>/metadata.yml`. Carried as authored; omitted when there are none.
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub guarantees: Vec<String>,
    /// Output columns the view declares in `columns:` (name, type and description only). Names
    /// may be checked by a host that can parse the statement; types are author assertions, not
    /// inferred from SQL by this loader. Omitted when the view declares none.
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub columns: Vec<CatalogColumn>,
}

/// One business meaning no host check covers (`semantics:` in a rule file's front-matter), bound to
/// the models or views whose queries it concerns. A host that runs a query touching one of them
/// reports the id as unverified. Carried as authored.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct CatalogSemantic {
    pub id: String,
    pub models: Vec<String>,
    pub note: String,
}

/// One business-rule file (`knowledge/rules/*.md`, or the legacy root `instructions.md`), carried
/// whole: rules are authored prose a host may disclose like schema. `knowledge/sql/` is not a
/// rule file and never appears here.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct CatalogKnowledgeRule {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct CatalogProject {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_source: Option<String>,
}

/// One catalog diagnostic: a free-text message for a file that did not parse, or a structured
/// entry for a `denied_columns` declaration the host must refuse to run with.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum CatalogDiagnostic {
    Message(String),
    DeniedColumnsInvalid {
        /// Always `denied_columns_invalid`.
        kind: &'static str,
        path: String,
        entry: String,
    },
    SemanticsInvalid {
        /// Always `semantics_invalid`.
        kind: &'static str,
        path: String,
        entry: String,
    },
    ViewColumnsInvalid {
        /// Always `view_columns_invalid`.
        kind: &'static str,
        path: String,
        entry: String,
    },
}

impl std::fmt::Display for CatalogDiagnostic {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CatalogDiagnostic::Message(message) => f.write_str(message),
            CatalogDiagnostic::DeniedColumnsInvalid { kind, path, entry } => {
                write!(f, "{path}: {kind}: {entry}")
            }
            CatalogDiagnostic::SemanticsInvalid { kind, path, entry } => {
                write!(f, "{path}: {kind}: {entry}")
            }
            CatalogDiagnostic::ViewColumnsInvalid { kind, path, entry } => {
                write!(f, "{path}: {kind}: {entry}")
            }
        }
    }
}

impl CatalogDiagnostic {
    fn denied_columns_invalid(path: &str, entry: impl Into<String>) -> Self {
        CatalogDiagnostic::DeniedColumnsInvalid {
            kind: "denied_columns_invalid",
            path: path.to_string(),
            entry: entry.into(),
        }
    }

    fn semantics_invalid(path: &str, entry: impl Into<String>) -> Self {
        CatalogDiagnostic::SemanticsInvalid {
            kind: "semantics_invalid",
            path: path.to_string(),
            entry: entry.into(),
        }
    }

    fn view_columns_invalid(path: &str, entry: impl Into<String>) -> Self {
        CatalogDiagnostic::ViewColumnsInvalid {
            kind: "view_columns_invalid",
            path: path.to_string(),
            entry: entry.into(),
        }
    }
}

/// The whole catalog. Field order is the serialization order; arrays keep the sorted file order
/// [`crate::read_project_dir`] produces, so the same project always yields the same bytes.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct CapabilityCatalog {
    pub catalog_version: u32,
    /// Version of the loader that wrote this catalog (`CARGO_PKG_VERSION`).
    pub loader_version: String,
    /// SHA-256 over the project source files (see `project_digest`); set by the host that read
    /// the directory, omitted by the pure builder.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub digest: Option<String>,
    pub project: CatalogProject,
    pub models: Vec<CatalogModel>,
    pub relationships: Vec<CatalogRelationship>,
    pub cubes: Vec<CatalogCube>,
    pub views: Vec<CatalogView>,
    /// Business rules, in `wren context instructions` order (current rule files sorted by path,
    /// then the legacy `instructions.md`). Omitted when the project has none, so a project
    /// without rules serializes exactly as before.
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub knowledge_rules: Vec<CatalogKnowledgeRule>,
    /// True when a root `instructions.md` exists (the deprecated location of the rules).
    #[serde(skip_serializing_if = "std::ops::Not::not", default)]
    pub knowledge_rules_used_legacy: bool,
    /// Ids of the declared default rules the `wren` CLI enforces, read from the same front-matter
    /// (`knowledge_rules` content keeps it verbatim), in declaration order. Ids only; the CLI
    /// validates the declarations. Omitted when there are none, so a project without
    /// declarations serializes exactly as before.
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub declared_defaults: Vec<String>,
    /// `model.column` entries the project denies, from the top-level `denied_columns` key of the
    /// rule files' front-matter: merged, de-duplicated, sorted. Only entries naming a column the
    /// project has are listed; a bad entry is a diagnostic and sets `denied_columns_invalid`.
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub denied_columns: Vec<String>,
    /// True when any `denied_columns` declaration could not be honoured (malformed entry, unknown
    /// model or column, unreadable front-matter that mentions the key). A host must refuse to run:
    /// a denylist that was only partly read is not a denylist.
    #[serde(skip_serializing_if = "std::ops::Not::not", default)]
    pub denied_columns_invalid: bool,
    /// Business meanings no host check covers, from the top-level `semantics` key of the rule files'
    /// front-matter, in declaration order. Omitted when there are none. All or nothing: when any
    /// entry is malformed the list is empty and `semantics_invalid` is set.
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub semantics: Vec<CatalogSemantic>,
    /// True when a `semantics` declaration could not be read in full. A host must refuse to run:
    /// it could not tell its caller which meanings a result leaves unchecked.
    #[serde(skip_serializing_if = "std::ops::Not::not", default)]
    pub semantics_invalid: bool,
    /// True when a view's `columns:` declaration could not be read in full (not a list, a
    /// malformed or duplicate entry). All or nothing: every view's `columns` is then empty. A host
    /// must refuse to run: it would show a worker columns the project did not fully declare.
    #[serde(skip_serializing_if = "std::ops::Not::not", default)]
    pub view_columns_invalid: bool,
    /// Files that did not parse, by kind; the catalog is still emitted without them.
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub diagnostics: Vec<CatalogDiagnostic>,
}

impl CapabilityCatalog {
    /// Attach the content digest of the project directory (see `project_digest`).
    pub fn with_digest(mut self, digest: String) -> Self {
        self.digest = Some(digest);
        self
    }

    /// Attach the project's business rules, read by the host (`read_knowledge_rules`), and the
    /// `denied_columns` their front-matter declares, validated against this catalog's models. Kept
    /// apart from [`capability_catalog`], which is pure over the MDL sources.
    pub fn with_knowledge_rules(mut self, rules: crate::project::KnowledgeRules) -> Self {
        let declarations = crate::project::denied_column_declarations(&rules.files);
        let mut denied = std::collections::BTreeSet::new();
        for declaration in declarations {
            match declaration {
                crate::project::DeniedDeclaration::Unreadable { path, reason } => {
                    self.denied_columns_invalid = true;
                    self.diagnostics
                        .push(CatalogDiagnostic::denied_columns_invalid(&path, reason));
                }
                crate::project::DeniedDeclaration::Entry { path, entry } => {
                    if self.has_column(&entry) {
                        denied.insert(entry);
                    } else {
                        self.denied_columns_invalid = true;
                        self.diagnostics
                            .push(CatalogDiagnostic::denied_columns_invalid(&path, entry));
                    }
                }
            }
        }
        self.denied_columns = denied.into_iter().collect();
        let (semantics, problems) = crate::project::semantic_declarations(&rules.files);
        for (path, entry) in problems {
            self.semantics_invalid = true;
            self.diagnostics
                .push(CatalogDiagnostic::semantics_invalid(&path, entry));
        }
        self.semantics = semantics
            .into_iter()
            .map(|entry| CatalogSemantic {
                id: entry.id,
                models: entry.models,
                note: entry.note,
            })
            .collect();
        self.knowledge_rules = rules
            .files
            .into_iter()
            .map(|file| CatalogKnowledgeRule {
                path: file.path,
                content: file.content,
            })
            .collect();
        self.knowledge_rules_used_legacy = rules.used_legacy;
        self.declared_defaults = rules.declared_defaults;
        self
    }
}

impl CapabilityCatalog {
    /// Whether `entry` is `<model>.<column>` in the lower-case form a denylist accepts and names a
    /// column of a model in this catalog.
    fn has_column(&self, entry: &str) -> bool {
        let valid = |part: &str| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        };
        let Some((model, column)) = entry.split_once('.') else {
            return false;
        };
        valid(model)
            && valid(column)
            && self
                .models
                .iter()
                .any(|m| m.name == model && m.columns.iter().any(|c| c.name == column))
    }
}

fn primary_key(value: Option<serde_yaml::Value>) -> Vec<String> {
    match value {
        Some(serde_yaml::Value::String(one)) => vec![one],
        Some(serde_yaml::Value::Sequence(many)) => many
            .into_iter()
            .filter_map(|item| item.as_str().map(str::to_owned))
            .collect(),
        _ => Vec::new(),
    }
}

fn enum_values(value: Option<serde_yaml::Value>) -> Vec<CatalogEnumValue> {
    let mut out = Vec::new();
    match value {
        Some(serde_yaml::Value::Mapping(map)) => {
            for (key, meaning) in map {
                if let Some(value) = scalar(&key) {
                    let meaning = scalar(&meaning).filter(|s| !s.trim().is_empty());
                    out.push(CatalogEnumValue { value, meaning });
                }
            }
        }
        Some(serde_yaml::Value::Sequence(items)) => {
            for item in items {
                if let serde_yaml::Value::Mapping(map) = item {
                    let value = map.get("value").and_then(scalar);
                    let meaning = map
                        .get("meaning")
                        .and_then(scalar)
                        .filter(|s| !s.trim().is_empty());
                    if let Some(value) = value {
                        out.push(CatalogEnumValue { value, meaning });
                    }
                } else if let Some(value) = scalar(&item) {
                    out.push(CatalogEnumValue {
                        value,
                        meaning: None,
                    });
                }
            }
        }
        _ => {}
    }
    out
}

fn scalar(value: &serde_yaml::Value) -> Option<String> {
    match value {
        serde_yaml::Value::String(s) => Some(s.clone()),
        serde_yaml::Value::Number(n) => Some(n.to_string()),
        serde_yaml::Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

fn member(m: CubeMemberFile) -> CatalogCubeMember {
    let date_range = m.date_range.and_then(|range| match range.as_slice() {
        [start, end] => Some([start.clone(), end.clone()]),
        _ => None,
    });
    CatalogCubeMember {
        name: m.name,
        r#type: m.r#type,
        description: m.properties.description,
        granularities: m.granularities.unwrap_or_default(),
        date_range,
    }
}

fn cube(c: CubeFile) -> CatalogCube {
    CatalogCube {
        name: c.name,
        base_object: c.base_object,
        description: c.properties.description,
        measures: c.measures.into_iter().map(member).collect(),
        dimensions: c.dimensions.into_iter().map(member).collect(),
        time_dimensions: c.time_dimensions.into_iter().map(member).collect(),
    }
}

const VIEW_COLUMN_DESCRIPTION_MAX: usize = 400;

fn valid_view_column_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

/// A short, single-line rendering of an author-supplied value for a diagnostic.
fn quoted(text: &str) -> String {
    let flat: String = text.chars().filter(|c| !c.is_control()).take(40).collect();
    format!("{flat:?}")
}

/// Read a view's `columns:` list. Only `name`, `type` and `description` are kept; any other key
/// of an entry is dropped like every unnamed authored field. The error names the entry by
/// position and says what is wrong, never repeating a description.
fn view_columns(raw: Option<&serde_yaml::Value>) -> Result<Vec<CatalogColumn>, String> {
    let Some(raw) = raw else {
        return Ok(Vec::new());
    };
    let serde_yaml::Value::Sequence(entries) = raw else {
        return Err("columns must be a list".to_string());
    };
    let mut columns: Vec<CatalogColumn> = Vec::with_capacity(entries.len());
    for (index, entry) in entries.iter().enumerate() {
        let at = format!("columns[{index}]");
        let serde_yaml::Value::Mapping(map) = entry else {
            return Err(format!("{at}: must be a mapping with name and type"));
        };
        let field = |key: &str| map.get(serde_yaml::Value::String(key.to_string()));
        let name = match field("name") {
            Some(serde_yaml::Value::String(name)) if valid_view_column_name(name) => name.clone(),
            Some(serde_yaml::Value::String(name)) => {
                return Err(format!(
                    "{at}: name {} must match ^[a-z0-9_]+$",
                    quoted(name)
                ))
            }
            _ => return Err(format!("{at}: name must be a string matching ^[a-z0-9_]+$")),
        };
        let r#type = match field("type") {
            Some(serde_yaml::Value::String(t)) if !t.trim().is_empty() => t.clone(),
            _ => return Err(format!("{at}: type must be a non-empty string")),
        };
        let description = match field("description") {
            None | Some(serde_yaml::Value::Null) => None,
            Some(serde_yaml::Value::String(d))
                if d.chars().count() <= VIEW_COLUMN_DESCRIPTION_MAX =>
            {
                Some(d.clone())
            }
            Some(serde_yaml::Value::String(_)) => {
                return Err(format!(
                    "{at}: description is longer than {VIEW_COLUMN_DESCRIPTION_MAX} characters"
                ))
            }
            Some(_) => return Err(format!("{at}: description must be a string")),
        };
        if columns.iter().any(|c| c.name == name) {
            return Err(format!("{at}: duplicate column name {}", quoted(&name)));
        }
        columns.push(CatalogColumn {
            name,
            r#type,
            description,
            not_null: None,
            is_calculated: None,
            is_hidden: None,
            relationship: None,
            enum_values: Vec::new(),
        });
    }
    Ok(columns)
}

/// Build the capability catalog from read project sources. Parse failures of individual files
/// are recorded in `diagnostics` and the file is skipped; the catalog never fails as a whole.
pub fn capability_catalog(sources: &ProjectSources) -> CapabilityCatalog {
    let mut diagnostics = Vec::new();
    let project = match parse_doc_or_default::<ProjectFile>(&sources.wren_project_yml) {
        Ok(p) => CatalogProject {
            name: p.name,
            data_source: p.data_source,
        },
        Err(e) => {
            diagnostics.push(CatalogDiagnostic::Message(format!("wren_project.yml: {e}")));
            CatalogProject {
                name: None,
                data_source: None,
            }
        }
    };

    let mut models = Vec::new();
    for (index, yml) in sources.model_ymls.iter().enumerate() {
        match serde_yaml::from_str::<ModelFile>(yml) {
            Ok(m) => models.push(CatalogModel {
                name: m.name,
                description: m.properties.description,
                primary_key: primary_key(m.primary_key),
                columns: m
                    .columns
                    .into_iter()
                    .map(|c| CatalogColumn {
                        name: c.name,
                        r#type: c.r#type,
                        description: c.properties.description,
                        not_null: c.not_null,
                        is_calculated: c.is_calculated,
                        is_hidden: c.is_hidden,
                        relationship: c.relationship,
                        enum_values: enum_values(c.properties.enum_values),
                    })
                    .collect(),
            }),
            Err(e) => diagnostics.push(CatalogDiagnostic::Message(format!("model[{index}]: {e}"))),
        }
    }

    let mut relationships = Vec::new();
    if let Some(yml) = &sources.relationships_yml {
        match parse_relationships(yml) {
            Ok(list) => relationships.extend(list.into_iter().map(|r| CatalogRelationship {
                name: r.name,
                models: r.models,
                join_type: r.join_type,
                condition: r.condition,
            })),
            Err(e) => diagnostics.push(CatalogDiagnostic::Message(format!(
                "relationships.yml: {e}"
            ))),
        }
    }

    let (declared, cube_errors) = authored_cubes::<CubeFile>(sources);
    let cubes: Vec<CatalogCube> = declared.into_iter().map(cube).collect();
    diagnostics.extend(
        cube_errors
            .into_iter()
            .map(|(label, e)| CatalogDiagnostic::Message(format!("{label}: {e}"))),
    );

    let mut views = Vec::new();
    let mut view_columns_invalid = false;
    for (index, (meta_yml, sql_yml)) in sources.views.iter().enumerate() {
        match serde_yaml::from_str::<ViewMetaFile>(meta_yml) {
            Ok(v) => {
                let inline = v.statement.as_deref().is_some_and(|s| !s.is_empty());
                match sql_yml_statement(sql_yml) {
                    Ok(None) if !inline => {
                        diagnostics.push(CatalogDiagnostic::Message(format!(
                            "views/{}: no statement (define it in metadata.yml or sql.yml)",
                            v.name
                        )));
                    }
                    Err(_) => diagnostics.push(CatalogDiagnostic::Message(format!(
                        "views/{}/sql.yml: not valid YAML or not a statement mapping",
                        v.name
                    ))),
                    _ => {}
                }
                let columns = match view_columns(v.columns.as_ref()) {
                    Ok(columns) => columns,
                    Err(reason) => {
                        view_columns_invalid = true;
                        diagnostics.push(CatalogDiagnostic::view_columns_invalid(
                            &format!("views/{}/metadata.yml", v.name),
                            reason,
                        ));
                        Vec::new()
                    }
                };
                let guarantees = v
                    .guarantees
                    .unwrap_or_default()
                    .into_iter()
                    .enumerate()
                    .filter_map(|(index, id)| match id {
                        serde_yaml::Value::String(id) => Some(id),
                        _ => {
                            diagnostics.push(CatalogDiagnostic::Message(format!(
                                "views/{}/metadata.yml: guarantees[{index}] must be a string",
                                v.name
                            )));
                            None
                        }
                    })
                    .collect();
                views.push(CatalogView {
                    name: v.name,
                    description: v.properties.description,
                    guarantees,
                    columns,
                });
            }
            Err(e) => diagnostics.push(CatalogDiagnostic::Message(format!("view[{index}]: {e}"))),
        }
    }
    if view_columns_invalid {
        for view in &mut views {
            view.columns.clear();
        }
    }

    CapabilityCatalog {
        catalog_version: CATALOG_VERSION,
        loader_version: env!("CARGO_PKG_VERSION").to_string(),
        digest: None,
        project,
        models,
        relationships,
        cubes,
        views,
        knowledge_rules: Vec::new(),
        knowledge_rules_used_legacy: false,
        declared_defaults: Vec::new(),
        denied_columns: Vec::new(),
        denied_columns_invalid: false,
        semantics: Vec::new(),
        semantics_invalid: false,
        view_columns_invalid,
        diagnostics,
    }
}

/// Render the catalog as its JSON document (pretty-printed, stable field order).
pub fn catalog_document(catalog: &CapabilityCatalog) -> Result<String, serde_json::Error> {
    serde_json::to_string_pretty(catalog)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sources(model_yml: &str) -> ProjectSources {
        ProjectSources {
            wren_project_yml: "schema_version: 5\nname: demo\ndata_source: duckdb\n".into(),
            model_ymls: vec![model_yml.into()],
            relationships_yml: None,
            cubes_yml: None,
            cube_ymls: Vec::new(),
            views: Vec::new(),
            knowledge_sql_mds: Vec::new(),
            dashboards_yml: None,
        }
    }

    #[test]
    fn keeps_enum_values_without_meanings() {
        for (authored, expected) in [
            (
                "{paid: active, shipped: null, cancelled: ''}",
                serde_json::json!([
                    {"value": "paid", "meaning": "active"},
                    {"value": "shipped"}, {"value": "cancelled"}
                ]),
            ),
            (
                "[{value: paid, meaning: active}, {value: shipped}, {value: cancelled, meaning: null}, {value: pending, meaning: ' '} ]",
                serde_json::json!([
                    {"value": "paid", "meaning": "active"},
                    {"value": "shipped"}, {"value": "cancelled"}, {"value": "pending"}
                ]),
            ),
            (
                "[paid, shipped, 3, true]",
                serde_json::json!([
                    {"value": "paid"}, {"value": "shipped"},
                    {"value": "3"}, {"value": "true"}
                ]),
            ),
        ] {
            let model = format!(
                "name: orders\ncolumns:\n  - name: status\n    type: VARCHAR\n    properties:\n      enum_values: {authored}\n"
            );
            let catalog = capability_catalog(&sources(&model));
            let json: serde_json::Value =
                serde_json::from_str(&catalog_document(&catalog).unwrap()).unwrap();
            assert_eq!(json["models"][0]["columns"][0]["enum_values"], expected);
        }
    }

    #[test]
    fn keeps_descriptions_and_enum_meanings_and_drops_everything_else() {
        let catalog = capability_catalog(&sources(
            r#"name: orders
ref_sql: SELECT * FROM raw_orders WHERE deleted_at IS NULL
properties:
  description: One row per order.
  sample_values: [1, 2, 3]
columns:
  - name: status
    type: VARCHAR
    properties:
      description: "[enum] see enum_values"
      enum_values: { A: active, I: inactive }
      sample_values: [A, I]
  - name: total_cents
    type: BIGINT
    is_calculated: true
    expression: amount * 100
"#,
        ));
        let json = catalog_document(&catalog).unwrap();
        assert!(json.contains("One row per order."));
        assert!(json.contains("\"meaning\": \"active\""));
        assert!(!json.contains("SELECT"));
        assert!(!json.contains("sample_values"));
        assert!(!json.contains("amount * 100"));
        assert_eq!(catalog.models[0].columns[1].is_calculated, Some(true));
        assert!(catalog.diagnostics.is_empty());
    }

    #[test]
    fn a_non_string_description_does_not_drop_its_model_or_columns() {
        let catalog = capability_catalog(&sources(
            "name: orders\nproperties: { description: { draft: true } }\ncolumns:\n  - { name: id, type: INTEGER }\n",
        ));

        assert_eq!(catalog.models.len(), 1);
        assert_eq!(catalog.models[0].name, "orders");
        assert_eq!(catalog.models[0].description, None);
        assert_eq!(catalog.models[0].columns.len(), 1);
        assert!(catalog.diagnostics.is_empty());
    }

    #[test]
    fn root_cube_descriptions_override_directory_mirror_prose() {
        let mut sources = sources("name: orders\ncolumns: []\n");
        sources.cubes_yml = Some(
            r#"- name: order_metrics
  base_object: orders
  properties: { description: Root cube description. }
  measures:
    - name: total_value
      expression: "SUM(total)"
      type: DOUBLE
      properties: { description: Root measure description. }
  dimensions: []
  time_dimensions: []
"#
            .into(),
        );
        sources.cube_ymls = vec![r#"name: order_metrics
base_object: orders
properties: { description: Directory cube prose. }
measures:
  - name: total_value
    expression: "SUM(total)"
    type: DOUBLE
    properties: { description: Directory measure prose. }
dimensions: []
time_dimensions: []
"#
        .into()];

        let catalog = capability_catalog(&sources);
        assert_eq!(catalog.cubes.len(), 1);
        assert_eq!(
            catalog.cubes[0].description.as_deref(),
            Some("Root cube description.")
        );
        assert_eq!(
            catalog.cubes[0].measures[0].description.as_deref(),
            Some("Root measure description.")
        );
        assert!(catalog.diagnostics.is_empty());
    }

    #[test]
    fn a_broken_file_is_a_diagnostic_not_a_failure() {
        let catalog = capability_catalog(&sources("name: [unclosed"));
        assert!(catalog.models.is_empty());
        assert_eq!(catalog.diagnostics.len(), 1);
    }
}
