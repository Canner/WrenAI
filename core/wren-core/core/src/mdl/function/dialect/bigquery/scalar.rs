use std::sync::Arc;

use datafusion::{
    arrow::datatypes::{DataType, Field},
    common::types::{logical_binary, logical_string},
    logical_expr::{Coercion, Signature, TypeSignature, Volatility},
};

use crate::{
    make_udf_function,
    mdl::function::{ByPassScalarUDF, ReturnType},
};

use crate::mdl::function::utils::build_document;

make_udf_function!(
    ByPassScalarUDF::new(
        "array_first",
        ReturnType::SameAsInputFirstArrayElement,
        Signature::array(Volatility::Immutable),
        Some(build_document(
            "Returns the first element of the array.",
            "SELECT ARRAY_FIRST([1, 2, 3]); -- returns 1"
        )),
    ),
    array_first
);

make_udf_function!(
    ByPassScalarUDF::new(
        "array_last",
        ReturnType::SameAsInputFirstArrayElement,
        Signature::array(Volatility::Immutable),
        Some(build_document(
            "Returns the last element of the array.",
            "SELECT ARRAY_LAST([1, 2, 3]); -- returns 3"
        )),
    ),
    array_last
);

make_udf_function!(
    ByPassScalarUDF::new(
        "generate_array",
        ReturnType::ArrayOfInputFirstArgument,
        Signature::one_of(
            vec![TypeSignature::Any(3), TypeSignature::Any(2),],
            Volatility::Immutable
        ),
        Some(build_document(
            "Generates an array of values from start to end with an optional step.",
            "SELECT GENERATE_ARRAY(1, 5); -- returns [1, 2, 3, 4, 5]"
        )),
    ),
    generate_array
);

make_udf_function!(
    ByPassScalarUDF::new(
        "generate_date_array",
        ReturnType::ArrayOfInputFirstArgument,
        Signature::one_of(vec![
            TypeSignature::Any(3),
            TypeSignature::Any(2),
        ], Volatility::Immutable),
        Some(build_document(
            "Generates an array of dates from start to end with an optional step.",
            "SELECT GENERATE_DATE_ARRAY(DATE '2021-01-01', DATE '2021-01-05'); -- returns [2021-01-01, 2021-01-02, 2021-01-03, 2021-01-04, 2021-01-05]"
        )),
    ),
    generate_date_array
);

make_udf_function!(
    ByPassScalarUDF::new(
        "generate_timestamp_array",
        ReturnType::ArrayOfInputFirstArgument,
        Signature::one_of(vec![
            TypeSignature::Any(3),
        ], Volatility::Immutable),
        Some(build_document(
            "Returns an ARRAY of TIMESTAMPS separated by a given interval. The start_timestamp and end_timestamp parameters determine the inclusive lower and upper bounds of the ARRAY.",
            "SELECT GENERATE_TIMESTAMP_ARRAY('2016-10-05 00:00:00', '2016-10-07 00:00:00', INTERVAL 1 DAY) AS timestamp_array;"
        )),
    ),
    generate_timestamp_array
);

make_udf_function!(
    ByPassScalarUDF::new(
        "bit_count",
        ReturnType::Specific(DataType::Int64),
        Signature::one_of(vec![
            TypeSignature::Coercible(vec![Coercion::new_exact(
            datafusion::logical_expr::TypeSignatureClass::Integer,
        )]),
        TypeSignature::Coercible(vec![Coercion::new_exact(
            datafusion::logical_expr::TypeSignatureClass::Native(logical_binary()),
        )]),
        ], Volatility::Immutable),
        Some(build_document(
            "Returns the number of bits set to 1 in the binary representation of the input integer.",
            "SELECT BIT_COUNT(29); -- returns 4, since 29 in binary is 11101"
        )),
    ),
    bit_count
);

make_udf_function!(
    ByPassScalarUDF::new(
        "parse_bignumeric",
        ReturnType::Specific(DataType::Decimal128(38, 9)),
        Signature::coercible(
            vec![Coercion::new_exact(
                datafusion::logical_expr::TypeSignatureClass::Native(logical_string()),
            )],
            Volatility::Immutable,
        ),
        Some(build_document(
            "Parses a string and returns a BIGNUMERIC value.",
            "SELECT PARSE_BIGNUMERIC('1234567890.123456789'); -- returns 1234567890.123456789"
        )),
    ),
    parse_bignumeric
);

make_udf_function!(
    ByPassScalarUDF::new(
        "parse_numeric",
        ReturnType::Specific(DataType::Decimal128(38, 9)),
        Signature::coercible(
            vec![Coercion::new_exact(
                datafusion::logical_expr::TypeSignatureClass::Native(logical_string()),
            )],
            Volatility::Immutable,
        ),
        Some(build_document(
            "Parses a string and returns a NUMERIC value.",
            "SELECT PARSE_NUMERIC('12345.6789'); -- returns 12345.6789"
        )),
    ),
    parse_numeric
);

make_udf_function!(
    ByPassScalarUDF::new(
        "date",
        ReturnType::Specific(DataType::Date32),
        Signature::one_of(
            vec![TypeSignature::Any(1), TypeSignature::Any(2),],
            Volatility::Immutable,
        ),
        Some(build_document(
            "Extracts the date part from a timestamp or string.",
            "SELECT DATE('2021-10-05 12:34:56'); -- returns 2021-10-05"
        )),
    ),
    date
);

make_udf_function!(
    ByPassScalarUDF::new(
        "date_add",
        ReturnType::Specific(DataType::Date32),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Adds a specified interval to a date.",
            "SELECT DATE_ADD(DATE '2021-01-01', INTERVAL 5 DAY); -- returns 2021-01-06"
        )),
    ),
    date_add
);

make_udf_function!(
    ByPassScalarUDF::new(
        "date_diff",
        ReturnType::Specific(DataType::Int64),
        Signature::any(3, Volatility::Immutable),
        Some(build_document(
            "Returns the number of date part boundaries between two date expressions.",
            "SELECT DATE_DIFF('DAY', DATE '2021-01-10', DATE '2021-01-01'); -- returns 9"
        )),
    ),
    date_diff
);

make_udf_function!(
    ByPassScalarUDF::new(
        "date_from_unix_date",
        ReturnType::Specific(DataType::Date32),
        Signature::coercible(
            vec![Coercion::new_exact(
                datafusion::logical_expr::TypeSignatureClass::Integer
            ),],
            Volatility::Immutable,
        ),
        Some(build_document(
            "Converts a Unix date (number of days since 1970-01-01) to a DATE.",
            "SELECT DATE_FROM_UNIX_DATE(18628); -- returns 2021-01-01"
        )),
    ),
    date_from_unix_date
);

make_udf_function!(
    ByPassScalarUDF::new(
        "date_sub",
        ReturnType::Specific(DataType::Date32),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Subtracts a specified interval from a date.",
            "SELECT DATE_SUB(DATE '2021-01-10', INTERVAL 5 DAY); -- returns 2021-01-05"
        )),
    ),
    date_sub
);

