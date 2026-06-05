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

use quote::quote;
use syn::{parse_macro_input, LitBool};

/// This macro generates a struct for `Manifest`
/// If python_binding is true, it will generate a `pyclass` attribute
#[proc_macro]
pub fn manifest(python_binding: proc_macro::TokenStream) -> proc_macro::TokenStream {
    let input = parse_macro_input!(python_binding as LitBool);
    let python_binding = if input.value {
        quote! {
            #[pyclass]
        }
    } else {
        quote! {}
    };

    let expanded = quote! {
        #python_binding
        #[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Hash, Clone)]
        #[serde(rename_all = "camelCase")]
        pub struct Manifest {
            #[serde(default = "default_layout_version")]
            pub layout_version: u32,
            pub catalog: String,
            pub schema: String,
            #[serde(default)]
            pub models: Vec<Arc<Model>>,
            #[serde(default)]
            pub relationships: Vec<Arc<Relationship>>,
            #[serde(default)]
            pub views: Vec<Arc<View>>,
            #[serde(default)]
            pub data_source: Option<DataSource>,
            #[serde(default)]
            pub cubes: Vec<Arc<Cube>>,
        }

        fn default_layout_version() -> u32 {
            1
        }
    };
    proc_macro::TokenStream::from(expanded)
}

/// This macro generates an enum for `DataSource`
/// If python_binding is true, it will generate a `pyclass` attribute
#[proc_macro]
pub fn data_source(python_binding: proc_macro::TokenStream) -> proc_macro::TokenStream {
    let input = parse_macro_input!(python_binding as LitBool);
    let python_binding = if input.value {
        quote! {
            #[pyclass(eq, eq_int)]
        }
    } else {
        quote! {}
    };

    let expanded = quote! {
        #python_binding
        #[derive(Serialize, Deserialize, Debug, Default, PartialEq, Eq, Hash, Clone, Copy)]
        #[serde(rename_all = "UPPERCASE")]
        pub enum DataSource {
            #[serde(alias = "bigquery")]
            BigQuery,
            #[serde(alias = "clickhouse")]
            Clickhouse,
            #[serde(alias = "canner")]
            Canner,
            #[serde(alias = "trino")]
            Trino,
            #[serde(alias = "mssql")]
            MSSQL,
            #[serde(alias = "mysql")]
            MySQL,
            #[serde(alias = "doris")]
            Doris,
            #[serde(alias = "postgres")]
            Postgres,
            #[serde(alias = "snowflake")]
            Snowflake,
            #[default]
            #[serde(alias = "datafusion")]
            Datafusion,
            #[serde(alias = "duckdb")]
            DuckDB,
            #[serde(alias = "local_file")]
            LocalFile,
            #[serde(alias = "s3_file")]
            S3File,
            #[serde(alias = "gcs_file")]
            GcsFile,
            #[serde(alias = "minio_file")]
            MinioFile,
            #[serde(alias = "oracle")]
            Oracle,
            #[serde(alias = "athena")]
            Athena,
            #[serde(alias = "redshift")]
            Redshift,
            #[serde(alias = "databricks")]
            Databricks,
            #[serde(alias = "spark")]
            Spark,
        }
    };
    proc_macro::TokenStream::from(expanded)
}

/// This macro generates a struct for `Model`
/// If python_binding is true, it will generate a `pyclass` attribute
#[proc_macro]
pub fn model(python_binding: proc_macro::TokenStream) -> proc_macro::TokenStream {
    let input = parse_macro_input!(python_binding as LitBool);
    let python_binding = if input.value {
        quote! {
            #[pyclass]
        }
    } else {
        quote! {}
    };

    let expanded = quote! {
        #python_binding
        #[serde_as]
        #[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Hash, Clone)]
        #[serde(rename_all = "camelCase")]
        pub struct Model {
            pub name: String,
            #[serde(default)]
            pub ref_sql: Option<String>,
            #[serde(default)]
            pub base_object: Option<String>,
            #[serde(default, with = "table_reference")]
            pub table_reference: Option<String>,
            pub columns: Vec<Arc<Column>>,
            #[serde(default)]
            pub primary_key: Option<PrimaryKey>,
            #[serde(default, with = "bool_from_int")]
            pub cached: bool,
            #[serde(default)]
            pub refresh_time: Option<String>,
            #[serde(default)]
            pub row_level_access_controls: Vec<Arc<RowLevelAccessControl>>,
            #[serde(default)]
            pub dialect: Option<DataSource>,
        }
    };
    proc_macro::TokenStream::from(expanded)
}

