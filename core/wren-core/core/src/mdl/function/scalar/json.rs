//! Snowflake has a mature set of functions for working with semi-structured data.
//! We follow their lead in naming and behavior for these functions.

use datafusion::{
    arrow::datatypes::DataType,
    common::types::logical_string,
    logical_expr::{Coercion, Signature, TypeSignatureClass},
};

use crate::{
    make_udf_function,
    mdl::function::{utils::build_document, ByPassScalarUDF, ReturnType},
};

make_udf_function!(
    ByPassScalarUDF::new(
        "get_path",
        ReturnType::Specific(DataType::Utf8),
        Signature::coercible(
            vec![
                Coercion::new_exact(TypeSignatureClass::Native(logical_string())),
                Coercion::new_exact(TypeSignatureClass::Native(logical_string())),
            ],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document(
            "Extracts a value from semi-structured data using a path name.",
            "select get_path(parse_json('{\"a\": {\"b\": 1}}'), '$.a.b')"
        ))
    ),
    get_path
);

make_udf_function!(
    ByPassScalarUDF::new(
        "as_array",
        ReturnType::ArrayOfInputFirstArgument,
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(
                logical_string()
            ))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document(
            "Cast a json, variant or object to array",
            "select as_array(get_path(parse_json('{\"a\": [1, 2, 3]}'), '$.a'))"
        )),
    ),
    as_array
);

make_udf_function!(
    ByPassScalarUDF::new(
        "as_binary",
        ReturnType::Specific(DataType::Binary),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(
                logical_string()
            ))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document(
            "Cast a json, variant or object to binary",
            "select as_binary(get_path(parse_json('{\"a\": \"hello\"}'), '$.a'))"
        )),
    ),
    as_binary
);

make_udf_function!(
    ByPassScalarUDF::new(
        "as_boolean",
        ReturnType::Specific(DataType::Boolean),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(
                logical_string()
            ))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document(
            "Cast a json, variant or object to boolean",
            "select as_boolean(get_path(parse_json('{\"a\": true}'), '$.a'))"
        )),
    ),
    as_boolean
);

make_udf_function!(
    ByPassScalarUDF::new(
        "as_char",
        ReturnType::Specific(DataType::Utf8),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(
                logical_string()
            ))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document(
            "Cast a json, variant or object to char",
            "select as_char(get_path(parse_json('{\"a\": \"hello\"}'), '$.a'))"
        )),
    ),
    as_char
);

make_udf_function!(
    ByPassScalarUDF::new(
        "as_varchar",
        ReturnType::Specific(DataType::Utf8),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(
                logical_string()
            ))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document(
            "Cast a json, variant or object to varchar",
            "select as_varchar(get_path(parse_json('{\"a\": \"hello\"}'), '$.a'))"
        )),
    ),
    as_varchar
);

make_udf_function!(
    ByPassScalarUDF::new(
        "as_date",
        ReturnType::Specific(DataType::Date32),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(
                logical_string()
            ))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document(
            "Cast a json, variant or object to date",
            "select as_date(get_path(parse_json('{\"a\": \"2023-01-01\"}'), '$.a'))"
        )),
    ),
    as_date
);

make_udf_function!(
    ByPassScalarUDF::new(
        "as_decimal",
        ReturnType::Specific(DataType::Decimal128(38, 10)),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(
                logical_string()
            ))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document(
            "Cast a json, variant or object to decimal",
            "select as_decimal(get_path(parse_json('{\"a\": 123.45}'), '$.a'))"
        )),
    ),
    as_decimal
);

make_udf_function!(
    ByPassScalarUDF::new(
        "as_number",
        ReturnType::Specific(DataType::Float64),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(
                logical_string()
            ))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document(
            "Cast a json, variant or object to number",
            "select as_number(get_path(parse_json('{\"a\": 123.45}'), '$.a'))"
        )),
    ),
    as_number
);

