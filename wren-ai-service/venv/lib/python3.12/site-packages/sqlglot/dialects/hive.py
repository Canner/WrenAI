from __future__ import annotations

import typing as t
from functools import partial

from sqlglot import exp, generator, parser, tokens, transforms
from sqlglot.dialects.dialect import (
    DATE_ADD_OR_SUB,
    Dialect,
    NormalizationStrategy,
    approx_count_distinct_sql,
    arg_max_or_min_no_count,
    datestrtodate_sql,
    build_formatted_time,
    if_sql,
    is_parse_json,
    left_to_substring_sql,
    locate_to_strposition,
    max_or_greatest,
    min_or_least,
    no_ilike_sql,
    no_recursive_cte_sql,
    no_safe_divide_sql,
    no_trycast_sql,
    regexp_extract_sql,
    regexp_replace_sql,
    rename_func,
    right_to_substring_sql,
    strposition_to_locate_sql,
    struct_extract_sql,
    time_format,
    timestrtotime_sql,
    unit_to_str,
    var_map_sql,
    sequence_sql,
    property_sql,
    build_regexp_extract,
)
from sqlglot.transforms import (
    remove_unique_constraints,
    ctas_with_tmp_tables_to_create_tmp_view,
    preprocess,
    move_schema_columns_to_partitioned_by,
)
from sqlglot.helper import seq_get
from sqlglot.tokens import TokenType
from sqlglot.generator import unsupported_args

# (FuncType, Multiplier)
DATE_DELTA_INTERVAL = {
    "YEAR": ("ADD_MONTHS", 12),
    "MONTH": ("ADD_MONTHS", 1),
    "QUARTER": ("ADD_MONTHS", 3),
    "WEEK": ("DATE_ADD", 7),
    "DAY": ("DATE_ADD", 1),
}

TIME_DIFF_FACTOR = {
    "MILLISECOND": " * 1000",
    "SECOND": "",
    "MINUTE": " / 60",
    "HOUR": " / 3600",
}

DIFF_MONTH_SWITCH = ("YEAR", "QUARTER", "MONTH")


def _add_date_sql(self: Hive.Generator, expression: DATE_ADD_OR_SUB) -> str:
    if isinstance(expression, exp.TsOrDsAdd) and not expression.unit:
        return self.func("DATE_ADD", expression.this, expression.expression)

    unit = expression.text("unit").upper()
    func, multiplier = DATE_DELTA_INTERVAL.get(unit, ("DATE_ADD", 1))

    if isinstance(expression, exp.DateSub):
        multiplier *= -1

    if expression.expression.is_number:
        modified_increment = exp.Literal.number(expression.expression.to_py() * multiplier)
    else:
        modified_increment = expression.expression
        if multiplier != 1:
            modified_increment = exp.Mul(  # type: ignore
                this=modified_increment, expression=exp.Literal.number(multiplier)
            )

    return self.func(func, expression.this, modified_increment)


def _date_diff_sql(self: Hive.Generator, expression: exp.DateDiff | exp.TsOrDsDiff) -> str:
    unit = expression.text("unit").upper()

    factor = TIME_DIFF_FACTOR.get(unit)
    if factor is not None:
        left = self.sql(expression, "this")
        right = self.sql(expression, "expression")
        sec_diff = f"UNIX_TIMESTAMP({left}) - UNIX_TIMESTAMP({right})"
        return f"({sec_diff}){factor}" if factor else sec_diff

    months_between = unit in DIFF_MONTH_SWITCH
    sql_func = "MONTHS_BETWEEN" if months_between else "DATEDIFF"
    _, multiplier = DATE_DELTA_INTERVAL.get(unit, ("", 1))
    multiplier_sql = f" / {multiplier}" if multiplier > 1 else ""
    diff_sql = f"{sql_func}({self.format_args(expression.this, expression.expression)})"

    if months_between or multiplier_sql:
        # MONTHS_BETWEEN returns a float, so we need to truncate the fractional part.
        # For the same reason, we want to truncate if there's a divisor present.
        diff_sql = f"CAST({diff_sql}{multiplier_sql} AS INT)"

    return diff_sql