/// This macro generates a struct for `Column`
/// If python_binding is true, it will generate a `pyclass` attribute
#[proc_macro]
pub fn column(python_binding: proc_macro::TokenStream) -> proc_macro::TokenStream {
    let input = parse_macro_input!(python_binding as LitBool);
    let python_binding = if input.value {
        quote! {
            #[pyclass]
        }
    } else {
        quote! {}
    };

    let expanded = quote! {
        #python_binding
        #[serde_as]
        #[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Hash)]
        #[serde(rename_all = "camelCase")]
        pub struct Column {
            pub name: String,
            pub r#type: String,
            #[serde(default)]
            pub relationship: Option<String>,
            #[serde(default, with = "bool_from_int")]
            pub is_calculated: bool,
            #[serde(default, with = "bool_from_int")]
            pub not_null: bool,
            #[serde_as(as = "NoneAsEmptyString")]
            #[serde(default)]
            pub expression: Option<String>,
            #[serde(default, with = "bool_from_int")]
            pub is_hidden: bool,
            pub column_level_access_control: Option<Arc<ColumnLevelAccessControl>>,
        }
    };
    proc_macro::TokenStream::from(expanded)
}

/// This macro generates a struct for `Relationship`
/// If python_binding is true, it will generate a `pyclass` attribute
#[proc_macro]
pub fn relationship(python_binding: proc_macro::TokenStream) -> proc_macro::TokenStream {
    let input = parse_macro_input!(python_binding as LitBool);
    let python_binding = if input.value {
        quote! {
            #[pyclass]
        }
    } else {
        quote! {}
    };

    let expanded = quote! {
        #python_binding
        #[serde_as]
        #[derive(Serialize, Deserialize, Debug, Hash, PartialEq, Eq)]
        #[serde(rename_all = "camelCase")]
        pub struct Relationship {
            pub name: String,
            pub models: Vec<String>,
            pub join_type: JoinType,
            pub condition: String,
        }
    };
    proc_macro::TokenStream::from(expanded)
}

/// This macro generates an enum for `JoinType`
/// If python_binding is true, it will generate a `pyclass` attribute
#[proc_macro]
pub fn join_type(python_binding: proc_macro::TokenStream) -> proc_macro::TokenStream {
    let input = parse_macro_input!(python_binding as LitBool);
    let python_binding = if input.value {
        quote! {
            #[pyclass(eq, eq_int)]
        }
    } else {
        quote! {}
    };

    let expanded = quote! {
        #python_binding
        #[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Hash, Clone, Copy)]
        #[serde(rename_all = "SCREAMING_SNAKE_CASE")]
        pub enum JoinType {
            #[serde(alias = "one_to_one")]
            OneToOne,
            #[serde(alias = "one_to_many")]
            OneToMany,
            #[serde(alias = "many_to_one")]
            ManyToOne,
            #[serde(alias = "many_to_many")]
            ManyToMany,
        }
    };
    proc_macro::TokenStream::from(expanded)
}

