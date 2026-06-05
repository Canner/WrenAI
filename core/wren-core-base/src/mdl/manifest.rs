use std::error::Error;
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
use std::fmt::Display;
use std::str::FromStr;
use std::sync::Arc;

#[cfg(not(feature = "python-binding"))]
mod manifest_impl {
    use crate::mdl::manifest::bool_from_int;
    use crate::mdl::manifest::table_reference;
    use crate::mdl::manifest::PrimaryKey;
    use manifest_macro::{
        column, column_level_access_control, column_level_operator, cube, cube_dimension,
        data_source, join_type, manifest, measure, model, normalized_expr, normalized_expr_type,
        relationship, row_level_access_control, session_property, time_dimension, view,
    };
    use serde::{Deserialize, Serialize};
    use serde_with::serde_as;
    use serde_with::DeserializeFromStr;
    use serde_with::NoneAsEmptyString;
    use serde_with::SerializeDisplay;
    use std::sync::Arc;
    manifest!(false);
    data_source!(false);
    model!(false);
    column!(false);
    relationship!(false);
    view!(false);
    join_type!(false);
    measure!(false);
    cube_dimension!(false);
    time_dimension!(false);
    cube!(false);
    row_level_access_control!(false);
    column_level_access_control!(false);
    session_property!(false);
    normalized_expr!(false);
    normalized_expr_type!(false);
    column_level_operator!(false);
}

#[cfg(feature = "python-binding")]
mod manifest_impl {
    use crate::mdl::manifest::bool_from_int;
    use crate::mdl::manifest::table_reference;
    use crate::mdl::manifest::PrimaryKey;
    use manifest_macro::{
        column, column_level_access_control, column_level_operator, cube, cube_dimension,
        data_source, join_type, manifest, measure, model, normalized_expr, normalized_expr_type,
        relationship, row_level_access_control, session_property, time_dimension, view,
    };
    use pyo3::pyclass;
    use serde::{Deserialize, Serialize};
    use serde_with::serde_as;
    use serde_with::DeserializeFromStr;
    use serde_with::NoneAsEmptyString;
    use serde_with::SerializeDisplay;
    use std::sync::Arc;

    data_source!(true);
    model!(true);
    column!(true);
    relationship!(true);
    view!(true);
    join_type!(true);
    measure!(true);
    cube_dimension!(true);
    time_dimension!(true);
    cube!(true);
    manifest!(true);
    row_level_access_control!(true);
    column_level_access_control!(true);
    session_property!(true);
    normalized_expr!(true);
    normalized_expr_type!(true);
    column_level_operator!(true);
}

pub use crate::mdl::manifest::manifest_impl::*;

/// The primary key of a [Model]. A model may declare either a single column
/// (`"primaryKey": "id"`) or a composite key (`"primaryKey": ["a", "b"]`).
/// The `#[serde(untagged)]` representation keeps the legacy single-string form
/// fully backward compatible.
#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq, Eq, Hash, Clone)]
#[serde(untagged)]
pub enum PrimaryKey {
    Single(String),
    Composite(Vec<String>),
}

impl PrimaryKey {
    /// All primary key columns in declaration order.
    pub fn columns(&self) -> Vec<&str> {
        match self {
            PrimaryKey::Single(s) => vec![s.as_str()],
            PrimaryKey::Composite(v) => v.iter().map(String::as_str).collect(),
        }
    }
}

pub const MAX_SUPPORTED_LAYOUT_VERSION: u32 = 2;

impl Manifest {
    pub fn validate_layout_version(&self) -> Result<(), LayoutVersionError> {
        if self.layout_version > MAX_SUPPORTED_LAYOUT_VERSION {
            Err(LayoutVersionError {
                manifest_version: self.layout_version,
                max_supported: MAX_SUPPORTED_LAYOUT_VERSION,
            })
        } else {
            Ok(())
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LayoutVersionError {
    pub manifest_version: u32,
    pub max_supported: u32,
}

impl Display for LayoutVersionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "This manifest requires layout version {}, but this engine only supports up to {}",
            self.manifest_version, self.max_supported
        )
    }
}

impl Error for LayoutVersionError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedDataSourceError {
    pub message: String,
}

impl ParsedDataSourceError {
    pub fn new(msg: &str) -> ParsedDataSourceError {
        ParsedDataSourceError {
            message: msg.to_string(),
        }
    }
}

impl Display for ParsedDataSourceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "ParsedDataSourceError: {}", self.message)
    }
}

impl Error for ParsedDataSourceError {
    #[allow(deprecated)]
    fn description(&self) -> &str {
        &self.message
    }
}

