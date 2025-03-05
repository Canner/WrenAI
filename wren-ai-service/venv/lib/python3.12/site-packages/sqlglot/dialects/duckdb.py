from __future__ import annotations

import typing as t

from sqlglot import exp, generator, parser, tokens, transforms
from sqlglot.expressions import DATA_TYPE
from sqlglot.dialects.dialect import (
    Dialect,
    JSON_EXTRACT_TYPE,
    NormalizationStrategy,
    approx_count_distinct_sql,
    arrow_json_extract_sql,
    binary_from_function,
    bool_xor_sql,
    build_default_decimal_type,
    date_trunc_to_time,
    datestrtodate_sql,
    no_datetime_sql,
    encode_decode_sql,
    build_formatted_time,
    inline_array_unless_query,
    no_comment_column_constraint_sql,
    no_safe_divide_sql,
    no_time_sql,
    no_timestamp_sql,
    pivot_column_names,
    rename_func,
    str_position_sql,
    str_to_time_sql,
    timestamptrunc_sql,
    timestrtotime_sql,
    unit_to_var,
    unit_to_str,
    sha256_sql,
    build_regexp_extract,
    explode_to_unnest_sql,
    no_make_interval_sql,
)
from sqlglot.generator import unsupported_args
from sqlglot.helper import seq_get
from sqlglot.tokens import TokenType
from sqlglot.parser import binary_range_parser

DATETIME_DELTA = t.Union[
    exp.DateAdd, exp.TimeAdd, exp.DatetimeAdd, exp.TsOrDsAdd, exp.DateSub, exp.DatetimeSub
]

WINDOW_FUNCS_WITH_IGNORE_NULLS = (
    exp.FirstValue,
    exp.LastValue,
    exp.Lag,
    exp.Lead,
    exp.NthValue,
)


def _date_delta_sql(self: DuckDB.Generator, expression: DATETIME_DELTA) -> str:
    this = expression.this
    unit = unit_to_var(expression)
    op = (
        "+"
        if isinstance(expression, (exp.DateAdd, exp.TimeAdd, exp.DatetimeAdd, exp.TsOrDsAdd))
        else "-"
    )

    to_type: t.Optional[DATA_TYPE] = None
    if isinstance(expression, exp.TsOrDsAdd):
        to_type = expression.return_type
    elif this.is_string:
        # Cast string literals (i.e function parameters) to the appropriate type for +/- interval to work
        to_type = (
            exp.DataType.Type.DATETIME
            if isinstance(expression, (exp.DatetimeAdd, exp.DatetimeSub))
            else exp.DataType.Type.DATE
        )

    this = exp.cast(this, to_type) if to_type else this

    return f"{self.sql(this)} {op} {self.sql(exp.Interval(this=expression.expression, unit=unit))}"


# BigQuery -> DuckDB conversion for the DATE function
def _date_sql(self: DuckDB.Generator, expression: exp.Date) -> str:
    result = f"CAST({self.sql(expression, 'this')} AS DATE)"
    zone = self.sql(expression, "zone")

    if zone:
        date_str = self.func("STRFTIME", result, "'%d/%m/%Y'")
        date_str = f"{date_str} || ' ' || {zone}"

        # This will create a TIMESTAMP with time zone information
        result = self.func("STRPTIME", date_str, "'%d/%m/%Y %Z'")

    return result


# BigQuery -> DuckDB conversion for the TIME_DIFF function
def _timediff_sql(self: DuckDB.Generator, expression: exp.TimeDiff) -> str:
    this = exp.cast(expression.this, exp.DataType.Type.TIME)
    expr = exp.cast(expression.expression, exp.DataType.Type.TIME)

    # Although the 2 dialects share similar signatures, BQ seems to inverse
    # the sign of the result so the start/end time operands are flipped
    return self.func("DATE_DIFF", unit_to_str(expression), expr, this)


@unsupported_args(("expression", "DuckDB's ARRAY_SORT does not support a comparator."))
def _array_sort_sql(self: DuckDB.Generator, expression: exp.ArraySort) -> str:
    return self.func("ARRAY_SORT", expression.this)


def _sort_array_sql(self: DuckDB.Generator, expression: exp.SortArray) -> str:
    name = "ARRAY_REVERSE_SORT" if expression.args.get("asc") == exp.false() else "ARRAY_SORT"
    return self.func(name, expression.this)


def _build_sort_array_desc(args: t.List) -> exp.Expression:
    return exp.SortArray(this=seq_get(args, 0), asc=exp.false())


def _build_date_diff(args: t.List) -> exp.Expression:
    return exp.DateDiff(this=seq_get(args, 2), expression=seq_get(args, 1), unit=seq_get(args, 0))


def _build_generate_series(end_exclusive: bool = False) -> t.Callable[[t.List], exp.GenerateSeries]:
    def _builder(args: t.List) -> exp.GenerateSeries:
        # Check https://duckdb.org/docs/sql/functions/nested.html#range-functions
        if len(args) == 1:
            # DuckDB uses 0 as a default for the series' start when it's omitted
            args.insert(0, exp.Literal.number("0"))

        gen_series = exp.GenerateSeries.from_arg_list(args)
        gen_series.set("is_end_exclusive", end_exclusive)

        return gen_series

    return _builder


def _build_make_timestamp(args: t.List) -> exp.Expression:
    if len(args) == 1:
        return exp.UnixToTime(this=seq_get(args, 0), scale=exp.UnixToTime.MICROS)

    return exp.TimestampFromParts(
        year=seq_get(args, 0),
        month=seq_get(args, 1),
        day=seq_get(args, 2),
        hour=seq_get(args, 3),
        min=seq_get(args, 4),
        sec=seq_get(args, 5),
    )