make_udf_function!(
    ByPassScalarUDF::new(
        "format_date",
        ReturnType::Specific(DataType::Utf8),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Formats a DATE according to the specified format string.",
            "SELECT FORMAT_DATE('%Y-%m-%d', DATE '2021-01-05'); -- returns '2021-01-05'"
        )),
    ),
    format_date
);

make_udf_function!(
    ByPassScalarUDF::new(
        "parse_date",
        ReturnType::Specific(DataType::Date32),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Parses a string into a DATE according to the specified format string.",
            "SELECT PARSE_DATE('%Y-%m-%d', '2021-01-05'); -- returns 2021-01-05"
        )),
    ),
    parse_date
);

make_udf_function!(
    ByPassScalarUDF::new(
        "unix_date",
        ReturnType::Specific(DataType::Int32),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Converts a DATE to a Unix date (number of days since 1970-01-01).",
            "SELECT UNIX_DATE(DATE '2021-01-01'); -- returns 18628"
        )),
    ),
    unix_date
);

make_udf_function!(
    ByPassScalarUDF::new(
        "farm_fingerprint",
        ReturnType::Specific(DataType::Int64),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Computes a fingerprint for a string.",
            "SELECT FARM_FINGERPRINT('Hello, world!'); -- returns a 64-bit integer"
        )),
    ),
    farm_fingerprint
);

make_udf_function!(
    ByPassScalarUDF::new(
        "sha1",
        ReturnType::Specific(DataType::Utf8),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Computes the SHA-1 hash of a string.",
            "SELECT SHA1('Hello, world!'); -- returns '2ef7bdecadad9f73dffb5fbdc4f1b3e6eed8c5'"
        )),
    ),
    sha1
);

make_udf_function!(
    ByPassScalarUDF::new(
        "justify_days",
        ReturnType::Specific(DataType::Interval(
            datafusion::arrow::datatypes::IntervalUnit::DayTime
        )),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Justifies a number of days.",
            "SELECT JUSTIFY_DAYS(5); -- returns INTERVAL '5' DAY"
        )),
    ),
    justify_days
);

make_udf_function!(
    ByPassScalarUDF::new(
        "justify_hours",
        ReturnType::Specific(DataType::Interval(
            datafusion::arrow::datatypes::IntervalUnit::DayTime
        )),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Justifies a number of hours.",
            "SELECT JUSTIFY_HOURS(48); -- returns INTERVAL '2' DAY"
        )),
    ),
    justify_hours
);

make_udf_function!(
    ByPassScalarUDF::new(
        "justify_interval",
        ReturnType::Specific(DataType::Interval(datafusion::arrow::datatypes::IntervalUnit::MonthDayNano)),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Justifies an interval.",
            "SELECT JUSTIFY_INTERVAL(INTERVAL '36' HOUR); -- returns INTERVAL '1' DAY '12' HOUR"
        )),
    ),
    justify_interval
);

make_udf_function!(
    ByPassScalarUDF::new(
        "ceiling",
        ReturnType::Specific(DataType::Float64),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Synonym of CEIL(X)",
            "SELECT CEILING(3.14); -- returns 4.0"
        )),
    ),
    ceiling
);

make_udf_function!(
    ByPassScalarUDF::new(
        "cosine_distance",
        ReturnType::Specific(DataType::Float64),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Computes the cosine distance between two vectors.",
            "SELECT COSINE_DISTANCE(ARRAY[1, 2, 3], ARRAY[4, 5, 6]); -- returns 0.9746318461970762"
        )),
    ),
    cosine_distance
);

make_udf_function!(
    ByPassScalarUDF::new(
        "coth",
        ReturnType::Specific(DataType::Float64),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Computes the hyperbolic cotangent of a number.",
            "SELECT COTH(1.0); -- returns 1.3130352854993312"
        )),
    ),
    coth
);

make_udf_function!(
    ByPassScalarUDF::new(
        "csc",
        ReturnType::Specific(DataType::Float64),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Computes the cosecant of the input angle, which is in radians.",
            "SELECT CSC(1.0); -- returns 1.8508157176809257"
        )),
    ),
    csc
);

make_udf_function!(
    ByPassScalarUDF::new(
        "csch",
        ReturnType::Specific(DataType::Float64),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Computes the hyperbolic cosecant of a number.",
            "SELECT CSCH(1.0); -- returns 0.8509181282393216"
        )),
    ),
    csch
);

make_udf_function!(
    ByPassScalarUDF::new(
        "div",
        ReturnType::Specific(DataType::Int64),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Computes the integer division of two numbers.",
            "SELECT DIV(5, 2); -- returns 2"
        )),
    ),
    div
);

make_udf_function!(
    ByPassScalarUDF::new(
        "exp",
        ReturnType::Specific(DataType::Float64),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Computes the exponential of a number.",
            "SELECT EXP(1.0); -- returns 2.718281828459045"
        )),
    ),
    exp
);

make_udf_function!(
    ByPassScalarUDF::new(
        "euclidean_distance",
        ReturnType::Specific(DataType::Float64),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Computes the Euclidean distance between two points.",
            "SELECT EUCLIDEAN_DISTANCE(ARRAY[1, 2], ARRAY[4, 6]); -- returns 5.0"
        )),
    ),
    euclidean_distance
);

make_udf_function!(
    ByPassScalarUDF::new(
        "is_inf",
        ReturnType::Specific(DataType::Boolean),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Returns true if the input is positive or negative infinity.",
            "SELECT IS_INF(1.0 / 0.0); -- returns true"
        )),
    ),
    is_inf
);

make_udf_function!(
    ByPassScalarUDF::new(
        "is_nan",
        ReturnType::Specific(DataType::Boolean),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Returns true if the input is NaN (Not a Number).",
            "SELECT IS_NAN(0.0 / 0.0); -- returns true"
        )),
    ),
    is_nan
);

make_udf_function!(
    ByPassScalarUDF::new(
        "mod",
        ReturnType::Specific(DataType::Int64),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Computes the modulus of two numbers.",
            "SELECT MOD(5, 2); -- returns 1"
        )),
    ),
    r#mod
);

make_udf_function!(
    ByPassScalarUDF::new(
        "rand",
        ReturnType::Specific(DataType::Float64),
        Signature::nullary(Volatility::Volatile),
        Some(build_document(
            "Returns a random float value in the range [0, 1). The random seed is unique to each row.",
            "SELECT RAND(); -- returns a random float between 0 and 1"
        )),
    ),
    rand
);

make_udf_function!(
    ByPassScalarUDF::new(
        "safe_add",
        ReturnType::Specific(DataType::Int64),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Performs addition and returns NULL if overflow occurs.",
            "SELECT SAFE_ADD(9223372036854775807, 1); -- returns NULL"
        )),
    ),
    safe_add
);

make_udf_function!(
    ByPassScalarUDF::new(
        "safe_subtract",
        ReturnType::Specific(DataType::Int64),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Performs subtraction and returns NULL if overflow occurs.",
            "SELECT SAFE_SUBTRACT(-9223372036854775808, 1); -- returns NULL"
        )),
    ),
    safe_subtract
);

