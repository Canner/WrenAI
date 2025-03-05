from __future__ import annotations

import typing as t

from sqlglot import exp, generator, parser, tokens, transforms
from sqlglot.dialects.dialect import (
    DATE_ADD_OR_SUB,
    Dialect,
    JSON_EXTRACT_TYPE,
    any_value_to_max_sql,
    binary_from_function,
    bool_xor_sql,
    datestrtodate_sql,
    build_formatted_time,
    filter_array_using_unnest,
    json_extract_segments,
    json_path_key_only_name,
    max_or_greatest,
    merge_without_target_sql,
    min_or_least,
    no_last_day_sql,
    no_map_from_entries_sql,
    no_paren_current_date_sql,
    no_pivot_sql,
    no_trycast_sql,
    build_json_extract_path,
    build_timestamp_trunc,
    rename_func,
    sha256_sql,
    str_position_sql,
    struct_extract_sql,
    timestamptrunc_sql,
    timestrtotime_sql,
    trim_sql,
    ts_or_ds_add_cast,
)
from sqlglot.helper import is_int, seq_get
from sqlglot.parser import binary_range_parser
from sqlglot.tokens import TokenType

DATE_DIFF_FACTOR = {
    "MICROSECOND": " * 1000000",
    "MILLISECOND": " * 1000",
    "SECOND": "",
    "MINUTE": " / 60",
    "HOUR": " / 3600",
    "DAY": " / 86400",
}


def _date_add_sql(kind: str) -> t.Callable[[Postgres.Generator, DATE_ADD_OR_SUB], str]:
    def func(self: Postgres.Generator, expression: DATE_ADD_OR_SUB) -> str:
        if isinstance(expression, exp.TsOrDsAdd):
            expression = ts_or_ds_add_cast(expression)

        this = self.sql(expression, "this")
        unit = expression.args.get("unit")

        e = self._simplify_unless_literal(expression.expression)
        if isinstance(e, exp.Literal):
            e.args["is_string"] = True
        elif e.is_number:
            e = exp.Literal.string(e.to_py())
        else:
            self.unsupported("Cannot add non literal")

        return f"{this} {kind} {self.sql(exp.Interval(this=e, unit=unit))}"

    return func


def _date_diff_sql(self: Postgres.Generator, expression: exp.DateDiff) -> str:
    unit = expression.text("unit").upper()
    factor = DATE_DIFF_FACTOR.get(unit)

    end = f"CAST({self.sql(expression, 'this')} AS TIMESTAMP)"
    start = f"CAST({self.sql(expression, 'expression')} AS TIMESTAMP)"

    if factor is not None:
        return f"CAST(EXTRACT(epoch FROM {end} - {start}){factor} AS BIGINT)"

    age = f"AGE({end}, {start})"

    if unit == "WEEK":
        unit = f"EXTRACT(days FROM ({end} - {start})) / 7"
    elif unit == "MONTH":
        unit = f"EXTRACT(year FROM {age}) * 12 + EXTRACT(month FROM {age})"
    elif unit == "QUARTER":
        unit = f"EXTRACT(year FROM {age}) * 4 + EXTRACT(month FROM {age}) / 3"
    elif unit == "YEAR":
        unit = f"EXTRACT(year FROM {age})"
    else:
        unit = age

    return f"CAST({unit} AS BIGINT)"


def _substring_sql(self: Postgres.Generator, expression: exp.Substring) -> str:
    this = self.sql(expression, "this")
    start = self.sql(expression, "start")
    length = self.sql(expression, "length")

    from_part = f" FROM {start}" if start else ""
    for_part = f" FOR {length}" if length else ""

    return f"SUBSTRING({this}{from_part}{for_part})"


