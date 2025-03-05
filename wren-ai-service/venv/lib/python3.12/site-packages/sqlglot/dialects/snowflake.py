from __future__ import annotations

import typing as t

from sqlglot import exp, generator, parser, tokens, transforms
from sqlglot.dialects.dialect import (
    Dialect,
    NormalizationStrategy,
    binary_from_function,
    build_default_decimal_type,
    build_timestamp_from_parts,
    date_delta_sql,
    date_trunc_to_time,
    datestrtodate_sql,
    build_formatted_time,
    if_sql,
    inline_array_sql,
    max_or_greatest,
    min_or_least,
    rename_func,
    timestamptrunc_sql,
    timestrtotime_sql,
    var_map_sql,
    map_date_part,
    no_safe_divide_sql,
    no_timestamp_sql,
    timestampdiff_sql,
    no_make_interval_sql,
)
from sqlglot.generator import unsupported_args
from sqlglot.helper import flatten, is_float, is_int, seq_get
from sqlglot.tokens import TokenType

if t.TYPE_CHECKING:
    from sqlglot._typing import E


# from https://docs.snowflake.com/en/sql-reference/functions/to_timestamp.html
def _build_datetime(
    name: str, kind: exp.DataType.Type, safe: bool = False
) -> t.Callable[[t.List], exp.Func]:
    def _builder(args: t.List) -> exp.Func:
        value = seq_get(args, 0)
        scale_or_fmt = seq_get(args, 1)

        int_value = value is not None and is_int(value.name)
        int_scale_or_fmt = scale_or_fmt is not None and scale_or_fmt.is_int

        if isinstance(value, exp.Literal) or (value and scale_or_fmt):
            # Converts calls like `TO_TIME('01:02:03')` into casts
            if len(args) == 1 and value.is_string and not int_value:
                return (
                    exp.TryCast(this=value, to=exp.DataType.build(kind))
                    if safe
                    else exp.cast(value, kind)
                )

            # Handles `TO_TIMESTAMP(str, fmt)` and `TO_TIMESTAMP(num, scale)` as special
            # cases so we can transpile them, since they're relatively common
            if kind == exp.DataType.Type.TIMESTAMP:
                if not safe and (int_value or int_scale_or_fmt):
                    # TRY_TO_TIMESTAMP('integer') is not parsed into exp.UnixToTime as
                    # it's not easily transpilable
                    return exp.UnixToTime(this=value, scale=scale_or_fmt)
                if not int_scale_or_fmt and not is_float(value.name):
                    expr = build_formatted_time(exp.StrToTime, "snowflake")(args)
                    expr.set("safe", safe)
                    return expr

        if kind == exp.DataType.Type.DATE and not int_value:
            formatted_exp = build_formatted_time(exp.TsOrDsToDate, "snowflake")(args)
            formatted_exp.set("safe", safe)
            return formatted_exp

        return exp.Anonymous(this=name, expressions=args)

    return _builder


def _build_object_construct(args: t.List) -> t.Union[exp.StarMap, exp.Struct]:
    expression = parser.build_var_map(args)

    if isinstance(expression, exp.StarMap):
        return expression

    return exp.Struct(
        expressions=[
            exp.PropertyEQ(this=k, expression=v) for k, v in zip(expression.keys, expression.values)
        ]
    )


def _build_datediff(args: t.List) -> exp.DateDiff:
    return exp.DateDiff(
        this=seq_get(args, 2), expression=seq_get(args, 1), unit=map_date_part(seq_get(args, 0))
    )


def _build_date_time_add(expr_type: t.Type[E]) -> t.Callable[[t.List], E]:
    def _builder(args: t.List) -> E:
        return expr_type(
            this=seq_get(args, 2),
            expression=seq_get(args, 1),
            unit=map_date_part(seq_get(args, 0)),
        )

    return _builder


# https://docs.snowflake.com/en/sql-reference/functions/div0
def _build_if_from_div0(args: t.List) -> exp.If:
    lhs = exp._wrap(seq_get(args, 0), exp.Binary)
    rhs = exp._wrap(seq_get(args, 1), exp.Binary)

    cond = exp.EQ(this=rhs, expression=exp.Literal.number(0)).and_(
        exp.Is(this=lhs, expression=exp.null()).not_()
    )
    true = exp.Literal.number(0)
    false = exp.Div(this=lhs, expression=rhs)
    return exp.If(this=cond, true=true, false=false)


# https://docs.snowflake.com/en/sql-reference/functions/zeroifnull
def _build_if_from_zeroifnull(args: t.List) -> exp.If:
    cond = exp.Is(this=seq_get(args, 0), expression=exp.Null())
    return exp.If(this=cond, true=exp.Literal.number(0), false=seq_get(args, 0))


# https://docs.snowflake.com/en/sql-reference/functions/zeroifnull
def _build_if_from_nullifzero(args: t.List) -> exp.If:
    cond = exp.EQ(this=seq_get(args, 0), expression=exp.Literal.number(0))
    return exp.If(this=cond, true=exp.Null(), false=seq_get(args, 0))


def _regexpilike_sql(self: Snowflake.Generator, expression: exp.RegexpILike) -> str:
    flag = expression.text("flag")

    if "i" not in flag:
        flag += "i"

    return self.func(
        "REGEXP_LIKE", expression.this, expression.expression, exp.Literal.string(flag)
    )


def _build_regexp_replace(args: t.List) -> exp.RegexpReplace:
    regexp_replace = exp.RegexpReplace.from_arg_list(args)

    if not regexp_replace.args.get("replacement"):
        regexp_replace.set("replacement", exp.Literal.string(""))

    return regexp_replace


def _show_parser(*args: t.Any, **kwargs: t.Any) -> t.Callable[[Snowflake.Parser], exp.Show]:
    def _parse(self: Snowflake.Parser) -> exp.Show:
        return self._parse_show_snowflake(*args, **kwargs)

    return _parse


def _date_trunc_to_time(args: t.List) -> exp.DateTrunc | exp.TimestampTrunc:
    trunc = date_trunc_to_time(args)
    trunc.set("unit", map_date_part(trunc.args["unit"]))
    return trunc