make_udf_function!(
    ByPassScalarUDF::new(
        "safe_multiply",
        ReturnType::Specific(DataType::Int64),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Performs multiplication and returns NULL if overflow occurs.",
            "SELECT SAFE_MULTIPLY(3037000499, 3037000499); -- returns NULL"
        )),
    ),
    safe_multiply
);

make_udf_function!(
    ByPassScalarUDF::new(
        "safe_divide",
        ReturnType::Specific(DataType::Float64),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Performs division and returns NULL if division by zero occurs.",
            "SELECT SAFE_DIVIDE(1, 0); -- returns NULL"
        )),
    ),
    safe_divide
);

make_udf_function!(
    ByPassScalarUDF::new(
        "safe_negate",
        ReturnType::Specific(DataType::Int64),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Performs negation and returns NULL if overflow occurs.",
            "SELECT SAFE_NEGATE(-9223372036854775808); -- returns NULL"
        )),
    ),
    safe_negate
);

make_udf_function!(
    ByPassScalarUDF::new(
        "sec",
        ReturnType::Specific(DataType::Float64),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Computes the secant of the input angle, which is in radians.",
            "SELECT SEC(1.0); -- returns 1.8508157176809257"
        )),
    ),
    sec
);

make_udf_function!(
    ByPassScalarUDF::new(
        "sech",
        ReturnType::Specific(DataType::Float64),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Computes the hyperbolic secant of a number.",
            "SELECT SECH(1.0); -- returns 0.6480542736638855"
        )),
    ),
    sech
);

make_udf_function!(
    ByPassScalarUDF::new(
        "sign",
        ReturnType::Specific(DataType::Int8),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Returns the sign of a number: -1 for negative, 0 for zero, and 1 for positive.",
            "SELECT SIGN(-10); -- returns -1"
        )),
    ),
    sign
);

make_udf_function!(
    ByPassScalarUDF::new(
        "generate_range_array",
        ReturnType::ArrayOfInputFirstArgument,
        Signature::one_of(vec![
            TypeSignature::Any(3),
            TypeSignature::Any(2),
        ], Volatility::Immutable),
        Some(build_document(
            "Generates an array of numbers within a specified range with an optional step.",
            "SELECT GENERATE_RANGE_ARRAY(1, 10); -- returns [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]"
        )),
    ),
    generate_range_array
);

make_udf_function!(
    ByPassScalarUDF::new(
        "range_contains",
        ReturnType::Specific(DataType::Boolean),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Checks if the inner range is in the outer range.",
            "SELECT RANGE_CONTAINS(RANGE(1, 10), RANGE(3, 7)); -- returns true"
        )),
    ),
    range_contains
);

make_udf_function!(
    ByPassScalarUDF::new(
        "range_end",
        ReturnType::SameAsInputFirstArrayElement,
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Gets the upper bound of a range.",
            "SELECT RANGE_END(RANGE(1, 10)); -- returns 10"
        )),
    ),
    range_end
);

make_udf_function!(
    ByPassScalarUDF::new(
        "range_start",
        ReturnType::SameAsInputFirstArrayElement,
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Gets the lower bound of a range.",
            "SELECT RANGE_START(RANGE(1, 10)); -- returns 1"
        )),
    ),
    range_start
);

make_udf_function!(
    ByPassScalarUDF::new(
        "range_intersect",
        ReturnType::SameAsInputFirstArrayElement,
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Computes the intersection of two ranges.",
            "SELECT RANGE_INTERSECT(RANGE(1, 10), RANGE(5, 15)); -- returns RANGE(5, 10)"
        )),
    ),
    range_intersect
);

make_udf_function!(
    ByPassScalarUDF::new(
        "range_overlaps",
        ReturnType::Specific(DataType::Boolean),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Checks if two ranges overlap.",
            "SELECT RANGE_OVERLAPS(RANGE(1, 10), RANGE(5, 15)); -- returns true"
        )),
    ),
    range_overlaps
);

make_udf_function!(
    ByPassScalarUDF::new(
        "ascii",
        ReturnType::Specific(DataType::Int32),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Returns the ASCII code of the first character of the input string.",
            "SELECT ASCII(column_name) FROM table;"
        )),
    ),
    ascii
);

make_udf_function!(
    ByPassScalarUDF::new(
        "byte_length",
        ReturnType::Specific(DataType::Int32),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Returns the length of the input string in bytes.",
            "SELECT BYTE_LENGTH(column_name) FROM table;"
        )),
    ),
    byte_length
);

make_udf_function!(
    ByPassScalarUDF::new(
        "char_length",
        ReturnType::Specific(DataType::Int32),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Returns the length of the input string in characters.",
            "SELECT CHAR_LENGTH(column_name) FROM table;"
        )),
    ),
    char_length
);

make_udf_function!(
    ByPassScalarUDF::new(
        "character_length",
        ReturnType::Specific(DataType::Int32),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Returns the length of the input string in characters. Synonym for CHAR_LENGTH.",
            "SELECT CHARACTER_LENGTH(column_name) FROM table;"
        )),
    ),
    character_length
);

make_udf_function!(
    ByPassScalarUDF::new(
        "chr",
        ReturnType::Specific(DataType::Utf8),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Returns the character corresponding to the given ASCII code.",
            "SELECT CHR(65); -- returns 'A'"
        )),
    ),
    chr
);

make_udf_function!(
    ByPassScalarUDF::new(
        "code_points_to_bytes",
        ReturnType::Specific(DataType::Binary),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Converts an array of Unicode code points to a byte array.",
            "SELECT CODE_POINTS_TO_BYTES([72, 101, 108, 108, 111]); -- returns b'Hello'"
        )),
    ),
    code_points_to_bytes
);

make_udf_function!(
    ByPassScalarUDF::new(
        "code_points_to_string",
        ReturnType::Specific(DataType::Utf8),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Converts an array of Unicode code points to a string.",
            "SELECT CODE_POINTS_TO_STRING([72, 101, 108, 108, 111]); -- returns 'Hello'"
        )),
    ),
    code_points_to_string
);

make_udf_function!(
    ByPassScalarUDF::new(
        "collate",
        ReturnType::Specific(DataType::Utf8),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Applies a collation to a string.",
            "SELECT COLLATE('straße', 'de_DE'); -- returns 'straße' with German collation"
        )),
    ),
    collate
);

make_udf_function!(
    ByPassScalarUDF::new(
        "contains_substr",
        ReturnType::Specific(DataType::Boolean),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Checks if the first string contains the second substring.",
            "SELECT CONTAINS_SUBSTR('Hello, world!', 'world'); -- returns true"
        )),
    ),
    contains_substr
);

make_udf_function!(
    ByPassScalarUDF::new(
        "edit_distance",
        ReturnType::Specific(DataType::Int32),
        Signature::one_of(
            vec![TypeSignature::Any(2), TypeSignature::Any(3),],
            Volatility::Immutable
        ),
        Some(build_document(
            "Computes the Levenshtein edit distance between two strings.",
            "SELECT EDIT_DISTANCE('kitten', 'sitting'); -- returns 3"
        )),
    ),
    edit_distance
);

