use std::sync::Arc;

use datafusion::{
    arrow::datatypes::{DataType, Field, Fields},
    common::types::logical_boolean,
    logical_expr::{Coercion, Signature, TypeSignature, TypeSignatureClass, Volatility},
};

use crate::{
    make_udaf_function,
    mdl::function::{ByPassAggregateUDF, ReturnType},
};

use crate::mdl::function::utils::build_document;

make_udaf_function!(
    ByPassAggregateUDF::new(
        "any_value",
        ReturnType::SameAsInput,
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Gets an expression for some row.",
            "SELECT ANY_VALUE(column_name) FROM table;"
        )),
    ),
    any_value
);

make_udaf_function!(
    ByPassAggregateUDF::new(
        "approx_count_distinct",
        ReturnType::Specific(DataType::Int64),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Gets the approximate result for COUNT(DISTINCT expression).",
            "SELECT APPROX_COUNT_DISTINCT(column_name) FROM table;"
        )),
    ),
    approx_count_distinct
);

make_udaf_function!(
    ByPassAggregateUDF::new(
        "approx_quantiles",
        ReturnType::ArrayOfInputFirstArgument,
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Gets the approximate quantile boundaries.",
            "SELECT APPROX_QUANTILES(column_name, 100) FROM table;"
        )),
    ),
    approx_quantiles
);

make_udaf_function!(
    ByPassAggregateUDF::new(
        "approx_top_count",
        ReturnType::Specific(DataType::List(Arc::new(Field::new(
            "item",
            DataType::Struct(Fields::from(vec![
                Field::new("value", DataType::Utf8, true),
                Field::new("count", DataType::Int64, true),
            ])),
            true,
        )))),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Gets the approximate top elements and their approximate count.",
            "SELECT APPROX_TOP_COUNT(column_name, 10) FROM table;"
        )),
    ),
    approx_top_count
);

make_udaf_function!(
    ByPassAggregateUDF::new(
        "approx_top_sum",
        ReturnType::Specific(DataType::List(Arc::new(Field::new(
            "item",
            DataType::Struct(Fields::from(vec![
                Field::new("value", DataType::Utf8, true),
                Field::new("sum", DataType::Float64, true),
            ])),
            true,
        )))),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Gets the approximate top elements and their approximate sum.",
            "SELECT APPROX_TOP_SUM(column_name, 10) FROM table;"
        )),
    ),
    approx_top_sum
);

make_udaf_function!(
    ByPassAggregateUDF::new(
        "array_concat_agg",
        ReturnType::SameAsInput,
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Concatenates all input arrays into a single array.",
            "SELECT ARRAY_CONCAT_AGG(column_name) FROM table;"
        )),
    ),
    array_concat_agg
);

make_udaf_function!(
    ByPassAggregateUDF::new_with_alias(
        "countif",
        ReturnType::Specific(DataType::Int64),
        Signature::any(1, Volatility::Immutable),
        vec!["count_if".to_string()],
        Some(build_document(
            "Counts the number of input rows for which the given condition is true.",
            "SELECT COUNTIF(column_name > 10) FROM table;"
        )),
    ),
    countif
);

make_udaf_function!(
    ByPassAggregateUDF::new(
        "logical_and",
        ReturnType::Specific(DataType::Boolean),
        Signature::coercible(vec![Coercion::new_exact(TypeSignatureClass::Native(logical_boolean()))], Volatility::Immutable),
        Some(build_document(
            "Returns the logical AND of all non-NULL expressions. Returns NULL if there are zero input rows or expression evaluates to NULL for all rows.",
            "SELECT LOGICAL_AND(column_name) FROM table;"
        )),
    ),
    logical_and
);

make_udaf_function!(
    ByPassAggregateUDF::new(
        "logical_or",
        ReturnType::Specific(DataType::Boolean),
        Signature::coercible(vec![Coercion::new_exact(TypeSignatureClass::Native(logical_boolean()))], Volatility::Immutable),
        Some(build_document(
            "Returns the logical OR of all non-NULL expressions. Returns NULL if there are zero input rows or expression evaluates to NULL for all rows.",
            "SELECT LOGICAL_OR(column_name) FROM table;"
        )),
    ),
    logical_or
);

make_udaf_function!(
    ByPassAggregateUDF::new(
        "max_by",
        ReturnType::SameAsInput,
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Synonym for ANY_VALUE(x HAVING MAX y).",
            "SELECT MAX_BY(value_column, order_column) FROM table;"
        )),
    ),
    max_by
);

make_udaf_function!(
    ByPassAggregateUDF::new(
        "min_by",
        ReturnType::SameAsInput,
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Synonym for ANY_VALUE(x HAVING MIN y).",
            "SELECT MIN_BY(value_column, order_column) FROM table;"
        )),
    ),
    min_by
);

make_udaf_function!(
    ByPassAggregateUDF::new(
        "stddev_samp",
        ReturnType::Specific(DataType::Float64),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Calculates the sample standard deviation of a set of values.",
            "SELECT STDDEV_SAMP(column_name) FROM table;"
        )),
    ),
    stddev_samp
);

make_udaf_function!(
    ByPassAggregateUDF::new(
        "variance",
        ReturnType::Specific(DataType::Float64),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Calculates the variance of a set of values.",
            "SELECT VARIANCE(column_name) FROM table;"
        )),
    ),
    variance
);

make_udaf_function!(
    ByPassAggregateUDF::new(
        "group_concat",
        ReturnType::Specific(DataType::Utf8),
        Signature::one_of(vec![TypeSignature::Any(1), TypeSignature::Any(2)], Volatility::Immutable),
        Some(build_document(
            "(DEPRECATED)(BigQuery Legacy SQL)Concatenates values from a group into a single string with a specified separator.",
            "SELECT GROUP_CONCAT(column_name, ', ') FROM table;"
        )),
    ),
    group_concat
);