def _struct_sql(self: DuckDB.Generator, expression: exp.Struct) -> str:
    args: t.List[str] = []

    # BigQuery allows inline construction such as "STRUCT<a STRING, b INTEGER>('str', 1)" which is
    # canonicalized to "ROW('str', 1) AS STRUCT(a TEXT, b INT)" in DuckDB
    # The transformation to ROW will take place if:
    #  1. The STRUCT itself does not have proper fields (key := value) as a "proper" STRUCT would
    #  2. A cast to STRUCT / ARRAY of STRUCTs is found
    ancestor_cast = expression.find_ancestor(exp.Cast)
    is_bq_inline_struct = (
        (expression.find(exp.PropertyEQ) is None)
        and ancestor_cast
        and any(
            casted_type.is_type(exp.DataType.Type.STRUCT)
            for casted_type in ancestor_cast.find_all(exp.DataType)
        )
    )

    for i, expr in enumerate(expression.expressions):
        is_property_eq = isinstance(expr, exp.PropertyEQ)
        value = expr.expression if is_property_eq else expr

        if is_bq_inline_struct:
            args.append(self.sql(value))
        else:
            key = expr.name if is_property_eq else f"_{i}"
            args.append(f"{self.sql(exp.Literal.string(key))}: {self.sql(value)}")

    csv_args = ", ".join(args)

    return f"ROW({csv_args})" if is_bq_inline_struct else f"{{{csv_args}}}"


def _datatype_sql(self: DuckDB.Generator, expression: exp.DataType) -> str:
    if expression.is_type("array"):
        return f"{self.expressions(expression, flat=True)}[{self.expressions(expression, key='values', flat=True)}]"

    # Modifiers are not supported for TIME, [TIME | TIMESTAMP] WITH TIME ZONE
    if expression.is_type(
        exp.DataType.Type.TIME, exp.DataType.Type.TIMETZ, exp.DataType.Type.TIMESTAMPTZ
    ):
        return expression.this.value

    return self.datatype_sql(expression)


def _json_format_sql(self: DuckDB.Generator, expression: exp.JSONFormat) -> str:
    sql = self.func("TO_JSON", expression.this, expression.args.get("options"))
    return f"CAST({sql} AS TEXT)"


def _unix_to_time_sql(self: DuckDB.Generator, expression: exp.UnixToTime) -> str:
    scale = expression.args.get("scale")
    timestamp = expression.this

    if scale in (None, exp.UnixToTime.SECONDS):
        return self.func("TO_TIMESTAMP", timestamp)
    if scale == exp.UnixToTime.MILLIS:
        return self.func("EPOCH_MS", timestamp)
    if scale == exp.UnixToTime.MICROS:
        return self.func("MAKE_TIMESTAMP", timestamp)

    return self.func("TO_TIMESTAMP", exp.Div(this=timestamp, expression=exp.func("POW", 10, scale)))


WRAPPED_JSON_EXTRACT_EXPRESSIONS = (exp.Binary, exp.Bracket, exp.In)


def _arrow_json_extract_sql(self: DuckDB.Generator, expression: JSON_EXTRACT_TYPE) -> str:
    arrow_sql = arrow_json_extract_sql(self, expression)
    if not expression.same_parent and isinstance(
        expression.parent, WRAPPED_JSON_EXTRACT_EXPRESSIONS
    ):
        arrow_sql = self.wrap(arrow_sql)
    return arrow_sql


def _implicit_datetime_cast(
    arg: t.Optional[exp.Expression], type: exp.DataType.Type = exp.DataType.Type.DATE
) -> t.Optional[exp.Expression]:
    return exp.cast(arg, type) if isinstance(arg, exp.Literal) else arg


def _date_diff_sql(self: DuckDB.Generator, expression: exp.DateDiff) -> str:
    this = _implicit_datetime_cast(expression.this)
    expr = _implicit_datetime_cast(expression.expression)

    return self.func("DATE_DIFF", unit_to_str(expression), expr, this)


def _generate_datetime_array_sql(
    self: DuckDB.Generator, expression: t.Union[exp.GenerateDateArray, exp.GenerateTimestampArray]
) -> str:
    is_generate_date_array = isinstance(expression, exp.GenerateDateArray)

    type = exp.DataType.Type.DATE if is_generate_date_array else exp.DataType.Type.TIMESTAMP
    start = _implicit_datetime_cast(expression.args.get("start"), type=type)
    end = _implicit_datetime_cast(expression.args.get("end"), type=type)

    # BQ's GENERATE_DATE_ARRAY & GENERATE_TIMESTAMP_ARRAY are transformed to DuckDB'S GENERATE_SERIES
    gen_series: t.Union[exp.GenerateSeries, exp.Cast] = exp.GenerateSeries(
        start=start, end=end, step=expression.args.get("step")
    )

    if is_generate_date_array:
        # The GENERATE_SERIES result type is TIMESTAMP array, so to match BQ's semantics for
        # GENERATE_DATE_ARRAY we must cast it back to DATE array
        gen_series = exp.cast(gen_series, exp.DataType.build("ARRAY<DATE>"))

    return self.sql(gen_series)


def _json_extract_value_array_sql(
    self: DuckDB.Generator, expression: exp.JSONValueArray | exp.JSONExtractArray
) -> str:
    json_extract = exp.JSONExtract(this=expression.this, expression=expression.expression)
    data_type = "ARRAY<STRING>" if isinstance(expression, exp.JSONValueArray) else "ARRAY<JSON>"
    return self.sql(exp.cast(json_extract, to=exp.DataType.build(data_type)))