make_udf_function!(
    ByPassScalarUDF::new(
        "ends_with",
        ReturnType::Specific(DataType::Boolean),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Checks if the first string ends with the second substring.",
            "SELECT ENDS_WITH('Hello, world!', 'world!'); -- returns true"
        )),
    ),
    ends_with
);

make_udf_function!(
    ByPassScalarUDF::new(
        "format",
        ReturnType::Specific(DataType::Utf8),
        Signature::variadic_any(Volatility::Immutable),
        Some(build_document(
            "Formats a string using the specified format and arguments.",
            "SELECT FORMAT('date: %s!', FORMAT_DATE('%B %d, %Y', date '2015-01-02'));"
        )),
    ),
    format
);

make_udf_function!(
    ByPassScalarUDF::new(
        "from_base32",
        ReturnType::Specific(DataType::Binary),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Decodes a base32-encoded string to a byte array.",
            "SELECT FROM_BASE32('JBSWY3DPEBLW64TMMQQ===='); -- returns b'Hello, world!'"
        )),
    ),
    from_base32
);

make_udf_function!(
    ByPassScalarUDF::new(
        "from_base64",
        ReturnType::Specific(DataType::Binary),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Decodes a base64-encoded string to a byte array.",
            "SELECT FROM_BASE64('SGVsbG8sIHdvcmxkIQ=='); -- returns b'Hello, world!'"
        )),
    ),
    from_base64
);

make_udf_function!(
    ByPassScalarUDF::new(
        "from_hex",
        ReturnType::Specific(DataType::Binary),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Decodes a hexadecimal-encoded string to a byte array.",
            "SELECT FROM_HEX('48656c6c6f2c20776f726c6421'); -- returns b'Hello, world!'"
        )),
    ),
    from_hex
);

make_udf_function!(
    ByPassScalarUDF::new(
        "initcap",
        ReturnType::Specific(DataType::Utf8),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Capitalizes the first letter of each word in the input string.",
            "SELECT INITCAP('hello world!'); -- returns 'Hello World!'"
        )),
    ),
    initcap
);

make_udf_function!(
    ByPassScalarUDF::new(
        "length",
        ReturnType::Specific(DataType::Int32),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Returns the length of the input string in characters.",
            "SELECT LENGTH('Hello, world!'); -- returns 13"
        )),
    ),
    length
);

make_udf_function!(
    ByPassScalarUDF::new(
        "normalize",
        ReturnType::Specific(DataType::Utf8),
        Signature::one_of(
            vec![TypeSignature::Any(1), TypeSignature::Any(2),],
            Volatility::Immutable
        ),
        Some(build_document(
            "Normalizes a string to the specified Unicode normalization form.",
            "SELECT NORMALIZE('é'); -- returns 'é' in NFC form"
        )),
    ),
    normalize
);

make_udf_function!(
    ByPassScalarUDF::new(
        "normalize_and_casefold",
        ReturnType::Specific(DataType::Utf8),
        Signature::one_of(vec![
            TypeSignature::Any(1),
            TypeSignature::Any(2),
        ], Volatility::Immutable),
        Some(build_document(
            "Takes a string value and returns it as a normalized string. If you don't provide a normalization mode, NFC is used.",
            "SELECT NORMALIZE_AND_CASEFOLD('Straße'); -- returns 'strasse'"
        )),
    ),
    normalize_and_casefold
);

make_udf_function!(
    ByPassScalarUDF::new(
        "regexp_contains",
        ReturnType::Specific(DataType::Boolean),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Checks if the input string matches the specified regular expression.",
            "SELECT REGEXP_CONTAINS('Hello, world!', r'world'); -- returns true"
        )),
    ),
    regexp_contains
);

make_udf_function!(
    ByPassScalarUDF::new(
        "regexp_extract",
        ReturnType::Specific(DataType::Utf8),
        Signature::one_of(vec![
            TypeSignature::Any(2),
            TypeSignature::Any(3),
            TypeSignature::Any(4),
        ], Volatility::Immutable),
        Some(build_document(
            "Extracts a substring from the input string that matches the specified regular expression.",
            "SELECT REGEXP_EXTRACT('Hello, world!', r'world'); -- returns 'world'"
        )),
    ),
    regexp_extract
);

make_udf_function!(
    ByPassScalarUDF::new(
        "regexp_extract_all",
        ReturnType::Specific(DataType::List(Arc::new(Field::new("item", DataType::Utf8, true)))),
        Signature::one_of(vec![
            TypeSignature::Any(2),
        ], Volatility::Immutable),
        Some(build_document(
            "Extracts all substrings from the input string that match the specified regular expression.",
            "SELECT REGEXP_EXTRACT_ALL('ababab', r'ab'); -- returns ['ab', 'ab', 'ab']"
        )),
    ),
    regexp_extract_all
);

make_udf_function!(
    ByPassScalarUDF::new(
        "regexp_substr",
        ReturnType::Specific(DataType::Utf8),
        Signature::one_of(
            vec![
                TypeSignature::Any(2),
                TypeSignature::Any(3),
                TypeSignature::Any(4),
            ],
            Volatility::Immutable
        ),
        Some(build_document(
            "Returns the substring that matches the specified regular expression.",
            "SELECT REGEXP_SUBSTR('Hello, world!', r'world'); -- returns 'world'"
        )),
    ),
    regexp_substr
);

make_udf_function!(
    ByPassScalarUDF::new(
        "safe_convert_bytes_to_string",
        ReturnType::Specific(DataType::Utf8),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Converts a byte array to a string, returning NULL if the byte array is not valid UTF-8.",
            "SELECT SAFE_CONVERT_BYTES_TO_STRING(b'Hello, world!'); -- returns 'Hello, world!'"
        )),
    ),
    safe_convert_bytes_to_string
);

make_udf_function!(
    ByPassScalarUDF::new(
        "soundex",
        ReturnType::Specific(DataType::Utf8),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Returns the Soundex code for the input string.",
            "SELECT SOUNDEX('Robert'); -- returns 'R163'"
        )),
    ),
    soundex
);

make_udf_function!(
    ByPassScalarUDF::new(
        "split",
        ReturnType::Specific(DataType::List(Arc::new(Field::new("item", DataType::Utf8, true)))),
        Signature::one_of(vec![
            TypeSignature::Any(1),
            TypeSignature::Any(2),
        ], Volatility::Immutable),
        Some(build_document(
            "Splits the input string into an array of substrings based on the specified delimiter.",
            "SELECT SPLIT('apple,banana,cherry', ','); -- returns ['apple', 'banana', 'cherry']"
        )),
    ),
    split
);

make_udf_function!(
    ByPassScalarUDF::new(
        "to_base32",
        ReturnType::Specific(DataType::Utf8),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Encodes a byte array to a base32-encoded string.",
            "SELECT TO_BASE32(b'Hello, world!'); -- returns 'JBSWY3DPEBLW64TMMQQ===='"
        )),
    ),
    to_base32
);

