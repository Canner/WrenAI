use crate::mdl::lineage::DatasetLink;
use crate::mdl::manifest::Column;
use crate::mdl::utils::quoted;
use crate::mdl::{manifest::Model, WrenMDL};
use crate::mdl::{Dataset, SessionStateRef};
use datafusion::arrow::datatypes::{
    DataType, Field, IntervalUnit, Schema, SchemaBuilder, SchemaRef, TimeUnit,
};
use datafusion::common::tree_node::{
    Transformed, TransformedResult, TreeNode, TreeNodeRecursion,
};
use datafusion::common::types::{
    logical_binary, logical_boolean, logical_date, logical_float16, logical_float32,
    logical_float64, logical_string,
};
use datafusion::common::{plan_err, DFSchema, DFSchemaRef};
use datafusion::datasource::DefaultTableSource;
use datafusion::error::Result;
use datafusion::logical_expr::sqlparser::ast::ArrayElemTypeDef;
use datafusion::logical_expr::sqlparser::dialect::GenericDialect;
use datafusion::logical_expr::{builder::LogicalTableSource, Expr, TableSource};
use datafusion::logical_expr::{Coercion, TypeSignatureClass};
use datafusion::sql::sqlparser::ast;
use datafusion::sql::sqlparser::parser::Parser;
use datafusion::sql::TableReference;
use log::debug;
use petgraph::dot::{Config, Dot};
use petgraph::Graph;
use std::collections::{BTreeMap, HashSet};
use std::str::FromStr;
use std::{collections::HashMap, sync::Arc};

fn create_list_type(array_type: &str) -> Result<DataType> {
    // Workaround for the array type without an element type
    if array_type.len() == "array".len() || array_type == "list" {
        return create_list_type("array<varchar>");
    }
    if let ast::DataType::Array(value) = parse_type(array_type)? {
        let data_type = match value {
            ArrayElemTypeDef::None => {
                return plan_err!("Array type must have an element type")
            }
            ArrayElemTypeDef::AngleBracket(data_type) => {
                try_map_data_type(&data_type.to_string())?
            }
            ArrayElemTypeDef::SquareBracket(_, _) => {
                unreachable!()
            }
            ArrayElemTypeDef::Parenthesis(_) => {
                return plan_err!(
                    "The format of the array type should be 'array<element_type>'"
                )
            }
        };
        return Ok(DataType::List(Arc::new(Field::new(
            "item", data_type, true,
        ))));
    }
    unreachable!()
}

fn create_struct_type(struct_type: &str) -> Result<DataType> {
    let sql_type = parse_type(struct_type)?;
    let mut builder = SchemaBuilder::new();
    let mut counter = 0;
    match sql_type {
        ast::DataType::Struct(fields, ..) => {
            if fields.is_empty() {
                return plan_err!("struct must have at least one field");
            }
            for field in fields {
                let data_type = try_map_data_type(field.field_type.to_string().as_str())?;
                let field = Field::new(
                    field
                        .field_name
                        .map(|f| f.to_string())
                        .unwrap_or_else(|| format!("c{counter}")),
                    data_type,
                    true,
                );
                counter += 1;
                builder.push(field);
            }
        }
        _ => {
            unreachable!()
        }
    }
    let fields = builder.finish().fields;
    Ok(DataType::Struct(fields))
}

fn parse_type(struct_type: &str) -> Result<ast::DataType> {
    let dialect = GenericDialect {};
    Ok(Parser::new(&dialect)
        .try_with_sql(struct_type)?
        .parse_data_type()?)
}

/// Map the data type from the string to the Arrow data type
/// If the data type is not supported, it will return Utf8
pub fn try_map_data_type(data_type: &str) -> Result<DataType> {
    Ok(map_data_type(data_type).ok().unwrap_or_else(|| {
        debug!("can't parse data type {data_type}, return Utf8");
        DataType::Utf8
    }))
}