def _unqualify_unpivot_columns(expression: exp.Expression) -> exp.Expression:
    """
    Snowflake doesn't allow columns referenced in UNPIVOT to be qualified,
    so we need to unqualify them.

    Example:
        >>> from sqlglot import parse_one
        >>> expr = parse_one("SELECT * FROM m_sales UNPIVOT(sales FOR month IN (m_sales.jan, feb, mar, april))")
        >>> print(_unqualify_unpivot_columns(expr).sql(dialect="snowflake"))
        SELECT * FROM m_sales UNPIVOT(sales FOR month IN (jan, feb, mar, april))
    """
    if isinstance(expression, exp.Pivot) and expression.unpivot:
        expression = transforms.unqualify_columns(expression)

    return expression


def _flatten_structured_types_unless_iceberg(expression: exp.Expression) -> exp.Expression:
    assert isinstance(expression, exp.Create)

    def _flatten_structured_type(expression: exp.DataType) -> exp.DataType:
        if expression.this in exp.DataType.NESTED_TYPES:
            expression.set("expressions", None)
        return expression

    props = expression.args.get("properties")
    if isinstance(expression.this, exp.Schema) and not (props and props.find(exp.IcebergProperty)):
        for schema_expression in expression.this.expressions:
            if isinstance(schema_expression, exp.ColumnDef):
                column_type = schema_expression.kind
                if isinstance(column_type, exp.DataType):
                    column_type.transform(_flatten_structured_type, copy=False)

    return expression


def _unnest_generate_date_array(unnest: exp.Unnest) -> None:
    generate_date_array = unnest.expressions[0]
    start = generate_date_array.args.get("start")
    end = generate_date_array.args.get("end")
    step = generate_date_array.args.get("step")

    if not start or not end or not isinstance(step, exp.Interval) or step.name != "1":
        return

    unit = step.args.get("unit")

    unnest_alias = unnest.args.get("alias")
    if unnest_alias:
        unnest_alias = unnest_alias.copy()
        sequence_value_name = seq_get(unnest_alias.columns, 0) or "value"
    else:
        sequence_value_name = "value"

    # We'll add the next sequence value to the starting date and project the result
    date_add = _build_date_time_add(exp.DateAdd)(
        [unit, exp.cast(sequence_value_name, "int"), exp.cast(start, "date")]
    ).as_(sequence_value_name)

    # We use DATEDIFF to compute the number of sequence values needed
    number_sequence = Snowflake.Parser.FUNCTIONS["ARRAY_GENERATE_RANGE"](
        [exp.Literal.number(0), _build_datediff([unit, start, end]) + 1]
    )

    unnest.set("expressions", [number_sequence])
    unnest.replace(exp.select(date_add).from_(unnest.copy()).subquery(unnest_alias))


def _transform_generate_date_array(expression: exp.Expression) -> exp.Expression:
    if isinstance(expression, exp.Select):
        for generate_date_array in expression.find_all(exp.GenerateDateArray):
            parent = generate_date_array.parent

            # If GENERATE_DATE_ARRAY is used directly as an array (e.g passed into ARRAY_LENGTH), the transformed Snowflake
            # query is the following (it'll be unnested properly on the next iteration due to copy):
            # SELECT ref(GENERATE_DATE_ARRAY(...)) -> SELECT ref((SELECT ARRAY_AGG(*) FROM UNNEST(GENERATE_DATE_ARRAY(...))))
            if not isinstance(parent, exp.Unnest):
                unnest = exp.Unnest(expressions=[generate_date_array.copy()])
                generate_date_array.replace(
                    exp.select(exp.ArrayAgg(this=exp.Star())).from_(unnest).subquery()
                )

            if (
                isinstance(parent, exp.Unnest)
                and isinstance(parent.parent, (exp.From, exp.Join))
                and len(parent.expressions) == 1
            ):
                _unnest_generate_date_array(parent)

    return expression


def _build_regexp_extract(expr_type: t.Type[E]) -> t.Callable[[t.List], E]:
    def _builder(args: t.List) -> E:
        return expr_type(
            this=seq_get(args, 0),
            expression=seq_get(args, 1),
            position=seq_get(args, 2),
            occurrence=seq_get(args, 3),
            parameters=seq_get(args, 4),
            group=seq_get(args, 5) or exp.Literal.number(0),
        )

    return _builder


def _regexpextract_sql(self, expression: exp.RegexpExtract | exp.RegexpExtractAll) -> str:
    # Other dialects don't support all of the following parameters, so we need to
    # generate default values as necessary to ensure the transpilation is correct
    group = expression.args.get("group")

    # To avoid generating all these default values, we set group to None if
    # it's 0 (also default value) which doesn't trigger the following chain
    if group and group.name == "0":
        group = None

    parameters = expression.args.get("parameters") or (group and exp.Literal.string("c"))
    occurrence = expression.args.get("occurrence") or (parameters and exp.Literal.number(1))
    position = expression.args.get("position") or (occurrence and exp.Literal.number(1))

    return self.func(
        "REGEXP_SUBSTR" if isinstance(expression, exp.RegexpExtract) else "REGEXP_EXTRACT_ALL",
        expression.this,
        expression.expression,
        position,
        occurrence,
        parameters,
        group,
    )


def _json_extract_value_array_sql(
    self: Snowflake.Generator, expression: exp.JSONValueArray | exp.JSONExtractArray
) -> str:
    json_extract = exp.JSONExtract(this=expression.this, expression=expression.expression)
    ident = exp.to_identifier("x")

    if isinstance(expression, exp.JSONValueArray):
        this: exp.Expression = exp.cast(ident, to=exp.DataType.Type.VARCHAR)
    else:
        this = exp.ParseJSON(this=f"TO_JSON({ident})")

    transform_lambda = exp.Lambda(expressions=[ident], this=this)

    return self.func("TRANSFORM", json_extract, transform_lambda)