make_udf_function!(
    ByPassScalarUDF::new(
        "to_base64",
        ReturnType::Specific(DataType::Utf8),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Encodes a byte array to a base64-encoded string.",
            "SELECT TO_BASE64(b'Hello, world!'); -- returns 'SGVsbG8sIHdvcmxkIQ=='"
        )),
    ),
    to_base64
);

make_udf_function!(
    ByPassScalarUDF::new(
        "to_code_points",
        ReturnType::Specific(DataType::List(Arc::new(Field::new(
            "item",
            DataType::Int32,
            true
        )))),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Converts a string to an array of Unicode code points.",
            "SELECT TO_CODE_POINTS('Hello'); -- returns [72, 101, 108, 108, 111]"
        )),
    ),
    to_code_points
);

make_udf_function!(
    ByPassScalarUDF::new(
        "trim",
        ReturnType::Specific(DataType::Utf8),
        Signature::one_of(vec![
            TypeSignature::Any(1),
            TypeSignature::Any(2),
        ], Volatility::Immutable),
        Some(build_document(
            "Removes leading and trailing spaces or specified characters from the input string.",
            "SELECT TRIM('  Hello, world!  '); -- returns 'Hello, world!'"
        )),
    ),
    trim
);

make_udf_function!(
    ByPassScalarUDF::new(
        "unicode",
        ReturnType::Specific(DataType::Int32),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Returns the Unicode code point of the first character of the input string.",
            "SELECT UNICODE('A'); -- returns 65"
        )),
    ),
    unicode
);

make_udf_function!(
    ByPassScalarUDF::new(
        "format_time",
        ReturnType::Specific(DataType::Utf8),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Formats a TIME according to the specified format string.",
            r#"SELECT FORMAT_TIME("%R", TIME "15:30:00") as formatted_time; -- returns '15:30'"#
        )),
    ),
    format_time
);

make_udf_function!(
    ByPassScalarUDF::new(
        "parse_time",
        ReturnType::Specific(DataType::Time64(datafusion::arrow::datatypes::TimeUnit::Microsecond)),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Parses a string into a TIME according to the specified format string.",
            "SELECT PARSE_TIME('%I:%M:%S %p', '2:23:38 pm') AS parsed_time; -- returns TIME '14:23:38'"
        )),
    ),
    parse_time
);

make_udf_function!(
    ByPassScalarUDF::new(
        "time",
        ReturnType::Specific(DataType::Time64(
            datafusion::arrow::datatypes::TimeUnit::Microsecond
        )),
        Signature::one_of(
            vec![
                TypeSignature::Any(1),
                TypeSignature::Any(2),
                TypeSignature::Any(3),
            ],
            Volatility::Immutable
        ),
        Some(build_document(
            "Converts a string to a TIME value.",
            "SELECT TIME('15:30:00') AS time_value;"
        )),
    ),
    time
);

make_udf_function!(
    ByPassScalarUDF::new(
        "time_add",
        ReturnType::Specific(DataType::Time64(datafusion::arrow::datatypes::TimeUnit::Microsecond)),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Adds an INTERVAL to a TIME value.",
            "SELECT TIME_ADD(TIME '15:30:00', INTERVAL '02:00:00' HOUR TO SECOND) AS new_time;"
        )),
    ),
    time_add
);

make_udf_function!(
    ByPassScalarUDF::new(
        "time_diff",
        ReturnType::Specific(DataType::Int64),
        Signature::any(3, Volatility::Immutable),
        Some(build_document(
            "Calculates the difference between two TIME values as an INTERVAL.",
            "SELECT TIME_DIFF('SECOND', TIME '18:30:00', TIME '15:30:00') AS time_difference;"
        )),
    ),
    time_diff
);

make_udf_function!(
    ByPassScalarUDF::new(
        "time_sub",
        ReturnType::Specific(DataType::Time64(datafusion::arrow::datatypes::TimeUnit::Microsecond)),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Subtracts an INTERVAL from a TIME value.",
            "SELECT TIME_SUB(TIME '15:30:00', INTERVAL '02:00:00' HOUR TO SECOND) AS new_time;"
        )),
    ),
    time_sub
);

make_udf_function!(
    ByPassScalarUDF::new(
        "time_trunc",
        ReturnType::Specific(DataType::Time64(
            datafusion::arrow::datatypes::TimeUnit::Microsecond
        )),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Truncates a TIME value to the specified part.",
            "SELECT TIME_TRUNC('HOUR', TIME '15:45:30') AS truncated_time;"
        )),
    ),
    time_trunc
);

make_udf_function!(
    ByPassScalarUDF::new(
        "format_timestamp",
        ReturnType::Specific(DataType::Utf8),
        Signature::one_of(vec![
            TypeSignature::Any(2),
            TypeSignature::Any(3),
        ], Volatility::Immutable),
        Some(build_document(
            "Formats a TIMESTAMP according to the specified format string with optional timezone.",
            r#"SSELECT FORMAT_TIMESTAMP("%c", TIMESTAMP "2050-12-25 15:30:55+00", "UTC"); -- returns 'Sun Dec 25 15:30:55 2050'"#
        )),
    ),
    format_timestamp
);

make_udf_function!(
    ByPassScalarUDF::new(
        "parse_timestamp",
        ReturnType::Specific(DataType::Timestamp(datafusion::arrow::datatypes::TimeUnit::Microsecond, None)),
        Signature::one_of(vec![
            TypeSignature::Any(2),
            TypeSignature::Any(3),
        ], Volatility::Immutable),
        Some(build_document(
            "Parses a string into a TIMESTAMP according to the specified format string with optional timezone.",
            r#"SELECT PARSE_TIMESTAMP("%c", "Thu Dec 25 07:30:00 2008") AS parsed;"#
        )),
    ),
    parse_timestamp
);

make_udf_function!(
    ByPassScalarUDF::new(
        "timestamp",
        ReturnType::Specific(DataType::Timestamp(
            datafusion::arrow::datatypes::TimeUnit::Microsecond,
            None
        )),
        Signature::one_of(
            vec![TypeSignature::Any(1), TypeSignature::Any(2),],
            Volatility::Immutable
        ),
        Some(build_document(
            "Converts a string to a TIMESTAMP value with optional timezone.",
            "SELECT TIMESTAMP('2023-10-05 14:30:00', 'UTC') AS timestamp_value;"
        )),
    ),
    timestamp
);

make_udf_function!(
    ByPassScalarUDF::new(
        "timestamp_add",
        ReturnType::Specific(DataType::Timestamp(datafusion::arrow::datatypes::TimeUnit::Microsecond, None)),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Adds an INTERVAL to a TIMESTAMP value.",
            "SELECT TIMESTAMP_ADD(TIMESTAMP '2023-10-05 14:30:00', INTERVAL 10 MINUTE) AS new_timestamp;"
        )),
    ),
    timestamp_add
);