/// This macro generates a struct for `Measure` (part of a Cube).
/// If python_binding is true, it will generate a `pyclass` attribute.
#[proc_macro]
pub fn measure(python_binding: proc_macro::TokenStream) -> proc_macro::TokenStream {
    let input = parse_macro_input!(python_binding as LitBool);
    let python_binding = if input.value {
        quote! { #[pyclass] }
    } else {
        quote! {}
    };

    let expanded = quote! {
        #python_binding
        #[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Hash, Clone)]
        #[serde(rename_all = "camelCase")]
        pub struct Measure {
            pub name: String,
            pub expression: String,
            pub r#type: String,
        }
    };
    proc_macro::TokenStream::from(expanded)
}

/// This macro generates a struct for `CubeDimension` (a grouping attribute in a Cube).
/// If python_binding is true, it will generate a `pyclass` attribute.
#[proc_macro]
pub fn cube_dimension(python_binding: proc_macro::TokenStream) -> proc_macro::TokenStream {
    let input = parse_macro_input!(python_binding as LitBool);
    let python_binding = if input.value {
        quote! { #[pyclass] }
    } else {
        quote! {}
    };

    let expanded = quote! {
        #python_binding
        #[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Hash, Clone)]
        #[serde(rename_all = "camelCase")]
        pub struct CubeDimension {
            pub name: String,
            pub expression: String,
            pub r#type: String,
        }
    };
    proc_macro::TokenStream::from(expanded)
}

/// This macro generates a struct for `TimeDimension` (a date/timestamp column in a Cube).
/// If python_binding is true, it will generate a `pyclass` attribute.
#[proc_macro]
pub fn time_dimension(python_binding: proc_macro::TokenStream) -> proc_macro::TokenStream {
    let input = parse_macro_input!(python_binding as LitBool);
    let python_binding = if input.value {
        quote! { #[pyclass] }
    } else {
        quote! {}
    };

    let expanded = quote! {
        #python_binding
        #[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Hash, Clone)]
        #[serde(rename_all = "camelCase")]
        pub struct TimeDimension {
            pub name: String,
            pub expression: String,
            pub r#type: String,
        }
    };
    proc_macro::TokenStream::from(expanded)
}

/// This macro generates a struct for `Cube` — the first-class MDL analytical type.
/// Hierarchies use `BTreeMap` (sorted keys) so `Hash` is implemented manually
/// rather than derived (`BTreeMap` does not implement `Hash`).
/// If python_binding is true, it will generate a `pyclass` attribute.
#[proc_macro]
pub fn cube(python_binding: proc_macro::TokenStream) -> proc_macro::TokenStream {
    let input = parse_macro_input!(python_binding as LitBool);
    let python_binding = if input.value {
        quote! { #[pyclass] }
    } else {
        quote! {}
    };

    let expanded = quote! {
        #python_binding
        #[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
        #[serde(rename_all = "camelCase")]
        pub struct Cube {
            pub name: String,
            pub base_object: String,
            #[serde(default)]
            pub measures: Vec<std::sync::Arc<Measure>>,
            #[serde(default)]
            pub dimensions: Vec<std::sync::Arc<CubeDimension>>,
            #[serde(default)]
            pub time_dimensions: Vec<std::sync::Arc<TimeDimension>>,
            /// Ordered drill-down paths: coarsest to finest dimension names.
            /// Uses `BTreeMap` so key iteration is deterministic.
            #[serde(default)]
            pub hierarchies: std::collections::BTreeMap<String, Vec<String>>,
        }

        impl std::hash::Hash for Cube {
            fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
                self.name.hash(state);
                self.base_object.hash(state);
                self.measures.hash(state);
                self.dimensions.hash(state);
                self.time_dimensions.hash(state);
                // BTreeMap iterates in sorted key order — consistent with its PartialEq impl.
                for (k, v) in &self.hierarchies {
                    k.hash(state);
                    v.hash(state);
                }
            }
        }
    };
    proc_macro::TokenStream::from(expanded)
}

/// This macro generates a struct for `View`
/// If python_binding is true, it will generate a `pyclass` attribute
#[proc_macro]
pub fn view(python_binding: proc_macro::TokenStream) -> proc_macro::TokenStream {
    let input = parse_macro_input!(python_binding as LitBool);
    let python_binding = if input.value {
        quote! {
            #[pyclass]
        }
    } else {
        quote! {}
    };

    let expanded = quote! {
        #python_binding
        #[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Hash)]
        #[serde(rename_all = "camelCase")]
        pub struct View {
            pub name: String,
            pub statement: String,
            #[serde(default)]
            pub dialect: Option<DataSource>,
        }
    };
    proc_macro::TokenStream::from(expanded)
}

#[proc_macro]
pub fn row_level_access_control(
    python_binding: proc_macro::TokenStream,
) -> proc_macro::TokenStream {
    let input = parse_macro_input!(python_binding as LitBool);
    let python_binding = if input.value {
        quote! {
            #[pyclass]
        }
    } else {
        quote! {}
    };
    let expanded = quote! {
        #python_binding
        #[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Hash, Clone)]
        #[serde(rename_all = "camelCase")]
        pub struct RowLevelAccessControl {
            pub name: String,
            #[serde(default)]
            pub required_properties: Vec<SessionProperty>,
            /// A string expression that can be evaluated to a boolean value
            pub condition: String,
        }
    };
    proc_macro::TokenStream::from(expanded)
}

#[proc_macro]
pub fn session_property(python_binding: proc_macro::TokenStream) -> proc_macro::TokenStream {
    let input = parse_macro_input!(python_binding as LitBool);
    let python_binding = if input.value {
        quote! {
            #[pyclass]
        }
    } else {
        quote! {}
    };
    let expanded = quote! {
        #python_binding
        #[derive(Serialize, Debug, PartialEq, Eq, Hash, Clone)]
        #[serde(rename_all = "camelCase")]
        pub struct SessionProperty {
            pub name: String,
            pub required: bool,
            pub default_expr: Option<String>,
            // To avoid duplicate clone for normalized name(to_lowercase), we store it here
            #[serde(skip_serializing, default = "String::new")]
            pub normalized_name: String,
        }

        impl SessionProperty {
            #[cfg(not(feature = "python-binding"))]
            pub fn new(name: String, required: bool, default_expr: Option<String>) -> Self {
                let normalized_name = name.to_lowercase();
                Self {
                    name,
                    required,
                    default_expr,
                    normalized_name,
                }
            }
        }

        impl<'de> serde::Deserialize<'de> for SessionProperty {
            fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct SessionPropertyHelper {
                    name: String,
                    required: bool,
                    default_expr: Option<String>,
                }

                let helper = SessionPropertyHelper::deserialize(deserializer)?;
                Ok(SessionProperty {
                    normalized_name: helper.name.to_lowercase(),
                    name: helper.name,
                    required: helper.required,
                    default_expr: helper.default_expr,
                })
            }
        }
    };
    proc_macro::TokenStream::from(expanded)
}

#[proc_macro]
pub fn column_level_access_control(
    python_binding: proc_macro::TokenStream,
) -> proc_macro::TokenStream {
    let input = parse_macro_input!(python_binding as LitBool);
    let python_binding = if input.value {
        quote! {
            #[pyclass]
        }
    } else {
        quote! {}
    };
    let expanded = quote! {
        #python_binding
        #[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Hash)]
        #[serde(rename_all = "camelCase")]
        pub struct ColumnLevelAccessControl {
            pub name: String,
            pub required_properties: Vec<SessionProperty>,
            pub operator: ColumnLevelOperator,
            pub threshold: NormalizedExpr,
        }
    };
    proc_macro::TokenStream::from(expanded)
}

#[proc_macro]
pub fn column_level_operator(python_binding: proc_macro::TokenStream) -> proc_macro::TokenStream {
    let input = parse_macro_input!(python_binding as LitBool);
    let python_binding = if input.value {
        quote! {
            #[pyclass(eq, eq_int)]
        }
    } else {
        quote! {}
    };
    let expanded = quote! {
        #python_binding
        #[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Hash, Clone, Copy)]
        #[serde(rename_all = "SCREAMING_SNAKE_CASE")]
        pub enum ColumnLevelOperator {
            Equals,
            NotEquals,
            GreaterThan,
            LessThan,
            GreaterThanOrEquals,
            LessThanOrEquals,
        }
    };
    proc_macro::TokenStream::from(expanded)
}

#[proc_macro]
pub fn normalized_expr(python_binding: proc_macro::TokenStream) -> proc_macro::TokenStream {
    let input = parse_macro_input!(python_binding as LitBool);
    let python_binding = if input.value {
        quote! {
            #[pyclass]
        }
    } else {
        quote! {}
    };
    let expanded = quote! {
        #python_binding
        #[derive(SerializeDisplay, DeserializeFromStr, Debug, PartialEq, Eq, Hash)]
        pub struct NormalizedExpr {
            pub value: String,
            #[serde_with(alias = "type")]
            pub data_type: NormalizedExprType,
        }
    };
    proc_macro::TokenStream::from(expanded)
}

#[proc_macro]
pub fn normalized_expr_type(python_binding: proc_macro::TokenStream) -> proc_macro::TokenStream {
    let input = parse_macro_input!(python_binding as LitBool);
    let python_binding = if input.value {
        quote! {
            #[pyclass(eq, eq_int)]
        }
    } else {
        quote! {}
    };
    let expanded = quote! {
        #python_binding
        #[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Hash, Clone, Copy)]
        #[serde(rename_all = "SCREAMING_SNAKE_CASE")]
        pub enum NormalizedExprType {
            Numeric,
            String,
        }
    };
    proc_macro::TokenStream::from(expanded)
}