make_udf_function!(
    ByPassScalarUDF::new(
        "as_double",
        ReturnType::Specific(DataType::Float64),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(
                logical_string()
            ))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document(
            "Cast a json, variant or object to double",
            "select as_double(get_path(parse_json('{\"a\": 123.45}'), '$.a'))"
        )),
    ),
    as_double
);

make_udf_function!(
    ByPassScalarUDF::new(
        "as_real",
        ReturnType::Specific(DataType::Float32),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(
                logical_string()
            ))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document(
            "Cast a json, variant or object to real",
            "select as_real(get_path(parse_json('{\"a\": 123.45}'), '$.a'))"
        )),
    ),
    as_real
);

make_udf_function!(
    ByPassScalarUDF::new(
        "as_integer",
        ReturnType::Specific(DataType::Int64),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(
                logical_string()
            ))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document(
            "Cast a json, variant or object to integer",
            "select as_integer(get_path(parse_json('{\"a\": 123}'), '$.a'))"
        )),
    ),
    as_integer
);

make_udf_function!(
    ByPassScalarUDF::new(
        "as_object",
        ReturnType::Specific(DataType::Utf8),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(
                logical_string()
            ))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document(
            "Cast a json, variant or object to object",
            "select as_object(get_path(parse_json('{\"a\": {\"b\": 1}}'), '$.a'))"
        )),
    ),
    as_object
);

make_udf_function!(
    ByPassScalarUDF::new(
        "as_time",
        ReturnType::Specific(DataType::Time32(
            datafusion::arrow::datatypes::TimeUnit::Millisecond
        )),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(
                logical_string()
            ))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document(
            "Cast a json, variant or object to time",
            "select as_time(get_path(parse_json('{\"a\": \"12:34:56\"}'), '$.a'))"
        )),
    ),
    as_time
);

make_udf_function!(
    ByPassScalarUDF::new(
        "as_timestamp",
        ReturnType::Specific(DataType::Timestamp(datafusion::arrow::datatypes::TimeUnit::Microsecond, None)),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(logical_string()))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document("Cast a json, variant or object to timestamp", "select as_timestamp(get_path(parse_json('{\"a\": \"2023-01-01 12:34:56\"}'), '$.a'))")),
    ),
    as_timestamp
);

make_udf_function!(
    ByPassScalarUDF::new(
        "as_timestamp_tz",
        ReturnType::Specific(DataType::Timestamp(datafusion::arrow::datatypes::TimeUnit::Microsecond, Some("UTC".into()))),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(logical_string()))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document("Cast a json, variant or object to timestamp with time zone", "select as_timestamp_tz(get_path(parse_json('{\"a\": \"2023-01-01 12:34:56+00:00\"}'), '$.a'))")),
    ),
    as_timestamp_tz
);

make_udf_function!(
    ByPassScalarUDF::new(
        "is_array",
        ReturnType::Specific(DataType::Boolean),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(
                logical_string()
            ))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document(
            "Check if a json, variant or object is an array",
            "select is_array(get_path(parse_json('{\"a\": [1, 2, 3]}'), '$.a'))"
        )),
    ),
    is_array
);

make_udf_function!(
    ByPassScalarUDF::new(
        "is_binary",
        ReturnType::Specific(DataType::Boolean),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(
                logical_string()
            ))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document(
            "Check if a json, variant or object is binary",
            "select is_binary(get_path(parse_json('{\"a\": \"hello\"}'), '$.a'))"
        )),
    ),
    is_binary
);

make_udf_function!(
    ByPassScalarUDF::new(
        "is_boolean",
        ReturnType::Specific(DataType::Boolean),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(
                logical_string()
            ))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document(
            "Check if a json, variant or object is boolean",
            "select is_boolean(get_path(parse_json('{\"a\": true}'), '$.a'))"
        )),
    ),
    is_boolean
);

make_udf_function!(
    ByPassScalarUDF::new(
        "is_char",
        ReturnType::Specific(DataType::Boolean),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(
                logical_string()
            ))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document(
            "Check if a json, variant or object is char",
            "select is_char(get_path(parse_json('{\"a\": \"hello\"}'), '$.a'))"
        )),
    ),
    is_char
);