make_udf_function!(
    ByPassScalarUDF::new(
        "timestamp_diff",
        ReturnType::Specific(DataType::Int64),
        Signature::any(3, Volatility::Immutable),
        Some(build_document(
            "Calculates the difference between two TIMESTAMP values as an INTERVAL.",
            "SELECT TIMESTAMP_DIFF('MINUTE', TIMESTAMP '2023-10-05 15:30:00', TIMESTAMP '2023-10-05 14:30:00') AS timestamp_difference;"
        )),
    ),
    timestamp_diff
);

make_udf_function!(
    ByPassScalarUDF::new(
        "timestamp_micros",
        ReturnType::Specific(DataType::Timestamp(datafusion::arrow::datatypes::TimeUnit::Microsecond, None)),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Interprets int64_expression as the number of microseconds since 1970-01-01 00:00:00 UTC and returns a timestamp.",
            "SELECT TIMESTAMP_MICROS(1230219000000000) AS timestamp_value;"
        )),
    ),
    timestamp_micros
);

make_udf_function!(
    ByPassScalarUDF::new(
        "timestamp_millis",
        ReturnType::Specific(DataType::Timestamp(datafusion::arrow::datatypes::TimeUnit::Microsecond, None)),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Interprets int64_expression as the number of milliseconds since 1970-01-01 00:00:00 UTC and returns a timestamp.",
            "SELECT TIMESTAMP_MILLIS(1230219000000) AS timestamp_value;"
        )),
    ),
    timestamp_millis
);

make_udf_function!(
    ByPassScalarUDF::new(
        "timestamp_seconds",
        ReturnType::Specific(DataType::Timestamp(datafusion::arrow::datatypes::TimeUnit::Microsecond, None)),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Interprets int64_expression as the number of seconds since 1970-01-01 00:00:00 UTC and returns a timestamp.",
            "SELECT TIMESTAMP_SECONDS(1230219000) AS timestamp_value;"
        )),
    ),
    timestamp_seconds
);

make_udf_function!(
    ByPassScalarUDF::new(
        "timestamp_sub",
        ReturnType::Specific(DataType::Timestamp(datafusion::arrow::datatypes::TimeUnit::Microsecond, None)),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Subtracts an INTERVAL from a TIMESTAMP value.",
            "SELECT TIMESTAMP_SUB(TIMESTAMP '2023-10-05 14:30:00', INTERVAL 10 MINUTE) AS new_timestamp;"
        )),
    ),
    timestamp_sub
);

make_udf_function!(
    ByPassScalarUDF::new(
        "timestamp_trunc",
        ReturnType::Specific(DataType::Timestamp(datafusion::arrow::datatypes::TimeUnit::Microsecond, None)),
        Signature::one_of(vec![
            TypeSignature::Any(2),
            TypeSignature::Any(3),
        ], Volatility::Immutable),
        Some(build_document(
            "Truncates a TIMESTAMP value to the specified part.",
            "SELECT TIMESTAMP_TRUNC('HOUR', TIMESTAMP '2023-10-05 14:45:30') AS truncated_timestamp;"
        )),
    ),
    timestamp_trunc
);

make_udf_function!(
    ByPassScalarUDF::new(
        "unix_micros",
        ReturnType::Specific(DataType::Int64),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Returns the number of microseconds since 1970-01-01 00:00:00 UTC for the given TIMESTAMP.",
            "SELECT UNIX_MICROS(TIMESTAMP '2023-10-05 14:30:00') AS microseconds_since_epoch;"
        )),
    ),
    unix_micros
);

make_udf_function!(
    ByPassScalarUDF::new(
        "unix_millis",
        ReturnType::Specific(DataType::Int64),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Returns the number of milliseconds since 1970-01-01 00:00:00 UTC for the given TIMESTAMP.",
            "SELECT UNIX_MILLIS(TIMESTAMP '2023-10-05 14:30:00') AS milliseconds_since_epoch;"
        )),
    ),
    unix_millis
);

make_udf_function!(
    ByPassScalarUDF::new(
        "unix_seconds",
        ReturnType::Specific(DataType::Int64),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Returns the number of seconds since 1970-01-01 00:00:00 UTC for the given TIMESTAMP.",
            "SELECT UNIX_SECONDS(TIMESTAMP '2023-10-05 14:30:00') AS seconds_since_epoch;"
        )),
    ),
    unix_seconds
);

make_udf_function!(
    ByPassScalarUDF::new(
        "current_datetime",
        ReturnType::Specific(DataType::Timestamp(
            datafusion::arrow::datatypes::TimeUnit::Microsecond,
            None
        )),
        Signature::nullary(Volatility::Volatile),
        Some(build_document(
            "Returns the current date and time.",
            "SELECT CURRENT_DATETIME() AS now;"
        )),
    ),
    current_datetime
);

make_udf_function!(
    ByPassScalarUDF::new(
        "datetime",
        ReturnType::Specific(DataType::Timestamp(
            datafusion::arrow::datatypes::TimeUnit::Microsecond,
            None
        )),
        Signature::one_of(
            vec![
                TypeSignature::Any(1),
                TypeSignature::Any(2),
                TypeSignature::Any(3),
            ],
            Volatility::Immutable
        ),
        Some(build_document(
            "Converts a string to a DATETIME value with optional timezone.",
            "SELECT DATETIME('2023-10-05 14:30:00', 'UTC') AS datetime_value;"
        )),
    ),
    datetime
);

make_udf_function!(
    ByPassScalarUDF::new(
        "datetime_add",
        ReturnType::Specific(DataType::Timestamp(datafusion::arrow::datatypes::TimeUnit::Microsecond, None)),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Adds an INTERVAL to a DATETIME value.",
            "SELECT DATETIME_ADD(DATETIME '2023-10-05 14:30:00', INTERVAL 10 MINUTE) AS new_datetime;"
        )),
    ),
    datetime_add
);

make_udf_function!(
    ByPassScalarUDF::new(
        "datetime_diff",
        ReturnType::Specific(DataType::Int64),
        Signature::any(3, Volatility::Immutable),
        Some(build_document(
            "Calculates the difference between two DATETIME values as an INTERVAL.",
            "SELECT DATETIME_DIFF('MINUTE', DATETIME '2023-10-05 15:30:00', DATETIME '2023-10-05 14:30:00') AS datetime_difference;"
        )),
    ),
    datetime_diff
);

make_udf_function!(
    ByPassScalarUDF::new(
        "datetime_sub",
        ReturnType::Specific(DataType::Timestamp(datafusion::arrow::datatypes::TimeUnit::Microsecond, None)),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Subtracts an INTERVAL from a DATETIME value.",
            "SELECT DATETIME_SUB(DATETIME '2023-10-05 14:30:00', INTERVAL 10 MINUTE) AS new_datetime;"
        )),
    ),
    datetime_sub
);

make_udf_function!(
    ByPassScalarUDF::new(
        "datetime_trunc",
        ReturnType::Specific(DataType::Timestamp(
            datafusion::arrow::datatypes::TimeUnit::Microsecond,
            None
        )),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Truncates a DATETIME value to the specified part.",
            "SELECT DATETIME_TRUNC('HOUR', DATETIME '2023-10-05 14:45:30') AS truncated_datetime;"
        )),
    ),
    datetime_trunc
);