impl Display for DataSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DataSource::BigQuery => write!(f, "BIGQUERY"),
            DataSource::Clickhouse => write!(f, "CLICKHOUSE"),
            DataSource::Canner => write!(f, "CANNER"),
            DataSource::Trino => write!(f, "TRINO"),
            DataSource::MSSQL => write!(f, "MSSQL"),
            DataSource::MySQL => write!(f, "MYSQL"),
            DataSource::Doris => write!(f, "DORIS"),
            DataSource::Postgres => write!(f, "POSTGRES"),
            DataSource::Snowflake => write!(f, "SNOWFLAKE"),
            DataSource::Datafusion => write!(f, "DATAFUSION"),
            DataSource::DuckDB => write!(f, "DUCKDB"),
            DataSource::LocalFile => write!(f, "LOCAL_FILE"),
            DataSource::S3File => write!(f, "S3_FILE"),
            DataSource::GcsFile => write!(f, "GCS_FILE"),
            DataSource::MinioFile => write!(f, "MINIO_FILE"),
            DataSource::Oracle => write!(f, "ORACLE"),
            DataSource::Athena => write!(f, "ATHENA"),
            DataSource::Redshift => write!(f, "REDSHIFT"),
            DataSource::Databricks => write!(f, "DATABRICKS"),
            DataSource::Spark => write!(f, "SPARK"),
        }
    }
}

impl FromStr for DataSource {
    type Err = ParsedDataSourceError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_uppercase().as_str() {
            "BIGQUERY" => Ok(DataSource::BigQuery),
            "CLICKHOUSE" => Ok(DataSource::Clickhouse),
            "CANNER" => Ok(DataSource::Canner),
            "TRINO" => Ok(DataSource::Trino),
            "MSSQL" => Ok(DataSource::MSSQL),
            "MYSQL" => Ok(DataSource::MySQL),
            "DORIS" => Ok(DataSource::Doris),
            "POSTGRES" => Ok(DataSource::Postgres),
            "SNOWFLAKE" => Ok(DataSource::Snowflake),
            "DATAFUSION" => Ok(DataSource::Datafusion),
            "DUCKDB" => Ok(DataSource::DuckDB),
            "LOCAL_FILE" => Ok(DataSource::LocalFile),
            "S3_FILE" => Ok(DataSource::S3File),
            "GCS_FILE" => Ok(DataSource::GcsFile),
            "MINIO_FILE" => Ok(DataSource::MinioFile),
            "ORACLE" => Ok(DataSource::Oracle),
            "ATHENA" => Ok(DataSource::Athena),
            "REDSHIFT" => Ok(DataSource::Redshift),
            "DATABRICKS" => Ok(DataSource::Databricks),
            "SPARK" => Ok(DataSource::Spark),
            _ => Err(ParsedDataSourceError::new(&format!(
                "Unknown data source: {}",
                s
            ))),
        }
    }
}

mod table_reference {
    use serde::{self, Deserialize, Deserializer, Serialize, Serializer};

    use crate::mdl::utils::{parse_identifiers_normalized, quote_identifier};

    #[derive(Deserialize, Serialize, Default)]
    struct TableReference {
        catalog: Option<String>,
        schema: Option<String>,
        table: Option<String>,
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
    where
        D: Deserializer<'de>,
    {
        Ok(Option::deserialize(deserializer)?
            .map(
                |TableReference {
                     catalog,
                     schema,
                     table,
                 }| {
                    [catalog, schema, table]
                        .into_iter()
                        .filter_map(|s| {
                            s.filter(|x| !x.is_empty())
                                .map(|x| quote_identifier(&x).to_string())
                        })
                        .collect::<Vec<_>>()
                        .join(".")
                },
            )
            .filter(|s| !s.is_empty()))
    }

    pub fn serialize<S>(table_ref: &Option<String>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        if let Some(table_ref) = table_ref {
            let parts: Vec<String> =
                parse_identifiers_normalized(table_ref, false).map_err(|e| {
                    serde::ser::Error::custom(format!(
                        "Failed to parse table reference: {table_ref}, error: {e}"
                    ))
                })?;
            if parts.len() > 3 {
                return Err(serde::ser::Error::custom(format!(
                    "Invalid table reference: {table_ref}"
                )));
            }
            let table_ref = if parts.len() == 3 {
                TableReference {
                    catalog: Some(parts[0].to_string()),
                    schema: Some(parts[1].to_string()),
                    table: Some(parts[2].to_string()),
                }
            } else if parts.len() == 2 {
                TableReference {
                    catalog: None,
                    schema: Some(parts[0].to_string()),
                    table: Some(parts[1].to_string()),
                }
            } else if parts.len() == 1 {
                TableReference {
                    catalog: None,
                    schema: None,
                    table: Some(parts[0].to_string()),
                }
            } else {
                TableReference::default()
            };
            table_ref.serialize(serializer)
        } else {
            serializer.serialize_none()
        }
    }
}

mod bool_from_int {
    use serde::{self, Deserialize, Deserializer, Serialize, Serializer};