make_udf_function!(
    ByPassScalarUDF::new(
        "is_varchar",
        ReturnType::Specific(DataType::Boolean),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(
                logical_string()
            ))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document(
            "Check if a json, variant or object is varchar",
            "select is_varchar(get_path(parse_json('{\"a\": \"hello\"}'), '$.a'))"
        )),
    ),
    is_varchar
);

make_udf_function!(
    ByPassScalarUDF::new(
        "is_date",
        ReturnType::Specific(DataType::Boolean),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(
                logical_string()
            ))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document(
            "Check if a json, variant or object is date",
            "select is_date(get_path(parse_json('{\"a\": \"2023-01-01\"}'), '$.a'))"
        )),
    ),
    is_date
);

make_udf_function!(
    ByPassScalarUDF::new(
        "is_double",
        ReturnType::Specific(DataType::Boolean),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(
                logical_string()
            ))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document(
            "Check if a json, variant or object is double",
            "select is_double(get_path(parse_json('{\"a\": 123.45}'), '$.a'))"
        )),
    ),
    is_double
);

make_udf_function!(
    ByPassScalarUDF::new(
        "is_real",
        ReturnType::Specific(DataType::Boolean),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(
                logical_string()
            ))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document(
            "Check if a json, variant or object is real",
            "select is_real(get_path(parse_json('{\"a\": 123.45}'), '$.a'))"
        )),
    ),
    is_real
);

make_udf_function!(
    ByPassScalarUDF::new(
        "is_integer",
        ReturnType::Specific(DataType::Boolean),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(
                logical_string()
            ))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document(
            "Check if a json, variant or object is integer",
            "select is_integer(get_path(parse_json('{\"a\": 123}'), '$.a'))"
        )),
    ),
    is_integer
);

make_udf_function!(
    ByPassScalarUDF::new(
        "is_null_value",
        ReturnType::Specific(DataType::Boolean),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(logical_string()))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document("Check if a json, variant or object is null. Note that this function is used to check a null value in JSON but it doesn't equate to SQL NULL",
        "select is_null_value(get_path(parse_json('{\"a\": null}'), '$.a'))")),
    ),
    is_null_value
);

make_udf_function!(
    ByPassScalarUDF::new(
        "is_object",
        ReturnType::Specific(DataType::Boolean),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(
                logical_string()
            ))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document(
            "Check if a json, variant or object is an object",
            "select is_object(get_path(parse_json('{\"a\": {\"b\": 1}}'), '$.a'))"
        )),
    ),
    is_object
);

make_udf_function!(
    ByPassScalarUDF::new(
        "is_time",
        ReturnType::Specific(DataType::Boolean),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(
                logical_string()
            ))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document(
            "Check if a json, variant or object is time",
            "select is_time(get_path(parse_json('{\"a\": \"12:34:56\"}'), '$.a'))"
        )),
    ),
    is_time
);

make_udf_function!(
    ByPassScalarUDF::new(
        "is_timestamp",
        ReturnType::Specific(DataType::Boolean),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(logical_string()))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document("Check if a json, variant or object is timestamp", "select is_timestamp(get_path(parse_json('{\"a\": \"2023-01-01 12:34:56\"}'), '$.a'))")),
    ),
    is_timestamp
);

make_udf_function!(
    ByPassScalarUDF::new(
        "is_timestamp_tz",
        ReturnType::Specific(DataType::Boolean),
        Signature::coercible(
            vec![Coercion::new_exact(TypeSignatureClass::Native(logical_string()))],
            datafusion::logical_expr::Volatility::Immutable,
        ),
        Some(build_document("Check if a json, variant or object is timestamp with time zone", "select is_timestamp_tz(get_path(parse_json('{\"a\": \"2023-01-01 12:34:56+00:00\"}'), '$.a'))")),
    ),
    is_timestamp_tz
);