def _json_format_sql(self: Hive.Generator, expression: exp.JSONFormat) -> str:
    this = expression.this

    if is_parse_json(this):
        if this.this.is_string:
            # Since FROM_JSON requires a nested type, we always wrap the json string with
            # an array to ensure that "naked" strings like "'a'" will be handled correctly
            wrapped_json = exp.Literal.string(f"[{this.this.name}]")

            from_json = self.func(
                "FROM_JSON", wrapped_json, self.func("SCHEMA_OF_JSON", wrapped_json)
            )
            to_json = self.func("TO_JSON", from_json)

            # This strips the [, ] delimiters of the dummy array printed by TO_JSON
            return self.func("REGEXP_EXTRACT", to_json, "'^.(.*).$'", "1")
        return self.sql(this)

    return self.func("TO_JSON", this, expression.args.get("options"))


@generator.unsupported_args(("expression", "Hive's SORT_ARRAY does not support a comparator."))
def _array_sort_sql(self: Hive.Generator, expression: exp.ArraySort) -> str:
    return self.func("SORT_ARRAY", expression.this)


def _str_to_unix_sql(self: Hive.Generator, expression: exp.StrToUnix) -> str:
    return self.func("UNIX_TIMESTAMP", expression.this, time_format("hive")(self, expression))


def _unix_to_time_sql(self: Hive.Generator, expression: exp.UnixToTime) -> str:
    timestamp = self.sql(expression, "this")
    scale = expression.args.get("scale")
    if scale in (None, exp.UnixToTime.SECONDS):
        return rename_func("FROM_UNIXTIME")(self, expression)

    return f"FROM_UNIXTIME({timestamp} / POW(10, {scale}))"


def _str_to_date_sql(self: Hive.Generator, expression: exp.StrToDate) -> str:
    this = self.sql(expression, "this")
    time_format = self.format_time(expression)
    if time_format not in (Hive.TIME_FORMAT, Hive.DATE_FORMAT):
        this = f"FROM_UNIXTIME(UNIX_TIMESTAMP({this}, {time_format}))"
    return f"CAST({this} AS DATE)"


def _str_to_time_sql(self: Hive.Generator, expression: exp.StrToTime) -> str:
    this = self.sql(expression, "this")
    time_format = self.format_time(expression)
    if time_format not in (Hive.TIME_FORMAT, Hive.DATE_FORMAT):
        this = f"FROM_UNIXTIME(UNIX_TIMESTAMP({this}, {time_format}))"
    return f"CAST({this} AS TIMESTAMP)"


def _to_date_sql(self: Hive.Generator, expression: exp.TsOrDsToDate) -> str:
    time_format = self.format_time(expression)
    if time_format and time_format not in (Hive.TIME_FORMAT, Hive.DATE_FORMAT):
        return self.func("TO_DATE", expression.this, time_format)

    if isinstance(expression.this, exp.TsOrDsToDate):
        return self.sql(expression, "this")

    return self.func("TO_DATE", expression.this)


def _build_with_ignore_nulls(
    exp_class: t.Type[exp.Expression],
) -> t.Callable[[t.List[exp.Expression]], exp.Expression]:
    def _parse(args: t.List[exp.Expression]) -> exp.Expression:
        this = exp_class(this=seq_get(args, 0))
        if seq_get(args, 1) == exp.true():
            return exp.IgnoreNulls(this=this)
        return this

    return _parse