    pub fn deserialize<'de, D>(deserializer: D) -> Result<bool, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value: serde_json::Value = Deserialize::deserialize(deserializer)?;
        match value {
            serde_json::Value::Bool(b) => Ok(b),
            // Backward compatibility with Wren AI manifests
            // In the legacy manifest format generated by Wren AI, boolean values are represented as integers (0 or 1)
            serde_json::Value::Number(n) if n.is_u64() => Ok(n.as_u64().unwrap() != 0),
            _ => Err(serde::de::Error::custom("invalid type for boolean")),
        }
    }

    pub fn serialize<S>(value: &bool, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        Serialize::serialize(value, serializer)
    }
}

impl JoinType {
    pub fn is_to_one(&self) -> bool {
        matches!(self, JoinType::OneToOne | JoinType::ManyToOne)
    }
}

impl Display for JoinType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            JoinType::OneToOne => write!(f, "one_to_one"),
            JoinType::OneToMany => write!(f, "one_to_many"),
            JoinType::ManyToOne => write!(f, "many_to_one"),
            JoinType::ManyToMany => write!(f, "many_to_many"),
        }
    }
}

impl Model {
    /// Physical columns are columns that can be selected from the model.
    /// All physical columns are visible columns, but not all visible columns are physical columns
    /// e.g. columns that are not a relationship column
    pub fn get_physical_columns(&self, show_visible_only: bool) -> Vec<Arc<Column>> {
        if show_visible_only {
            self.get_visible_columns()
                .filter(|c| c.relationship.is_none())
                .map(|c| Arc::clone(&c))
                .collect()
        } else {
            self.columns
                .iter()
                .filter(|c| c.relationship.is_none())
                .map(Arc::clone)
                .collect()
        }
    }

    /// Return the name of the model
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Return the iterator of all visible columns
    pub fn get_visible_columns(&self) -> impl Iterator<Item = Arc<Column>> + '_ {
        self.columns.iter().filter(|f| !f.is_hidden).map(Arc::clone)
    }

    /// Get the specified visible column by name
    pub fn get_visible_column(&self, column_name: &str) -> Option<Arc<Column>> {
        self.get_visible_columns()
            .find(|c| c.name == column_name)
            .map(|c| Arc::clone(&c))
    }

    pub fn get_column(&self, column_name: &str) -> Option<Arc<Column>> {
        self.columns
            .iter()
            .find(|c| c.name == column_name)
            .map(Arc::clone)
    }

    /// Return the first primary key column of the model.
    /// For a composite key this is the first declared column; use
    /// [`Model::primary_keys`] to get every column.
    pub fn primary_key(&self) -> Option<&str> {
        self.primary_key
            .as_ref()
            .and_then(|pk| pk.columns().into_iter().next())
    }

    /// Return all primary key columns of the model (empty if none declared).
    pub fn primary_keys(&self) -> Vec<&str> {
        self.primary_key
            .as_ref()
            .map(PrimaryKey::columns)
            .unwrap_or_default()
    }

    /// Return the table reference of the model
    pub fn table_reference(&self) -> Option<&str> {
        self.table_reference.as_deref()
    }

    /// Return the ref_sql of the model
    pub fn ref_sql(&self) -> Option<&str> {
        self.ref_sql.as_deref()
    }

    /// Determine the source type of this model
    pub fn source(&self) -> ModelSource {
        match (self.table_reference.is_some(), self.ref_sql.is_some()) {
            (true, false) => ModelSource::TableReference,
            (false, true) => ModelSource::RefSql,
            (true, true) => {
                ModelSource::Invalid("Both table_reference and ref_sql are defined".to_string())
            }
            (false, false) => ModelSource::Invalid(
                "No source defined: must have either table_reference or ref_sql".to_string(),
            ),
        }
    }

    pub fn row_level_access_controls(&self) -> &[Arc<RowLevelAccessControl>] {
        &self.row_level_access_controls
    }
}

#[derive(Debug, Clone)]
pub enum ModelSource {
    TableReference,
    RefSql,
    Invalid(String),
}

impl PartialOrd for Model {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Model {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.name.cmp(&other.name)
    }
}

impl Column {
    /// Return the name of the column
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Return the expression of the column
    pub fn expression(&self) -> Option<&str> {
        self.expression.as_deref()
    }

    pub fn column_level_access_control(&self) -> Option<Arc<ColumnLevelAccessControl>> {
        if let Some(ref cla) = &self.column_level_access_control {
            Some(Arc::clone(cla))
        } else {
            None
        }
    }
}

impl Cube {
    pub fn name(&self) -> &str {
        &self.name
    }
}

impl Measure {
    pub fn name(&self) -> &str {
        &self.name
    }
}

impl CubeDimension {
    pub fn name(&self) -> &str {
        &self.name
    }
}

