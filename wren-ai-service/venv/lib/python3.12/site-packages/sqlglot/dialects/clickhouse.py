from __future__ import annotations
import typing as t
import datetime
from sqlglot import exp, generator, parser, tokens
from sqlglot.dialects.dialect import (
    Dialect,
    NormalizationStrategy,
    arg_max_or_min_no_count,
    build_date_delta,
    build_formatted_time,
    inline_array_sql,
    json_extract_segments,
    json_path_key_only_name,
    no_pivot_sql,
    build_json_extract_path,
    rename_func,
    sha256_sql,
    var_map_sql,
    timestamptrunc_sql,
    unit_to_var,
    trim_sql,
)
from sqlglot.generator import Generator
from sqlglot.helper import is_int, seq_get
from sqlglot.tokens import Token, TokenType
from sqlglot.generator import unsupported_args

DATEΤΙΜΕ_DELTA = t.Union[exp.DateAdd, exp.DateDiff, exp.DateSub, exp.TimestampSub, exp.TimestampAdd]


def _build_date_format(args: t.List) -> exp.TimeToStr:
    expr = build_formatted_time(exp.TimeToStr, "clickhouse")(args)

    timezone = seq_get(args, 2)
    if timezone:
        expr.set("zone", timezone)

    return expr


def _unix_to_time_sql(self: ClickHouse.Generator, expression: exp.UnixToTime) -> str:
    scale = expression.args.get("scale")
    timestamp = expression.this

    if scale in (None, exp.UnixToTime.SECONDS):
        return self.func("fromUnixTimestamp", exp.cast(timestamp, exp.DataType.Type.BIGINT))
    if scale == exp.UnixToTime.MILLIS:
        return self.func("fromUnixTimestamp64Milli", exp.cast(timestamp, exp.DataType.Type.BIGINT))
    if scale == exp.UnixToTime.MICROS:
        return self.func("fromUnixTimestamp64Micro", exp.cast(timestamp, exp.DataType.Type.BIGINT))
    if scale == exp.UnixToTime.NANOS:
        return self.func("fromUnixTimestamp64Nano", exp.cast(timestamp, exp.DataType.Type.BIGINT))

    return self.func(
        "fromUnixTimestamp",
        exp.cast(
            exp.Div(this=timestamp, expression=exp.func("POW", 10, scale)), exp.DataType.Type.BIGINT
        ),
    )


def _lower_func(sql: str) -> str:
    index = sql.index("(")
    return sql[:index].lower() + sql[index:]


def _quantile_sql(self: ClickHouse.Generator, expression: exp.Quantile) -> str:
    quantile = expression.args["quantile"]
    args = f"({self.sql(expression, 'this')})"

    if isinstance(quantile, exp.Array):
        func = self.func("quantiles", *quantile)
    else:
        func = self.func("quantile", quantile)

    return func + args


def _build_count_if(args: t.List) -> exp.CountIf | exp.CombinedAggFunc:
    if len(args) == 1:
        return exp.CountIf(this=seq_get(args, 0))

    return exp.CombinedAggFunc(this="countIf", expressions=args, parts=("count", "If"))


def _build_str_to_date(args: t.List) -> exp.Cast | exp.Anonymous:
    if len(args) == 3:
        return exp.Anonymous(this="STR_TO_DATE", expressions=args)

    strtodate = exp.StrToDate.from_arg_list(args)
    return exp.cast(strtodate, exp.DataType.build(exp.DataType.Type.DATETIME))


def _datetime_delta_sql(name: str) -> t.Callable[[Generator, DATEΤΙΜΕ_DELTA], str]:
    def _delta_sql(self: Generator, expression: DATEΤΙΜΕ_DELTA) -> str:
        if not expression.unit:
            return rename_func(name)(self, expression)

        return self.func(
            name,
            unit_to_var(expression),
            expression.expression,
            expression.this,
        )

    return _delta_sql


def _timestrtotime_sql(self: ClickHouse.Generator, expression: exp.TimeStrToTime):
    ts = expression.this

    tz = expression.args.get("zone")
    if tz and isinstance(ts, exp.Literal):
        # Clickhouse will not accept timestamps that include a UTC offset, so we must remove them.
        # The first step to removing is parsing the string with `datetime.datetime.fromisoformat`.
        #
        # In python <3.11, `fromisoformat()` can only parse timestamps of millisecond (3 digit)
        # or microsecond (6 digit) precision. It will error if passed any other number of fractional
        # digits, so we extract the fractional seconds and pad to 6 digits before parsing.
        ts_string = ts.name.strip()

        # separate [date and time] from [fractional seconds and UTC offset]
        ts_parts = ts_string.split(".")
        if len(ts_parts) == 2:
            # separate fractional seconds and UTC offset
            offset_sep = "+" if "+" in ts_parts[1] else "-"
            ts_frac_parts = ts_parts[1].split(offset_sep)
            num_frac_parts = len(ts_frac_parts)

            # pad to 6 digits if fractional seconds present
            ts_frac_parts[0] = ts_frac_parts[0].ljust(6, "0")
            ts_string = "".join(
                [
                    ts_parts[0],  # date and time
                    ".",
                    ts_frac_parts[0],  # fractional seconds
                    offset_sep if num_frac_parts > 1 else "",
                    ts_frac_parts[1] if num_frac_parts > 1 else "",  # utc offset (if present)
                ]
            )

        # return literal with no timezone, eg turn '2020-01-01 12:13:14-08:00' into '2020-01-01 12:13:14'
        # this is because Clickhouse encodes the timezone as a data type parameter and throws an error if
        # it's part of the timestamp string
        ts_without_tz = (
            datetime.datetime.fromisoformat(ts_string).replace(tzinfo=None).isoformat(sep=" ")
        )
        ts = exp.Literal.string(ts_without_tz)

    # Non-nullable DateTime64 with microsecond precision
    expressions = [exp.DataTypeParam(this=tz)] if tz else []
    datatype = exp.DataType.build(
        exp.DataType.Type.DATETIME64,
        expressions=[exp.DataTypeParam(this=exp.Literal.number(6)), *expressions],
        nullable=False,
    )

    return self.sql(exp.cast(ts, datatype, dialect=self.dialect))