class Hive(Dialect):
    ALIAS_POST_TABLESAMPLE = True
    IDENTIFIERS_CAN_START_WITH_DIGIT = True
    SUPPORTS_USER_DEFINED_TYPES = False
    SAFE_DIVISION = True
    ARRAY_AGG_INCLUDES_NULLS = None
    REGEXP_EXTRACT_DEFAULT_GROUP = 1

    # https://spark.apache.org/docs/latest/sql-ref-identifier.html#description
    NORMALIZATION_STRATEGY = NormalizationStrategy.CASE_INSENSITIVE

    TIME_MAPPING = {
        "y": "%Y",
        "Y": "%Y",
        "YYYY": "%Y",
        "yyyy": "%Y",
        "YY": "%y",
        "yy": "%y",
        "MMMM": "%B",
        "MMM": "%b",
        "MM": "%m",
        "M": "%-m",
        "dd": "%d",
        "d": "%-d",
        "HH": "%H",
        "H": "%-H",
        "hh": "%I",
        "h": "%-I",
        "mm": "%M",
        "m": "%-M",
        "ss": "%S",
        "s": "%-S",
        "SSSSSS": "%f",
        "a": "%p",
        "DD": "%j",
        "D": "%-j",
        "E": "%a",
        "EE": "%a",
        "EEE": "%a",
        "EEEE": "%A",
    }

    DATE_FORMAT = "'yyyy-MM-dd'"
    DATEINT_FORMAT = "'yyyyMMdd'"
    TIME_FORMAT = "'yyyy-MM-dd HH:mm:ss'"

    class Tokenizer(tokens.Tokenizer):
        QUOTES = ["'", '"']
        IDENTIFIERS = ["`"]
        STRING_ESCAPES = ["\\"]

        SINGLE_TOKENS = {
            **tokens.Tokenizer.SINGLE_TOKENS,
            "$": TokenType.PARAMETER,
        }

        KEYWORDS = {
            **tokens.Tokenizer.KEYWORDS,
            "ADD ARCHIVE": TokenType.COMMAND,
            "ADD ARCHIVES": TokenType.COMMAND,
            "ADD FILE": TokenType.COMMAND,
            "ADD FILES": TokenType.COMMAND,
            "ADD JAR": TokenType.COMMAND,
            "ADD JARS": TokenType.COMMAND,
            "MINUS": TokenType.EXCEPT,
            "MSCK REPAIR": TokenType.COMMAND,
            "REFRESH": TokenType.REFRESH,
            "TIMESTAMP AS OF": TokenType.TIMESTAMP_SNAPSHOT,
            "VERSION AS OF": TokenType.VERSION_SNAPSHOT,
            "SERDEPROPERTIES": TokenType.SERDE_PROPERTIES,
        }

        NUMERIC_LITERALS = {
            "L": "BIGINT",
            "S": "SMALLINT",
            "Y": "TINYINT",
            "D": "DOUBLE",
            "F": "FLOAT",
            "BD": "DECIMAL",
        }

    class Parser(parser.Parser):
        LOG_DEFAULTS_TO_LN = True
        STRICT_CAST = False
        VALUES_FOLLOWED_BY_PAREN = False

        FUNCTIONS = {
            **parser.Parser.FUNCTIONS,
            "BASE64": exp.ToBase64.from_arg_list,
            "COLLECT_LIST": lambda args: exp.ArrayAgg(this=seq_get(args, 0), nulls_excluded=True),
            "COLLECT_SET": exp.ArrayUniqueAgg.from_arg_list,
            "DATE_ADD": lambda args: exp.TsOrDsAdd(
                this=seq_get(args, 0), expression=seq_get(args, 1), unit=exp.Literal.string("DAY")
            ),
            "DATE_FORMAT": lambda args: build_formatted_time(exp.TimeToStr, "hive")(
                [
                    exp.TimeStrToTime(this=seq_get(args, 0)),
                    seq_get(args, 1),
                ]
            ),
            "DATE_SUB": lambda args: exp.TsOrDsAdd(
                this=seq_get(args, 0),
                expression=exp.Mul(this=seq_get(args, 1), expression=exp.Literal.number(-1)),
                unit=exp.Literal.string("DAY"),
            ),
            "DATEDIFF": lambda args: exp.DateDiff(
                this=exp.TsOrDsToDate(this=seq_get(args, 0)),
                expression=exp.TsOrDsToDate(this=seq_get(args, 1)),
            ),
            "DAY": lambda args: exp.Day(this=exp.TsOrDsToDate(this=seq_get(args, 0))),
            "FIRST": _build_with_ignore_nulls(exp.First),
            "FIRST_VALUE": _build_with_ignore_nulls(exp.FirstValue),
            "FROM_UNIXTIME": build_formatted_time(exp.UnixToStr, "hive", True),
            "GET_JSON_OBJECT": exp.JSONExtractScalar.from_arg_list,
            "LAST": _build_with_ignore_nulls(exp.Last),
            "LAST_VALUE": _build_with_ignore_nulls(exp.LastValue),
            "LOCATE": locate_to_strposition,
            "MAP": parser.build_var_map,
            "MONTH": lambda args: exp.Month(this=exp.TsOrDsToDate.from_arg_list(args)),
            "PERCENTILE": exp.Quantile.from_arg_list,
            "PERCENTILE_APPROX": exp.ApproxQuantile.from_arg_list,
            "REGEXP_EXTRACT": build_regexp_extract(exp.RegexpExtract),
            "REGEXP_EXTRACT_ALL": build_regexp_extract(exp.RegexpExtractAll),
            "SEQUENCE": exp.GenerateSeries.from_arg_list,
            "SIZE": exp.ArraySize.from_arg_list,
            "SPLIT": exp.RegexpSplit.from_arg_list,
            "STR_TO_MAP": lambda args: exp.StrToMap(
                this=seq_get(args, 0),
                pair_delim=seq_get(args, 1) or exp.Literal.string(","),
                key_value_delim=seq_get(args, 2) or exp.Literal.string(":"),
            ),
            "TO_DATE": build_formatted_time(exp.TsOrDsToDate, "hive"),
            "TO_JSON": exp.JSONFormat.from_arg_list,
            "TRUNC": exp.TimestampTrunc.from_arg_list,
            "UNBASE64": exp.FromBase64.from_arg_list,
            "UNIX_TIMESTAMP": lambda args: build_formatted_time(exp.StrToUnix, "hive", True)(
                args or [exp.CurrentTimestamp()]
            ),
            "YEAR": lambda args: exp.Year(this=exp.TsOrDsToDate.from_arg_list(args)),
        }

        NO_PAREN_FUNCTION_PARSERS = {
            **parser.Parser.NO_PAREN_FUNCTION_PARSERS,
            "TRANSFORM": lambda self: self._parse_transform(),
        }

        NO_PAREN_FUNCTIONS = parser.Parser.NO_PAREN_FUNCTIONS.copy()
        NO_PAREN_FUNCTIONS.pop(TokenType.CURRENT_TIME)

        PROPERTY_PARSERS = {
            **parser.Parser.PROPERTY_PARSERS,
            "SERDEPROPERTIES": lambda self: exp.SerdeProperties(
                expressions=self._parse_wrapped_csv(self._parse_property)
            ),
        }

        def _parse_transform(self) -> t.Optional[exp.Transform | exp.QueryTransform]:
            if not self._match(TokenType.L_PAREN, advance=False):
                self._retreat(self._index - 1)
                return None

            args = self._parse_wrapped_csv(self._parse_lambda)
            row_format_before = self._parse_row_format(match_row=True)

            record_writer = None
            if self._match_text_seq("RECORDWRITER"):
                record_writer = self._parse_string()

            if not self._match(TokenType.USING):
                return exp.Transform.from_arg_list(args)

            command_script = self._parse_string()

            self._match(TokenType.ALIAS)
            schema = self._parse_schema()

            row_format_after = self._parse_row_format(match_row=True)
            record_reader = None
            if self._match_text_seq("RECORDREADER"):
                record_reader = self._parse_string()

            return self.expression(
                exp.QueryTransform,
                expressions=args,
                command_script=command_script,
                schema=schema,
                row_format_before=row_format_before,
                record_writer=record_writer,
                row_format_after=row_format_after,
                record_reader=record_reader,
            )

        def _parse_types(
            self, check_func: bool = False, schema: bool = False, allow_identifiers: bool = True
        ) -> t.Optional[exp.Expression]:
            """
            Spark (and most likely Hive) treats casts to CHAR(length) and VARCHAR(length) as casts to
            STRING in all contexts except for schema definitions. For example, this is in Spark v3.4.0:

                spark-sql (default)> select cast(1234 as varchar(2));
                23/06/06 15:51:18 WARN CharVarcharUtils: The Spark cast operator does not support
                char/varchar type and simply treats them as string type. Please use string type
                directly to avoid confusion. Otherwise, you can set spark.sql.legacy.charVarcharAsString
                to true, so that Spark treat them as string type as same as Spark 3.0 and earlier

                1234
                Time taken: 4.265 seconds, Fetched 1 row(s)

            This shows that Spark doesn't truncate the value into '12', which is inconsistent with
            what other dialects (e.g. postgres) do, so we need to drop the length to transpile correctly.

            Reference: https://spark.apache.org/docs/latest/sql-ref-datatypes.html
            """
            this = super()._parse_types(
                check_func=check_func, schema=schema, allow_identifiers=allow_identifiers
            )

            if this and not schema:
                return this.transform(
                    lambda node: (
                        node.replace(exp.DataType.build("text"))
                        if isinstance(node, exp.DataType) and node.is_type("char", "varchar")
                        else node
                    ),
                    copy=False,
                )

            return this

        def _parse_partition_and_order(
            self,
        ) -> t.Tuple[t.List[exp.Expression], t.Optional[exp.Expression]]:
            return (
                (
                    self._parse_csv(self._parse_assignment)
                    if self._match_set({TokenType.PARTITION_BY, TokenType.DISTRIBUTE_BY})
                    else []
                ),
                super()._parse_order(skip_order_token=self._match(TokenType.SORT_BY)),
            )

        def _parse_parameter(self) -> exp.Parameter:
            self._match(TokenType.L_BRACE)
            this = self._parse_identifier() or self._parse_primary_or_var()
            expression = self._match(TokenType.COLON) and (
                self._parse_identifier() or self._parse_primary_or_var()
            )
            self._match(TokenType.R_BRACE)
            return self.expression(exp.Parameter, this=this, expression=expression)

        def _to_prop_eq(self, expression: exp.Expression, index: int) -> exp.Expression:
            if isinstance(expression, exp.Column):
                key = expression.this
            else:
                key = exp.to_identifier(f"col{index + 1}")

            return self.expression(exp.PropertyEQ, this=key, expression=expression)

    class Generator(generator.Generator):
        LIMIT_FETCH = "LIMIT"
        TABLESAMPLE_WITH_METHOD = False
        JOIN_HINTS = False
        TABLE_HINTS = False
        QUERY_HINTS = False
        INDEX_ON = "ON TABLE"
        EXTRACT_ALLOWS_QUOTES = False
        NVL2_SUPPORTED = False
        LAST_DAY_SUPPORTS_DATE_PART = False
        JSON_PATH_SINGLE_QUOTE_ESCAPE = True
        SUPPORTS_TO_NUMBER = False
        WITH_PROPERTIES_PREFIX = "TBLPROPERTIES"
        PARSE_JSON_NAME = None
        PAD_FILL_PATTERN_IS_REQUIRED = True
        SUPPORTS_MEDIAN = False
        ARRAY_SIZE_NAME = "SIZE"

        EXPRESSIONS_WITHOUT_NESTED_CTES = {
            exp.Insert,
            exp.Select,
            exp.Subquery,
            exp.SetOperation,
        }

        SUPPORTED_JSON_PATH_PARTS = {
            exp.JSONPathKey,
            exp.JSONPathRoot,
            exp.JSONPathSubscript,
            exp.JSONPathWildcard,
        }

        TYPE_MAPPING = {
            **generator.Generator.TYPE_MAPPING,
            exp.DataType.Type.BIT: "BOOLEAN",
            exp.DataType.Type.DATETIME: "TIMESTAMP",
            exp.DataType.Type.ROWVERSION: "BINARY",
            exp.DataType.Type.TEXT: "STRING",
            exp.DataType.Type.TIME: "TIMESTAMP",
            exp.DataType.Type.TIMESTAMPTZ: "TIMESTAMP",
            exp.DataType.Type.UTINYINT: "SMALLINT",
            exp.DataType.Type.VARBINARY: "BINARY",
        }

        TRANSFORMS = {
            **generator.Generator.TRANSFORMS,
            exp.Group: transforms.preprocess([transforms.unalias_group]),
            exp.Property: property_sql,
            exp.AnyValue: rename_func("FIRST"),
            exp.ApproxDistinct: approx_count_distinct_sql,
            exp.ArgMax: arg_max_or_min_no_count("MAX_BY"),
            exp.ArgMin: arg_max_or_min_no_count("MIN_BY"),
            exp.ArrayConcat: rename_func("CONCAT"),
            exp.ArrayToString: lambda self, e: self.func("CONCAT_WS", e.expression, e.this),
            exp.ArraySort: _array_sort_sql,
            exp.With: no_recursive_cte_sql,
            exp.DateAdd: _add_date_sql,
            exp.DateDiff: _date_diff_sql,
            exp.DateStrToDate: datestrtodate_sql,
            exp.DateSub: _add_date_sql,
            exp.DateToDi: lambda self,
            e: f"CAST(DATE_FORMAT({self.sql(e, 'this')}, {Hive.DATEINT_FORMAT}) AS INT)",
            exp.DiToDate: lambda self,
            e: f"TO_DATE(CAST({self.sql(e, 'this')} AS STRING), {Hive.DATEINT_FORMAT})",
            exp.FileFormatProperty: lambda self,
            e: f"STORED AS {self.sql(e, 'this') if isinstance(e.this, exp.InputOutputFormat) else e.name.upper()}",
            exp.FromBase64: rename_func("UNBASE64"),
            exp.GenerateSeries: sequence_sql,
            exp.GenerateDateArray: sequence_sql,
            exp.If: if_sql(),
            exp.ILike: no_ilike_sql,
            exp.IsNan: rename_func("ISNAN"),
            exp.JSONExtract: lambda self, e: self.func("GET_JSON_OBJECT", e.this, e.expression),
            exp.JSONExtractScalar: lambda self, e: self.func(
                "GET_JSON_OBJECT", e.this, e.expression
            ),
            exp.JSONFormat: _json_format_sql,
            exp.Left: left_to_substring_sql,
            exp.Map: var_map_sql,
            exp.Max: max_or_greatest,
            exp.MD5Digest: lambda self, e: self.func("UNHEX", self.func("MD5", e.this)),
            exp.Min: min_or_least,
            exp.MonthsBetween: lambda self, e: self.func("MONTHS_BETWEEN", e.this, e.expression),
            exp.NotNullColumnConstraint: lambda _, e: (
                "" if e.args.get("allow_null") else "NOT NULL"
            ),
            exp.VarMap: var_map_sql,
            exp.Create: preprocess(
                [
                    remove_unique_constraints,
                    ctas_with_tmp_tables_to_create_tmp_view,
                    move_schema_columns_to_partitioned_by,
                ]
            ),
            exp.Quantile: rename_func("PERCENTILE"),
            exp.ApproxQuantile: rename_func("PERCENTILE_APPROX"),
            exp.RegexpExtract: regexp_extract_sql,
            exp.RegexpExtractAll: regexp_extract_sql,
            exp.RegexpReplace: regexp_replace_sql,
            exp.RegexpLike: lambda self, e: self.binary(e, "RLIKE"),
            exp.RegexpSplit: rename_func("SPLIT"),
            exp.Right: right_to_substring_sql,
            exp.SafeDivide: no_safe_divide_sql,
            exp.SchemaCommentProperty: lambda self, e: self.naked_property(e),
            exp.ArrayUniqueAgg: rename_func("COLLECT_SET"),
            exp.Split: lambda self, e: self.func(
                "SPLIT", e.this, self.func("CONCAT", "'\\\\Q'", e.expression, "'\\\\E'")
            ),
            exp.Select: transforms.preprocess(
                [
                    transforms.eliminate_qualify,
                    transforms.eliminate_distinct_on,
                    partial(transforms.unnest_to_explode, unnest_using_arrays_zip=False),
                    transforms.any_to_exists,
                ]
            ),
            exp.StrPosition: strposition_to_locate_sql,
            exp.StrToDate: _str_to_date_sql,
            exp.StrToTime: _str_to_time_sql,
            exp.StrToUnix: _str_to_unix_sql,
            exp.StructExtract: struct_extract_sql,
            exp.Table: transforms.preprocess([transforms.unnest_generate_series]),
            exp.TimeStrToDate: rename_func("TO_DATE"),
            exp.TimeStrToTime: timestrtotime_sql,
            exp.TimeStrToUnix: rename_func("UNIX_TIMESTAMP"),
            exp.TimestampTrunc: lambda self, e: self.func("TRUNC", e.this, unit_to_str(e)),
            exp.TimeToStr: lambda self, e: self.func("DATE_FORMAT", e.this, self.format_time(e)),
            exp.TimeToUnix: rename_func("UNIX_TIMESTAMP"),
            exp.ToBase64: rename_func("BASE64"),
            exp.TsOrDiToDi: lambda self,
            e: f"CAST(SUBSTR(REPLACE(CAST({self.sql(e, 'this')} AS STRING), '-', ''), 1, 8) AS INT)",
            exp.TsOrDsAdd: _add_date_sql,
            exp.TsOrDsDiff: _date_diff_sql,
            exp.TsOrDsToDate: _to_date_sql,
            exp.TryCast: no_trycast_sql,
            exp.UnixToStr: lambda self, e: self.func(
                "FROM_UNIXTIME", e.this, time_format("hive")(self, e)
            ),
            exp.UnixToTime: _unix_to_time_sql,
            exp.UnixToTimeStr: rename_func("FROM_UNIXTIME"),
            exp.Unnest: rename_func("EXPLODE"),
            exp.PartitionedByProperty: lambda self, e: f"PARTITIONED BY {self.sql(e, 'this')}",
            exp.NumberToStr: rename_func("FORMAT_NUMBER"),
            exp.National: lambda self, e: self.national_sql(e, prefix=""),
            exp.ClusteredColumnConstraint: lambda self,
            e: f"({self.expressions(e, 'this', indent=False)})",
            exp.NonClusteredColumnConstraint: lambda self,
            e: f"({self.expressions(e, 'this', indent=False)})",
            exp.NotForReplicationColumnConstraint: lambda *_: "",
            exp.OnProperty: lambda *_: "",
            exp.PrimaryKeyColumnConstraint: lambda *_: "PRIMARY KEY",
            exp.WeekOfYear: rename_func("WEEKOFYEAR"),
            exp.DayOfMonth: rename_func("DAYOFMONTH"),
            exp.DayOfWeek: rename_func("DAYOFWEEK"),
            exp.Levenshtein: unsupported_args("ins_cost", "del_cost", "sub_cost", "max_dist")(
                rename_func("LEVENSHTEIN")
            ),
        }

        PROPERTIES_LOCATION = {
            **generator.Generator.PROPERTIES_LOCATION,
            exp.FileFormatProperty: exp.Properties.Location.POST_SCHEMA,
            exp.PartitionedByProperty: exp.Properties.Location.POST_SCHEMA,
            exp.VolatileProperty: exp.Properties.Location.UNSUPPORTED,
            exp.WithDataProperty: exp.Properties.Location.UNSUPPORTED,
        }

        def unnest_sql(self, expression: exp.Unnest) -> str:
            return rename_func("EXPLODE")(self, expression)

        def _jsonpathkey_sql(self, expression: exp.JSONPathKey) -> str:
            if isinstance(expression.this, exp.JSONPathWildcard):
                self.unsupported("Unsupported wildcard in JSONPathKey expression")
                return ""

            return super()._jsonpathkey_sql(expression)

        def parameter_sql(self, expression: exp.Parameter) -> str:
            this = self.sql(expression, "this")
            expression_sql = self.sql(expression, "expression")

            parent = expression.parent
            this = f"{this}:{expression_sql}" if expression_sql else this

            if isinstance(parent, exp.EQ) and isinstance(parent.parent, exp.SetItem):
                # We need to produce SET key = value instead of SET ${key} = value
                return this

            return f"${{{this}}}"

        def schema_sql(self, expression: exp.Schema) -> str:
            for ordered in expression.find_all(exp.Ordered):
                if ordered.args.get("desc") is False:
                    ordered.set("desc", None)

            return super().schema_sql(expression)

        def constraint_sql(self, expression: exp.Constraint) -> str:
            for prop in list(expression.find_all(exp.Properties)):
                prop.pop()

            this = self.sql(expression, "this")
            expressions = self.expressions(expression, sep=" ", flat=True)
            return f"CONSTRAINT {this} {expressions}"

        def rowformatserdeproperty_sql(self, expression: exp.RowFormatSerdeProperty) -> str:
            serde_props = self.sql(expression, "serde_properties")
            serde_props = f" {serde_props}" if serde_props else ""
            return f"ROW FORMAT SERDE {self.sql(expression, 'this')}{serde_props}"

        def arrayagg_sql(self, expression: exp.ArrayAgg) -> str:
            return self.func(
                "COLLECT_LIST",
                expression.this.this if isinstance(expression.this, exp.Order) else expression.this,
            )

        def datatype_sql(self, expression: exp.DataType) -> str:
            if expression.this in self.PARAMETERIZABLE_TEXT_TYPES and (
                not expression.expressions or expression.expressions[0].name == "MAX"
            ):
                expression = exp.DataType.build("text")
            elif expression.is_type(exp.DataType.Type.TEXT) and expression.expressions:
                expression.set("this", exp.DataType.Type.VARCHAR)
            elif expression.this in exp.DataType.TEMPORAL_TYPES:
                expression = exp.DataType.build(expression.this)
            elif expression.is_type("float"):
                size_expression = expression.find(exp.DataTypeParam)
                if size_expression:
                    size = int(size_expression.name)
                    expression = (
                        exp.DataType.build("float") if size <= 32 else exp.DataType.build("double")
                    )

            return super().datatype_sql(expression)

        def version_sql(self, expression: exp.Version) -> str:
            sql = super().version_sql(expression)
            return sql.replace("FOR ", "", 1)

        def struct_sql(self, expression: exp.Struct) -> str:
            values = []

            for i, e in enumerate(expression.expressions):
                if isinstance(e, exp.PropertyEQ):
                    self.unsupported("Hive does not support named structs.")
                    values.append(e.expression)
                else:
                    values.append(e)

            return self.func("STRUCT", *values)

        def alterset_sql(self, expression: exp.AlterSet) -> str:
            exprs = self.expressions(expression, flat=True)
            exprs = f" {exprs}" if exprs else ""
            location = self.sql(expression, "location")
            location = f" LOCATION {location}" if location else ""
            file_format = self.expressions(expression, key="file_format", flat=True, sep=" ")
            file_format = f" FILEFORMAT {file_format}" if file_format else ""
            serde = self.sql(expression, "serde")
            serde = f" SERDE {serde}" if serde else ""
            tags = self.expressions(expression, key="tag", flat=True, sep="")
            tags = f" TAGS {tags}" if tags else ""

            return f"SET{serde}{exprs}{location}{file_format}{tags}"

        def serdeproperties_sql(self, expression: exp.SerdeProperties) -> str:
            prefix = "WITH " if expression.args.get("with") else ""
            exprs = self.expressions(expression, flat=True)

            return f"{prefix}SERDEPROPERTIES ({exprs})"

        def exists_sql(self, expression: exp.Exists):
            if expression.expression:
                return self.function_fallback_sql(expression)

            return super().exists_sql(expression)