make_udf_function!(
    ByPassScalarUDF::new(
        "format_datetime",
        ReturnType::Specific(DataType::Utf8),
        Signature::one_of(vec![
            TypeSignature::Any(2),
            TypeSignature::Any(3),
        ], Volatility::Immutable),
        Some(build_document(
            "Formats a DATETIME according to the specified format string with optional timezone.",
            r#"SELECT FORMAT_DATETIME("%c", DATETIME "2050-12-25 15:30:55", "UTC"); -- returns 'Sun Dec 25 15:30:55 2050'"#
        )),
    ),
    format_datetime
);

make_udf_function!(
    ByPassScalarUDF::new(
        "parse_datetime",
        ReturnType::Specific(DataType::Timestamp(datafusion::arrow::datatypes::TimeUnit::Microsecond, None)),
        Signature::one_of(vec![
            TypeSignature::Any(2),
            TypeSignature::Any(3),
        ], Volatility::Immutable),
        Some(build_document(
            "Parses a string into a DATETIME according to the specified format string with optional timezone.",
            r#"SELECT PARSE_DATETIME("%c", "Thu Dec 25 07:30:00 2008") AS parsed;"#
        )),
    ),
    parse_datetime
);

make_udf_function!(
    ByPassScalarUDF::new(
        "offset",
        ReturnType::Specific(DataType::Int64),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "To access the array element for zero-based indexing.",
            "SELECT [10, 20, 30][OFFSET(1)] AS second_element; -- returns 20"
        )),
    ),
    offset
);

make_udf_function!(
    ByPassScalarUDF::new(
        "ordinal",
        ReturnType::Specific(DataType::Int64),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "To access the array element for one-based indexing.",
            "SELECT [10, 20, 30][ORDINAL(2)] AS second_element; -- returns 20"
        )),
    ),
    ordinal
);

make_udf_function!(
    ByPassScalarUDF::new(
        "safe_offset",
        ReturnType::Specific(DataType::Int64),
        Signature::any(1, Volatility::Immutable),
        Some(build_document("To safely access the array element for zero-based indexing, returning NULL if out of bounds.",
        "SELECT [10, 20, 30][SAFE_OFFSET(5)] AS out_of_bounds_element; -- returns NULL"
        )),
    ),
    safe_offset
);

make_udf_function!(
    ByPassScalarUDF::new(
        "safe_ordinal",
        ReturnType::Specific(DataType::Int64),
        Signature::any(1, Volatility::Immutable),
        Some(build_document("To safely access the array element for one-based indexing, returning NULL if out of bounds.",
        "SELECT [10, 20, 30][SAFE_ORDINAL(5)] AS out_of_bounds_element; -- returns NULL"
        )),
    ),
    safe_ordinal
);

// JSON functions would go here
make_udf_function!(
    ByPassScalarUDF::new(
        "bool",
        ReturnType::Specific(DataType::Boolean),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Converts a JSON boolean to a SQL BOOL value.",
            "SELECT BOOL(JSON 'true') AS vacancy;"
        )),
    ),
    r#bool
);

make_udf_function!(
    ByPassScalarUDF::new(
        "float64",
        ReturnType::Specific(DataType::Float64),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Converts a JSON number to a SQL FLOAT64 value.",
            "SELECT FLOAT64(JSON '12345.6789') AS gdp;"
        )),
    ),
    float64
);

make_udf_function!(
    ByPassScalarUDF::new(
        "int64",
        ReturnType::Specific(DataType::Int64),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Converts a JSON number to a SQL INT64 value.",
            "SELECT INT64(JSON '123456789') AS population;"
        )),
    ),
    int64
);

make_udf_function!(
    ByPassScalarUDF::new(
        "json_array",
        ReturnType::Specific(DataType::Utf8),
        Signature::variadic_any(Volatility::Immutable),
        Some(build_document(
            "Creates a JSON array from the input values.",
            "SELECT JSON_ARRAY(1, 'two', TRUE) AS json_array;"
        )),
    ),
    json_array
);

make_udf_function!(
    ByPassScalarUDF::new(
        "json_array_append",
        ReturnType::Specific(DataType::Utf8),
        Signature::variadic_any(Volatility::Immutable),
        Some(build_document(
            "Appends values to a JSON array.",
            "SELECT JSON_ARRAY_APPEND(JSON_ARRAY(1, 2), 3) AS json_array;"
        )),
    ),
    json_array_append
);

make_udf_function!(
    ByPassScalarUDF::new(
        "json_array_insert",
        ReturnType::Specific(DataType::Utf8),
        Signature::variadic_any(Volatility::Immutable),
        Some(build_document(
            "Inserts values into a JSON array at specified positions.",
            r#"SELECT JSON_ARRAY_INSERT(JSON '["a", ["b", "c"], "d"]', '$[1]', 1) AS json_data;"#
        )),
    ),
    json_array_insert
);

make_udf_function!(
    ByPassScalarUDF::new(
        "json_extract",
        ReturnType::Specific(DataType::Utf8),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Extracts a value from a JSON string using a JSONPath expression.",
            r#"SELECT JSON_EXTRACT(JSON '{"a": {"b": [1, 2, 3]}}', '$.a.b[1]') AS json_value;"#
        )),
    ),
    json_extract
);

make_udf_function!(
    ByPassScalarUDF::new(
        "json_extract_array",
        ReturnType::Specific(DataType::Utf8),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Extracts a JSON array from a JSON string using a JSONPath expression.",
            r#"SELECT JSON_EXTRACT_ARRAY(JSON '{"a": {"b": [1, 2, 3]}}', '$.a.b') AS json_array;"#
        )),
    ),
    json_extract_array
);

make_udf_function!(
    ByPassScalarUDF::new(
        "json_extract_scalar",
        ReturnType::Specific(DataType::Utf8),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Extracts a scalar value from a JSON string using a JSONPath expression.",
            r#"SELECT JSON_EXTRACT_SCALAR(JSON '{"a": {"b": 42}}', '$.a.b') AS json_value;"#
        )),
    ),
    json_extract_scalar
);

make_udf_function!(
    ByPassScalarUDF::new(
        "json_extract_string_array",
        ReturnType::Specific(DataType::Utf8),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Extracts a JSON string array from a JSON string using a JSONPath expression.",
            r#"SELECT JSON_EXTRACT_STRING_ARRAY(JSON '{"a": {"b": ["x", "y", "z"]}}', '$.a.b') AS json_string_array;"#
        )),
    ),
    json_extract_string_array
);

make_udf_function!(
    ByPassScalarUDF::new(
        "json_keys",
        ReturnType::Specific(DataType::List(Arc::new(Field::new("item", DataType::Utf8, true)))),
        Signature::one_of(vec![
            TypeSignature::Any(1),
            TypeSignature::Any(2),
            TypeSignature::Any(3),
        ], Volatility::Immutable),
        Some(build_document(
            "Extracts unique JSON keys from a JSON expression with optional max_depth and mode parameters ('strict', 'lax', 'lax recursive'.",
            r#"SELECT JSON_KEYS(JSON '{"name": "Alice", "age": 30}') AS keys;"#
        )),
    ),
    json_keys
);