def _string_agg_sql(self: Postgres.Generator, expression: exp.GroupConcat) -> str:
    separator = expression.args.get("separator") or exp.Literal.string(",")

    order = ""
    this = expression.this
    if isinstance(this, exp.Order):
        if this.this:
            this = this.this.pop()
        order = self.sql(expression.this)  # Order has a leading space

    return f"STRING_AGG({self.format_args(this, separator)}{order})"


def _auto_increment_to_serial(expression: exp.Expression) -> exp.Expression:
    auto = expression.find(exp.AutoIncrementColumnConstraint)

    if auto:
        expression.args["constraints"].remove(auto.parent)
        kind = expression.args["kind"]

        if kind.this == exp.DataType.Type.INT:
            kind.replace(exp.DataType(this=exp.DataType.Type.SERIAL))
        elif kind.this == exp.DataType.Type.SMALLINT:
            kind.replace(exp.DataType(this=exp.DataType.Type.SMALLSERIAL))
        elif kind.this == exp.DataType.Type.BIGINT:
            kind.replace(exp.DataType(this=exp.DataType.Type.BIGSERIAL))

    return expression


def _serial_to_generated(expression: exp.Expression) -> exp.Expression:
    if not isinstance(expression, exp.ColumnDef):
        return expression
    kind = expression.kind
    if not kind:
        return expression

    if kind.this == exp.DataType.Type.SERIAL:
        data_type = exp.DataType(this=exp.DataType.Type.INT)
    elif kind.this == exp.DataType.Type.SMALLSERIAL:
        data_type = exp.DataType(this=exp.DataType.Type.SMALLINT)
    elif kind.this == exp.DataType.Type.BIGSERIAL:
        data_type = exp.DataType(this=exp.DataType.Type.BIGINT)
    else:
        data_type = None

    if data_type:
        expression.args["kind"].replace(data_type)
        constraints = expression.args["constraints"]
        generated = exp.ColumnConstraint(kind=exp.GeneratedAsIdentityColumnConstraint(this=False))
        notnull = exp.ColumnConstraint(kind=exp.NotNullColumnConstraint())

        if notnull not in constraints:
            constraints.insert(0, notnull)
        if generated not in constraints:
            constraints.insert(0, generated)

    return expression


def _build_generate_series(args: t.List) -> exp.ExplodingGenerateSeries:
    # The goal is to convert step values like '1 day' or INTERVAL '1 day' into INTERVAL '1' day
    # Note: postgres allows calls with just two arguments -- the "step" argument defaults to 1
    step = seq_get(args, 2)
    if step is not None:
        if step.is_string:
            args[2] = exp.to_interval(step.this)
        elif isinstance(step, exp.Interval) and not step.args.get("unit"):
            args[2] = exp.to_interval(step.this.this)

    return exp.ExplodingGenerateSeries.from_arg_list(args)


def _build_to_timestamp(args: t.List) -> exp.UnixToTime | exp.StrToTime:
    # TO_TIMESTAMP accepts either a single double argument or (text, text)
    if len(args) == 1:
        # https://www.postgresql.org/docs/current/functions-datetime.html#FUNCTIONS-DATETIME-TABLE
        return exp.UnixToTime.from_arg_list(args)

    # https://www.postgresql.org/docs/current/functions-formatting.html
    return build_formatted_time(exp.StrToTime, "postgres")(args)


def _json_extract_sql(
    name: str, op: str
) -> t.Callable[[Postgres.Generator, JSON_EXTRACT_TYPE], str]:
    def _generate(self: Postgres.Generator, expression: JSON_EXTRACT_TYPE) -> str:
        if expression.args.get("only_json_types"):
            return json_extract_segments(name, quoted_index=False, op=op)(self, expression)
        return json_extract_segments(name)(self, expression)

    return _generate