pub fn map_data_type(data_type: &str) -> Result<DataType> {
    let lower = data_type.to_lowercase();
    let lower_data_type = lower.as_str();
    // TODO: try parse nested type by arrow
    // Currently, we don't care about the element type of the array or struct.
    // We only care about the array or struct itself.
    if lower_data_type.starts_with("array") || lower_data_type.starts_with("list") {
        return create_list_type(lower_data_type);
    }
    if lower_data_type.starts_with("struct") {
        return create_struct_type(lower_data_type);
    }
    let result = match lower_data_type {
        // Wren Definition Types
        "bool" | "boolean" => DataType::Boolean,
        "tinyint" => DataType::Int8,
        "utinyint" => DataType::UInt8,
        "int2" => DataType::Int16,
        "smallint" => DataType::Int16,
        "usmallint" => DataType::UInt16,
        "int4" => DataType::Int32,
        "int" => DataType::Int32,
        "integer" => DataType::Int32,
        "uinteger" => DataType::UInt32,
        "int8" => DataType::Int64,
        "bigint" => DataType::Int64,
        "ubigint" => DataType::UInt64,
        "numeric" => DataType::Decimal128(38, 10), // set the default precision and scale
        "decimal" => DataType::Decimal128(38, 10),
        "varchar" => DataType::Utf8,
        "char" => DataType::Utf8,
        "bpchar" => DataType::Utf8, // we don't have a BPCHAR type, so we map it to Utf8
        "text" => DataType::Utf8,
        "string" => DataType::Utf8,
        "name" => DataType::Utf8,
        "float4" => DataType::Float32,
        "real" => DataType::Float32,
        "float" => DataType::Float32,
        "float8" => DataType::Float64,
        "double" => DataType::Float64,
        "timestamp" | "datetime" => DataType::Timestamp(TimeUnit::Nanosecond, None), // chose the smallest time unit
        "timestamptz"
        | "timestamp_with_timezone"
        | "timestamp_with_time_zone"
        | "timestamp with time zone"
        | "time with time zone" => {
            // time with time zone isn't equal to timestamp with time zone but
            // we don't have a time with time zone type, so we map it to timestamp with time zone
            DataType::Timestamp(TimeUnit::Nanosecond, Some("UTC".into()))
        }
        "date" => DataType::Date32,
        "interval" => DataType::Interval(IntervalUnit::DayTime),
        "json" => DataType::Utf8, // we don't have a JSON type, so we map it to Utf8
        "xml" => DataType::Utf8,  // we don't have a XML type, so we map it to Utf8
        "jsonb" => DataType::Binary, // we don't have a JSONB type, so we map it to Binary
        "oid" => DataType::Int32,
        "bytea" => DataType::Binary,
        "uuid" => DataType::Utf8, // we don't have a UUID type, so we map it to Utf8
        "inet" => DataType::Utf8, // we don't have a INET type, so we map it to Utf8
        "unknown" => DataType::Utf8, // we don't have a UNKNOWN type, so we map it to Utf8
        // BigQuery Compatible Types
        "bignumeric" => DataType::Decimal128(38, 10), // set the default precision and scale
        "bytes" => DataType::Binary,
        "binary" => DataType::Binary,
        "float64" => DataType::Float64,
        "int64" => DataType::Int64,
        "time" => DataType::Time32(TimeUnit::Nanosecond), // chose the smallest time unit
        "null" => DataType::Null,
        // Trino Compatible Types
        "varbinary" => DataType::Binary,
        // ClickHouse Compatible Types
        "datetime64" => DataType::Timestamp(TimeUnit::Nanosecond, None),
        "datetime32" => DataType::Timestamp(TimeUnit::Second, None),
        "date32" => DataType::Date32,
        "uint8" => DataType::UInt8,
        "uint16" => DataType::UInt16,
        "uint32" => DataType::UInt32,
        "uint64" => DataType::UInt64,
        "int16" => DataType::Int16,
        "int32" => DataType::Int32,
        // DuckDB Compatible Types
        "blob" => DataType::Binary,
        "hugeint" => DataType::Int64, // we don't have a HUGEINT type, so we map it to Int64
        "uhugeint" => DataType::UInt64, // we don't have a UHUINT type, so we map it to UInt64
        "bit" => DataType::Boolean, // we don't have a BIT type, so we map it to Boolean
        "timestamp_ns" => DataType::Timestamp(TimeUnit::Nanosecond, None),
        "any" => DataType::Utf8, // we don't have an ANY type, so we map it to Utf8
        _ => {
            debug!("try parse by arrow {lower_data_type}");
            // the from_str is case sensitive, so we need to use the original string
            DataType::from_str(data_type)?
        }
    };
    Ok(result)
}