class DuckDB(Dialect):
    NULL_ORDERING = "nulls_are_last"
    SUPPORTS_USER_DEFINED_TYPES = False
    SAFE_DIVISION = True
    INDEX_OFFSET = 1
    CONCAT_COALESCE = True
    SUPPORTS_ORDER_BY_ALL = True
    SUPPORTS_FIXED_SIZE_ARRAYS = True
    STRICT_JSON_PATH_SYNTAX = False

    # https://duckdb.org/docs/sql/introduction.html#creating-a-new-table
    NORMALIZATION_STRATEGY = NormalizationStrategy.CASE_INSENSITIVE

    def to_json_path(self, path: t.Optional[exp.Expression]) -> t.Optional[exp.Expression]:
        if isinstance(path, exp.Literal):
            # DuckDB also supports the JSON pointer syntax, where every path starts with a `/`.
            # Additionally, it allows accessing the back of lists using the `[#-i]` syntax.
            # This check ensures we'll avoid trying to parse these as JSON paths, which can
            # either result in a noisy warning or in an invalid representation of the path.
            path_text = path.name
            if path_text.startswith("/") or "[#" in path_text:
                return path

        return super().to_json_path(path)

    class Tokenizer(tokens.Tokenizer):
        HEREDOC_STRINGS = ["$"]

        HEREDOC_TAG_IS_IDENTIFIER = True
        HEREDOC_STRING_ALTERNATIVE = TokenType.PARAMETER

        KEYWORDS = {
            **tokens.Tokenizer.KEYWORDS,
            "//": TokenType.DIV,
            "**": TokenType.DSTAR,
            "^@": TokenType.CARET_AT,
            "@>": TokenType.AT_GT,
            "<@": TokenType.LT_AT,
            "ATTACH": TokenType.ATTACH,
            "BINARY": TokenType.VARBINARY,
            "BITSTRING": TokenType.BIT,
            "BPCHAR": TokenType.TEXT,
            "CHAR": TokenType.TEXT,
            "CHARACTER VARYING": TokenType.TEXT,
            "DETACH": TokenType.DETACH,
            "EXCLUDE": TokenType.EXCEPT,
            "LOGICAL": TokenType.BOOLEAN,
            "ONLY": TokenType.ONLY,
            "PIVOT_WIDER": TokenType.PIVOT,
            "POSITIONAL": TokenType.POSITIONAL,
            "SIGNED": TokenType.INT,
            "STRING": TokenType.TEXT,
            "SUMMARIZE": TokenType.SUMMARIZE,
            "TIMESTAMP_S": TokenType.TIMESTAMP_S,
            "TIMESTAMP_MS": TokenType.TIMESTAMP_MS,
            "TIMESTAMP_NS": TokenType.TIMESTAMP_NS,
            "TIMESTAMP_US": TokenType.TIMESTAMP,
            "UBIGINT": TokenType.UBIGINT,
            "UINTEGER": TokenType.UINT,
            "USMALLINT": TokenType.USMALLINT,
            "UTINYINT": TokenType.UTINYINT,
            "VARCHAR": TokenType.TEXT,
        }
        KEYWORDS.pop("/*+")

        SINGLE_TOKENS = {
            **tokens.Tokenizer.SINGLE_TOKENS,
            "$": TokenType.PARAMETER,
        }

    class Parser(parser.Parser):
        BITWISE = {
            **parser.Parser.BITWISE,
            TokenType.TILDA: exp.RegexpLike,
        }
        BITWISE.pop(TokenType.CARET)

        RANGE_PARSERS = {
            **parser.Parser.RANGE_PARSERS,
            TokenType.DAMP: binary_range_parser(exp.ArrayOverlaps),
            TokenType.CARET_AT: binary_range_parser(exp.StartsWith),
        }

        EXPONENT = {
            **parser.Parser.EXPONENT,
            TokenType.CARET: exp.Pow,
            TokenType.DSTAR: exp.Pow,
        }

        FUNCTIONS_WITH_ALIASED_ARGS = {*parser.Parser.FUNCTIONS_WITH_ALIASED_ARGS, "STRUCT_PACK"}

        FUNCTIONS = {
            **parser.Parser.FUNCTIONS,
            "ARRAY_REVERSE_SORT": _build_sort_array_desc,
            "ARRAY_SORT": exp.SortArray.from_arg_list,
            "DATEDIFF": _build_date_diff,
            "DATE_DIFF": _build_date_diff,
            "DATE_TRUNC": date_trunc_to_time,
            "DATETRUNC": date_trunc_to_time,
            "DECODE": lambda args: exp.Decode(
                this=seq_get(args, 0), charset=exp.Literal.string("utf-8")
            ),
            "ENCODE": lambda args: exp.Encode(
                this=seq_get(args, 0), charset=exp.Literal.string("utf-8")
            ),
            "EPOCH": exp.TimeToUnix.from_arg_list,
            "EPOCH_MS": lambda args: exp.UnixToTime(
                this=seq_get(args, 0), scale=exp.UnixToTime.MILLIS
            ),
            "JSON": exp.ParseJSON.from_arg_list,
            "JSON_EXTRACT_PATH": parser.build_extract_json_with_path(exp.JSONExtract),
            "JSON_EXTRACT_STRING": parser.build_extract_json_with_path(exp.JSONExtractScalar),
            "LIST_HAS": exp.ArrayContains.from_arg_list,
            "LIST_REVERSE_SORT": _build_sort_array_desc,
            "LIST_SORT": exp.SortArray.from_arg_list,
            "LIST_VALUE": lambda args: exp.Array(expressions=args),
            "MAKE_TIME": exp.TimeFromParts.from_arg_list,
            "MAKE_TIMESTAMP": _build_make_timestamp,
            "QUANTILE_CONT": exp.PercentileCont.from_arg_list,
            "QUANTILE_DISC": exp.PercentileDisc.from_arg_list,
            "REGEXP_EXTRACT": build_regexp_extract(exp.RegexpExtract),
            "REGEXP_EXTRACT_ALL": build_regexp_extract(exp.RegexpExtractAll),
            "REGEXP_MATCHES": exp.RegexpLike.from_arg_list,
            "REGEXP_REPLACE": lambda args: exp.RegexpReplace(
                this=seq_get(args, 0),
                expression=seq_get(args, 1),
                replacement=seq_get(args, 2),
                modifiers=seq_get(args, 3),
            ),
            "STRFTIME": build_formatted_time(exp.TimeToStr, "duckdb"),
            "STRING_SPLIT": exp.Split.from_arg_list,
            "STRING_SPLIT_REGEX": exp.RegexpSplit.from_arg_list,
            "STRING_TO_ARRAY": exp.Split.from_arg_list,
            "STRPTIME": build_formatted_time(exp.StrToTime, "duckdb"),
            "STRUCT_PACK": exp.Struct.from_arg_list,
            "STR_SPLIT": exp.Split.from_arg_list,
            "STR_SPLIT_REGEX": exp.RegexpSplit.from_arg_list,
            "TO_TIMESTAMP": exp.UnixToTime.from_arg_list,
            "UNNEST": exp.Explode.from_arg_list,
            "XOR": binary_from_function(exp.BitwiseXor),
            "GENERATE_SERIES": _build_generate_series(),
            "RANGE": _build_generate_series(end_exclusive=True),
            "EDITDIST3": exp.Levenshtein.from_arg_list,
        }

        FUNCTIONS.pop("DATE_SUB")
        FUNCTIONS.pop("GLOB")

        FUNCTION_PARSERS = parser.Parser.FUNCTION_PARSERS.copy()
        FUNCTION_PARSERS.pop("DECODE")

        NO_PAREN_FUNCTION_PARSERS = {
            **parser.Parser.NO_PAREN_FUNCTION_PARSERS,
            "MAP": lambda self: self._parse_map(),
        }

        TABLE_ALIAS_TOKENS = parser.Parser.TABLE_ALIAS_TOKENS - {
            TokenType.SEMI,
            TokenType.ANTI,
        }

        PLACEHOLDER_PARSERS = {
            **parser.Parser.PLACEHOLDER_PARSERS,
            TokenType.PARAMETER: lambda self: (
                self.expression(exp.Placeholder, this=self._prev.text)
                if self._match(TokenType.NUMBER) or self._match_set(self.ID_VAR_TOKENS)
                else None
            ),
        }

        TYPE_CONVERTERS = {
            # https://duckdb.org/docs/sql/data_types/numeric
            exp.DataType.Type.DECIMAL: build_default_decimal_type(precision=18, scale=3),
            # https://duckdb.org/docs/sql/data_types/text
            exp.DataType.Type.TEXT: lambda dtype: exp.DataType.build("TEXT"),
        }

        STATEMENT_PARSERS = {
            **parser.Parser.STATEMENT_PARSERS,
            TokenType.ATTACH: lambda self: self._parse_attach_detach(),
            TokenType.DETACH: lambda self: self._parse_attach_detach(is_attach=False),
        }

        def _parse_table_sample(self, as_modifier: bool = False) -> t.Optional[exp.TableSample]:
            # https://duckdb.org/docs/sql/samples.html
            sample = super()._parse_table_sample(as_modifier=as_modifier)
            if sample and not sample.args.get("method"):
                if sample.args.get("size"):
                    sample.set("method", exp.var("RESERVOIR"))
                else:
                    sample.set("method", exp.var("SYSTEM"))

            return sample

        def _parse_bracket(
            self, this: t.Optional[exp.Expression] = None
        ) -> t.Optional[exp.Expression]:
            bracket = super()._parse_bracket(this)
            if isinstance(bracket, exp.Bracket):
                bracket.set("returns_list_for_maps", True)

            return bracket

        def _parse_map(self) -> exp.ToMap | exp.Map:
            if self._match(TokenType.L_BRACE, advance=False):
                return self.expression(exp.ToMap, this=self._parse_bracket())

            args = self._parse_wrapped_csv(self._parse_assignment)
            return self.expression(exp.Map, keys=seq_get(args, 0), values=seq_get(args, 1))

        def _parse_struct_types(self, type_required: bool = False) -> t.Optional[exp.Expression]:
            return self._parse_field_def()

        def _pivot_column_names(self, aggregations: t.List[exp.Expression]) -> t.List[str]:
            if len(aggregations) == 1:
                return super()._pivot_column_names(aggregations)
            return pivot_column_names(aggregations, dialect="duckdb")

        def _parse_attach_detach(self, is_attach=True) -> exp.Attach | exp.Detach:
            def _parse_attach_option() -> exp.AttachOption:
                return self.expression(
                    exp.AttachOption,
                    this=self._parse_var(any_token=True),
                    expression=self._parse_field(any_token=True),
                )

            self._match(TokenType.DATABASE)
            exists = self._parse_exists(not_=is_attach)
            this = self._parse_alias(self._parse_primary_or_var(), explicit=True)

            if self._match(TokenType.L_PAREN, advance=False):
                expressions = self._parse_wrapped_csv(_parse_attach_option)
            else:
                expressions = None

            return (
                self.expression(exp.Attach, this=this, exists=exists, expressions=expressions)
                if is_attach
                else self.expression(exp.Detach, this=this, exists=exists)
            )

    class Generator(generator.Generator):
        PARAMETER_TOKEN = "$"
        NAMED_PLACEHOLDER_TOKEN = "$"
        JOIN_HINTS = False
        TABLE_HINTS = False
        QUERY_HINTS = False
        LIMIT_FETCH = "LIMIT"
        STRUCT_DELIMITER = ("(", ")")
        RENAME_TABLE_WITH_DB = False
        NVL2_SUPPORTED = False
        SEMI_ANTI_JOIN_WITH_SIDE = False
        TABLESAMPLE_KEYWORDS = "USING SAMPLE"
        TABLESAMPLE_SEED_KEYWORD = "REPEATABLE"
        LAST_DAY_SUPPORTS_DATE_PART = False
        JSON_KEY_VALUE_PAIR_SEP = ","
        IGNORE_NULLS_IN_FUNC = True
        JSON_PATH_BRACKETED_KEY_SUPPORTED = False
        SUPPORTS_CREATE_TABLE_LIKE = False
        MULTI_ARG_DISTINCT = False
        CAN_IMPLEMENT_ARRAY_ANY = True
        SUPPORTS_TO_NUMBER = False
        COPY_HAS_INTO_KEYWORD = False
        STAR_EXCEPT = "EXCLUDE"
        PAD_FILL_PATTERN_IS_REQUIRED = True
        ARRAY_CONCAT_IS_VAR_LEN = False
        ARRAY_SIZE_DIM_REQUIRED = False

        TRANSFORMS = {
            **generator.Generator.TRANSFORMS,
            exp.ApproxDistinct: approx_count_distinct_sql,
            exp.Array: inline_array_unless_query,
            exp.ArrayFilter: rename_func("LIST_FILTER"),
            exp.ArraySort: _array_sort_sql,
            exp.ArraySum: rename_func("LIST_SUM"),
            exp.BitwiseXor: rename_func("XOR"),
            exp.CommentColumnConstraint: no_comment_column_constraint_sql,
            exp.CurrentDate: lambda *_: "CURRENT_DATE",
            exp.CurrentTime: lambda *_: "CURRENT_TIME",
            exp.CurrentTimestamp: lambda *_: "CURRENT_TIMESTAMP",
            exp.DayOfMonth: rename_func("DAYOFMONTH"),
            exp.DayOfWeek: rename_func("DAYOFWEEK"),
            exp.DayOfWeekIso: rename_func("ISODOW"),
            exp.DayOfYear: rename_func("DAYOFYEAR"),
            exp.DataType: _datatype_sql,
            exp.Date: _date_sql,
            exp.DateAdd: _date_delta_sql,
            exp.DateFromParts: rename_func("MAKE_DATE"),
            exp.DateSub: _date_delta_sql,
            exp.DateDiff: _date_diff_sql,
            exp.DateStrToDate: datestrtodate_sql,
            exp.Datetime: no_datetime_sql,
            exp.DatetimeSub: _date_delta_sql,
            exp.DatetimeAdd: _date_delta_sql,
            exp.DateToDi: lambda self,
            e: f"CAST(STRFTIME({self.sql(e, 'this')}, {DuckDB.DATEINT_FORMAT}) AS INT)",
            exp.Decode: lambda self, e: encode_decode_sql(self, e, "DECODE", replace=False),
            exp.DiToDate: lambda self,
            e: f"CAST(STRPTIME(CAST({self.sql(e, 'this')} AS TEXT), {DuckDB.DATEINT_FORMAT}) AS DATE)",
            exp.Encode: lambda self, e: encode_decode_sql(self, e, "ENCODE", replace=False),
            exp.GenerateDateArray: _generate_datetime_array_sql,
            exp.GenerateTimestampArray: _generate_datetime_array_sql,
            exp.Explode: rename_func("UNNEST"),
            exp.IntDiv: lambda self, e: self.binary(e, "//"),
            exp.IsInf: rename_func("ISINF"),
            exp.IsNan: rename_func("ISNAN"),
            exp.JSONBExists: rename_func("JSON_EXISTS"),
            exp.JSONExtract: _arrow_json_extract_sql,
            exp.JSONExtractArray: _json_extract_value_array_sql,
            exp.JSONExtractScalar: _arrow_json_extract_sql,
            exp.JSONFormat: _json_format_sql,
            exp.JSONValueArray: _json_extract_value_array_sql,
            exp.Lateral: explode_to_unnest_sql,
            exp.LogicalOr: rename_func("BOOL_OR"),
            exp.LogicalAnd: rename_func("BOOL_AND"),
            exp.MakeInterval: lambda self, e: no_make_interval_sql(self, e, sep=" "),
            exp.MD5Digest: lambda self, e: self.func("UNHEX", self.func("MD5", e.this)),
            exp.MonthsBetween: lambda self, e: self.func(
                "DATEDIFF",
                "'month'",
                exp.cast(e.expression, exp.DataType.Type.TIMESTAMP, copy=True),
                exp.cast(e.this, exp.DataType.Type.TIMESTAMP, copy=True),
            ),
            exp.PercentileCont: rename_func("QUANTILE_CONT"),
            exp.PercentileDisc: rename_func("QUANTILE_DISC"),
            # DuckDB doesn't allow qualified columns inside of PIVOT expressions.
            # See: https://github.com/duckdb/duckdb/blob/671faf92411182f81dce42ac43de8bfb05d9909e/src/planner/binder/tableref/bind_pivot.cpp#L61-L62
            exp.Pivot: transforms.preprocess([transforms.unqualify_columns]),
            exp.RegexpReplace: lambda self, e: self.func(
                "REGEXP_REPLACE",
                e.this,
                e.expression,
                e.args.get("replacement"),
                e.args.get("modifiers"),
            ),
            exp.RegexpLike: rename_func("REGEXP_MATCHES"),
            exp.RegexpSplit: rename_func("STR_SPLIT_REGEX"),
            exp.Return: lambda self, e: self.sql(e, "this"),
            exp.ReturnsProperty: lambda self, e: "TABLE" if isinstance(e.this, exp.Schema) else "",
            exp.Rand: rename_func("RANDOM"),
            exp.SafeDivide: no_safe_divide_sql,
            exp.SHA: rename_func("SHA1"),
            exp.SHA2: sha256_sql,
            exp.Split: rename_func("STR_SPLIT"),
            exp.SortArray: _sort_array_sql,
            exp.StrPosition: str_position_sql,
            exp.StrToUnix: lambda self, e: self.func(
                "EPOCH", self.func("STRPTIME", e.this, self.format_time(e))
            ),
            exp.Struct: _struct_sql,
            exp.Transform: rename_func("LIST_TRANSFORM"),
            exp.TimeAdd: _date_delta_sql,
            exp.Time: no_time_sql,
            exp.TimeDiff: _timediff_sql,
            exp.Timestamp: no_timestamp_sql,
            exp.TimestampDiff: lambda self, e: self.func(
                "DATE_DIFF", exp.Literal.string(e.unit), e.expression, e.this
            ),
            exp.TimestampTrunc: timestamptrunc_sql(),
            exp.TimeStrToDate: lambda self, e: self.sql(exp.cast(e.this, exp.DataType.Type.DATE)),
            exp.TimeStrToTime: timestrtotime_sql,
            exp.TimeStrToUnix: lambda self, e: self.func(
                "EPOCH", exp.cast(e.this, exp.DataType.Type.TIMESTAMP)
            ),
            exp.TimeToStr: lambda self, e: self.func("STRFTIME", e.this, self.format_time(e)),
            exp.TimeToUnix: rename_func("EPOCH"),
            exp.TsOrDiToDi: lambda self,
            e: f"CAST(SUBSTR(REPLACE(CAST({self.sql(e, 'this')} AS TEXT), '-', ''), 1, 8) AS INT)",
            exp.TsOrDsAdd: _date_delta_sql,
            exp.TsOrDsDiff: lambda self, e: self.func(
                "DATE_DIFF",
                f"'{e.args.get('unit') or 'DAY'}'",
                exp.cast(e.expression, exp.DataType.Type.TIMESTAMP),
                exp.cast(e.this, exp.DataType.Type.TIMESTAMP),
            ),
            exp.UnixToStr: lambda self, e: self.func(
                "STRFTIME", self.func("TO_TIMESTAMP", e.this), self.format_time(e)
            ),
            exp.DatetimeTrunc: lambda self, e: self.func(
                "DATE_TRUNC", unit_to_str(e), exp.cast(e.this, exp.DataType.Type.DATETIME)
            ),
            exp.UnixToTime: _unix_to_time_sql,
            exp.UnixToTimeStr: lambda self, e: f"CAST(TO_TIMESTAMP({self.sql(e, 'this')}) AS TEXT)",
            exp.VariancePop: rename_func("VAR_POP"),
            exp.WeekOfYear: rename_func("WEEKOFYEAR"),
            exp.Xor: bool_xor_sql,
            exp.Levenshtein: unsupported_args("ins_cost", "del_cost", "sub_cost", "max_dist")(
                rename_func("LEVENSHTEIN")
            ),
        }

        SUPPORTED_JSON_PATH_PARTS = {
            exp.JSONPathKey,
            exp.JSONPathRoot,
            exp.JSONPathSubscript,
            exp.JSONPathWildcard,
        }

        TYPE_MAPPING = {
            **generator.Generator.TYPE_MAPPING,
            exp.DataType.Type.BINARY: "BLOB",
            exp.DataType.Type.BPCHAR: "TEXT",
            exp.DataType.Type.CHAR: "TEXT",
            exp.DataType.Type.DATETIME: "TIMESTAMP",
            exp.DataType.Type.FLOAT: "REAL",
            exp.DataType.Type.NCHAR: "TEXT",
            exp.DataType.Type.NVARCHAR: "TEXT",
            exp.DataType.Type.UINT: "UINTEGER",
            exp.DataType.Type.VARBINARY: "BLOB",
            exp.DataType.Type.ROWVERSION: "BLOB",
            exp.DataType.Type.VARCHAR: "TEXT",
            exp.DataType.Type.TIMESTAMPNTZ: "TIMESTAMP",
            exp.DataType.Type.TIMESTAMP_S: "TIMESTAMP_S",
            exp.DataType.Type.TIMESTAMP_MS: "TIMESTAMP_MS",
            exp.DataType.Type.TIMESTAMP_NS: "TIMESTAMP_NS",
        }

        # https://github.com/duckdb/duckdb/blob/ff7f24fd8e3128d94371827523dae85ebaf58713/third_party/libpg_query/grammar/keywords/reserved_keywords.list#L1-L77
        RESERVED_KEYWORDS = {
            "array",
            "analyse",
            "union",
            "all",
            "when",
            "in_p",
            "default",
            "create_p",
            "window",
            "asymmetric",
            "to",
            "else",
            "localtime",
            "from",
            "end_p",
            "select",
            "current_date",
            "foreign",
            "with",
            "grant",
            "session_user",
            "or",
            "except",
            "references",
            "fetch",
            "limit",
            "group_p",
            "leading",
            "into",
            "collate",
            "offset",
            "do",
            "then",
            "localtimestamp",
            "check_p",
            "lateral_p",
            "current_role",
            "where",
            "asc_p",
            "placing",
            "desc_p",
            "user",
            "unique",
            "initially",
            "column",
            "both",
            "some",
            "as",
            "any",
            "only",
            "deferrable",
            "null_p",
            "current_time",
            "true_p",
            "table",
            "case",
            "trailing",
            "variadic",
            "for",
            "on",
            "distinct",
            "false_p",
            "not",
            "constraint",
            "current_timestamp",
            "returning",
            "primary",
            "intersect",
            "having",
            "analyze",
            "current_user",
            "and",
            "cast",
            "symmetric",
            "using",
            "order",
            "current_catalog",
        }

        UNWRAPPED_INTERVAL_VALUES = (exp.Literal, exp.Paren)

        # DuckDB doesn't generally support CREATE TABLE .. properties
        # https://duckdb.org/docs/sql/statements/create_table.html
        PROPERTIES_LOCATION = {
            prop: exp.Properties.Location.UNSUPPORTED
            for prop in generator.Generator.PROPERTIES_LOCATION
        }

        # There are a few exceptions (e.g. temporary tables) which are supported or
        # can be transpiled to DuckDB, so we explicitly override them accordingly
        PROPERTIES_LOCATION[exp.LikeProperty] = exp.Properties.Location.POST_SCHEMA
        PROPERTIES_LOCATION[exp.TemporaryProperty] = exp.Properties.Location.POST_CREATE
        PROPERTIES_LOCATION[exp.ReturnsProperty] = exp.Properties.Location.POST_ALIAS

        def fromiso8601timestamp_sql(self, expression: exp.FromISO8601Timestamp) -> str:
            return self.sql(exp.cast(expression.this, exp.DataType.Type.TIMESTAMPTZ))

        def strtotime_sql(self, expression: exp.StrToTime) -> str:
            if expression.args.get("safe"):
                formatted_time = self.format_time(expression)
                return f"CAST({self.func('TRY_STRPTIME', expression.this, formatted_time)} AS TIMESTAMP)"
            return str_to_time_sql(self, expression)

        def strtodate_sql(self, expression: exp.StrToDate) -> str:
            if expression.args.get("safe"):
                formatted_time = self.format_time(expression)
                return f"CAST({self.func('TRY_STRPTIME', expression.this, formatted_time)} AS DATE)"
            return f"CAST({str_to_time_sql(self, expression)} AS DATE)"

        def parsejson_sql(self, expression: exp.ParseJSON) -> str:
            arg = expression.this
            if expression.args.get("safe"):
                return self.sql(exp.case().when(exp.func("json_valid", arg), arg).else_(exp.null()))
            return self.func("JSON", arg)

        def timefromparts_sql(self, expression: exp.TimeFromParts) -> str:
            nano = expression.args.get("nano")
            if nano is not None:
                expression.set(
                    "sec", expression.args["sec"] + nano.pop() / exp.Literal.number(1000000000.0)
                )

            return rename_func("MAKE_TIME")(self, expression)

        def timestampfromparts_sql(self, expression: exp.TimestampFromParts) -> str:
            sec = expression.args["sec"]

            milli = expression.args.get("milli")
            if milli is not None:
                sec += milli.pop() / exp.Literal.number(1000.0)

            nano = expression.args.get("nano")
            if nano is not None:
                sec += nano.pop() / exp.Literal.number(1000000000.0)

            if milli or nano:
                expression.set("sec", sec)

            return rename_func("MAKE_TIMESTAMP")(self, expression)

        def tablesample_sql(
            self,
            expression: exp.TableSample,
            tablesample_keyword: t.Optional[str] = None,
        ) -> str:
            if not isinstance(expression.parent, exp.Select):
                # This sample clause only applies to a single source, not the entire resulting relation
                tablesample_keyword = "TABLESAMPLE"

            if expression.args.get("size"):
                method = expression.args.get("method")
                if method and method.name.upper() != "RESERVOIR":
                    self.unsupported(
                        f"Sampling method {method} is not supported with a discrete sample count, "
                        "defaulting to reservoir sampling"
                    )
                    expression.set("method", exp.var("RESERVOIR"))

            return super().tablesample_sql(expression, tablesample_keyword=tablesample_keyword)

        def interval_sql(self, expression: exp.Interval) -> str:
            multiplier: t.Optional[int] = None
            unit = expression.text("unit").lower()

            if unit.startswith("week"):
                multiplier = 7
            if unit.startswith("quarter"):
                multiplier = 90

            if multiplier:
                return f"({multiplier} * {super().interval_sql(exp.Interval(this=expression.this, unit=exp.var('DAY')))})"

            return super().interval_sql(expression)

        def columndef_sql(self, expression: exp.ColumnDef, sep: str = " ") -> str:
            if isinstance(expression.parent, exp.UserDefinedFunction):
                return self.sql(expression, "this")
            return super().columndef_sql(expression, sep)

        def join_sql(self, expression: exp.Join) -> str:
            if (
                expression.side == "LEFT"
                and not expression.args.get("on")
                and isinstance(expression.this, exp.Unnest)
            ):
                # Some dialects support `LEFT JOIN UNNEST(...)` without an explicit ON clause
                # DuckDB doesn't, but we can just add a dummy ON clause that is always true
                return super().join_sql(expression.on(exp.true()))

            return super().join_sql(expression)

        def generateseries_sql(self, expression: exp.GenerateSeries) -> str:
            # GENERATE_SERIES(a, b) -> [a, b], RANGE(a, b) -> [a, b)
            if expression.args.get("is_end_exclusive"):
                return rename_func("RANGE")(self, expression)

            return self.function_fallback_sql(expression)

        def bracket_sql(self, expression: exp.Bracket) -> str:
            this = expression.this
            if isinstance(this, exp.Array):
                this.replace(exp.paren(this))

            bracket = super().bracket_sql(expression)

            if not expression.args.get("returns_list_for_maps"):
                if not this.type:
                    from sqlglot.optimizer.annotate_types import annotate_types

                    this = annotate_types(this)

                if this.is_type(exp.DataType.Type.MAP):
                    bracket = f"({bracket})[1]"

            return bracket

        def withingroup_sql(self, expression: exp.WithinGroup) -> str:
            expression_sql = self.sql(expression, "expression")

            func = expression.this
            if isinstance(func, exp.PERCENTILES):
                # Make the order key the first arg and slide the fraction to the right
                # https://duckdb.org/docs/sql/aggregates#ordered-set-aggregate-functions
                order_col = expression.find(exp.Ordered)
                if order_col:
                    func.set("expression", func.this)
                    func.set("this", order_col.this)

            this = self.sql(expression, "this").rstrip(")")

            return f"{this}{expression_sql})"

        def length_sql(self, expression: exp.Length) -> str:
            arg = expression.this

            # Dialects like BQ and Snowflake also accept binary values as args, so
            # DDB will attempt to infer the type or resort to case/when resolution
            if not expression.args.get("binary") or arg.is_string:
                return self.func("LENGTH", arg)

            if not arg.type:
                from sqlglot.optimizer.annotate_types import annotate_types

                arg = annotate_types(arg)

            if arg.is_type(*exp.DataType.TEXT_TYPES):
                return self.func("LENGTH", arg)

            # We need these casts to make duckdb's static type checker happy
            blob = exp.cast(arg, exp.DataType.Type.VARBINARY)
            varchar = exp.cast(arg, exp.DataType.Type.VARCHAR)

            case = (
                exp.case(self.func("TYPEOF", arg))
                .when(
                    "'VARCHAR'", exp.Anonymous(this="LENGTH", expressions=[varchar])
                )  # anonymous to break length_sql recursion
                .when("'BLOB'", self.func("OCTET_LENGTH", blob))
            )

            return self.sql(case)

        def objectinsert_sql(self, expression: exp.ObjectInsert) -> str:
            this = expression.this
            key = expression.args.get("key")
            key_sql = key.name if isinstance(key, exp.Expression) else ""
            value_sql = self.sql(expression, "value")

            kv_sql = f"{key_sql} := {value_sql}"

            # If the input struct is empty e.g. transpiling OBJECT_INSERT(OBJECT_CONSTRUCT(), key, value) from Snowflake
            # then we can generate STRUCT_PACK which will build it since STRUCT_INSERT({}, key := value) is not valid DuckDB
            if isinstance(this, exp.Struct) and not this.expressions:
                return self.func("STRUCT_PACK", kv_sql)

            return self.func("STRUCT_INSERT", this, kv_sql)

        def unnest_sql(self, expression: exp.Unnest) -> str:
            explode_array = expression.args.get("explode_array")
            if explode_array:
                # In BigQuery, UNNESTing a nested array leads to explosion of the top-level array & struct
                # This is transpiled to DDB by transforming "FROM UNNEST(...)" to "FROM (SELECT UNNEST(..., max_depth => 2))"
                expression.expressions.append(
                    exp.Kwarg(this=exp.var("max_depth"), expression=exp.Literal.number(2))
                )

                # If BQ's UNNEST is aliased, we transform it from a column alias to a table alias in DDB
                alias = expression.args.get("alias")
                if alias:
                    expression.set("alias", None)
                    alias = exp.TableAlias(this=seq_get(alias.args.get("columns"), 0))

                unnest_sql = super().unnest_sql(expression)
                select = exp.Select(expressions=[unnest_sql]).subquery(alias)
                return self.sql(select)

            return super().unnest_sql(expression)

        def ignorenulls_sql(self, expression: exp.IgnoreNulls) -> str:
            if isinstance(expression.this, WINDOW_FUNCS_WITH_IGNORE_NULLS):
                # DuckDB should render IGNORE NULLS only for the general-purpose
                # window functions that accept it e.g. FIRST_VALUE(... IGNORE NULLS) OVER (...)
                return super().ignorenulls_sql(expression)

            return self.sql(expression, "this")

        def arraytostring_sql(self, expression: exp.ArrayToString) -> str:
            this = self.sql(expression, "this")
            null_text = self.sql(expression, "null")

            if null_text:
                this = f"LIST_TRANSFORM({this}, x -> COALESCE(x, {null_text}))"

            return self.func("ARRAY_TO_STRING", this, expression.expression)

        @unsupported_args("position", "occurrence")
        def regexpextract_sql(self, expression: exp.RegexpExtract) -> str:
            group = expression.args.get("group")
            params = expression.args.get("parameters")

            # Do not render group if there is no following argument,
            # and it's the default value for this dialect
            if (
                not params
                and group
                and group.name == str(self.dialect.REGEXP_EXTRACT_DEFAULT_GROUP)
            ):
                group = None
            return self.func(
                "REGEXP_EXTRACT", expression.this, expression.expression, group, params
            )

        @unsupported_args("culture")
        def numbertostr_sql(self, expression: exp.NumberToStr) -> str:
            fmt = expression.args.get("format")
            if fmt and fmt.is_int:
                return self.func("FORMAT", f"'{{:,.{fmt.name}f}}'", expression.this)

            self.unsupported("Only integer formats are supported by NumberToStr")
            return self.function_fallback_sql(expression)