impl TimeDimension {
    pub fn name(&self) -> &str {
        &self.name
    }
}

impl View {
    pub fn name(&self) -> &str {
        &self.name
    }
}

impl SessionProperty {
    pub fn normalized_name(&self) -> &str {
        &self.normalized_name
    }
}

#[cfg(test)]
mod tests {
    use crate::mdl::builder::ModelBuilder;
    use crate::mdl::manifest::table_reference;
    use crate::mdl::manifest::ModelSource;
    use serde_json::Serializer;

    #[test]
    fn test_table_reference_serialize() {
        [
            (
                Some("catalog.schema.table".to_string()),
                r#"{"catalog":"catalog","schema":"schema","table":"table"}"#,
            ),
            (
                Some("schema.table".to_string()),
                r#"{"catalog":null,"schema":"schema","table":"table"}"#,
            ),
            (
                Some("table".to_string()),
                r#"{"catalog":null,"schema":null,"table":"table"}"#,
            ),
            (None, "null"),
        ]
        .iter()
        .for_each(|(table_ref, expected)| {
            let mut buf = Vec::new();
            table_reference::serialize(table_ref, &mut Serializer::new(&mut buf)).unwrap();
            assert_eq!(String::from_utf8(buf).unwrap(), *expected);
        });
    }

    #[test]
    fn test_case_sensitive() {
        let table_ref = Some(r#""Catalog"."Schema"."Table""#.to_string());
        let mut buf = Vec::new();
        table_reference::serialize(&table_ref, &mut Serializer::new(&mut buf)).unwrap();
        let serialized = String::from_utf8(buf).unwrap();
        assert_eq!(
            serialized,
            r#"{"catalog":"Catalog","schema":"Schema","table":"Table"}"#
        );
    }

    #[test]
    fn test_model_source() {
        // table_reference only → TableReference
        let model = ModelBuilder::new("tref_model")
            .table_reference("schema.orders")
            .build();
        assert!(matches!(model.source(), ModelSource::TableReference));
        assert_eq!(model.table_reference(), Some("schema.orders"));
        assert_eq!(model.ref_sql(), None);

        // ref_sql only → RefSql
        let model = ModelBuilder::new("sql_model").ref_sql("SELECT 1").build();
        assert!(matches!(model.source(), ModelSource::RefSql));
        assert_eq!(model.table_reference(), None);
        assert_eq!(model.ref_sql(), Some("SELECT 1"));

        // both defined → Invalid
        let mut model = ModelBuilder::new("both_model")
            .table_reference("schema.orders")
            .ref_sql("SELECT 1")
            .build();
        assert!(matches!(model.source(), ModelSource::Invalid(_)));

        // neither defined → Invalid
        model = ModelBuilder::new("empty_model").build();
        assert!(matches!(model.source(), ModelSource::Invalid(_)));
    }

    #[test]
    fn test_primary_key_serde() {
        use crate::mdl::manifest::{Model, PrimaryKey};

        // Legacy single-column form deserializes to Single and serializes back to a string.
        let single: Model =
            serde_json::from_str(r#"{"name":"customer","columns":[],"primaryKey":"c_custkey"}"#)
                .unwrap();
        assert_eq!(
            single.primary_key,
            Some(PrimaryKey::Single("c_custkey".into()))
        );
        assert_eq!(single.primary_key(), Some("c_custkey"));
        assert_eq!(single.primary_keys(), vec!["c_custkey"]);
        assert_eq!(
            serde_json::to_value(&single.primary_key).unwrap(),
            serde_json::json!("c_custkey")
        );

        // Composite form deserializes to Composite and serializes back to an array.
        let composite: Model = serde_json::from_str(
            r#"{"name":"partsupp","columns":[],"primaryKey":["ps_partkey","ps_suppkey"]}"#,
        )
        .unwrap();
        assert_eq!(
            composite.primary_key,
            Some(PrimaryKey::Composite(vec![
                "ps_partkey".into(),
                "ps_suppkey".into()
            ]))
        );
        assert_eq!(composite.primary_key(), Some("ps_partkey"));
        assert_eq!(composite.primary_keys(), vec!["ps_partkey", "ps_suppkey"]);
        assert_eq!(
            serde_json::to_value(&composite.primary_key).unwrap(),
            serde_json::json!(["ps_partkey", "ps_suppkey"])
        );

        // Absent primary key.
        let none: Model = serde_json::from_str(r#"{"name":"m","columns":[]}"#).unwrap();
        assert_eq!(none.primary_key(), None);
        assert!(none.primary_keys().is_empty());

        // Builder produces the composite form.
        let model = ModelBuilder::new("partsupp")
            .primary_keys(&["ps_partkey", "ps_suppkey"])
            .build();
        assert_eq!(model.primary_keys(), vec!["ps_partkey", "ps_suppkey"]);
    }
}