pub fn get_coercion_type_signature(data_type: &DataType) -> Result<Coercion> {
    match data_type {
        DataType::Boolean => Ok(Coercion::new_exact(TypeSignatureClass::Native(
            logical_boolean(),
        ))),
        DataType::Int8
        | DataType::Int16
        | DataType::Int32
        | DataType::Int64
        | DataType::UInt8
        | DataType::UInt16
        | DataType::UInt32
        | DataType::UInt64 => Ok(Coercion::new_exact(TypeSignatureClass::Integer)),
        DataType::Timestamp(_, _) => {
            Ok(Coercion::new_exact(TypeSignatureClass::Timestamp))
        }
        DataType::Time32(_) | DataType::Time64(_) => {
            Ok(Coercion::new_exact(TypeSignatureClass::Time))
        }
        DataType::Duration(_) => Ok(Coercion::new_exact(TypeSignatureClass::Duration)),
        DataType::Interval(_) => Ok(Coercion::new_exact(TypeSignatureClass::Interval)),
        DataType::Binary | DataType::BinaryView | DataType::LargeBinary => Ok(
            Coercion::new_exact(TypeSignatureClass::Native(logical_binary())),
        ),
        DataType::Utf8 | DataType::LargeUtf8 | DataType::Utf8View => Ok(
            Coercion::new_exact(TypeSignatureClass::Native(logical_string())),
        ),
        DataType::Date32 | DataType::Date64 => Ok(Coercion::new_exact(
            TypeSignatureClass::Native(logical_date()),
        )),
        DataType::Float16 => Ok(Coercion::new_exact(TypeSignatureClass::Native(
            logical_float16(),
        ))),
        DataType::Float32 => Ok(Coercion::new_exact(TypeSignatureClass::Native(
            logical_float32(),
        ))),
        DataType::Float64 => Ok(Coercion::new_exact(TypeSignatureClass::Native(
            logical_float64(),
        ))),
        _ => plan_err!("Unsupported data type for coercion: {data_type}"),
    }
}