class ClickHouse(Dialect):
    NORMALIZE_FUNCTIONS: bool | str = False
    NULL_ORDERING = "nulls_are_last"
    SUPPORTS_USER_DEFINED_TYPES = False
    SAFE_DIVISION = True
    LOG_BASE_FIRST: t.Optional[bool] = None
    FORCE_EARLY_ALIAS_REF_EXPANSION = True
    PRESERVE_ORIGINAL_NAMES = True

    # https://github.com/ClickHouse/ClickHouse/issues/33935#issue-1112165779
    NORMALIZATION_STRATEGY = NormalizationStrategy.CASE_SENSITIVE

    UNESCAPED_SEQUENCES = {
        "\\0": "\0",
    }

    CREATABLE_KIND_MAPPING = {"DATABASE": "SCHEMA"}

    SET_OP_DISTINCT_BY_DEFAULT: t.Dict[t.Type[exp.Expression], t.Optional[bool]] = {
        exp.Except: False,
        exp.Intersect: False,
        exp.Union: None,
    }

    class Tokenizer(tokens.Tokenizer):
        COMMENTS = ["--", "#", "#!", ("/*", "*/")]
        IDENTIFIERS = ['"', "`"]
        IDENTIFIER_ESCAPES = ["\\"]
        STRING_ESCAPES = ["'", "\\"]
        BIT_STRINGS = [("0b", "")]
        HEX_STRINGS = [("0x", ""), ("0X", "")]
        HEREDOC_STRINGS = ["$"]

        KEYWORDS = {
            **tokens.Tokenizer.KEYWORDS,
            "ATTACH": TokenType.COMMAND,
            "DATE32": TokenType.DATE32,
            "DATETIME64": TokenType.DATETIME64,
            "DICTIONARY": TokenType.DICTIONARY,
            "ENUM8": TokenType.ENUM8,
            "ENUM16": TokenType.ENUM16,
            "FINAL": TokenType.FINAL,
            "FIXEDSTRING": TokenType.FIXEDSTRING,
            "FLOAT32": TokenType.FLOAT,
            "FLOAT64": TokenType.DOUBLE,
            "GLOBAL": TokenType.GLOBAL,
            "INT256": TokenType.INT256,
            "LOWCARDINALITY": TokenType.LOWCARDINALITY,
            "MAP": TokenType.MAP,
            "NESTED": TokenType.NESTED,
            "SAMPLE": TokenType.TABLE_SAMPLE,
            "TUPLE": TokenType.STRUCT,
            "UINT128": TokenType.UINT128,
            "UINT16": TokenType.USMALLINT,
            "UINT256": TokenType.UINT256,
            "UINT32": TokenType.UINT,
            "UINT64": TokenType.UBIGINT,
            "UINT8": TokenType.UTINYINT,
            "IPV4": TokenType.IPV4,
            "IPV6": TokenType.IPV6,
            "POINT": TokenType.POINT,
            "RING": TokenType.RING,
            "LINESTRING": TokenType.LINESTRING,
            "MULTILINESTRING": TokenType.MULTILINESTRING,
            "POLYGON": TokenType.POLYGON,
            "MULTIPOLYGON": TokenType.MULTIPOLYGON,
            "AGGREGATEFUNCTION": TokenType.AGGREGATEFUNCTION,
            "SIMPLEAGGREGATEFUNCTION": TokenType.SIMPLEAGGREGATEFUNCTION,
            "SYSTEM": TokenType.COMMAND,
            "PREWHERE": TokenType.PREWHERE,
        }
        KEYWORDS.pop("/*+")

        SINGLE_TOKENS = {
            **tokens.Tokenizer.SINGLE_TOKENS,
            "$": TokenType.HEREDOC_STRING,
        }

    class Parser(parser.Parser):
        # Tested in ClickHouse's playground, it seems that the following two queries do the same thing
        # * select x from t1 union all select x from t2 limit 1;
        # * select x from t1 union all (select x from t2 limit 1);
        MODIFIERS_ATTACHED_TO_SET_OP = False
        INTERVAL_SPANS = False

        FUNCTIONS = {
            **parser.Parser.FUNCTIONS,
            "ANY": exp.AnyValue.from_arg_list,
            "ARRAYSUM": exp.ArraySum.from_arg_list,
            "COUNTIF": _build_count_if,
            "DATE_ADD": build_date_delta(exp.DateAdd, default_unit=None),
            "DATEADD": build_date_delta(exp.DateAdd, default_unit=None),
            "DATE_DIFF": build_date_delta(exp.DateDiff, default_unit=None),
            "DATEDIFF": build_date_delta(exp.DateDiff, default_unit=None),
            "DATE_FORMAT": _build_date_format,
            "DATE_SUB": build_date_delta(exp.DateSub, default_unit=None),
            "DATESUB": build_date_delta(exp.DateSub, default_unit=None),
            "FORMATDATETIME": _build_date_format,
            "JSONEXTRACTSTRING": build_json_extract_path(
                exp.JSONExtractScalar, zero_based_indexing=False
            ),
            "MAP": parser.build_var_map,
            "MATCH": exp.RegexpLike.from_arg_list,
            "RANDCANONICAL": exp.Rand.from_arg_list,
            "STR_TO_DATE": _build_str_to_date,
            "TUPLE": exp.Struct.from_arg_list,
            "TIMESTAMP_SUB": build_date_delta(exp.TimestampSub, default_unit=None),
            "TIMESTAMPSUB": build_date_delta(exp.TimestampSub, default_unit=None),
            "TIMESTAMP_ADD": build_date_delta(exp.TimestampAdd, default_unit=None),
            "TIMESTAMPADD": build_date_delta(exp.TimestampAdd, default_unit=None),
            "UNIQ": exp.ApproxDistinct.from_arg_list,
            "XOR": lambda args: exp.Xor(expressions=args),
            "MD5": exp.MD5Digest.from_arg_list,
            "SHA256": lambda args: exp.SHA2(this=seq_get(args, 0), length=exp.Literal.number(256)),
            "SHA512": lambda args: exp.SHA2(this=seq_get(args, 0), length=exp.Literal.number(512)),
            "EDITDISTANCE": exp.Levenshtein.from_arg_list,
            "LEVENSHTEINDISTANCE": exp.Levenshtein.from_arg_list,
        }
        FUNCTIONS.pop("TRANSFORM")

        AGG_FUNCTIONS = {
            "count",
            "min",
            "max",
            "sum",
            "avg",
            "any",
            "stddevPop",
            "stddevSamp",
            "varPop",
            "varSamp",
            "corr",
            "covarPop",
            "covarSamp",
            "entropy",
            "exponentialMovingAverage",
            "intervalLengthSum",
            "kolmogorovSmirnovTest",
            "mannWhitneyUTest",
            "median",
            "rankCorr",
            "sumKahan",
            "studentTTest",
            "welchTTest",
            "anyHeavy",
            "anyLast",
            "boundingRatio",
            "first_value",
            "last_value",
            "argMin",
            "argMax",
            "avgWeighted",
            "topK",
            "topKWeighted",
            "deltaSum",
            "deltaSumTimestamp",
            "groupArray",
            "groupArrayLast",
            "groupUniqArray",
            "groupArrayInsertAt",
            "groupArrayMovingAvg",
            "groupArrayMovingSum",
            "groupArraySample",
            "groupBitAnd",
            "groupBitOr",
            "groupBitXor",
            "groupBitmap",
            "groupBitmapAnd",
            "groupBitmapOr",
            "groupBitmapXor",
            "sumWithOverflow",
            "sumMap",
            "minMap",
            "maxMap",
            "skewSamp",
            "skewPop",
            "kurtSamp",
            "kurtPop",
            "uniq",
            "uniqExact",
            "uniqCombined",
            "uniqCombined64",
            "uniqHLL12",
            "uniqTheta",
            "quantile",
            "quantiles",
            "quantileExact",
            "quantilesExact",
            "quantileExactLow",
            "quantilesExactLow",
            "quantileExactHigh",
            "quantilesExactHigh",
            "quantileExactWeighted",
            "quantilesExactWeighted",
            "quantileTiming",
            "quantilesTiming",
            "quantileTimingWeighted",
            "quantilesTimingWeighted",
            "quantileDeterministic",
            "quantilesDeterministic",
            "quantileTDigest",
            "quantilesTDigest",
            "quantileTDigestWeighted",
            "quantilesTDigestWeighted",
            "quantileBFloat16",
            "quantilesBFloat16",
            "quantileBFloat16Weighted",
            "quantilesBFloat16Weighted",
            "simpleLinearRegression",
            "stochasticLinearRegression",
            "stochasticLogisticRegression",
            "categoricalInformationValue",
            "contingency",
            "cramersV",
            "cramersVBiasCorrected",
            "theilsU",
            "maxIntersections",
            "maxIntersectionsPosition",
            "meanZTest",
            "quantileInterpolatedWeighted",
            "quantilesInterpolatedWeighted",
            "quantileGK",
            "quantilesGK",
            "sparkBar",
            "sumCount",
            "largestTriangleThreeBuckets",
            "histogram",
            "sequenceMatch",
            "sequenceCount",
            "windowFunnel",
            "retention",
            "uniqUpTo",
            "sequenceNextNode",
            "exponentialTimeDecayedAvg",
        }

        AGG_FUNCTIONS_SUFFIXES = [
            "If",
            "Array",
            "ArrayIf",
            "Map",
            "SimpleState",
            "State",
            "Merge",
            "MergeState",
            "ForEach",
            "Distinct",
            "OrDefault",
            "OrNull",
            "Resample",
            "ArgMin",
            "ArgMax",
        ]

        FUNC_TOKENS = {
            *parser.Parser.FUNC_TOKENS,
            TokenType.SET,
        }

        RESERVED_TOKENS = parser.Parser.RESERVED_TOKENS - {TokenType.SELECT}

        ID_VAR_TOKENS = {
            *parser.Parser.ID_VAR_TOKENS,
            TokenType.LIKE,
        }

        AGG_FUNC_MAPPING = (
            lambda functions, suffixes: {
                f"{f}{sfx}": (f, sfx) for sfx in (suffixes + [""]) for f in functions
            }
        )(AGG_FUNCTIONS, AGG_FUNCTIONS_SUFFIXES)

        FUNCTIONS_WITH_ALIASED_ARGS = {*parser.Parser.FUNCTIONS_WITH_ALIASED_ARGS, "TUPLE"}

        FUNCTION_PARSERS = {
            **parser.Parser.FUNCTION_PARSERS,
            "ARRAYJOIN": lambda self: self.expression(exp.Explode, this=self._parse_expression()),
            "QUANTILE": lambda self: self._parse_quantile(),
            "MEDIAN": lambda self: self._parse_quantile(),
            "COLUMNS": lambda self: self._parse_columns(),
        }

        FUNCTION_PARSERS.pop("MATCH")

        NO_PAREN_FUNCTION_PARSERS = parser.Parser.NO_PAREN_FUNCTION_PARSERS.copy()
        NO_PAREN_FUNCTION_PARSERS.pop("ANY")

        NO_PAREN_FUNCTIONS = parser.Parser.NO_PAREN_FUNCTIONS.copy()
        NO_PAREN_FUNCTIONS.pop(TokenType.CURRENT_TIMESTAMP)

        RANGE_PARSERS = {
            **parser.Parser.RANGE_PARSERS,
            TokenType.GLOBAL: lambda self, this: self._match(TokenType.IN)
            and self._parse_in(this, is_global=True),
        }

        # The PLACEHOLDER entry is popped because 1) it doesn't affect Clickhouse (it corresponds to
        # the postgres-specific JSONBContains parser) and 2) it makes parsing the ternary op simpler.
        COLUMN_OPERATORS = parser.Parser.COLUMN_OPERATORS.copy()
        COLUMN_OPERATORS.pop(TokenType.PLACEHOLDER)

        JOIN_KINDS = {
            *parser.Parser.JOIN_KINDS,
            TokenType.ANY,
            TokenType.ASOF,
            TokenType.ARRAY,
        }

        TABLE_ALIAS_TOKENS = parser.Parser.TABLE_ALIAS_TOKENS - {
            TokenType.ANY,
            TokenType.ARRAY,
            TokenType.FINAL,
            TokenType.FORMAT,
            TokenType.SETTINGS,
        }

        ALIAS_TOKENS = parser.Parser.ALIAS_TOKENS - {
            TokenType.FORMAT,
        }

        LOG_DEFAULTS_TO_LN = True

        QUERY_MODIFIER_PARSERS = {
            **parser.Parser.QUERY_MODIFIER_PARSERS,
            TokenType.SETTINGS: lambda self: (
                "settings",
                self._advance() or self._parse_csv(self._parse_assignment),
            ),
            TokenType.FORMAT: lambda self: ("format", self._advance() or self._parse_id_var()),
        }

        CONSTRAINT_PARSERS = {
            **parser.Parser.CONSTRAINT_PARSERS,
            "INDEX": lambda self: self._parse_index_constraint(),
            "CODEC": lambda self: self._parse_compress(),
        }

        ALTER_PARSERS = {
            **parser.Parser.ALTER_PARSERS,
            "REPLACE": lambda self: self._parse_alter_table_replace(),
        }

        SCHEMA_UNNAMED_CONSTRAINTS = {
            *parser.Parser.SCHEMA_UNNAMED_CONSTRAINTS,
            "INDEX",
        }

        PLACEHOLDER_PARSERS = {
            **parser.Parser.PLACEHOLDER_PARSERS,
            TokenType.L_BRACE: lambda self: self._parse_query_parameter(),
        }

        # https://clickhouse.com/docs/en/sql-reference/statements/create/function
        def _parse_user_defined_function_expression(self) -> t.Optional[exp.Expression]:
            return self._parse_lambda()

        def _parse_types(
            self, check_func: bool = False, schema: bool = False, allow_identifiers: bool = True
        ) -> t.Optional[exp.Expression]:
            dtype = super()._parse_types(
                check_func=check_func, schema=schema, allow_identifiers=allow_identifiers
            )
            if isinstance(dtype, exp.DataType) and dtype.args.get("nullable") is not True:
                # Mark every type as non-nullable which is ClickHouse's default, unless it's
                # already marked as nullable. This marker helps us transpile types from other
                # dialects to ClickHouse, so that we can e.g. produce `CAST(x AS Nullable(String))`
                # from `CAST(x AS TEXT)`. If there is a `NULL` value in `x`, the former would
                # fail in ClickHouse without the `Nullable` type constructor.
                dtype.set("nullable", False)

            return dtype

        def _parse_extract(self) -> exp.Extract | exp.Anonymous:
            index = self._index
            this = self._parse_bitwise()
            if self._match(TokenType.FROM):
                self._retreat(index)
                return super()._parse_extract()

            # We return Anonymous here because extract and regexpExtract have different semantics,
            # so parsing extract(foo, bar) into RegexpExtract can potentially break queries. E.g.,
            # `extract('foobar', 'b')` works, but ClickHouse crashes for `regexpExtract('foobar', 'b')`.
            #
            # TODO: can we somehow convert the former into an equivalent `regexpExtract` call?
            self._match(TokenType.COMMA)
            return self.expression(
                exp.Anonymous, this="extract", expressions=[this, self._parse_bitwise()]
            )

        def _parse_assignment(self) -> t.Optional[exp.Expression]:
            this = super()._parse_assignment()

            if self._match(TokenType.PLACEHOLDER):
                return self.expression(
                    exp.If,
                    this=this,
                    true=self._parse_assignment(),
                    false=self._match(TokenType.COLON) and self._parse_assignment(),
                )

            return this

        def _parse_query_parameter(self) -> t.Optional[exp.Expression]:
            """
            Parse a placeholder expression like SELECT {abc: UInt32} or FROM {table: Identifier}
            https://clickhouse.com/docs/en/sql-reference/syntax#defining-and-using-query-parameters
            """
            this = self._parse_id_var()
            self._match(TokenType.COLON)
            kind = self._parse_types(check_func=False, allow_identifiers=False) or (
                self._match_text_seq("IDENTIFIER") and "Identifier"
            )

            if not kind:
                self.raise_error("Expecting a placeholder type or 'Identifier' for tables")
            elif not self._match(TokenType.R_BRACE):
                self.raise_error("Expecting }")

            return self.expression(exp.Placeholder, this=this, kind=kind)

        def _parse_in(self, this: t.Optional[exp.Expression], is_global: bool = False) -> exp.In:
            this = super()._parse_in(this)
            this.set("is_global", is_global)
            return this

        def _parse_table(
            self,
            schema: bool = False,
            joins: bool = False,
            alias_tokens: t.Optional[t.Collection[TokenType]] = None,
            parse_bracket: bool = False,
            is_db_reference: bool = False,
            parse_partition: bool = False,
        ) -> t.Optional[exp.Expression]:
            this = super()._parse_table(
                schema=schema,
                joins=joins,
                alias_tokens=alias_tokens,
                parse_bracket=parse_bracket,
                is_db_reference=is_db_reference,
            )

            if self._match(TokenType.FINAL):
                this = self.expression(exp.Final, this=this)

            return this

        def _parse_position(self, haystack_first: bool = False) -> exp.StrPosition:
            return super()._parse_position(haystack_first=True)

        # https://clickhouse.com/docs/en/sql-reference/statements/select/with/
        def _parse_cte(self) -> exp.CTE:
            # WITH <identifier> AS <subquery expression>
            cte: t.Optional[exp.CTE] = self._try_parse(super()._parse_cte)

            if not cte:
                # WITH <expression> AS <identifier>
                cte = self.expression(
                    exp.CTE,
                    this=self._parse_assignment(),
                    alias=self._parse_table_alias(),
                    scalar=True,
                )

            return cte

        def _parse_join_parts(
            self,
        ) -> t.Tuple[t.Optional[Token], t.Optional[Token], t.Optional[Token]]:
            is_global = self._match(TokenType.GLOBAL) and self._prev
            kind_pre = self._match_set(self.JOIN_KINDS, advance=False) and self._prev

            if kind_pre:
                kind = self._match_set(self.JOIN_KINDS) and self._prev
                side = self._match_set(self.JOIN_SIDES) and self._prev
                return is_global, side, kind

            return (
                is_global,
                self._match_set(self.JOIN_SIDES) and self._prev,
                self._match_set(self.JOIN_KINDS) and self._prev,
            )

        def _parse_join(
            self, skip_join_token: bool = False, parse_bracket: bool = False
        ) -> t.Optional[exp.Join]:
            join = super()._parse_join(skip_join_token=skip_join_token, parse_bracket=True)
            if join:
                join.set("global", join.args.pop("method", None))

                # tbl ARRAY JOIN arr <-- this should be a `Column` reference, not a `Table`
                # https://clickhouse.com/docs/en/sql-reference/statements/select/array-join
                if join.kind == "ARRAY":
                    for table in join.find_all(exp.Table):
                        table.replace(table.to_column())

            return join

        def _parse_function(
            self,
            functions: t.Optional[t.Dict[str, t.Callable]] = None,
            anonymous: bool = False,
            optional_parens: bool = True,
            any_token: bool = False,
        ) -> t.Optional[exp.Expression]:
            expr = super()._parse_function(
                functions=functions,
                anonymous=anonymous,
                optional_parens=optional_parens,
                any_token=any_token,
            )

            func = expr.this if isinstance(expr, exp.Window) else expr

            # Aggregate functions can be split in 2 parts: <func_name><suffix>
            parts = (
                self.AGG_FUNC_MAPPING.get(func.this) if isinstance(func, exp.Anonymous) else None
            )

            if parts:
                anon_func: exp.Anonymous = t.cast(exp.Anonymous, func)
                params = self._parse_func_params(anon_func)

                kwargs = {
                    "this": anon_func.this,
                    "expressions": anon_func.expressions,
                }
                if parts[1]:
                    kwargs["parts"] = parts
                    exp_class: t.Type[exp.Expression] = (
                        exp.CombinedParameterizedAgg if params else exp.CombinedAggFunc
                    )
                else:
                    exp_class = exp.ParameterizedAgg if params else exp.AnonymousAggFunc

                kwargs["exp_class"] = exp_class
                if params:
                    kwargs["params"] = params

                func = self.expression(**kwargs)

                if isinstance(expr, exp.Window):
                    # The window's func was parsed as Anonymous in base parser, fix its
                    # type to be ClickHouse style CombinedAnonymousAggFunc / AnonymousAggFunc
                    expr.set("this", func)
                elif params:
                    # Params have blocked super()._parse_function() from parsing the following window
                    # (if that exists) as they're standing between the function call and the window spec
                    expr = self._parse_window(func)
                else:
                    expr = func

            return expr

        def _parse_func_params(
            self, this: t.Optional[exp.Func] = None
        ) -> t.Optional[t.List[exp.Expression]]:
            if self._match_pair(TokenType.R_PAREN, TokenType.L_PAREN):
                return self._parse_csv(self._parse_lambda)

            if self._match(TokenType.L_PAREN):
                params = self._parse_csv(self._parse_lambda)
                self._match_r_paren(this)
                return params

            return None

        def _parse_quantile(self) -> exp.Quantile:
            this = self._parse_lambda()
            params = self._parse_func_params()
            if params:
                return self.expression(exp.Quantile, this=params[0], quantile=this)
            return self.expression(exp.Quantile, this=this, quantile=exp.Literal.number(0.5))

        def _parse_wrapped_id_vars(self, optional: bool = False) -> t.List[exp.Expression]:
            return super()._parse_wrapped_id_vars(optional=True)

        def _parse_primary_key(
            self, wrapped_optional: bool = False, in_props: bool = False
        ) -> exp.PrimaryKeyColumnConstraint | exp.PrimaryKey:
            return super()._parse_primary_key(
                wrapped_optional=wrapped_optional or in_props, in_props=in_props
            )

        def _parse_on_property(self) -> t.Optional[exp.Expression]:
            index = self._index
            if self._match_text_seq("CLUSTER"):
                this = self._parse_id_var()
                if this:
                    return self.expression(exp.OnCluster, this=this)
                else:
                    self._retreat(index)
            return None

        def _parse_index_constraint(
            self, kind: t.Optional[str] = None
        ) -> exp.IndexColumnConstraint:
            # INDEX name1 expr TYPE type1(args) GRANULARITY value
            this = self._parse_id_var()
            expression = self._parse_assignment()

            index_type = self._match_text_seq("TYPE") and (
                self._parse_function() or self._parse_var()
            )

            granularity = self._match_text_seq("GRANULARITY") and self._parse_term()

            return self.expression(
                exp.IndexColumnConstraint,
                this=this,
                expression=expression,
                index_type=index_type,
                granularity=granularity,
            )

        def _parse_partition(self) -> t.Optional[exp.Partition]:
            # https://clickhouse.com/docs/en/sql-reference/statements/alter/partition#how-to-set-partition-expression
            if not self._match(TokenType.PARTITION):
                return None

            if self._match_text_seq("ID"):
                # Corresponds to the PARTITION ID <string_value> syntax
                expressions: t.List[exp.Expression] = [
                    self.expression(exp.PartitionId, this=self._parse_string())
                ]
            else:
                expressions = self._parse_expressions()

            return self.expression(exp.Partition, expressions=expressions)

        def _parse_alter_table_replace(self) -> t.Optional[exp.Expression]:
            partition = self._parse_partition()

            if not partition or not self._match(TokenType.FROM):
                return None

            return self.expression(
                exp.ReplacePartition, expression=partition, source=self._parse_table_parts()
            )

        def _parse_projection_def(self) -> t.Optional[exp.ProjectionDef]:
            if not self._match_text_seq("PROJECTION"):
                return None

            return self.expression(
                exp.ProjectionDef,
                this=self._parse_id_var(),
                expression=self._parse_wrapped(self._parse_statement),
            )

        def _parse_constraint(self) -> t.Optional[exp.Expression]:
            return super()._parse_constraint() or self._parse_projection_def()

        def _parse_alias(
            self, this: t.Optional[exp.Expression], explicit: bool = False
        ) -> t.Optional[exp.Expression]:
            # In clickhouse "SELECT <expr> APPLY(...)" is a query modifier,
            # so "APPLY" shouldn't be parsed as <expr>'s alias. However, "SELECT <expr> apply" is a valid alias
            if self._match_pair(TokenType.APPLY, TokenType.L_PAREN, advance=False):
                return this

            return super()._parse_alias(this=this, explicit=explicit)

        def _parse_expression(self) -> t.Optional[exp.Expression]:
            this = super()._parse_expression()

            # Clickhouse allows "SELECT <expr> [APPLY(func)] [...]]" modifier
            while self._match_pair(TokenType.APPLY, TokenType.L_PAREN):
                this = exp.Apply(this=this, expression=self._parse_var(any_token=True))
                self._match(TokenType.R_PAREN)

            return this

        def _parse_columns(self) -> exp.Expression:
            this: exp.Expression = self.expression(exp.Columns, this=self._parse_lambda())

            while self._next and self._match_text_seq(")", "APPLY", "("):
                self._match(TokenType.R_PAREN)
                this = exp.Apply(this=this, expression=self._parse_var(any_token=True))
            return this

    class Generator(generator.Generator):
        QUERY_HINTS = False
        STRUCT_DELIMITER = ("(", ")")
        NVL2_SUPPORTED = False
        TABLESAMPLE_REQUIRES_PARENS = False
        TABLESAMPLE_SIZE_IS_ROWS = False
        TABLESAMPLE_KEYWORDS = "SAMPLE"
        LAST_DAY_SUPPORTS_DATE_PART = False
        CAN_IMPLEMENT_ARRAY_ANY = True
        SUPPORTS_TO_NUMBER = False
        JOIN_HINTS = False
        TABLE_HINTS = False
        GROUPINGS_SEP = ""
        SET_OP_MODIFIERS = False
        SUPPORTS_TABLE_ALIAS_COLUMNS = False
        VALUES_AS_TABLE = False
        ARRAY_SIZE_NAME = "LENGTH"

        STRING_TYPE_MAPPING = {
            exp.DataType.Type.CHAR: "String",
            exp.DataType.Type.LONGBLOB: "String",
            exp.DataType.Type.LONGTEXT: "String",
            exp.DataType.Type.MEDIUMBLOB: "String",
            exp.DataType.Type.MEDIUMTEXT: "String",
            exp.DataType.Type.TINYBLOB: "String",
            exp.DataType.Type.TINYTEXT: "String",
            exp.DataType.Type.TEXT: "String",
            exp.DataType.Type.VARBINARY: "String",
            exp.DataType.Type.VARCHAR: "String",
        }

        SUPPORTED_JSON_PATH_PARTS = {
            exp.JSONPathKey,
            exp.JSONPathRoot,
            exp.JSONPathSubscript,
        }

        TYPE_MAPPING = {
            **generator.Generator.TYPE_MAPPING,
            **STRING_TYPE_MAPPING,
            exp.DataType.Type.ARRAY: "Array",
            exp.DataType.Type.BOOLEAN: "Bool",
            exp.DataType.Type.BIGINT: "Int64",
            exp.DataType.Type.DATE32: "Date32",
            exp.DataType.Type.DATETIME: "DateTime",
            exp.DataType.Type.DATETIME64: "DateTime64",
            exp.DataType.Type.DECIMAL: "Decimal",
            exp.DataType.Type.DECIMAL32: "Decimal32",
            exp.DataType.Type.DECIMAL64: "Decimal64",
            exp.DataType.Type.DECIMAL128: "Decimal128",
            exp.DataType.Type.DECIMAL256: "Decimal256",
            exp.DataType.Type.TIMESTAMP: "DateTime",
            exp.DataType.Type.TIMESTAMPTZ: "DateTime",
            exp.DataType.Type.DOUBLE: "Float64",
            exp.DataType.Type.ENUM: "Enum",
            exp.DataType.Type.ENUM8: "Enum8",
            exp.DataType.Type.ENUM16: "Enum16",
            exp.DataType.Type.FIXEDSTRING: "FixedString",
            exp.DataType.Type.FLOAT: "Float32",
            exp.DataType.Type.INT: "Int32",
            exp.DataType.Type.MEDIUMINT: "Int32",
            exp.DataType.Type.INT128: "Int128",
            exp.DataType.Type.INT256: "Int256",
            exp.DataType.Type.LOWCARDINALITY: "LowCardinality",
            exp.DataType.Type.MAP: "Map",
            exp.DataType.Type.NESTED: "Nested",
            exp.DataType.Type.SMALLINT: "Int16",
            exp.DataType.Type.STRUCT: "Tuple",
            exp.DataType.Type.TINYINT: "Int8",
            exp.DataType.Type.UBIGINT: "UInt64",
            exp.DataType.Type.UINT: "UInt32",
            exp.DataType.Type.UINT128: "UInt128",
            exp.DataType.Type.UINT256: "UInt256",
            exp.DataType.Type.USMALLINT: "UInt16",
            exp.DataType.Type.UTINYINT: "UInt8",
            exp.DataType.Type.IPV4: "IPv4",
            exp.DataType.Type.IPV6: "IPv6",
            exp.DataType.Type.POINT: "Point",
            exp.DataType.Type.RING: "Ring",
            exp.DataType.Type.LINESTRING: "LineString",
            exp.DataType.Type.MULTILINESTRING: "MultiLineString",
            exp.DataType.Type.POLYGON: "Polygon",
            exp.DataType.Type.MULTIPOLYGON: "MultiPolygon",
            exp.DataType.Type.AGGREGATEFUNCTION: "AggregateFunction",
            exp.DataType.Type.SIMPLEAGGREGATEFUNCTION: "SimpleAggregateFunction",
        }

        TRANSFORMS = {
            **generator.Generator.TRANSFORMS,
            exp.AnyValue: rename_func("any"),
            exp.ApproxDistinct: rename_func("uniq"),
            exp.ArrayFilter: lambda self, e: self.func("arrayFilter", e.expression, e.this),
            exp.ArraySum: rename_func("arraySum"),
            exp.ArgMax: arg_max_or_min_no_count("argMax"),
            exp.ArgMin: arg_max_or_min_no_count("argMin"),
            exp.Array: inline_array_sql,
            exp.CastToStrType: rename_func("CAST"),
            exp.CountIf: rename_func("countIf"),
            exp.CompressColumnConstraint: lambda self,
            e: f"CODEC({self.expressions(e, key='this', flat=True)})",
            exp.ComputedColumnConstraint: lambda self,
            e: f"{'MATERIALIZED' if e.args.get('persisted') else 'ALIAS'} {self.sql(e, 'this')}",
            exp.CurrentDate: lambda self, e: self.func("CURRENT_DATE"),
            exp.DateAdd: _datetime_delta_sql("DATE_ADD"),
            exp.DateDiff: _datetime_delta_sql("DATE_DIFF"),
            exp.DateStrToDate: rename_func("toDate"),
            exp.DateSub: _datetime_delta_sql("DATE_SUB"),
            exp.Explode: rename_func("arrayJoin"),
            exp.Final: lambda self, e: f"{self.sql(e, 'this')} FINAL",
            exp.IsNan: rename_func("isNaN"),
            exp.JSONExtract: json_extract_segments("JSONExtractString", quoted_index=False),
            exp.JSONExtractScalar: json_extract_segments("JSONExtractString", quoted_index=False),
            exp.JSONPathKey: json_path_key_only_name,
            exp.JSONPathRoot: lambda *_: "",
            exp.Map: lambda self, e: _lower_func(var_map_sql(self, e)),
            exp.Median: rename_func("median"),
            exp.Nullif: rename_func("nullIf"),
            exp.PartitionedByProperty: lambda self, e: f"PARTITION BY {self.sql(e, 'this')}",
            exp.Pivot: no_pivot_sql,
            exp.Quantile: _quantile_sql,
            exp.RegexpLike: lambda self, e: self.func("match", e.this, e.expression),
            exp.Rand: rename_func("randCanonical"),
            exp.StartsWith: rename_func("startsWith"),
            exp.StrPosition: lambda self, e: self.func(
                "position", e.this, e.args.get("substr"), e.args.get("position")
            ),
            exp.TimeToStr: lambda self, e: self.func(
                "formatDateTime", e.this, self.format_time(e), e.args.get("zone")
            ),
            exp.TimeStrToTime: _timestrtotime_sql,
            exp.TimestampAdd: _datetime_delta_sql("TIMESTAMP_ADD"),
            exp.TimestampSub: _datetime_delta_sql("TIMESTAMP_SUB"),
            exp.VarMap: lambda self, e: _lower_func(var_map_sql(self, e)),
            exp.Xor: lambda self, e: self.func("xor", e.this, e.expression, *e.expressions),
            exp.MD5Digest: rename_func("MD5"),
            exp.MD5: lambda self, e: self.func("LOWER", self.func("HEX", self.func("MD5", e.this))),
            exp.SHA: rename_func("SHA1"),
            exp.SHA2: sha256_sql,
            exp.UnixToTime: _unix_to_time_sql,
            exp.TimestampTrunc: timestamptrunc_sql(zone=True),
            exp.Trim: trim_sql,
            exp.Variance: rename_func("varSamp"),
            exp.SchemaCommentProperty: lambda self, e: self.naked_property(e),
            exp.Stddev: rename_func("stddevSamp"),
            exp.Chr: rename_func("CHAR"),
            exp.Lag: lambda self, e: self.func(
                "lagInFrame", e.this, e.args.get("offset"), e.args.get("default")
            ),
            exp.Lead: lambda self, e: self.func(
                "leadInFrame", e.this, e.args.get("offset"), e.args.get("default")
            ),
            exp.Levenshtein: unsupported_args("ins_cost", "del_cost", "sub_cost", "max_dist")(
                rename_func("editDistance")
            ),
        }

        PROPERTIES_LOCATION = {
            **generator.Generator.PROPERTIES_LOCATION,
            exp.OnCluster: exp.Properties.Location.POST_NAME,
            exp.PartitionedByProperty: exp.Properties.Location.POST_SCHEMA,
            exp.ToTableProperty: exp.Properties.Location.POST_NAME,
            exp.VolatileProperty: exp.Properties.Location.UNSUPPORTED,
        }

        # There's no list in docs, but it can be found in Clickhouse code
        # see `ClickHouse/src/Parsers/ParserCreate*.cpp`
        ON_CLUSTER_TARGETS = {
            "SCHEMA",  # Transpiled CREATE SCHEMA may have OnCluster property set
            "DATABASE",
            "TABLE",
            "VIEW",
            "DICTIONARY",
            "INDEX",
            "FUNCTION",
            "NAMED COLLECTION",
        }

        # https://clickhouse.com/docs/en/sql-reference/data-types/nullable
        NON_NULLABLE_TYPES = {
            exp.DataType.Type.ARRAY,
            exp.DataType.Type.MAP,
            exp.DataType.Type.STRUCT,
            exp.DataType.Type.POINT,
            exp.DataType.Type.RING,
            exp.DataType.Type.LINESTRING,
            exp.DataType.Type.MULTILINESTRING,
            exp.DataType.Type.POLYGON,
            exp.DataType.Type.MULTIPOLYGON,
        }

        def strtodate_sql(self, expression: exp.StrToDate) -> str:
            strtodate_sql = self.function_fallback_sql(expression)

            if not isinstance(expression.parent, exp.Cast):
                # StrToDate returns DATEs in other dialects (eg. postgres), so
                # this branch aims to improve the transpilation to clickhouse
                return f"CAST({strtodate_sql} AS DATE)"

            return strtodate_sql

        def cast_sql(self, expression: exp.Cast, safe_prefix: t.Optional[str] = None) -> str:
            this = expression.this

            if isinstance(this, exp.StrToDate) and expression.to == exp.DataType.build("datetime"):
                return self.sql(this)

            return super().cast_sql(expression, safe_prefix=safe_prefix)

        def trycast_sql(self, expression: exp.TryCast) -> str:
            dtype = expression.to
            if not dtype.is_type(*self.NON_NULLABLE_TYPES, check_nullable=True):
                # Casting x into Nullable(T) appears to behave similarly to TRY_CAST(x AS T)
                dtype.set("nullable", True)

            return super().cast_sql(expression)

        def _jsonpathsubscript_sql(self, expression: exp.JSONPathSubscript) -> str:
            this = self.json_path_part(expression.this)
            return str(int(this) + 1) if is_int(this) else this

        def likeproperty_sql(self, expression: exp.LikeProperty) -> str:
            return f"AS {self.sql(expression, 'this')}"

        def _any_to_has(
            self,
            expression: exp.EQ | exp.NEQ,
            default: t.Callable[[t.Any], str],
            prefix: str = "",
        ) -> str:
            if isinstance(expression.left, exp.Any):
                arr = expression.left
                this = expression.right
            elif isinstance(expression.right, exp.Any):
                arr = expression.right
                this = expression.left
            else:
                return default(expression)

            return prefix + self.func("has", arr.this.unnest(), this)

        def eq_sql(self, expression: exp.EQ) -> str:
            return self._any_to_has(expression, super().eq_sql)

        def neq_sql(self, expression: exp.NEQ) -> str:
            return self._any_to_has(expression, super().neq_sql, "NOT ")

        def regexpilike_sql(self, expression: exp.RegexpILike) -> str:
            # Manually add a flag to make the search case-insensitive
            regex = self.func("CONCAT", "'(?i)'", expression.expression)
            return self.func("match", expression.this, regex)

        def datatype_sql(self, expression: exp.DataType) -> str:
            # String is the standard ClickHouse type, every other variant is just an alias.
            # Additionally, any supplied length parameter will be ignored.
            #
            # https://clickhouse.com/docs/en/sql-reference/data-types/string
            if expression.this in self.STRING_TYPE_MAPPING:
                dtype = "String"
            else:
                dtype = super().datatype_sql(expression)

            # This section changes the type to `Nullable(...)` if the following conditions hold:
            # - It's marked as nullable - this ensures we won't wrap ClickHouse types with `Nullable`
            #   and change their semantics
            # - It's not the key type of a `Map`. This is because ClickHouse enforces the following
            #   constraint: "Type of Map key must be a type, that can be represented by integer or
            #   String or FixedString (possibly LowCardinality) or UUID or IPv6"
            # - It's not a composite type, e.g. `Nullable(Array(...))` is not a valid type
            parent = expression.parent
            nullable = expression.args.get("nullable")
            if nullable is True or (
                nullable is None
                and not (
                    isinstance(parent, exp.DataType)
                    and parent.is_type(exp.DataType.Type.MAP, check_nullable=True)
                    and expression.index in (None, 0)
                )
                and not expression.is_type(*self.NON_NULLABLE_TYPES, check_nullable=True)
            ):
                dtype = f"Nullable({dtype})"

            return dtype

        def cte_sql(self, expression: exp.CTE) -> str:
            if expression.args.get("scalar"):
                this = self.sql(expression, "this")
                alias = self.sql(expression, "alias")
                return f"{this} AS {alias}"

            return super().cte_sql(expression)

        def after_limit_modifiers(self, expression: exp.Expression) -> t.List[str]:
            return super().after_limit_modifiers(expression) + [
                (
                    self.seg("SETTINGS ") + self.expressions(expression, key="settings", flat=True)
                    if expression.args.get("settings")
                    else ""
                ),
                (
                    self.seg("FORMAT ") + self.sql(expression, "format")
                    if expression.args.get("format")
                    else ""
                ),
            ]

        def parameterizedagg_sql(self, expression: exp.ParameterizedAgg) -> str:
            params = self.expressions(expression, key="params", flat=True)
            return self.func(expression.name, *expression.expressions) + f"({params})"

        def anonymousaggfunc_sql(self, expression: exp.AnonymousAggFunc) -> str:
            return self.func(expression.name, *expression.expressions)

        def combinedaggfunc_sql(self, expression: exp.CombinedAggFunc) -> str:
            return self.anonymousaggfunc_sql(expression)

        def combinedparameterizedagg_sql(self, expression: exp.CombinedParameterizedAgg) -> str:
            return self.parameterizedagg_sql(expression)

        def placeholder_sql(self, expression: exp.Placeholder) -> str:
            return f"{{{expression.name}: {self.sql(expression, 'kind')}}}"

        def oncluster_sql(self, expression: exp.OnCluster) -> str:
            return f"ON CLUSTER {self.sql(expression, 'this')}"

        def createable_sql(self, expression: exp.Create, locations: t.DefaultDict) -> str:
            if expression.kind in self.ON_CLUSTER_TARGETS and locations.get(
                exp.Properties.Location.POST_NAME
            ):
                this_name = self.sql(
                    expression.this if isinstance(expression.this, exp.Schema) else expression,
                    "this",
                )
                this_properties = " ".join(
                    [self.sql(prop) for prop in locations[exp.Properties.Location.POST_NAME]]
                )
                this_schema = self.schema_columns_sql(expression.this)
                this_schema = f"{self.sep()}{this_schema}" if this_schema else ""

                return f"{this_name}{self.sep()}{this_properties}{this_schema}"

            return super().createable_sql(expression, locations)

        def create_sql(self, expression: exp.Create) -> str:
            # The comment property comes last in CTAS statements, i.e. after the query
            query = expression.expression
            if isinstance(query, exp.Query):
                comment_prop = expression.find(exp.SchemaCommentProperty)
                if comment_prop:
                    comment_prop.pop()
                    query.replace(exp.paren(query))
            else:
                comment_prop = None

            create_sql = super().create_sql(expression)

            comment_sql = self.sql(comment_prop)
            comment_sql = f" {comment_sql}" if comment_sql else ""

            return f"{create_sql}{comment_sql}"

        def prewhere_sql(self, expression: exp.PreWhere) -> str:
            this = self.indent(self.sql(expression, "this"))
            return f"{self.seg('PREWHERE')}{self.sep()}{this}"

        def indexcolumnconstraint_sql(self, expression: exp.IndexColumnConstraint) -> str:
            this = self.sql(expression, "this")
            this = f" {this}" if this else ""
            expr = self.sql(expression, "expression")
            expr = f" {expr}" if expr else ""
            index_type = self.sql(expression, "index_type")
            index_type = f" TYPE {index_type}" if index_type else ""
            granularity = self.sql(expression, "granularity")
            granularity = f" GRANULARITY {granularity}" if granularity else ""

            return f"INDEX{this}{expr}{index_type}{granularity}"

        def partition_sql(self, expression: exp.Partition) -> str:
            return f"PARTITION {self.expressions(expression, flat=True)}"

        def partitionid_sql(self, expression: exp.PartitionId) -> str:
            return f"ID {self.sql(expression.this)}"

        def replacepartition_sql(self, expression: exp.ReplacePartition) -> str:
            return (
                f"REPLACE {self.sql(expression.expression)} FROM {self.sql(expression, 'source')}"
            )

        def projectiondef_sql(self, expression: exp.ProjectionDef) -> str:
            return f"PROJECTION {self.sql(expression.this)} {self.wrap(expression.expression)}"

        def is_sql(self, expression: exp.Is) -> str:
            is_sql = super().is_sql(expression)

            if isinstance(expression.parent, exp.Not):
                # value IS NOT NULL -> NOT (value IS NULL)
                is_sql = self.wrap(is_sql)

            return is_sql