def _build_regexp_replace(args: t.List) -> exp.RegexpReplace:
    # The signature of REGEXP_REPLACE is:
    # regexp_replace(source, pattern, replacement [, start [, N ]] [, flags ])
    #
    # Any one of `start`, `N` and `flags` can be column references, meaning that
    # unless we can statically see that the last argument is a non-integer string
    # (eg. not '0'), then it's not possible to construct the correct AST
    if len(args) > 3:
        last = args[-1]
        if not is_int(last.name):
            if not last.type or last.is_type(exp.DataType.Type.UNKNOWN, exp.DataType.Type.NULL):
                from sqlglot.optimizer.annotate_types import annotate_types

                last = annotate_types(last)

            if last.is_type(*exp.DataType.TEXT_TYPES):
                regexp_replace = exp.RegexpReplace.from_arg_list(args[:-1])
                regexp_replace.set("modifiers", last)
                return regexp_replace

    return exp.RegexpReplace.from_arg_list(args)


def _unix_to_time_sql(self: Postgres.Generator, expression: exp.UnixToTime) -> str:
    scale = expression.args.get("scale")
    timestamp = expression.this

    if scale in (None, exp.UnixToTime.SECONDS):
        return self.func("TO_TIMESTAMP", timestamp, self.format_time(expression))

    return self.func(
        "TO_TIMESTAMP",
        exp.Div(this=timestamp, expression=exp.func("POW", 10, scale)),
        self.format_time(expression),
    )


def _build_levenshtein_less_equal(args: t.List) -> exp.Levenshtein:
    # Postgres has two signatures for levenshtein_less_equal function, but in both cases
    # max_dist is the last argument
    # levenshtein_less_equal(source, target, ins_cost, del_cost, sub_cost, max_d)
    # levenshtein_less_equal(source, target, max_d)
    max_dist = args.pop()

    return exp.Levenshtein(
        this=seq_get(args, 0),
        expression=seq_get(args, 1),
        ins_cost=seq_get(args, 2),
        del_cost=seq_get(args, 3),
        sub_cost=seq_get(args, 4),
        max_dist=max_dist,
    )


def _levenshtein_sql(self: Postgres.Generator, expression: exp.Levenshtein) -> str:
    name = "LEVENSHTEIN_LESS_EQUAL" if expression.args.get("max_dist") else "LEVENSHTEIN"

    return rename_func(name)(self, expression)