make_udf_function!(
    ByPassScalarUDF::new(
        "json_object",
        ReturnType::Specific(DataType::Utf8),
        Signature::variadic_any(Volatility::Immutable),
        Some(build_document(
            "Creates a JSON object from key-value pairs.",
            "SELECT JSON_OBJECT('name', 'Alice', 'age', 30) AS json_object;"
        )),
    ),
    json_object
);

make_udf_function!(
    ByPassScalarUDF::new(
        "json_query",
        ReturnType::Specific(DataType::Utf8),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Extracts JSON values based on a JSONPath expression.",
            r#"SELECT JSON_QUERY(JSON '{"a": {"b": [1, 2, 3]}}', '$.a.b') AS json_value;"#
        )),
    ),
    json_query
);

make_udf_function!(
    ByPassScalarUDF::new(
        "json_query_array",
        ReturnType::Specific(DataType::Utf8),
        Signature::one_of(
            vec![TypeSignature::Any(1), TypeSignature::Any(2),],
            Volatility::Immutable
        ),
        Some(build_document(
            "Extracts JSON arrays based on a JSONPath expression.",
            r#"SELECT JSON_QUERY_ARRAY(JSON '{"a": {"b": [1, 2, 3]}}', '$.a.b') AS json_array;"#
        )),
    ),
    json_query_array
);

make_udf_function!(
    ByPassScalarUDF::new(
        "json_remove",
        ReturnType::Specific(DataType::Utf8),
        Signature::variadic_any(Volatility::Immutable),
        Some(build_document(
            "Removes specified paths from a JSON string.",
            r#"SELECT JSON_REMOVE(JSON '{"a": 1, "b": 2, "c": 3}', '$.b') AS json_data;"#
        )),
    ),
    json_remove
);

make_udf_function!(
    ByPassScalarUDF::new(
        "json_set",
        ReturnType::Specific(DataType::Utf8),
        Signature::variadic_any(Volatility::Immutable),
        Some(build_document(
            "Sets values at specified paths in a JSON string.",
            r#"SELECT JSON_SET(JSON '{"a": 1, "b": 2}', '$.b', 20, '$.c', 30) AS json_data;"#
        )),
    ),
    json_set
);

make_udf_function!(
    ByPassScalarUDF::new(
        "json_strip_nulls",
        ReturnType::Specific(DataType::Utf8),
        Signature::variadic_any(Volatility::Immutable),
        Some(build_document(
            "Removes all null values from a JSON string with optional path, include_array, and remove_empty_object parameters.",
            r#"SELECT JSON_STRIP_NULLS(JSON '{"a": 1, "b": null, "c": 3, "d": null}') AS json_data;"#
        )),
    ),
    json_strip_nulls
);

make_udf_function!(
    ByPassScalarUDF::new(
        "json_type",
        ReturnType::Specific(DataType::Utf8),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Returns the type of the outermost JSON value as a string.",
            r#"SELECT JSON_TYPE(JSON '{"a": 1, "b": 2}') AS json_type;"#
        )),
    ),
    json_type
);

make_udf_function!(
    ByPassScalarUDF::new(
        "json_value",
        ReturnType::Specific(DataType::Utf8),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Extracts a scalar value from a JSON string using a JSONPath expression.",
            r#"SELECT JSON_VALUE(JSON '{"a": {"b": 42}}', '$.a.b') AS json_value;"#
        )),
    ),
    json_value
);

make_udf_function!(
    ByPassScalarUDF::new(
        "json_value_array",
        ReturnType::Specific(DataType::Utf8),
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Extracts a JSON value array from a JSON string using a JSONPath expression.",
            r#"SELECT JSON_VALUE_ARRAY(JSON '{"a": {"b": ["x", "y", "z"]}}', '$.a.b') AS json_value_array;"#
        )),
    ),
    json_value_array
);

make_udf_function!(
    ByPassScalarUDF::new(
        "lax_bool",
        ReturnType::Specific(DataType::Boolean),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Converts a JSON boolean to a SQL BOOL value in lax mode.",
            "SELECT LAX_BOOL(JSON 'true') AS vacancy;"
        )),
    ),
    lax_bool
);

make_udf_function!(
    ByPassScalarUDF::new(
        "lax_float64",
        ReturnType::Specific(DataType::Float64),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Converts a JSON number to a SQL FLOAT64 value in lax mode.",
            "SELECT LAX_FLOAT64(JSON '12345.6789') AS gdp;"
        )),
    ),
    lax_float64
);

make_udf_function!(
    ByPassScalarUDF::new(
        "lax_int64",
        ReturnType::Specific(DataType::Int64),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Converts a JSON number to a SQL INT64 value in lax mode.",
            "SELECT LAX_INT64(JSON '123456789') AS population;"
        )),
    ),
    lax_int64
);

make_udf_function!(
    ByPassScalarUDF::new(
        "lax_string",
        ReturnType::Specific(DataType::Utf8),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Converts a JSON string to a SQL STRING value in lax mode.",
            "SELECT LAX_STRING(JSON 'Hello, world!') AS greeting;"
        )),
    ),
    lax_string
);

make_udf_function!(
    ByPassScalarUDF::new(
        "parse_json",
        ReturnType::Specific(DataType::Utf8),
        Signature::one_of(vec![
            TypeSignature::Any(1),
            TypeSignature::Any(2),
        ], Volatility::Immutable),
        Some(build_document(
            "Parses a string into a JSON value with optional mode parameter ('strict' or 'lax').",
            "SELECT PARSE_JSON('{\"name\": \"Alice\", \"age\": 30}') AS json_data;"
        )),
    ),
    parse_json
);

make_udf_function!(
    ByPassScalarUDF::new(
        "string",
        ReturnType::Specific(DataType::Utf8),
        Signature::any(1, Volatility::Immutable),
        Some(build_document(
            "Converts a JSON string to a SQL STRING value.",
            "SELECT STRING(JSON 'Hello, world!') AS greeting;"
        )),
    ),
    string
);

make_udf_function!(
    ByPassScalarUDF::new(
        "to_json",
        ReturnType::Specific(DataType::Utf8),
        Signature::one_of(
            vec![TypeSignature::Any(1), TypeSignature::Any(2),],
            Volatility::Immutable
        ),
        Some(build_document(
            "Converts a SQL value to a JSON string.",
            "SELECT TO_JSON(12345) AS json_data;"
        )),
    ),
    to_json
);

make_udf_function!(
    ByPassScalarUDF::new(
        "to_json_string",
        ReturnType::Specific(DataType::Utf8),
        Signature::one_of(
            vec![TypeSignature::Any(1), TypeSignature::Any(2),],
            Volatility::Immutable
        ),
        Some(build_document(
            "Converts a SQL value to a JSON string.",
            "SELECT TO_JSON_STRING(12345) AS json_string;"
        )),
    ),
    to_json_string
);