class Snowflake(Dialect):
    # https://docs.snowflake.com/en/sql-reference/identifiers-syntax
    NORMALIZATION_STRATEGY = NormalizationStrategy.UPPERCASE
    NULL_ORDERING = "nulls_are_large"
    TIME_FORMAT = "'YYYY-MM-DD HH24:MI:SS'"
    SUPPORTS_USER_DEFINED_TYPES = False
    SUPPORTS_SEMI_ANTI_JOIN = False
    PREFER_CTE_ALIAS_COLUMN = True
    TABLESAMPLE_SIZE_IS_PERCENT = True
    COPY_PARAMS_ARE_CSV = False
    ARRAY_AGG_INCLUDES_NULLS = None

    TIME_MAPPING = {
        "YYYY": "%Y",
        "yyyy": "%Y",
        "YY": "%y",
        "yy": "%y",
        "MMMM": "%B",
        "mmmm": "%B",
        "MON": "%b",
        "mon": "%b",
        "MM": "%m",
        "mm": "%m",
        "DD": "%d",
        "dd": "%-d",
        "DY": "%a",
        "dy": "%w",
        "HH24": "%H",
        "hh24": "%H",
        "HH12": "%I",
        "hh12": "%I",
        "MI": "%M",
        "mi": "%M",
        "SS": "%S",
        "ss": "%S",
        "FF": "%f",
        "ff": "%f",
        "FF6": "%f",
        "ff6": "%f",
    }

    def quote_identifier(self, expression: E, identify: bool = True) -> E:
        # This disables quoting DUAL in SELECT ... FROM DUAL, because Snowflake treats an
        # unquoted DUAL keyword in a special way and does not map it to a user-defined table
        if (
            isinstance(expression, exp.Identifier)
            and isinstance(expression.parent, exp.Table)
            and expression.name.lower() == "dual"
        ):
            return expression  # type: ignore

        return super().quote_identifier(expression, identify=identify)

    class Parser(parser.Parser):
        IDENTIFY_PIVOT_STRINGS = True
        DEFAULT_SAMPLING_METHOD = "BERNOULLI"
        COLON_IS_VARIANT_EXTRACT = True

        ID_VAR_TOKENS = {
            *parser.Parser.ID_VAR_TOKENS,
            TokenType.MATCH_CONDITION,
        }

        TABLE_ALIAS_TOKENS = parser.Parser.TABLE_ALIAS_TOKENS | {TokenType.WINDOW}
        TABLE_ALIAS_TOKENS.discard(TokenType.MATCH_CONDITION)

        FUNCTIONS = {
            **parser.Parser.FUNCTIONS,
            "APPROX_PERCENTILE": exp.ApproxQuantile.from_arg_list,
            "ARRAY_CONSTRUCT": lambda args: exp.Array(expressions=args),
            "ARRAY_CONTAINS": lambda args: exp.ArrayContains(
                this=seq_get(args, 1), expression=seq_get(args, 0)
            ),
            "ARRAY_GENERATE_RANGE": lambda args: exp.GenerateSeries(
                # ARRAY_GENERATE_RANGE has an exlusive end; we normalize it to be inclusive
                start=seq_get(args, 0),
                end=exp.Sub(this=seq_get(args, 1), expression=exp.Literal.number(1)),
                step=seq_get(args, 2),
            ),
            "BITXOR": binary_from_function(exp.BitwiseXor),
            "BIT_XOR": binary_from_function(exp.BitwiseXor),
            "BOOLXOR": binary_from_function(exp.Xor),
            "DATE": _build_datetime("DATE", exp.DataType.Type.DATE),
            "DATE_TRUNC": _date_trunc_to_time,
            "DATEADD": _build_date_time_add(exp.DateAdd),
            "DATEDIFF": _build_datediff,
            "DIV0": _build_if_from_div0,
            "EDITDISTANCE": lambda args: exp.Levenshtein(
                this=seq_get(args, 0), expression=seq_get(args, 1), max_dist=seq_get(args, 2)
            ),
            "FLATTEN": exp.Explode.from_arg_list,
            "GET_PATH": lambda args, dialect: exp.JSONExtract(
                this=seq_get(args, 0), expression=dialect.to_json_path(seq_get(args, 1))
            ),
            "IFF": exp.If.from_arg_list,
            "LAST_DAY": lambda args: exp.LastDay(
                this=seq_get(args, 0), unit=map_date_part(seq_get(args, 1))
            ),
            "LEN": lambda args: exp.Length(this=seq_get(args, 0), binary=True),
            "LENGTH": lambda args: exp.Length(this=seq_get(args, 0), binary=True),
            "LISTAGG": exp.GroupConcat.from_arg_list,
            "NULLIFZERO": _build_if_from_nullifzero,
            "OBJECT_CONSTRUCT": _build_object_construct,
            "REGEXP_EXTRACT_ALL": _build_regexp_extract(exp.RegexpExtractAll),
            "REGEXP_REPLACE": _build_regexp_replace,
            "REGEXP_SUBSTR": _build_regexp_extract(exp.RegexpExtract),
            "REGEXP_SUBSTR_ALL": _build_regexp_extract(exp.RegexpExtractAll),
            "RLIKE": exp.RegexpLike.from_arg_list,
            "SQUARE": lambda args: exp.Pow(this=seq_get(args, 0), expression=exp.Literal.number(2)),
            "TIMEADD": _build_date_time_add(exp.TimeAdd),
            "TIMEDIFF": _build_datediff,
            "TIMESTAMPADD": _build_date_time_add(exp.DateAdd),
            "TIMESTAMPDIFF": _build_datediff,
            "TIMESTAMPFROMPARTS": build_timestamp_from_parts,
            "TIMESTAMP_FROM_PARTS": build_timestamp_from_parts,
            "TIMESTAMPNTZFROMPARTS": build_timestamp_from_parts,
            "TIMESTAMP_NTZ_FROM_PARTS": build_timestamp_from_parts,
            "TRY_PARSE_JSON": lambda args: exp.ParseJSON(this=seq_get(args, 0), safe=True),
            "TRY_TO_DATE": _build_datetime("TRY_TO_DATE", exp.DataType.Type.DATE, safe=True),
            "TRY_TO_TIMESTAMP": _build_datetime(
                "TRY_TO_TIMESTAMP", exp.DataType.Type.TIMESTAMP, safe=True
            ),
            "TO_DATE": _build_datetime("TO_DATE", exp.DataType.Type.DATE),
            "TO_NUMBER": lambda args: exp.ToNumber(
                this=seq_get(args, 0),
                format=seq_get(args, 1),
                precision=seq_get(args, 2),
                scale=seq_get(args, 3),
            ),
            "TO_TIME": _build_datetime("TO_TIME", exp.DataType.Type.TIME),
            "TO_TIMESTAMP": _build_datetime("TO_TIMESTAMP", exp.DataType.Type.TIMESTAMP),
            "TO_TIMESTAMP_LTZ": _build_datetime("TO_TIMESTAMP_LTZ", exp.DataType.Type.TIMESTAMPLTZ),
            "TO_TIMESTAMP_NTZ": _build_datetime("TO_TIMESTAMP_NTZ", exp.DataType.Type.TIMESTAMP),
            "TO_TIMESTAMP_TZ": _build_datetime("TO_TIMESTAMP_TZ", exp.DataType.Type.TIMESTAMPTZ),
            "TO_VARCHAR": exp.ToChar.from_arg_list,
            "ZEROIFNULL": _build_if_from_zeroifnull,
        }

        FUNCTION_PARSERS = {
            **parser.Parser.FUNCTION_PARSERS,
            "DATE_PART": lambda self: self._parse_date_part(),
            "OBJECT_CONSTRUCT_KEEP_NULL": lambda self: self._parse_json_object(),
        }
        FUNCTION_PARSERS.pop("TRIM")

        TIMESTAMPS = parser.Parser.TIMESTAMPS - {TokenType.TIME}

        RANGE_PARSERS = {
            **parser.Parser.RANGE_PARSERS,
            TokenType.LIKE_ANY: parser.binary_range_parser(exp.LikeAny),
            TokenType.ILIKE_ANY: parser.binary_range_parser(exp.ILikeAny),
        }

        ALTER_PARSERS = {
            **parser.Parser.ALTER_PARSERS,
            "UNSET": lambda self: self.expression(
                exp.Set,
                tag=self._match_text_seq("TAG"),
                expressions=self._parse_csv(self._parse_id_var),
                unset=True,
            ),
        }

        STATEMENT_PARSERS = {
            **parser.Parser.STATEMENT_PARSERS,
            TokenType.SHOW: lambda self: self._parse_show(),
        }

        PROPERTY_PARSERS = {
            **parser.Parser.PROPERTY_PARSERS,
            "LOCATION": lambda self: self._parse_location_property(),
            "TAG": lambda self: self._parse_tag(),
        }

        TYPE_CONVERTERS = {
            # https://docs.snowflake.com/en/sql-reference/data-types-numeric#number
            exp.DataType.Type.DECIMAL: build_default_decimal_type(precision=38, scale=0),
        }

        SHOW_PARSERS = {
            "SCHEMAS": _show_parser("SCHEMAS"),
            "TERSE SCHEMAS": _show_parser("SCHEMAS"),
            "OBJECTS": _show_parser("OBJECTS"),
            "TERSE OBJECTS": _show_parser("OBJECTS"),
            "TABLES": _show_parser("TABLES"),
            "TERSE TABLES": _show_parser("TABLES"),
            "VIEWS": _show_parser("VIEWS"),
            "TERSE VIEWS": _show_parser("VIEWS"),
            "PRIMARY KEYS": _show_parser("PRIMARY KEYS"),
            "TERSE PRIMARY KEYS": _show_parser("PRIMARY KEYS"),
            "IMPORTED KEYS": _show_parser("IMPORTED KEYS"),
            "TERSE IMPORTED KEYS": _show_parser("IMPORTED KEYS"),
            "UNIQUE KEYS": _show_parser("UNIQUE KEYS"),
            "TERSE UNIQUE KEYS": _show_parser("UNIQUE KEYS"),
            "SEQUENCES": _show_parser("SEQUENCES"),
            "TERSE SEQUENCES": _show_parser("SEQUENCES"),
            "COLUMNS": _show_parser("COLUMNS"),
            "USERS": _show_parser("USERS"),
            "TERSE USERS": _show_parser("USERS"),
        }

        CONSTRAINT_PARSERS = {
            **parser.Parser.CONSTRAINT_PARSERS,
            "WITH": lambda self: self._parse_with_constraint(),
            "MASKING": lambda self: self._parse_with_constraint(),
            "PROJECTION": lambda self: self._parse_with_constraint(),
            "TAG": lambda self: self._parse_with_constraint(),
        }

        STAGED_FILE_SINGLE_TOKENS = {
            TokenType.DOT,
            TokenType.MOD,
            TokenType.SLASH,
        }

        FLATTEN_COLUMNS = ["SEQ", "KEY", "PATH", "INDEX", "VALUE", "THIS"]

        SCHEMA_KINDS = {"OBJECTS", "TABLES", "VIEWS", "SEQUENCES", "UNIQUE KEYS", "IMPORTED KEYS"}

        NON_TABLE_CREATABLES = {"STORAGE INTEGRATION", "TAG", "WAREHOUSE", "STREAMLIT"}

        LAMBDAS = {
            **parser.Parser.LAMBDAS,
            TokenType.ARROW: lambda self, expressions: self.expression(
                exp.Lambda,
                this=self._replace_lambda(
                    self._parse_assignment(),
                    expressions,
                ),
                expressions=[e.this if isinstance(e, exp.Cast) else e for e in expressions],
            ),
        }

        def _negate_range(
            self, this: t.Optional[exp.Expression] = None
        ) -> t.Optional[exp.Expression]:
            if not this:
                return this

            query = this.args.get("query")
            if isinstance(this, exp.In) and isinstance(query, exp.Query):
                # Snowflake treats `value NOT IN (subquery)` as `VALUE <> ALL (subquery)`, so
                # we do this conversion here to avoid parsing it into `NOT value IN (subquery)`
                # which can produce different results (most likely a SnowFlake bug).
                #
                # https://docs.snowflake.com/en/sql-reference/functions/in
                # Context: https://github.com/tobymao/sqlglot/issues/3890
                return self.expression(
                    exp.NEQ, this=this.this, expression=exp.All(this=query.unnest())
                )

            return self.expression(exp.Not, this=this)

        def _parse_tag(self) -> exp.Tags:
            return self.expression(
                exp.Tags,
                expressions=self._parse_wrapped_csv(self._parse_property),
            )

        def _parse_with_constraint(self) -> t.Optional[exp.Expression]:
            if self._prev.token_type != TokenType.WITH:
                self._retreat(self._index - 1)

            if self._match_text_seq("MASKING", "POLICY"):
                policy = self._parse_column()
                return self.expression(
                    exp.MaskingPolicyColumnConstraint,
                    this=policy.to_dot() if isinstance(policy, exp.Column) else policy,
                    expressions=self._match(TokenType.USING)
                    and self._parse_wrapped_csv(self._parse_id_var),
                )
            if self._match_text_seq("PROJECTION", "POLICY"):
                policy = self._parse_column()
                return self.expression(
                    exp.ProjectionPolicyColumnConstraint,
                    this=policy.to_dot() if isinstance(policy, exp.Column) else policy,
                )
            if self._match(TokenType.TAG):
                return self._parse_tag()

            return None

        def _parse_with_property(self) -> t.Optional[exp.Expression] | t.List[exp.Expression]:
            if self._match(TokenType.TAG):
                return self._parse_tag()

            return super()._parse_with_property()

        def _parse_create(self) -> exp.Create | exp.Command:
            expression = super()._parse_create()
            if isinstance(expression, exp.Create) and expression.kind in self.NON_TABLE_CREATABLES:
                # Replace the Table node with the enclosed Identifier
                expression.this.replace(expression.this.this)

            return expression

        # https://docs.snowflake.com/en/sql-reference/functions/date_part.html
        # https://docs.snowflake.com/en/sql-reference/functions-date-time.html#label-supported-date-time-parts
        def _parse_date_part(self: Snowflake.Parser) -> t.Optional[exp.Expression]:
            this = self._parse_var() or self._parse_type()

            if not this:
                return None

            self._match(TokenType.COMMA)
            expression = self._parse_bitwise()
            this = map_date_part(this)
            name = this.name.upper()

            if name.startswith("EPOCH"):
                if name == "EPOCH_MILLISECOND":
                    scale = 10**3
                elif name == "EPOCH_MICROSECOND":
                    scale = 10**6
                elif name == "EPOCH_NANOSECOND":
                    scale = 10**9
                else:
                    scale = None

                ts = self.expression(exp.Cast, this=expression, to=exp.DataType.build("TIMESTAMP"))
                to_unix: exp.Expression = self.expression(exp.TimeToUnix, this=ts)

                if scale:
                    to_unix = exp.Mul(this=to_unix, expression=exp.Literal.number(scale))

                return to_unix

            return self.expression(exp.Extract, this=this, expression=expression)

        def _parse_bracket_key_value(self, is_map: bool = False) -> t.Optional[exp.Expression]:
            if is_map:
                # Keys are strings in Snowflake's objects, see also:
                # - https://docs.snowflake.com/en/sql-reference/data-types-semistructured
                # - https://docs.snowflake.com/en/sql-reference/functions/object_construct
                return self._parse_slice(self._parse_string())

            return self._parse_slice(self._parse_alias(self._parse_assignment(), explicit=True))

        def _parse_lateral(self) -> t.Optional[exp.Lateral]:
            lateral = super()._parse_lateral()
            if not lateral:
                return lateral

            if isinstance(lateral.this, exp.Explode):
                table_alias = lateral.args.get("alias")
                columns = [exp.to_identifier(col) for col in self.FLATTEN_COLUMNS]
                if table_alias and not table_alias.args.get("columns"):
                    table_alias.set("columns", columns)
                elif not table_alias:
                    exp.alias_(lateral, "_flattened", table=columns, copy=False)

            return lateral

        def _parse_table_parts(
            self, schema: bool = False, is_db_reference: bool = False, wildcard: bool = False
        ) -> exp.Table:
            # https://docs.snowflake.com/en/user-guide/querying-stage
            if self._match(TokenType.STRING, advance=False):
                table = self._parse_string()
            elif self._match_text_seq("@", advance=False):
                table = self._parse_location_path()
            else:
                table = None

            if table:
                file_format = None
                pattern = None

                wrapped = self._match(TokenType.L_PAREN)
                while self._curr and wrapped and not self._match(TokenType.R_PAREN):
                    if self._match_text_seq("FILE_FORMAT", "=>"):
                        file_format = self._parse_string() or super()._parse_table_parts(
                            is_db_reference=is_db_reference
                        )
                    elif self._match_text_seq("PATTERN", "=>"):
                        pattern = self._parse_string()
                    else:
                        break

                    self._match(TokenType.COMMA)

                table = self.expression(exp.Table, this=table, format=file_format, pattern=pattern)
            else:
                table = super()._parse_table_parts(schema=schema, is_db_reference=is_db_reference)

            return table

        def _parse_id_var(
            self,
            any_token: bool = True,
            tokens: t.Optional[t.Collection[TokenType]] = None,
        ) -> t.Optional[exp.Expression]:
            if self._match_text_seq("IDENTIFIER", "("):
                identifier = (
                    super()._parse_id_var(any_token=any_token, tokens=tokens)
                    or self._parse_string()
                )
                self._match_r_paren()
                return self.expression(exp.Anonymous, this="IDENTIFIER", expressions=[identifier])

            return super()._parse_id_var(any_token=any_token, tokens=tokens)

        def _parse_show_snowflake(self, this: str) -> exp.Show:
            scope = None
            scope_kind = None

            # will identity SHOW TERSE SCHEMAS but not SHOW TERSE PRIMARY KEYS
            # which is syntactically valid but has no effect on the output
            terse = self._tokens[self._index - 2].text.upper() == "TERSE"

            history = self._match_text_seq("HISTORY")

            like = self._parse_string() if self._match(TokenType.LIKE) else None

            if self._match(TokenType.IN):
                if self._match_text_seq("ACCOUNT"):
                    scope_kind = "ACCOUNT"
                elif self._match_set(self.DB_CREATABLES):
                    scope_kind = self._prev.text.upper()
                    if self._curr:
                        scope = self._parse_table_parts()
                elif self._curr:
                    scope_kind = "SCHEMA" if this in self.SCHEMA_KINDS else "TABLE"
                    scope = self._parse_table_parts()

            return self.expression(
                exp.Show,
                **{
                    "terse": terse,
                    "this": this,
                    "history": history,
                    "like": like,
                    "scope": scope,
                    "scope_kind": scope_kind,
                    "starts_with": self._match_text_seq("STARTS", "WITH") and self._parse_string(),
                    "limit": self._parse_limit(),
                    "from": self._parse_string() if self._match(TokenType.FROM) else None,
                },
            )

        def _parse_location_property(self) -> exp.LocationProperty:
            self._match(TokenType.EQ)
            return self.expression(exp.LocationProperty, this=self._parse_location_path())

        def _parse_file_location(self) -> t.Optional[exp.Expression]:
            # Parse either a subquery or a staged file
            return (
                self._parse_select(table=True, parse_subquery_alias=False)
                if self._match(TokenType.L_PAREN, advance=False)
                else self._parse_table_parts()
            )

        def _parse_location_path(self) -> exp.Var:
            parts = [self._advance_any(ignore_reserved=True)]

            # We avoid consuming a comma token because external tables like @foo and @bar
            # can be joined in a query with a comma separator, as well as closing paren
            # in case of subqueries
            while self._is_connected() and not self._match_set(
                (TokenType.COMMA, TokenType.L_PAREN, TokenType.R_PAREN), advance=False
            ):
                parts.append(self._advance_any(ignore_reserved=True))

            return exp.var("".join(part.text for part in parts if part))

        def _parse_lambda_arg(self) -> t.Optional[exp.Expression]:
            this = super()._parse_lambda_arg()

            if not this:
                return this

            typ = self._parse_types()

            if typ:
                return self.expression(exp.Cast, this=this, to=typ)

            return this

    class Tokenizer(tokens.Tokenizer):
        STRING_ESCAPES = ["\\", "'"]
        HEX_STRINGS = [("x'", "'"), ("X'", "'")]
        RAW_STRINGS = ["$$"]
        COMMENTS = ["--", "//", ("/*", "*/")]
        NESTED_COMMENTS = False

        KEYWORDS = {
            **tokens.Tokenizer.KEYWORDS,
            "BYTEINT": TokenType.INT,
            "CHAR VARYING": TokenType.VARCHAR,
            "CHARACTER VARYING": TokenType.VARCHAR,
            "EXCLUDE": TokenType.EXCEPT,
            "ILIKE ANY": TokenType.ILIKE_ANY,
            "LIKE ANY": TokenType.LIKE_ANY,
            "MATCH_CONDITION": TokenType.MATCH_CONDITION,
            "MATCH_RECOGNIZE": TokenType.MATCH_RECOGNIZE,
            "MINUS": TokenType.EXCEPT,
            "NCHAR VARYING": TokenType.VARCHAR,
            "PUT": TokenType.COMMAND,
            "REMOVE": TokenType.COMMAND,
            "RM": TokenType.COMMAND,
            "SAMPLE": TokenType.TABLE_SAMPLE,
            "SQL_DOUBLE": TokenType.DOUBLE,
            "SQL_VARCHAR": TokenType.VARCHAR,
            "STORAGE INTEGRATION": TokenType.STORAGE_INTEGRATION,
            "TAG": TokenType.TAG,
            "TIMESTAMP_TZ": TokenType.TIMESTAMPTZ,
            "TOP": TokenType.TOP,
            "WAREHOUSE": TokenType.WAREHOUSE,
            "STREAMLIT": TokenType.STREAMLIT,
        }
        KEYWORDS.pop("/*+")

        SINGLE_TOKENS = {
            **tokens.Tokenizer.SINGLE_TOKENS,
            "$": TokenType.PARAMETER,
        }

        VAR_SINGLE_TOKENS = {"$"}

        COMMANDS = tokens.Tokenizer.COMMANDS - {TokenType.SHOW}

    class Generator(generator.Generator):
        PARAMETER_TOKEN = "$"
        MATCHED_BY_SOURCE = False
        SINGLE_STRING_INTERVAL = True
        JOIN_HINTS = False
        TABLE_HINTS = False
        QUERY_HINTS = False
        AGGREGATE_FILTER_SUPPORTED = False
        SUPPORTS_TABLE_COPY = False
        COLLATE_IS_FUNC = True
        LIMIT_ONLY_LITERALS = True
        JSON_KEY_VALUE_PAIR_SEP = ","
        INSERT_OVERWRITE = " OVERWRITE INTO"
        STRUCT_DELIMITER = ("(", ")")
        COPY_PARAMS_ARE_WRAPPED = False
        COPY_PARAMS_EQ_REQUIRED = True
        STAR_EXCEPT = "EXCLUDE"
        SUPPORTS_EXPLODING_PROJECTIONS = False
        ARRAY_CONCAT_IS_VAR_LEN = False
        SUPPORTS_CONVERT_TIMEZONE = True
        EXCEPT_INTERSECT_SUPPORT_ALL_CLAUSE = False
        SUPPORTS_MEDIAN = True
        ARRAY_SIZE_NAME = "ARRAY_SIZE"

        TRANSFORMS = {
            **generator.Generator.TRANSFORMS,
            exp.ApproxDistinct: rename_func("APPROX_COUNT_DISTINCT"),
            exp.ArgMax: rename_func("MAX_BY"),
            exp.ArgMin: rename_func("MIN_BY"),
            exp.Array: inline_array_sql,
            exp.ArrayConcat: lambda self, e: self.arrayconcat_sql(e, name="ARRAY_CAT"),
            exp.ArrayContains: lambda self, e: self.func("ARRAY_CONTAINS", e.expression, e.this),
            exp.AtTimeZone: lambda self, e: self.func(
                "CONVERT_TIMEZONE", e.args.get("zone"), e.this
            ),
            exp.BitwiseXor: rename_func("BITXOR"),
            exp.Create: transforms.preprocess([_flatten_structured_types_unless_iceberg]),
            exp.DateAdd: date_delta_sql("DATEADD"),
            exp.DateDiff: date_delta_sql("DATEDIFF"),
            exp.DatetimeAdd: date_delta_sql("TIMESTAMPADD"),
            exp.DatetimeDiff: timestampdiff_sql,
            exp.DateStrToDate: datestrtodate_sql,
            exp.DayOfMonth: rename_func("DAYOFMONTH"),
            exp.DayOfWeek: rename_func("DAYOFWEEK"),
            exp.DayOfYear: rename_func("DAYOFYEAR"),
            exp.Explode: rename_func("FLATTEN"),
            exp.Extract: rename_func("DATE_PART"),
            exp.FromTimeZone: lambda self, e: self.func(
                "CONVERT_TIMEZONE", e.args.get("zone"), "'UTC'", e.this
            ),
            exp.GenerateSeries: lambda self, e: self.func(
                "ARRAY_GENERATE_RANGE", e.args["start"], e.args["end"] + 1, e.args.get("step")
            ),
            exp.GroupConcat: rename_func("LISTAGG"),
            exp.If: if_sql(name="IFF", false_value="NULL"),
            exp.JSONExtractArray: _json_extract_value_array_sql,
            exp.JSONExtractScalar: lambda self, e: self.func(
                "JSON_EXTRACT_PATH_TEXT", e.this, e.expression
            ),
            exp.JSONObject: lambda self, e: self.func("OBJECT_CONSTRUCT_KEEP_NULL", *e.expressions),
            exp.JSONPathRoot: lambda *_: "",
            exp.JSONValueArray: _json_extract_value_array_sql,
            exp.LogicalAnd: rename_func("BOOLAND_AGG"),
            exp.LogicalOr: rename_func("BOOLOR_AGG"),
            exp.Map: lambda self, e: var_map_sql(self, e, "OBJECT_CONSTRUCT"),
            exp.MakeInterval: no_make_interval_sql,
            exp.Max: max_or_greatest,
            exp.Min: min_or_least,
            exp.ParseJSON: lambda self, e: self.func(
                "TRY_PARSE_JSON" if e.args.get("safe") else "PARSE_JSON", e.this
            ),
            exp.PartitionedByProperty: lambda self, e: f"PARTITION BY {self.sql(e, 'this')}",
            exp.PercentileCont: transforms.preprocess(
                [transforms.add_within_group_for_percentiles]
            ),
            exp.PercentileDisc: transforms.preprocess(
                [transforms.add_within_group_for_percentiles]
            ),
            exp.Pivot: transforms.preprocess([_unqualify_unpivot_columns]),
            exp.RegexpExtract: _regexpextract_sql,
            exp.RegexpExtractAll: _regexpextract_sql,
            exp.RegexpILike: _regexpilike_sql,
            exp.Rand: rename_func("RANDOM"),
            exp.Select: transforms.preprocess(
                [
                    transforms.eliminate_distinct_on,
                    transforms.explode_to_unnest(),
                    transforms.eliminate_semi_and_anti_joins,
                    _transform_generate_date_array,
                ]
            ),
            exp.SafeDivide: lambda self, e: no_safe_divide_sql(self, e, "IFF"),
            exp.SHA: rename_func("SHA1"),
            exp.StarMap: rename_func("OBJECT_CONSTRUCT"),
            exp.StartsWith: rename_func("STARTSWITH"),
            exp.StrPosition: lambda self, e: self.func(
                "POSITION", e.args.get("substr"), e.this, e.args.get("position")
            ),
            exp.StrToDate: lambda self, e: self.func("DATE", e.this, self.format_time(e)),
            exp.Stuff: rename_func("INSERT"),
            exp.TimeAdd: date_delta_sql("TIMEADD"),
            exp.Timestamp: no_timestamp_sql,
            exp.TimestampAdd: date_delta_sql("TIMESTAMPADD"),
            exp.TimestampDiff: lambda self, e: self.func(
                "TIMESTAMPDIFF", e.unit, e.expression, e.this
            ),
            exp.TimestampTrunc: timestamptrunc_sql(),
            exp.TimeStrToTime: timestrtotime_sql,
            exp.TimeToUnix: lambda self, e: f"EXTRACT(epoch_second FROM {self.sql(e, 'this')})",
            exp.ToArray: rename_func("TO_ARRAY"),
            exp.ToChar: lambda self, e: self.function_fallback_sql(e),
            exp.ToDouble: rename_func("TO_DOUBLE"),
            exp.TsOrDsAdd: date_delta_sql("DATEADD", cast=True),
            exp.TsOrDsDiff: date_delta_sql("DATEDIFF"),
            exp.TsOrDsToDate: lambda self, e: self.func(
                "TRY_TO_DATE" if e.args.get("safe") else "TO_DATE", e.this, self.format_time(e)
            ),
            exp.UnixToTime: rename_func("TO_TIMESTAMP"),
            exp.Uuid: rename_func("UUID_STRING"),
            exp.VarMap: lambda self, e: var_map_sql(self, e, "OBJECT_CONSTRUCT"),
            exp.WeekOfYear: rename_func("WEEKOFYEAR"),
            exp.Xor: rename_func("BOOLXOR"),
            exp.Levenshtein: unsupported_args("ins_cost", "del_cost", "sub_cost")(
                rename_func("EDITDISTANCE")
            ),
        }

        SUPPORTED_JSON_PATH_PARTS = {
            exp.JSONPathKey,
            exp.JSONPathRoot,
            exp.JSONPathSubscript,
        }

        TYPE_MAPPING = {
            **generator.Generator.TYPE_MAPPING,
            exp.DataType.Type.NESTED: "OBJECT",
            exp.DataType.Type.STRUCT: "OBJECT",
        }

        PROPERTIES_LOCATION = {
            **generator.Generator.PROPERTIES_LOCATION,
            exp.SetProperty: exp.Properties.Location.UNSUPPORTED,
            exp.VolatileProperty: exp.Properties.Location.UNSUPPORTED,
        }

        UNSUPPORTED_VALUES_EXPRESSIONS = {
            exp.Map,
            exp.StarMap,
            exp.Struct,
            exp.VarMap,
        }

        def with_properties(self, properties: exp.Properties) -> str:
            return self.properties(properties, wrapped=False, prefix=self.sep(""), sep=" ")

        def values_sql(self, expression: exp.Values, values_as_table: bool = True) -> str:
            if expression.find(*self.UNSUPPORTED_VALUES_EXPRESSIONS):
                values_as_table = False

            return super().values_sql(expression, values_as_table=values_as_table)

        def datatype_sql(self, expression: exp.DataType) -> str:
            expressions = expression.expressions
            if (
                expressions
                and expression.is_type(*exp.DataType.STRUCT_TYPES)
                and any(isinstance(field_type, exp.DataType) for field_type in expressions)
            ):
                # The correct syntax is OBJECT [ (<key> <value_type [NOT NULL] [, ...]) ]
                return "OBJECT"

            return super().datatype_sql(expression)

        def tonumber_sql(self, expression: exp.ToNumber) -> str:
            return self.func(
                "TO_NUMBER",
                expression.this,
                expression.args.get("format"),
                expression.args.get("precision"),
                expression.args.get("scale"),
            )

        def timestampfromparts_sql(self, expression: exp.TimestampFromParts) -> str:
            milli = expression.args.get("milli")
            if milli is not None:
                milli_to_nano = milli.pop() * exp.Literal.number(1000000)
                expression.set("nano", milli_to_nano)

            return rename_func("TIMESTAMP_FROM_PARTS")(self, expression)

        def cast_sql(self, expression: exp.Cast, safe_prefix: t.Optional[str] = None) -> str:
            if expression.is_type(exp.DataType.Type.GEOGRAPHY):
                return self.func("TO_GEOGRAPHY", expression.this)
            if expression.is_type(exp.DataType.Type.GEOMETRY):
                return self.func("TO_GEOMETRY", expression.this)

            return super().cast_sql(expression, safe_prefix=safe_prefix)

        def trycast_sql(self, expression: exp.TryCast) -> str:
            value = expression.this

            if value.type is None:
                from sqlglot.optimizer.annotate_types import annotate_types

                value = annotate_types(value)

            if value.is_type(*exp.DataType.TEXT_TYPES, exp.DataType.Type.UNKNOWN):
                return super().trycast_sql(expression)

            # TRY_CAST only works for string values in Snowflake
            return self.cast_sql(expression)

        def log_sql(self, expression: exp.Log) -> str:
            if not expression.expression:
                return self.func("LN", expression.this)

            return super().log_sql(expression)

        def unnest_sql(self, expression: exp.Unnest) -> str:
            unnest_alias = expression.args.get("alias")
            offset = expression.args.get("offset")

            columns = [
                exp.to_identifier("seq"),
                exp.to_identifier("key"),
                exp.to_identifier("path"),
                offset.pop() if isinstance(offset, exp.Expression) else exp.to_identifier("index"),
                seq_get(unnest_alias.columns if unnest_alias else [], 0)
                or exp.to_identifier("value"),
                exp.to_identifier("this"),
            ]

            if unnest_alias:
                unnest_alias.set("columns", columns)
            else:
                unnest_alias = exp.TableAlias(this="_u", columns=columns)

            explode = f"TABLE(FLATTEN(INPUT => {self.sql(expression.expressions[0])}))"
            alias = self.sql(unnest_alias)
            alias = f" AS {alias}" if alias else ""
            return f"{explode}{alias}"

        def show_sql(self, expression: exp.Show) -> str:
            terse = "TERSE " if expression.args.get("terse") else ""
            history = " HISTORY" if expression.args.get("history") else ""
            like = self.sql(expression, "like")
            like = f" LIKE {like}" if like else ""

            scope = self.sql(expression, "scope")
            scope = f" {scope}" if scope else ""

            scope_kind = self.sql(expression, "scope_kind")
            if scope_kind:
                scope_kind = f" IN {scope_kind}"

            starts_with = self.sql(expression, "starts_with")
            if starts_with:
                starts_with = f" STARTS WITH {starts_with}"

            limit = self.sql(expression, "limit")

            from_ = self.sql(expression, "from")
            if from_:
                from_ = f" FROM {from_}"

            return f"SHOW {terse}{expression.name}{history}{like}{scope_kind}{scope}{starts_with}{limit}{from_}"

        def describe_sql(self, expression: exp.Describe) -> str:
            # Default to table if kind is unknown
            kind_value = expression.args.get("kind") or "TABLE"
            kind = f" {kind_value}" if kind_value else ""
            this = f" {self.sql(expression, 'this')}"
            expressions = self.expressions(expression, flat=True)
            expressions = f" {expressions}" if expressions else ""
            return f"DESCRIBE{kind}{this}{expressions}"

        def generatedasidentitycolumnconstraint_sql(
            self, expression: exp.GeneratedAsIdentityColumnConstraint
        ) -> str:
            start = expression.args.get("start")
            start = f" START {start}" if start else ""
            increment = expression.args.get("increment")
            increment = f" INCREMENT {increment}" if increment else ""
            return f"AUTOINCREMENT{start}{increment}"

        def cluster_sql(self, expression: exp.Cluster) -> str:
            return f"CLUSTER BY ({self.expressions(expression, flat=True)})"

        def struct_sql(self, expression: exp.Struct) -> str:
            keys = []
            values = []

            for i, e in enumerate(expression.expressions):
                if isinstance(e, exp.PropertyEQ):
                    keys.append(
                        exp.Literal.string(e.name) if isinstance(e.this, exp.Identifier) else e.this
                    )
                    values.append(e.expression)
                else:
                    keys.append(exp.Literal.string(f"_{i}"))
                    values.append(e)

            return self.func("OBJECT_CONSTRUCT", *flatten(zip(keys, values)))

        @unsupported_args("weight", "accuracy")
        def approxquantile_sql(self, expression: exp.ApproxQuantile) -> str:
            return self.func("APPROX_PERCENTILE", expression.this, expression.args.get("quantile"))

        def alterset_sql(self, expression: exp.AlterSet) -> str:
            exprs = self.expressions(expression, flat=True)
            exprs = f" {exprs}" if exprs else ""
            file_format = self.expressions(expression, key="file_format", flat=True, sep=" ")
            file_format = f" STAGE_FILE_FORMAT = ({file_format})" if file_format else ""
            copy_options = self.expressions(expression, key="copy_options", flat=True, sep=" ")
            copy_options = f" STAGE_COPY_OPTIONS = ({copy_options})" if copy_options else ""
            tag = self.expressions(expression, key="tag", flat=True)
            tag = f" TAG {tag}" if tag else ""

            return f"SET{exprs}{file_format}{copy_options}{tag}"

        def strtotime_sql(self, expression: exp.StrToTime):
            safe_prefix = "TRY_" if expression.args.get("safe") else ""
            return self.func(
                f"{safe_prefix}TO_TIMESTAMP", expression.this, self.format_time(expression)
            )

        def timestampsub_sql(self, expression: exp.TimestampSub):
            return self.sql(
                exp.TimestampAdd(
                    this=expression.this,
                    expression=expression.expression * -1,
                    unit=expression.unit,
                )
            )

        def jsonextract_sql(self, expression: exp.JSONExtract):
            this = expression.this

            # JSON strings are valid coming from other dialects such as BQ
            return self.func(
                "GET_PATH",
                exp.ParseJSON(this=this) if this.is_string else this,
                expression.expression,
            )

        def timetostr_sql(self, expression: exp.TimeToStr) -> str:
            this = expression.this
            if not isinstance(this, exp.TsOrDsToTimestamp):
                this = exp.cast(this, exp.DataType.Type.TIMESTAMP)

            return self.func("TO_CHAR", this, self.format_time(expression))