class Postgres(Dialect):
    INDEX_OFFSET = 1
    TYPED_DIVISION = True
    CONCAT_COALESCE = True
    NULL_ORDERING = "nulls_are_large"
    TIME_FORMAT = "'YYYY-MM-DD HH24:MI:SS'"
    TABLESAMPLE_SIZE_IS_PERCENT = True

    TIME_MAPPING = {
        "AM": "%p",
        "PM": "%p",
        "D": "%u",  # 1-based day of week
        "DD": "%d",  # day of month
        "DDD": "%j",  # zero padded day of year
        "FMDD": "%-d",  # - is no leading zero for Python; same for FM in postgres
        "FMDDD": "%-j",  # day of year
        "FMHH12": "%-I",  # 9
        "FMHH24": "%-H",  # 9
        "FMMI": "%-M",  # Minute
        "FMMM": "%-m",  # 1
        "FMSS": "%-S",  # Second
        "HH12": "%I",  # 09
        "HH24": "%H",  # 09
        "MI": "%M",  # zero padded minute
        "MM": "%m",  # 01
        "OF": "%z",  # utc offset
        "SS": "%S",  # zero padded second
        "TMDay": "%A",  # TM is locale dependent
        "TMDy": "%a",
        "TMMon": "%b",  # Sep
        "TMMonth": "%B",  # September
        "TZ": "%Z",  # uppercase timezone name
        "US": "%f",  # zero padded microsecond
        "WW": "%U",  # 1-based week of year
        "YY": "%y",  # 15
        "YYYY": "%Y",  # 2015
    }

    class Tokenizer(tokens.Tokenizer):
        BIT_STRINGS = [("b'", "'"), ("B'", "'")]
        HEX_STRINGS = [("x'", "'"), ("X'", "'")]
        BYTE_STRINGS = [("e'", "'"), ("E'", "'")]
        HEREDOC_STRINGS = ["$"]

        HEREDOC_TAG_IS_IDENTIFIER = True
        HEREDOC_STRING_ALTERNATIVE = TokenType.PARAMETER

        KEYWORDS = {
            **tokens.Tokenizer.KEYWORDS,
            "~": TokenType.RLIKE,
            "@@": TokenType.DAT,
            "@>": TokenType.AT_GT,
            "<@": TokenType.LT_AT,
            "|/": TokenType.PIPE_SLASH,
            "||/": TokenType.DPIPE_SLASH,
            "BEGIN": TokenType.COMMAND,
            "BEGIN TRANSACTION": TokenType.BEGIN,
            "BIGSERIAL": TokenType.BIGSERIAL,
            "CHARACTER VARYING": TokenType.VARCHAR,
            "CONSTRAINT TRIGGER": TokenType.COMMAND,
            "CSTRING": TokenType.PSEUDO_TYPE,
            "DECLARE": TokenType.COMMAND,
            "DO": TokenType.COMMAND,
            "EXEC": TokenType.COMMAND,
            "HSTORE": TokenType.HSTORE,
            "INT8": TokenType.BIGINT,
            "MONEY": TokenType.MONEY,
            "NAME": TokenType.NAME,
            "OID": TokenType.OBJECT_IDENTIFIER,
            "ONLY": TokenType.ONLY,
            "OPERATOR": TokenType.OPERATOR,
            "REFRESH": TokenType.COMMAND,
            "REINDEX": TokenType.COMMAND,
            "RESET": TokenType.COMMAND,
            "REVOKE": TokenType.COMMAND,
            "SERIAL": TokenType.SERIAL,
            "SMALLSERIAL": TokenType.SMALLSERIAL,
            "TEMP": TokenType.TEMPORARY,
            "REGCLASS": TokenType.OBJECT_IDENTIFIER,
            "REGCOLLATION": TokenType.OBJECT_IDENTIFIER,
            "REGCONFIG": TokenType.OBJECT_IDENTIFIER,
            "REGDICTIONARY": TokenType.OBJECT_IDENTIFIER,
            "REGNAMESPACE": TokenType.OBJECT_IDENTIFIER,
            "REGOPER": TokenType.OBJECT_IDENTIFIER,
            "REGOPERATOR": TokenType.OBJECT_IDENTIFIER,
            "REGPROC": TokenType.OBJECT_IDENTIFIER,
            "REGPROCEDURE": TokenType.OBJECT_IDENTIFIER,
            "REGROLE": TokenType.OBJECT_IDENTIFIER,
            "REGTYPE": TokenType.OBJECT_IDENTIFIER,
            "FLOAT": TokenType.DOUBLE,
        }
        KEYWORDS.pop("/*+")
        KEYWORDS.pop("DIV")

        SINGLE_TOKENS = {
            **tokens.Tokenizer.SINGLE_TOKENS,
            "$": TokenType.HEREDOC_STRING,
        }

        VAR_SINGLE_TOKENS = {"$"}

    class Parser(parser.Parser):
        PROPERTY_PARSERS = {
            **parser.Parser.PROPERTY_PARSERS,
            "SET": lambda self: self.expression(exp.SetConfigProperty, this=self._parse_set()),
        }
        PROPERTY_PARSERS.pop("INPUT")

        FUNCTIONS = {
            **parser.Parser.FUNCTIONS,
            "DATE_TRUNC": build_timestamp_trunc,
            "DIV": lambda args: exp.cast(
                binary_from_function(exp.IntDiv)(args), exp.DataType.Type.DECIMAL
            ),
            "GENERATE_SERIES": _build_generate_series,
            "JSON_EXTRACT_PATH": build_json_extract_path(exp.JSONExtract),
            "JSON_EXTRACT_PATH_TEXT": build_json_extract_path(exp.JSONExtractScalar),
            "MAKE_TIME": exp.TimeFromParts.from_arg_list,
            "MAKE_TIMESTAMP": exp.TimestampFromParts.from_arg_list,
            "NOW": exp.CurrentTimestamp.from_arg_list,
            "REGEXP_REPLACE": _build_regexp_replace,
            "TO_CHAR": build_formatted_time(exp.TimeToStr, "postgres"),
            "TO_DATE": build_formatted_time(exp.StrToDate, "postgres"),
            "TO_TIMESTAMP": _build_to_timestamp,
            "UNNEST": exp.Explode.from_arg_list,
            "SHA256": lambda args: exp.SHA2(this=seq_get(args, 0), length=exp.Literal.number(256)),
            "SHA384": lambda args: exp.SHA2(this=seq_get(args, 0), length=exp.Literal.number(384)),
            "SHA512": lambda args: exp.SHA2(this=seq_get(args, 0), length=exp.Literal.number(512)),
            "LEVENSHTEIN_LESS_EQUAL": _build_levenshtein_less_equal,
        }

        FUNCTION_PARSERS = {
            **parser.Parser.FUNCTION_PARSERS,
            "DATE_PART": lambda self: self._parse_date_part(),
            "JSONB_EXISTS": lambda self: self._parse_jsonb_exists(),
        }

        BITWISE = {
            **parser.Parser.BITWISE,
            TokenType.HASH: exp.BitwiseXor,
        }

        EXPONENT = {
            TokenType.CARET: exp.Pow,
        }

        RANGE_PARSERS = {
            **parser.Parser.RANGE_PARSERS,
            TokenType.DAMP: binary_range_parser(exp.ArrayOverlaps),
            TokenType.DAT: lambda self, this: self.expression(
                exp.MatchAgainst, this=self._parse_bitwise(), expressions=[this]
            ),
            TokenType.OPERATOR: lambda self, this: self._parse_operator(this),
        }

        STATEMENT_PARSERS = {
            **parser.Parser.STATEMENT_PARSERS,
            TokenType.END: lambda self: self._parse_commit_or_rollback(),
        }

        JSON_ARROWS_REQUIRE_JSON_TYPE = True

        COLUMN_OPERATORS = {
            **parser.Parser.COLUMN_OPERATORS,
            TokenType.ARROW: lambda self, this, path: build_json_extract_path(
                exp.JSONExtract, arrow_req_json_type=self.JSON_ARROWS_REQUIRE_JSON_TYPE
            )([this, path]),
            TokenType.DARROW: lambda self, this, path: build_json_extract_path(
                exp.JSONExtractScalar, arrow_req_json_type=self.JSON_ARROWS_REQUIRE_JSON_TYPE
            )([this, path]),
        }

        def _parse_operator(self, this: t.Optional[exp.Expression]) -> t.Optional[exp.Expression]:
            while True:
                if not self._match(TokenType.L_PAREN):
                    break

                op = ""
                while self._curr and not self._match(TokenType.R_PAREN):
                    op += self._curr.text
                    self._advance()

                this = self.expression(
                    exp.Operator,
                    comments=self._prev_comments,
                    this=this,
                    operator=op,
                    expression=self._parse_bitwise(),
                )

                if not self._match(TokenType.OPERATOR):
                    break

            return this

        def _parse_date_part(self) -> exp.Expression:
            part = self._parse_type()
            self._match(TokenType.COMMA)
            value = self._parse_bitwise()

            if part and isinstance(part, (exp.Column, exp.Literal)):
                part = exp.var(part.name)

            return self.expression(exp.Extract, this=part, expression=value)

        def _parse_unique_key(self) -> t.Optional[exp.Expression]:
            return None

        def _parse_jsonb_exists(self) -> exp.JSONBExists:
            return self.expression(
                exp.JSONBExists,
                this=self._parse_bitwise(),
                path=self._match(TokenType.COMMA)
                and self.dialect.to_json_path(self._parse_bitwise()),
            )

        def _parse_generated_as_identity(
            self,
        ) -> (
            exp.GeneratedAsIdentityColumnConstraint
            | exp.ComputedColumnConstraint
            | exp.GeneratedAsRowColumnConstraint
        ):
            this = super()._parse_generated_as_identity()

            if self._match_text_seq("STORED"):
                this = self.expression(exp.ComputedColumnConstraint, this=this.expression)

            return this

    class Generator(generator.Generator):
        SINGLE_STRING_INTERVAL = True
        RENAME_TABLE_WITH_DB = False
        LOCKING_READS_SUPPORTED = True
        JOIN_HINTS = False
        TABLE_HINTS = False
        QUERY_HINTS = False
        NVL2_SUPPORTED = False
        PARAMETER_TOKEN = "$"
        TABLESAMPLE_SIZE_IS_ROWS = False
        TABLESAMPLE_SEED_KEYWORD = "REPEATABLE"
        SUPPORTS_SELECT_INTO = True
        JSON_TYPE_REQUIRED_FOR_EXTRACTION = True
        SUPPORTS_UNLOGGED_TABLES = True
        LIKE_PROPERTY_INSIDE_SCHEMA = True
        MULTI_ARG_DISTINCT = False
        CAN_IMPLEMENT_ARRAY_ANY = True
        COPY_HAS_INTO_KEYWORD = False
        ARRAY_CONCAT_IS_VAR_LEN = False
        SUPPORTS_MEDIAN = False
        ARRAY_SIZE_DIM_REQUIRED = True

        SUPPORTED_JSON_PATH_PARTS = {
            exp.JSONPathKey,
            exp.JSONPathRoot,
            exp.JSONPathSubscript,
        }

        TYPE_MAPPING = {
            **generator.Generator.TYPE_MAPPING,
            exp.DataType.Type.TINYINT: "SMALLINT",
            exp.DataType.Type.FLOAT: "REAL",
            exp.DataType.Type.DOUBLE: "DOUBLE PRECISION",
            exp.DataType.Type.BINARY: "BYTEA",
            exp.DataType.Type.VARBINARY: "BYTEA",
            exp.DataType.Type.ROWVERSION: "BYTEA",
            exp.DataType.Type.DATETIME: "TIMESTAMP",
        }

        TRANSFORMS = {
            **generator.Generator.TRANSFORMS,
            exp.AnyValue: any_value_to_max_sql,
            exp.ArrayConcat: lambda self, e: self.arrayconcat_sql(e, name="ARRAY_CAT"),
            exp.ArrayFilter: filter_array_using_unnest,
            exp.BitwiseXor: lambda self, e: self.binary(e, "#"),
            exp.ColumnDef: transforms.preprocess([_auto_increment_to_serial, _serial_to_generated]),
            exp.CurrentDate: no_paren_current_date_sql,
            exp.CurrentTimestamp: lambda *_: "CURRENT_TIMESTAMP",
            exp.CurrentUser: lambda *_: "CURRENT_USER",
            exp.DateAdd: _date_add_sql("+"),
            exp.DateDiff: _date_diff_sql,
            exp.DateStrToDate: datestrtodate_sql,
            exp.DateSub: _date_add_sql("-"),
            exp.Explode: rename_func("UNNEST"),
            exp.ExplodingGenerateSeries: rename_func("GENERATE_SERIES"),
            exp.GroupConcat: _string_agg_sql,
            exp.IntDiv: rename_func("DIV"),
            exp.JSONExtract: _json_extract_sql("JSON_EXTRACT_PATH", "->"),
            exp.JSONExtractScalar: _json_extract_sql("JSON_EXTRACT_PATH_TEXT", "->>"),
            exp.JSONBExtract: lambda self, e: self.binary(e, "#>"),
            exp.JSONBExtractScalar: lambda self, e: self.binary(e, "#>>"),
            exp.JSONBContains: lambda self, e: self.binary(e, "?"),
            exp.ParseJSON: lambda self, e: self.sql(exp.cast(e.this, exp.DataType.Type.JSON)),
            exp.JSONPathKey: json_path_key_only_name,
            exp.JSONPathRoot: lambda *_: "",
            exp.JSONPathSubscript: lambda self, e: self.json_path_part(e.this),
            exp.LastDay: no_last_day_sql,
            exp.LogicalOr: rename_func("BOOL_OR"),
            exp.LogicalAnd: rename_func("BOOL_AND"),
            exp.Max: max_or_greatest,
            exp.MapFromEntries: no_map_from_entries_sql,
            exp.Min: min_or_least,
            exp.Merge: merge_without_target_sql,
            exp.PartitionedByProperty: lambda self, e: f"PARTITION BY {self.sql(e, 'this')}",
            exp.PercentileCont: transforms.preprocess(
                [transforms.add_within_group_for_percentiles]
            ),
            exp.PercentileDisc: transforms.preprocess(
                [transforms.add_within_group_for_percentiles]
            ),
            exp.Pivot: no_pivot_sql,
            exp.Pow: lambda self, e: self.binary(e, "^"),
            exp.Rand: rename_func("RANDOM"),
            exp.RegexpLike: lambda self, e: self.binary(e, "~"),
            exp.RegexpILike: lambda self, e: self.binary(e, "~*"),
            exp.Select: transforms.preprocess(
                [
                    transforms.eliminate_semi_and_anti_joins,
                    transforms.eliminate_qualify,
                ]
            ),
            exp.SHA2: sha256_sql,
            exp.StrPosition: str_position_sql,
            exp.StrToDate: lambda self, e: self.func("TO_DATE", e.this, self.format_time(e)),
            exp.StrToTime: lambda self, e: self.func("TO_TIMESTAMP", e.this, self.format_time(e)),
            exp.StructExtract: struct_extract_sql,
            exp.Substring: _substring_sql,
            exp.TimeFromParts: rename_func("MAKE_TIME"),
            exp.TimestampFromParts: rename_func("MAKE_TIMESTAMP"),
            exp.TimestampTrunc: timestamptrunc_sql(zone=True),
            exp.TimeStrToTime: timestrtotime_sql,
            exp.TimeToStr: lambda self, e: self.func("TO_CHAR", e.this, self.format_time(e)),
            exp.ToChar: lambda self, e: self.function_fallback_sql(e),
            exp.Trim: trim_sql,
            exp.TryCast: no_trycast_sql,
            exp.TsOrDsAdd: _date_add_sql("+"),
            exp.TsOrDsDiff: _date_diff_sql,
            exp.UnixToTime: lambda self, e: self.func("TO_TIMESTAMP", e.this),
            exp.Uuid: lambda *_: "GEN_RANDOM_UUID()",
            exp.TimeToUnix: lambda self, e: self.func(
                "DATE_PART", exp.Literal.string("epoch"), e.this
            ),
            exp.VariancePop: rename_func("VAR_POP"),
            exp.Variance: rename_func("VAR_SAMP"),
            exp.Xor: bool_xor_sql,
            exp.UnixToTime: _unix_to_time_sql,
            exp.Levenshtein: _levenshtein_sql,
        }
        TRANSFORMS.pop(exp.CommentColumnConstraint)

        PROPERTIES_LOCATION = {
            **generator.Generator.PROPERTIES_LOCATION,
            exp.PartitionedByProperty: exp.Properties.Location.POST_SCHEMA,
            exp.TransientProperty: exp.Properties.Location.UNSUPPORTED,
            exp.VolatileProperty: exp.Properties.Location.UNSUPPORTED,
        }

        def schemacommentproperty_sql(self, expression: exp.SchemaCommentProperty) -> str:
            self.unsupported("Table comments are not supported in the CREATE statement")
            return ""

        def commentcolumnconstraint_sql(self, expression: exp.CommentColumnConstraint) -> str:
            self.unsupported("Column comments are not supported in the CREATE statement")
            return ""

        def unnest_sql(self, expression: exp.Unnest) -> str:
            if len(expression.expressions) == 1:
                arg = expression.expressions[0]
                if isinstance(arg, exp.GenerateDateArray):
                    generate_series: exp.Expression = exp.GenerateSeries(**arg.args)
                    if isinstance(expression.parent, (exp.From, exp.Join)):
                        generate_series = (
                            exp.select("value::date")
                            .from_(generate_series.as_("value"))
                            .subquery(expression.args.get("alias") or "_unnested_generate_series")
                        )
                    return self.sql(generate_series)

                from sqlglot.optimizer.annotate_types import annotate_types

                this = annotate_types(arg)
                if this.is_type("array<json>"):
                    while isinstance(this, exp.Cast):
                        this = this.this

                    arg_as_json = self.sql(exp.cast(this, exp.DataType.Type.JSON))
                    alias = self.sql(expression, "alias")
                    alias = f" AS {alias}" if alias else ""

                    if expression.args.get("offset"):
                        self.unsupported("Unsupported JSON_ARRAY_ELEMENTS with offset")

                    return f"JSON_ARRAY_ELEMENTS({arg_as_json}){alias}"

            return super().unnest_sql(expression)

        def bracket_sql(self, expression: exp.Bracket) -> str:
            """Forms like ARRAY[1, 2, 3][3] aren't allowed; we need to wrap the ARRAY."""
            if isinstance(expression.this, exp.Array):
                expression.set("this", exp.paren(expression.this, copy=False))

            return super().bracket_sql(expression)

        def matchagainst_sql(self, expression: exp.MatchAgainst) -> str:
            this = self.sql(expression, "this")
            expressions = [f"{self.sql(e)} @@ {this}" for e in expression.expressions]
            sql = " OR ".join(expressions)
            return f"({sql})" if len(expressions) > 1 else sql

        def alterset_sql(self, expression: exp.AlterSet) -> str:
            exprs = self.expressions(expression, flat=True)
            exprs = f"({exprs})" if exprs else ""

            access_method = self.sql(expression, "access_method")
            access_method = f"ACCESS METHOD {access_method}" if access_method else ""
            tablespace = self.sql(expression, "tablespace")
            tablespace = f"TABLESPACE {tablespace}" if tablespace else ""
            option = self.sql(expression, "option")

            return f"SET {exprs}{access_method}{tablespace}{option}"

        def datatype_sql(self, expression: exp.DataType) -> str:
            if expression.is_type(exp.DataType.Type.ARRAY):
                if expression.expressions:
                    values = self.expressions(expression, key="values", flat=True)
                    return f"{self.expressions(expression, flat=True)}[{values}]"
                return "ARRAY"
            return super().datatype_sql(expression)

        def cast_sql(self, expression: exp.Cast, safe_prefix: t.Optional[str] = None) -> str:
            this = expression.this

            # Postgres casts DIV() to decimal for transpilation but when roundtripping it's superfluous
            if isinstance(this, exp.IntDiv) and expression.to == exp.DataType.build("decimal"):
                return self.sql(this)

            return super().cast_sql(expression, safe_prefix=safe_prefix)

        def array_sql(self, expression: exp.Array) -> str:
            exprs = expression.expressions
            return (
                f"{self.normalize_func('ARRAY')}({self.sql(exprs[0])})"
                if isinstance(seq_get(exprs, 0), exp.Select)
                else f"{self.normalize_func('ARRAY')}[{self.expressions(expression, flat=True)}]"
            )

        def computedcolumnconstraint_sql(self, expression: exp.ComputedColumnConstraint) -> str:
            return f"GENERATED ALWAYS AS ({self.sql(expression, 'this')}) STORED"