pub fn create_schema(columns: Vec<Arc<Column>>) -> Result<SchemaRef> {
    let fields: Vec<Field> = columns
        .iter()
        .map(|column| {
            let data_type = try_map_data_type(&column.r#type)?;
            Ok(Field::new(&column.name, data_type, column.not_null))
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(SchemaRef::new(Schema::new_with_metadata(
        fields,
        HashMap::new(),
    )))
}

pub fn create_df_schema(model: &Model) -> Result<DFSchemaRef> {
    let fields: Vec<_> = model
        .get_physical_columns(false)
        .iter()
        .map(|col| {
            Ok((
                Some(TableReference::bare(model.name())),
                Arc::new(Field::new(
                    col.name(),
                    try_map_data_type(&col.r#type)?,
                    col.not_null,
                )),
            ))
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(Arc::new(DFSchema::new_with_metadata(
        fields,
        HashMap::new(),
    )?))
}

pub fn create_remote_table_source(
    model: Arc<Model>,
    mdl: &WrenMDL,
    session_state_ref: SessionStateRef,
) -> Result<Arc<dyn TableSource>> {
    let key = model.table_reference().unwrap_or_else(|| model.name());
    if let Some(table_provider) = mdl.get_table(key) {
        Ok(Arc::new(DefaultTableSource::new(table_provider)))
    } else {
        let dataset = Dataset::Model(model);
        let schema = dataset
            .to_remote_schema(Some(mdl.get_register_tables()), session_state_ref)?;
        Ok(Arc::new(LogicalTableSource::new(Arc::new(
            schema.as_arrow().clone(),
        ))))
    }
}

pub fn format_qualified_name(
    catalog: &str,
    schema: &str,
    dataset: &str,
    column: &str,
) -> String {
    format!(
        "{}.{}.{}.{}",
        quoted(catalog),
        quoted(schema),
        quoted(dataset),
        quoted(column)
    )
}

pub fn from_qualified_name(
    wren_mdl: &WrenMDL,
    dataset: &str,
    column: &str,
) -> datafusion::common::Column {
    from_qualified_name_str(wren_mdl.catalog(), wren_mdl.schema(), dataset, column)
}

pub fn from_qualified_name_str(
    catalog: &str,
    schema: &str,
    dataset: &str,
    column: &str,
) -> datafusion::common::Column {
    datafusion::common::Column::from_qualified_name(format_qualified_name(
        catalog, schema, dataset, column,
    ))
}

/// Use to print the graph for debugging purposes
pub fn print_graph(graph: &Graph<Dataset, DatasetLink>) {
    let dot = Dot::with_config(graph, &[Config::EdgeNoLabel]);
    println!("graph: {dot:?}");
}

/// Check if the table reference belongs to the mdl
pub fn belong_to_mdl(
    mdl: &WrenMDL,
    table_reference: TableReference,
    session: SessionStateRef,
) -> bool {
    let session = session.read();
    let catalog = table_reference
        .catalog()
        .unwrap_or(&session.config_options().catalog.default_catalog);
    let catalog_match = catalog == mdl.catalog();

    let schema = table_reference
        .schema()
        .unwrap_or(&session.config_options().catalog.default_schema);
    let schema_match = schema == mdl.schema();

    catalog_match && schema_match
}

/// Collect all the Columns and OuterReferenceColumns in the expression
pub fn expr_to_columns(
    expr: &Expr,
    accum: &mut HashSet<datafusion::common::Column>,
) -> Result<()> {
    expr.apply(|expr| {
        // TODO: remove deprecated wildcard
        #[allow(deprecated)]
        match expr {
            Expr::Column(qc) => {
                accum.insert(qc.clone());
            }
            Expr::OuterReferenceColumn(_, column) => {
                accum.insert(column.clone());
            }
            // Use explicit pattern match instead of a default
            // implementation, so that in the future if someone adds
            // new Expr types, they will check here as well
            Expr::Unnest(_)
            | Expr::ScalarVariable(_, _)
            | Expr::Alias(_)
            | Expr::Literal(_, _)
            | Expr::BinaryExpr { .. }
            | Expr::Like { .. }
            | Expr::SimilarTo { .. }
            | Expr::Not(_)
            | Expr::IsNotNull(_)
            | Expr::IsNull(_)
            | Expr::IsTrue(_)
            | Expr::IsFalse(_)
            | Expr::IsUnknown(_)
            | Expr::IsNotTrue(_)
            | Expr::IsNotFalse(_)
            | Expr::IsNotUnknown(_)
            | Expr::Negative(_)
            | Expr::Between { .. }
            | Expr::Case { .. }
            | Expr::Cast { .. }
            | Expr::TryCast { .. }
            | Expr::ScalarFunction(..)
            | Expr::WindowFunction { .. }
            | Expr::AggregateFunction { .. }
            | Expr::GroupingSet(_)
            | Expr::InList { .. }
            | Expr::Exists { .. }
            | Expr::InSubquery(_)
            | Expr::ScalarSubquery(_)
            | Expr::Wildcard { .. }
            | Expr::Placeholder(_) => {}
            Expr::SetComparison(_) => {}
        }
        Ok(TreeNodeRecursion::Continue)
    })
    .map(|_| ())
}

/// Rebase the column reference to the new base reference
///
/// e.g. `a.b` with base_reference `c` will be transformed to `c.b`
pub fn rebase_column(expr: &Expr, base_reference: &str) -> Result<Expr> {
    expr.clone()
        .transform_down(|expr| {
            if let Expr::Column(datafusion::common::Column { name, .. }) = expr {
                let rewritten = Expr::Column(datafusion::common::Column::new(
                    Some(base_reference),
                    name,
                ));
                Ok(Transformed::yes(rewritten))
            } else {
                Ok(Transformed::no(expr))
            }
        })
        .data()
}

/// Eliminate the ambiguous columns in the expressions. If there are columns with the same name,
/// only the first one will be kept.
pub fn eliminate_ambiguous_columns(expr: Vec<Expr>) -> Vec<Expr> {
    let mut columns = BTreeMap::new();
    for e in expr {
        match e {
            Expr::Column(c) => {
                columns.insert(c.name.clone(), Expr::Column(c));
            }
            _ => {
                columns.insert(e.clone().schema_name().to_string(), e);
            }
        }
    }
    columns.into_values().collect()
}

#[cfg(test)]
mod test {
    use crate::logical_plan::utils::{
        create_list_type, create_struct_type, try_map_data_type,
    };
    use datafusion::arrow::datatypes::{DataType, Field, Fields, IntervalUnit, TimeUnit};
    use datafusion::common::Result;

    #[test]
    pub fn test_map_data_type() -> Result<()> {
        let test_cases = vec![
            ("bool", DataType::Boolean),
            ("boolean", DataType::Boolean),
            ("tinyint", DataType::Int8),
            ("int2", DataType::Int16),
            ("smallint", DataType::Int16),
            ("int4", DataType::Int32),
            ("integer", DataType::Int32),
            ("int8", DataType::Int64),
            ("bigint", DataType::Int64),
            ("numeric", DataType::Decimal128(38, 10)),
            ("decimal", DataType::Decimal128(38, 10)),
            ("varchar", DataType::Utf8),
            ("char", DataType::Utf8),
            ("bpchar", DataType::Utf8),
            ("text", DataType::Utf8),
            ("string", DataType::Utf8),
            ("name", DataType::Utf8),
            ("float4", DataType::Float32),
            ("real", DataType::Float32),
            ("float8", DataType::Float64),
            ("double", DataType::Float64),
            ("timestamp", DataType::Timestamp(TimeUnit::Nanosecond, None)),
            (
                "timestamptz",
                DataType::Timestamp(TimeUnit::Nanosecond, Some("UTC".into())),
            ),
            (
                "timestamp_with_timezone",
                DataType::Timestamp(TimeUnit::Nanosecond, Some("UTC".into())),
            ),
            (
                "timestamp_with_time_zone",
                DataType::Timestamp(TimeUnit::Nanosecond, Some("UTC".into())),
            ),
            ("date", DataType::Date32),
            ("interval", DataType::Interval(IntervalUnit::DayTime)),
            ("json", DataType::Utf8),
            ("oid", DataType::Int32),
            ("bytea", DataType::Binary),
            ("uuid", DataType::Utf8),
            ("inet", DataType::Utf8),
            ("unknown", DataType::Utf8),
            ("bignumeric", DataType::Decimal128(38, 10)),
            ("bytes", DataType::Binary),
            ("datetime", DataType::Timestamp(TimeUnit::Nanosecond, None)),
            ("float64", DataType::Float64),
            ("int64", DataType::Int64),
            ("time", DataType::Time32(TimeUnit::Nanosecond)),
            ("null", DataType::Null),
            ("geography", DataType::Utf8),
            ("range", DataType::Utf8),
            ("array", create_list_type("array<varchar>")?),
            ("array<int64>", create_list_type("array<int64>")?),
            (
                "struct<name string, age int>",
                create_struct_type("struct<name string, age int>")?,
            ),
        ];
        for (data_type, expected) in test_cases {
            let result = try_map_data_type(data_type)?;
            assert_eq!(result, expected);
            // test case insensitivity
            let result = try_map_data_type(&data_type.to_uppercase())?;
            assert_eq!(result, expected);
        }

        let _ = try_map_data_type("array").map_err(|e| {
            assert_eq!(
                e.to_string(),
                "SQL error: ParserError(\"Expected: <, found: EOF\")"
            );
        });

        let _ = try_map_data_type("array<>").map_err(|e| {
            assert_eq!(
                e.to_string(),
                "SQL error: ParserError(\"Expected: <, found: <> at Line: 1, Column: 6\")"
            );
        });

        let _ = try_map_data_type("array(int64)").map_err(|e| {
            assert_eq!(
                e.to_string(),
                "SQL error: ParserError(\"Expected: <, found: ( at Line: 1, Column: 6\")"
            );
        });

        let _ = try_map_data_type("struct").map_err(|e| {
            assert_eq!(
                e.to_string(),
                "Error during planning: struct must have at least one field"
            );
        });

        Ok(())
    }

    #[test]
    fn test_parse_struct() -> Result<()> {
        let struct_string = "STRUCT<name VARCHAR, age INT>";
        let result = create_struct_type(struct_string)?;
        let fields: Fields = vec![
            Field::new("name", DataType::Utf8, true),
            Field::new("age", DataType::Int32, true),
        ]
        .into();
        let expected = DataType::Struct(fields);
        assert_eq!(result, expected);

        let struct_string = "STRUCT<VARCHAR, INT>";
        let result = create_struct_type(struct_string)?;
        let fields: Fields = vec![
            Field::new("c0", DataType::Utf8, true),
            Field::new("c1", DataType::Int32, true),
        ]
        .into();
        let expected = DataType::Struct(fields);
        assert_eq!(result, expected);
        let struct_string = "STRUCT<>";
        let _ = create_struct_type(struct_string).map_err(|e| {
            assert_eq!(
                e.to_string(),
                "Error during planning: struct must have at least one field"
            )
        });
        Ok(())
    }
}
