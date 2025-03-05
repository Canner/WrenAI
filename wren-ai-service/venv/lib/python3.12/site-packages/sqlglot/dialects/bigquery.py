from __future__ import annotations

import logging
import re
import typing as t

from sqlglot import exp, generator, parser, tokens, transforms
from sqlglot.dialects.dialect import (
    Dialect,
    NormalizationStrategy,
    arg_max_or_min_no_count,
    binary_from_function,
    date_add_interval_sql,
    datestrtodate_sql,
    build_formatted_time,
    filter_array_using_unnest,
    if_sql,
    inline_array_unless_query,
    max_or_greatest,
    min_or_least,
    no_ilike_sql,
    build_date_delta_with_interval,
    regexp_replace_sql,
    rename_func,
    sha256_sql,
    timestrtotime_sql,
    ts_or_ds_add_cast,
    unit_to_var,
    str_position_sql,
)
from sqlglot.helper import seq_get, split_num_words
from sqlglot.tokens import TokenType
from sqlglot.generator import unsupported_args

if t.TYPE_CHECKING:
    from sqlglot._typing import E, Lit

    from sqlglot.optimizer.annotate_types import TypeAnnotator

logger = logging.getLogger("sqlglot")


JSON_EXTRACT_TYPE = t.Union[exp.JSONExtract, exp.JSONExtractScalar, exp.JSONExtractArray]

DQUOTES_ESCAPING_JSON_FUNCTIONS = ("JSON_QUERY", "JSON_VALUE", "JSON_QUERY_ARRAY")


def _derived_table_values_to_unnest(self: BigQuery.Generator, expression: exp.Values) -> str:
    if not expression.find_ancestor(exp.From, exp.Join):
        return self.values_sql(expression)

    structs = []
    alias = expression.args.get("alias")
    for tup in expression.find_all(exp.Tuple):
        field_aliases = (
            alias.columns
            if alias and alias.columns
            else (f"_c{i}" for i in range(len(tup.expressions)))
        )
        expressions = [
            exp.PropertyEQ(this=exp.to_identifier(name), expression=fld)
            for name, fld in zip(field_aliases, tup.expressions)
        ]
        structs.append(exp.Struct(expressions=expressions))

    # Due to `UNNEST_COLUMN_ONLY`, it is expected that the table alias be contained in the columns expression
    alias_name_only = exp.TableAlias(columns=[alias.this]) if alias else None
    return self.unnest_sql(
        exp.Unnest(expressions=[exp.array(*structs, copy=False)], alias=alias_name_only)
    )


def _returnsproperty_sql(self: BigQuery.Generator, expression: exp.ReturnsProperty) -> str:
    this = expression.this
    if isinstance(this, exp.Schema):
        this = f"{self.sql(this, 'this')} <{self.expressions(this)}>"
    else:
        this = self.sql(this)
    return f"RETURNS {this}"


def _create_sql(self: BigQuery.Generator, expression: exp.Create) -> str:
    returns = expression.find(exp.ReturnsProperty)
    if expression.kind == "FUNCTION" and returns and returns.args.get("is_table"):
        expression.set("kind", "TABLE FUNCTION")

        if isinstance(expression.expression, (exp.Subquery, exp.Literal)):
            expression.set("expression", expression.expression.this)

    return self.create_sql(expression)


# https://issuetracker.google.com/issues/162294746
# workaround for bigquery bug when grouping by an expression and then ordering
# WITH x AS (SELECT 1 y)
# SELECT y + 1 z
# FROM x
# GROUP BY x + 1
# ORDER by z
def _alias_ordered_group(expression: exp.Expression) -> exp.Expression:
    if isinstance(expression, exp.Select):
        group = expression.args.get("group")
        order = expression.args.get("order")

        if group and order:
            aliases = {
                select.this: select.args["alias"]
                for select in expression.selects
                if isinstance(select, exp.Alias)
            }

            for grouped in group.expressions:
                if grouped.is_int:
                    continue
                alias = aliases.get(grouped)
                if alias:
                    grouped.replace(exp.column(alias))

    return expression


def _pushdown_cte_column_names(expression: exp.Expression) -> exp.Expression:
    """BigQuery doesn't allow column names when defining a CTE, so we try to push them down."""
    if isinstance(expression, exp.CTE) and expression.alias_column_names:
        cte_query = expression.this

        if cte_query.is_star:
            logger.warning(
                "Can't push down CTE column names for star queries. Run the query through"
                " the optimizer or use 'qualify' to expand the star projections first."
            )
            return expression

        column_names = expression.alias_column_names
        expression.args["alias"].set("columns", None)

        for name, select in zip(column_names, cte_query.selects):
            to_replace = select

            if isinstance(select, exp.Alias):
                select = select.this

            # Inner aliases are shadowed by the CTE column names
            to_replace.replace(exp.alias_(select, name))

    return expression


def _build_parse_timestamp(args: t.List) -> exp.StrToTime:
    this = build_formatted_time(exp.StrToTime, "bigquery")([seq_get(args, 1), seq_get(args, 0)])
    this.set("zone", seq_get(args, 2))
    return this


def _build_timestamp(args: t.List) -> exp.Timestamp:
    timestamp = exp.Timestamp.from_arg_list(args)
    timestamp.set("with_tz", True)
    return timestamp


def _build_date(args: t.List) -> exp.Date | exp.DateFromParts:
    expr_type = exp.DateFromParts if len(args) == 3 else exp.Date
    return expr_type.from_arg_list(args)


def _build_to_hex(args: t.List) -> exp.Hex | exp.MD5:
    # TO_HEX(MD5(..)) is common in BigQuery, so it's parsed into MD5 to simplify its transpilation
    arg = seq_get(args, 0)
    return exp.MD5(this=arg.this) if isinstance(arg, exp.MD5Digest) else exp.LowerHex(this=arg)


def _array_contains_sql(self: BigQuery.Generator, expression: exp.ArrayContains) -> str:
    return self.sql(
        exp.Exists(
            this=exp.select("1")
            .from_(exp.Unnest(expressions=[expression.left]).as_("_unnest", table=["_col"]))
            .where(exp.column("_col").eq(expression.right))
        )
    )


def _ts_or_ds_add_sql(self: BigQuery.Generator, expression: exp.TsOrDsAdd) -> str:
    return date_add_interval_sql("DATE", "ADD")(self, ts_or_ds_add_cast(expression))


def _ts_or_ds_diff_sql(self: BigQuery.Generator, expression: exp.TsOrDsDiff) -> str:
    expression.this.replace(exp.cast(expression.this, exp.DataType.Type.TIMESTAMP))
    expression.expression.replace(exp.cast(expression.expression, exp.DataType.Type.TIMESTAMP))
    unit = unit_to_var(expression)
    return self.func("DATE_DIFF", expression.this, expression.expression, unit)


def _unix_to_time_sql(self: BigQuery.Generator, expression: exp.UnixToTime) -> str:
    scale = expression.args.get("scale")
    timestamp = expression.this

    if scale in (None, exp.UnixToTime.SECONDS):
        return self.func("TIMESTAMP_SECONDS", timestamp)
    if scale == exp.UnixToTime.MILLIS:
        return self.func("TIMESTAMP_MILLIS", timestamp)
    if scale == exp.UnixToTime.MICROS:
        return self.func("TIMESTAMP_MICROS", timestamp)

    unix_seconds = exp.cast(
        exp.Div(this=timestamp, expression=exp.func("POW", 10, scale)), exp.DataType.Type.BIGINT
    )
    return self.func("TIMESTAMP_SECONDS", unix_seconds)


def _build_time(args: t.List) -> exp.Func:
    if len(args) == 1:
        return exp.TsOrDsToTime(this=args[0])
    if len(args) == 2:
        return exp.Time.from_arg_list(args)
    return exp.TimeFromParts.from_arg_list(args)


def _build_datetime(args: t.List) -> exp.Func:
    if len(args) == 1:
        return exp.TsOrDsToDatetime.from_arg_list(args)
    if len(args) == 2:
        return exp.Datetime.from_arg_list(args)
    return exp.TimestampFromParts.from_arg_list(args)


def _build_regexp_extract(
    expr_type: t.Type[E], default_group: t.Optional[exp.Expression] = None
) -> t.Callable[[t.List], E]:
    def _builder(args: t.List) -> E:
        try:
            group = re.compile(args[1].name).groups == 1
        except re.error:
            group = False

        # Default group is used for the transpilation of REGEXP_EXTRACT_ALL
        return expr_type(
            this=seq_get(args, 0),
            expression=seq_get(args, 1),
            position=seq_get(args, 2),
            occurrence=seq_get(args, 3),
            group=exp.Literal.number(1) if group else default_group,
        )

    return _builder


def _build_extract_json_with_default_path(expr_type: t.Type[E]) -> t.Callable[[t.List, Dialect], E]:
    def _builder(args: t.List, dialect: Dialect) -> E:
        if len(args) == 1:
            # The default value for the JSONPath is '$' i.e all of the data
            args.append(exp.Literal.string("$"))
        return parser.build_extract_json_with_path(expr_type)(args, dialect)

    return _builder


def _str_to_datetime_sql(
    self: BigQuery.Generator, expression: exp.StrToDate | exp.StrToTime
) -> str:
    this = self.sql(expression, "this")
    dtype = "DATE" if isinstance(expression, exp.StrToDate) else "TIMESTAMP"

    if expression.args.get("safe"):
        fmt = self.format_time(
            expression,
            self.dialect.INVERSE_FORMAT_MAPPING,
            self.dialect.INVERSE_FORMAT_TRIE,
        )
        return f"SAFE_CAST({this} AS {dtype} FORMAT {fmt})"

    fmt = self.format_time(expression)
    return self.func(f"PARSE_{dtype}", fmt, this, expression.args.get("zone"))


def _annotate_math_functions(self: TypeAnnotator, expression: E) -> E:
    """
    Many BigQuery math functions such as CEIL, FLOOR etc follow this return type convention:
    +---------+---------+---------+------------+---------+
    |  INPUT  | INT64   | NUMERIC | BIGNUMERIC | FLOAT64 |
    +---------+---------+---------+------------+---------+
    |  OUTPUT | FLOAT64 | NUMERIC | BIGNUMERIC | FLOAT64 |
    +---------+---------+---------+------------+---------+
    """
    self._annotate_args(expression)

    this: exp.Expression = expression.this

    self._set_type(
        expression,
        exp.DataType.Type.DOUBLE if this.is_type(*exp.DataType.INTEGER_TYPES) else this.type,
    )
    return expression


@unsupported_args("ins_cost", "del_cost", "sub_cost")
def _levenshtein_sql(self: BigQuery.Generator, expression: exp.Levenshtein) -> str:
    max_dist = expression.args.get("max_dist")
    if max_dist:
        max_dist = exp.Kwarg(this=exp.var("max_distance"), expression=max_dist)

    return self.func("EDIT_DISTANCE", expression.this, expression.expression, max_dist)


def _build_levenshtein(args: t.List) -> exp.Levenshtein:
    max_dist = seq_get(args, 2)
    return exp.Levenshtein(
        this=seq_get(args, 0),
        expression=seq_get(args, 1),
        max_dist=max_dist.expression if max_dist else None,
    )


def _build_format_time(expr_type: t.Type[exp.Expression]) -> t.Callable[[t.List], exp.TimeToStr]:
    def _builder(args: t.List) -> exp.TimeToStr:
        return exp.TimeToStr(this=expr_type(this=seq_get(args, 1)), format=seq_get(args, 0))

    return _builder


def _build_contains_substring(args: t.List) -> exp.Contains | exp.Anonymous:
    if len(args) == 3:
        return exp.Anonymous(this="CONTAINS_SUBSTR", expressions=args)

    # Lowercase the operands in case of transpilation, as exp.Contains
    # is case-sensitive on other dialects
    this = exp.Lower(this=seq_get(args, 0))
    expr = exp.Lower(this=seq_get(args, 1))

    return exp.Contains(this=this, expression=expr)


def _json_extract_sql(self: BigQuery.Generator, expression: JSON_EXTRACT_TYPE) -> str:
    name = (expression._meta and expression.meta.get("name")) or expression.sql_name()
    upper = name.upper()

    dquote_escaping = upper in DQUOTES_ESCAPING_JSON_FUNCTIONS

    if dquote_escaping:
        self._quote_json_path_key_using_brackets = False

    sql = rename_func(upper)(self, expression)

    if dquote_escaping:
        self._quote_json_path_key_using_brackets = True

    return sql


class BigQuery(Dialect):
    WEEK_OFFSET = -1
    UNNEST_COLUMN_ONLY = True
    SUPPORTS_USER_DEFINED_TYPES = False
    SUPPORTS_SEMI_ANTI_JOIN = False
    LOG_BASE_FIRST = False
    HEX_LOWERCASE = True
    FORCE_EARLY_ALIAS_REF_EXPANSION = True
    EXPAND_ALIAS_REFS_EARLY_ONLY_IN_GROUP_BY = True
    PRESERVE_ORIGINAL_NAMES = True

    # https://cloud.google.com/bigquery/docs/reference/standard-sql/lexical#case_sensitivity
    NORMALIZATION_STRATEGY = NormalizationStrategy.CASE_INSENSITIVE

    # bigquery udfs are case sensitive
    NORMALIZE_FUNCTIONS = False

    # https://cloud.google.com/bigquery/docs/reference/standard-sql/format-elements#format_elements_date_time
    TIME_MAPPING = {
        "%D": "%m/%d/%y",
        "%E6S": "%S.%f",
        "%e": "%-d",
    }

    FORMAT_MAPPING = {
        "DD": "%d",
        "MM": "%m",
        "MON": "%b",
        "MONTH": "%B",
        "YYYY": "%Y",
        "YY": "%y",
        "HH": "%I",
        "HH12": "%I",
        "HH24": "%H",
        "MI": "%M",
        "SS": "%S",
        "SSSSS": "%f",
        "TZH": "%z",
    }

    # The _PARTITIONTIME and _PARTITIONDATE pseudo-columns are not returned by a SELECT * statement
    # https://cloud.google.com/bigquery/docs/querying-partitioned-tables#query_an_ingestion-time_partitioned_table
    PSEUDOCOLUMNS = {"_PARTITIONTIME", "_PARTITIONDATE"}

    # All set operations require either a DISTINCT or ALL specifier
    SET_OP_DISTINCT_BY_DEFAULT = dict.fromkeys((exp.Except, exp.Intersect, exp.Union), None)

    ANNOTATORS = {
        **Dialect.ANNOTATORS,
        **{
            expr_type: lambda self, e: _annotate_math_functions(self, e)
            for expr_type in (exp.Floor, exp.Ceil, exp.Log, exp.Ln, exp.Sqrt, exp.Exp, exp.Round)
        },
        **{
            expr_type: lambda self, e: self._annotate_by_args(e, "this")
            for expr_type in (
                exp.Left,
                exp.Right,
                exp.Lower,
                exp.Upper,
                exp.Pad,
                exp.Trim,
                exp.RegexpExtract,
                exp.RegexpReplace,
                exp.Repeat,
                exp.Substring,
            )
        },
        exp.Concat: lambda self, e: self._annotate_by_args(e, "expressions"),
        exp.Sign: lambda self, e: self._annotate_by_args(e, "this"),
        exp.Split: lambda self, e: self._annotate_by_args(e, "this", array=True),
    }

    def normalize_identifier(self, expression: E) -> E:
        if (
            isinstance(expression, exp.Identifier)
            and self.normalization_strategy is not NormalizationStrategy.CASE_SENSITIVE
        ):
            parent = expression.parent
            while isinstance(parent, exp.Dot):
                parent = parent.parent

            # In BigQuery, CTEs are case-insensitive, but UDF and table names are case-sensitive
            # by default. The following check uses a heuristic to detect tables based on whether
            # they are qualified. This should generally be correct, because tables in BigQuery
            # must be qualified with at least a dataset, unless @@dataset_id is set.
            case_sensitive = (
                isinstance(parent, exp.UserDefinedFunction)
                or (
                    isinstance(parent, exp.Table)
                    and parent.db
                    and (parent.meta.get("quoted_table") or not parent.meta.get("maybe_column"))
                )
                or expression.meta.get("is_table")
            )
            if not case_sensitive:
                expression.set("this", expression.this.lower())

        return expression

    class Tokenizer(tokens.Tokenizer):
        QUOTES = ["'", '"', '"""', "'''"]
        COMMENTS = ["--", "#", ("/*", "*/")]
        IDENTIFIERS = ["`"]
        STRING_ESCAPES = ["\\"]

        HEX_STRINGS = [("0x", ""), ("0X", "")]

        BYTE_STRINGS = [
            (prefix + q, q) for q in t.cast(t.List[str], QUOTES) for prefix in ("b", "B")
        ]

        RAW_STRINGS = [
            (prefix + q, q) for q in t.cast(t.List[str], QUOTES) for prefix in ("r", "R")
        ]

        KEYWORDS = {
            **tokens.Tokenizer.KEYWORDS,
            "ANY TYPE": TokenType.VARIANT,
            "BEGIN": TokenType.COMMAND,
            "BEGIN TRANSACTION": TokenType.BEGIN,
            "BYTEINT": TokenType.INT,
            "BYTES": TokenType.BINARY,
            "CURRENT_DATETIME": TokenType.CURRENT_DATETIME,
            "DATETIME": TokenType.TIMESTAMP,
            "DECLARE": TokenType.COMMAND,
            "ELSEIF": TokenType.COMMAND,
            "EXCEPTION": TokenType.COMMAND,
            "FLOAT64": TokenType.DOUBLE,
            "FOR SYSTEM_TIME": TokenType.TIMESTAMP_SNAPSHOT,
            "MODEL": TokenType.MODEL,
            "NOT DETERMINISTIC": TokenType.VOLATILE,
            "RECORD": TokenType.STRUCT,
            "TIMESTAMP": TokenType.TIMESTAMPTZ,
        }
        KEYWORDS.pop("DIV")
        KEYWORDS.pop("VALUES")
        KEYWORDS.pop("/*+")

    class Parser(parser.Parser):
        PREFIXED_PIVOT_COLUMNS = True
        LOG_DEFAULTS_TO_LN = True
        SUPPORTS_IMPLICIT_UNNEST = True

        FUNCTIONS = {
            **parser.Parser.FUNCTIONS,
            "CONTAINS_SUBSTR": _build_contains_substring,
            "DATE": _build_date,
            "DATE_ADD": build_date_delta_with_interval(exp.DateAdd),
            "DATE_SUB": build_date_delta_with_interval(exp.DateSub),
            "DATE_TRUNC": lambda args: exp.DateTrunc(
                unit=exp.Literal.string(str(seq_get(args, 1))),
                this=seq_get(args, 0),
                zone=seq_get(args, 2),
            ),
            "DATETIME": _build_datetime,
            "DATETIME_ADD": build_date_delta_with_interval(exp.DatetimeAdd),
            "DATETIME_SUB": build_date_delta_with_interval(exp.DatetimeSub),
            "DIV": binary_from_function(exp.IntDiv),
            "EDIT_DISTANCE": _build_levenshtein,
            "FORMAT_DATE": _build_format_time(exp.TsOrDsToDate),
            "GENERATE_ARRAY": exp.GenerateSeries.from_arg_list,
            "JSON_EXTRACT_SCALAR": _build_extract_json_with_default_path(exp.JSONExtractScalar),
            "JSON_EXTRACT_ARRAY": _build_extract_json_with_default_path(exp.JSONExtractArray),
            "JSON_QUERY": parser.build_extract_json_with_path(exp.JSONExtract),
            "JSON_QUERY_ARRAY": _build_extract_json_with_default_path(exp.JSONExtractArray),
            "JSON_VALUE": _build_extract_json_with_default_path(exp.JSONExtractScalar),
            "JSON_VALUE_ARRAY": _build_extract_json_with_default_path(exp.JSONValueArray),
            "LENGTH": lambda args: exp.Length(this=seq_get(args, 0), binary=True),
            "MD5": exp.MD5Digest.from_arg_list,
            "TO_HEX": _build_to_hex,
            "PARSE_DATE": lambda args: build_formatted_time(exp.StrToDate, "bigquery")(
                [seq_get(args, 1), seq_get(args, 0)]
            ),
            "PARSE_TIMESTAMP": _build_parse_timestamp,
            "REGEXP_CONTAINS": exp.RegexpLike.from_arg_list,
            "REGEXP_EXTRACT": _build_regexp_extract(exp.RegexpExtract),
            "REGEXP_SUBSTR": _build_regexp_extract(exp.RegexpExtract),
            "REGEXP_EXTRACT_ALL": _build_regexp_extract(
                exp.RegexpExtractAll, default_group=exp.Literal.number(0)
            ),
            "SHA256": lambda args: exp.SHA2(this=seq_get(args, 0), length=exp.Literal.number(256)),
            "SHA512": lambda args: exp.SHA2(this=seq_get(args, 0), length=exp.Literal.number(512)),
            "SPLIT": lambda args: exp.Split(
                # https://cloud.google.com/bigquery/docs/reference/standard-sql/string_functions#split
                this=seq_get(args, 0),
                expression=seq_get(args, 1) or exp.Literal.string(","),
            ),
            "STRPOS": exp.StrPosition.from_arg_list,
            "TIME": _build_time,
            "TIME_ADD": build_date_delta_with_interval(exp.TimeAdd),
            "TIME_SUB": build_date_delta_with_interval(exp.TimeSub),
            "TIMESTAMP": _build_timestamp,
            "TIMESTAMP_ADD": build_date_delta_with_interval(exp.TimestampAdd),
            "TIMESTAMP_SUB": build_date_delta_with_interval(exp.TimestampSub),
            "TIMESTAMP_MICROS": lambda args: exp.UnixToTime(
                this=seq_get(args, 0), scale=exp.UnixToTime.MICROS
            ),
            "TIMESTAMP_MILLIS": lambda args: exp.UnixToTime(
                this=seq_get(args, 0), scale=exp.UnixToTime.MILLIS
            ),
            "TIMESTAMP_SECONDS": lambda args: exp.UnixToTime(this=seq_get(args, 0)),
            "TO_JSON_STRING": exp.JSONFormat.from_arg_list,
            "FORMAT_DATETIME": _build_format_time(exp.TsOrDsToDatetime),
            "FORMAT_TIMESTAMP": _build_format_time(exp.TsOrDsToTimestamp),
        }

        FUNCTION_PARSERS = {
            **parser.Parser.FUNCTION_PARSERS,
            "ARRAY": lambda self: self.expression(exp.Array, expressions=[self._parse_statement()]),
            "MAKE_INTERVAL": lambda self: self._parse_make_interval(),
            "FEATURES_AT_TIME": lambda self: self._parse_features_at_time(),
        }
        FUNCTION_PARSERS.pop("TRIM")

        NO_PAREN_FUNCTIONS = {
            **parser.Parser.NO_PAREN_FUNCTIONS,
            TokenType.CURRENT_DATETIME: exp.CurrentDatetime,
        }

        NESTED_TYPE_TOKENS = {
            *parser.Parser.NESTED_TYPE_TOKENS,
            TokenType.TABLE,
        }

        PROPERTY_PARSERS = {
            **parser.Parser.PROPERTY_PARSERS,
            "NOT DETERMINISTIC": lambda self: self.expression(
                exp.StabilityProperty, this=exp.Literal.string("VOLATILE")
            ),
            "OPTIONS": lambda self: self._parse_with_property(),
        }

        CONSTRAINT_PARSERS = {
            **parser.Parser.CONSTRAINT_PARSERS,
            "OPTIONS": lambda self: exp.Properties(expressions=self._parse_with_property()),
        }

        RANGE_PARSERS = parser.Parser.RANGE_PARSERS.copy()
        RANGE_PARSERS.pop(TokenType.OVERLAPS)

        NULL_TOKENS = {TokenType.NULL, TokenType.UNKNOWN}

        DASHED_TABLE_PART_FOLLOW_TOKENS = {TokenType.DOT, TokenType.L_PAREN, TokenType.R_PAREN}

        STATEMENT_PARSERS = {
            **parser.Parser.STATEMENT_PARSERS,
            TokenType.ELSE: lambda self: self._parse_as_command(self._prev),
            TokenType.END: lambda self: self._parse_as_command(self._prev),
            TokenType.FOR: lambda self: self._parse_for_in(),
        }

        BRACKET_OFFSETS = {
            "OFFSET": (0, False),
            "ORDINAL": (1, False),
            "SAFE_OFFSET": (0, True),
            "SAFE_ORDINAL": (1, True),
        }

        def _parse_for_in(self) -> exp.ForIn:
            this = self._parse_range()
            self._match_text_seq("DO")
            return self.expression(exp.ForIn, this=this, expression=self._parse_statement())

        def _parse_table_part(self, schema: bool = False) -> t.Optional[exp.Expression]:
            this = super()._parse_table_part(schema=schema) or self._parse_number()

            # https://cloud.google.com/bigquery/docs/reference/standard-sql/lexical#table_names
            if isinstance(this, exp.Identifier):
                table_name = this.name
                while self._match(TokenType.DASH, advance=False) and self._next:
                    start = self._curr
                    while self._is_connected() and not self._match_set(
                        self.DASHED_TABLE_PART_FOLLOW_TOKENS, advance=False
                    ):
                        self._advance()

                    table_name += self._find_sql(start, self._prev)

                this = exp.Identifier(this=table_name, quoted=this.args.get("quoted"))
            elif isinstance(this, exp.Literal):
                table_name = this.name

                if self._is_connected() and self._parse_var(any_token=True):
                    table_name += self._prev.text

                this = exp.Identifier(this=table_name, quoted=True)

            return this

        def _parse_table_parts(
            self, schema: bool = False, is_db_reference: bool = False, wildcard: bool = False
        ) -> exp.Table:
            table = super()._parse_table_parts(
                schema=schema, is_db_reference=is_db_reference, wildcard=True
            )

            # proj-1.db.tbl -- `1.` is tokenized as a float so we need to unravel it here
            if not table.catalog:
                if table.db:
                    parts = table.db.split(".")
                    if len(parts) == 2 and not table.args["db"].quoted:
                        table.set("catalog", exp.Identifier(this=parts[0]))
                        table.set("db", exp.Identifier(this=parts[1]))
                else:
                    parts = table.name.split(".")
                    if len(parts) == 2 and not table.this.quoted:
                        table.set("db", exp.Identifier(this=parts[0]))
                        table.set("this", exp.Identifier(this=parts[1]))

            if isinstance(table.this, exp.Identifier) and any("." in p.name for p in table.parts):
                alias = table.this
                catalog, db, this, *rest = (
                    exp.to_identifier(p, quoted=True)
                    for p in split_num_words(".".join(p.name for p in table.parts), ".", 3)
                )

                if rest and this:
                    this = exp.Dot.build([this, *rest])  # type: ignore

                table = exp.Table(
                    this=this, db=db, catalog=catalog, pivots=table.args.get("pivots")
                )
                table.meta["quoted_table"] = True
            else:
                alias = None

            # The `INFORMATION_SCHEMA` views in BigQuery need to be qualified by a region or
            # dataset, so if the project identifier is omitted we need to fix the ast so that
            # the `INFORMATION_SCHEMA.X` bit is represented as a single (quoted) Identifier.
            # Otherwise, we wouldn't correctly qualify a `Table` node that references these
            # views, because it would seem like the "catalog" part is set, when it'd actually
            # be the region/dataset. Merging the two identifiers into a single one is done to
            # avoid producing a 4-part Table reference, which would cause issues in the schema
            # module, when there are 3-part table names mixed with information schema views.
            #
            # See: https://cloud.google.com/bigquery/docs/information-schema-intro#syntax
            table_parts = table.parts
            if len(table_parts) > 1 and table_parts[-2].name.upper() == "INFORMATION_SCHEMA":
                # We need to alias the table here to avoid breaking existing qualified columns.
                # This is expected to be safe, because if there's an actual alias coming up in
                # the token stream, it will overwrite this one. If there isn't one, we are only
                # exposing the name that can be used to reference the view explicitly (a no-op).
                exp.alias_(
                    table,
                    t.cast(exp.Identifier, alias or table_parts[-1]),
                    table=True,
                    copy=False,
                )

                info_schema_view = f"{table_parts[-2].name}.{table_parts[-1].name}"
                table.set("this", exp.Identifier(this=info_schema_view, quoted=True))
                table.set("db", seq_get(table_parts, -3))
                table.set("catalog", seq_get(table_parts, -4))

            return table

        def _parse_column(self) -> t.Optional[exp.Expression]:
            column = super()._parse_column()
            if isinstance(column, exp.Column):
                parts = column.parts
                if any("." in p.name for p in parts):
                    catalog, db, table, this, *rest = (
                        exp.to_identifier(p, quoted=True)
                        for p in split_num_words(".".join(p.name for p in parts), ".", 4)
                    )

                    if rest and this:
                        this = exp.Dot.build([this, *rest])  # type: ignore

                    column = exp.Column(this=this, table=table, db=db, catalog=catalog)
                    column.meta["quoted_column"] = True

            return column

        @t.overload
        def _parse_json_object(self, agg: Lit[False]) -> exp.JSONObject: ...

        @t.overload
        def _parse_json_object(self, agg: Lit[True]) -> exp.JSONObjectAgg: ...

        def _parse_json_object(self, agg=False):
            json_object = super()._parse_json_object()
            array_kv_pair = seq_get(json_object.expressions, 0)

            # Converts BQ's "signature 2" of JSON_OBJECT into SQLGlot's canonical representation
            # https://cloud.google.com/bigquery/docs/reference/standard-sql/json_functions#json_object_signature2
            if (
                array_kv_pair
                and isinstance(array_kv_pair.this, exp.Array)
                and isinstance(array_kv_pair.expression, exp.Array)
            ):
                keys = array_kv_pair.this.expressions
                values = array_kv_pair.expression.expressions

                json_object.set(
                    "expressions",
                    [exp.JSONKeyValue(this=k, expression=v) for k, v in zip(keys, values)],
                )

            return json_object

        def _parse_bracket(
            self, this: t.Optional[exp.Expression] = None
        ) -> t.Optional[exp.Expression]:
            bracket = super()._parse_bracket(this)

            if this is bracket:
                return bracket

            if isinstance(bracket, exp.Bracket):
                for expression in bracket.expressions:
                    name = expression.name.upper()

                    if name not in self.BRACKET_OFFSETS:
                        break

                    offset, safe = self.BRACKET_OFFSETS[name]
                    bracket.set("offset", offset)
                    bracket.set("safe", safe)
                    expression.replace(expression.expressions[0])

            return bracket

        def _parse_unnest(self, with_alias: bool = True) -> t.Optional[exp.Unnest]:
            unnest = super()._parse_unnest(with_alias=with_alias)

            if not unnest:
                return None

            unnest_expr = seq_get(unnest.expressions, 0)
            if unnest_expr:
                from sqlglot.optimizer.annotate_types import annotate_types

                unnest_expr = annotate_types(unnest_expr)

                # Unnesting a nested array (i.e array of structs) explodes the top-level struct fields,
                # in contrast to other dialects such as DuckDB which flattens only the array by default
                if unnest_expr.is_type(exp.DataType.Type.ARRAY) and any(
                    array_elem.is_type(exp.DataType.Type.STRUCT)
                    for array_elem in unnest_expr._type.expressions
                ):
                    unnest.set("explode_array", True)

            return unnest

        def _parse_make_interval(self) -> exp.MakeInterval:
            expr = exp.MakeInterval()

            for arg_key in expr.arg_types:
                value = self._parse_lambda()

                if not value:
                    break

                # Non-named arguments are filled sequentially, (optionally) followed by named arguments
                # that can appear in any order e.g MAKE_INTERVAL(1, minute => 5, day => 2)
                if isinstance(value, exp.Kwarg):
                    arg_key = value.this.name

                expr.set(arg_key, value)

                self._match(TokenType.COMMA)

            return expr

        def _parse_features_at_time(self) -> exp.FeaturesAtTime:
            expr = self.expression(
                exp.FeaturesAtTime,
                this=(self._match(TokenType.TABLE) and self._parse_table())
                or self._parse_select(nested=True),
            )

            while self._match(TokenType.COMMA):
                arg = self._parse_lambda()

                # Get the LHS of the Kwarg and set the arg to that value, e.g
                # "num_rows => 1" sets the expr's `num_rows` arg
                if arg:
                    expr.set(arg.this.name, arg)

            return expr

    class Generator(generator.Generator):
        INTERVAL_ALLOWS_PLURAL_FORM = False
        JOIN_HINTS = False
        QUERY_HINTS = False
        TABLE_HINTS = False
        LIMIT_FETCH = "LIMIT"
        RENAME_TABLE_WITH_DB = False
        NVL2_SUPPORTED = False
        UNNEST_WITH_ORDINALITY = False
        COLLATE_IS_FUNC = True
        LIMIT_ONLY_LITERALS = True
        SUPPORTS_TABLE_ALIAS_COLUMNS = False
        UNPIVOT_ALIASES_ARE_IDENTIFIERS = False
        JSON_KEY_VALUE_PAIR_SEP = ","
        NULL_ORDERING_SUPPORTED = False
        IGNORE_NULLS_IN_FUNC = True
        JSON_PATH_SINGLE_QUOTE_ESCAPE = True
        CAN_IMPLEMENT_ARRAY_ANY = True
        SUPPORTS_TO_NUMBER = False
        NAMED_PLACEHOLDER_TOKEN = "@"
        HEX_FUNC = "TO_HEX"
        WITH_PROPERTIES_PREFIX = "OPTIONS"
        SUPPORTS_EXPLODING_PROJECTIONS = False
        EXCEPT_INTERSECT_SUPPORT_ALL_CLAUSE = False
        SUPPORTS_UNIX_SECONDS = True

        TRANSFORMS = {
            **generator.Generator.TRANSFORMS,
            exp.ApproxDistinct: rename_func("APPROX_COUNT_DISTINCT"),
            exp.ArgMax: arg_max_or_min_no_count("MAX_BY"),
            exp.ArgMin: arg_max_or_min_no_count("MIN_BY"),
            exp.Array: inline_array_unless_query,
            exp.ArrayContains: _array_contains_sql,
            exp.ArrayFilter: filter_array_using_unnest,
            exp.Cast: transforms.preprocess([transforms.remove_precision_parameterized_types]),
            exp.CollateProperty: lambda self, e: (
                f"DEFAULT COLLATE {self.sql(e, 'this')}"
                if e.args.get("default")
                else f"COLLATE {self.sql(e, 'this')}"
            ),
            exp.Commit: lambda *_: "COMMIT TRANSACTION",
            exp.CountIf: rename_func("COUNTIF"),
            exp.Create: _create_sql,
            exp.CTE: transforms.preprocess([_pushdown_cte_column_names]),
            exp.DateAdd: date_add_interval_sql("DATE", "ADD"),
            exp.DateDiff: lambda self, e: self.func(
                "DATE_DIFF", e.this, e.expression, unit_to_var(e)
            ),
            exp.DateFromParts: rename_func("DATE"),
            exp.DateStrToDate: datestrtodate_sql,
            exp.DateSub: date_add_interval_sql("DATE", "SUB"),
            exp.DatetimeAdd: date_add_interval_sql("DATETIME", "ADD"),
            exp.DatetimeSub: date_add_interval_sql("DATETIME", "SUB"),
            exp.DateTrunc: lambda self, e: self.func(
                "DATE_TRUNC", e.this, e.text("unit"), e.args.get("zone")
            ),
            exp.FromTimeZone: lambda self, e: self.func(
                "DATETIME", self.func("TIMESTAMP", e.this, e.args.get("zone")), "'UTC'"
            ),
            exp.GenerateSeries: rename_func("GENERATE_ARRAY"),
            exp.GroupConcat: rename_func("STRING_AGG"),
            exp.Hex: lambda self, e: self.func("UPPER", self.func("TO_HEX", self.sql(e, "this"))),
            exp.If: if_sql(false_value="NULL"),
            exp.ILike: no_ilike_sql,
            exp.IntDiv: rename_func("DIV"),
            exp.Int64: rename_func("INT64"),
            exp.JSONExtract: _json_extract_sql,
            exp.JSONExtractArray: _json_extract_sql,
            exp.JSONExtractScalar: _json_extract_sql,
            exp.JSONFormat: rename_func("TO_JSON_STRING"),
            exp.Levenshtein: _levenshtein_sql,
            exp.Max: max_or_greatest,
            exp.MD5: lambda self, e: self.func("TO_HEX", self.func("MD5", e.this)),
            exp.MD5Digest: rename_func("MD5"),
            exp.Min: min_or_least,
            exp.PartitionedByProperty: lambda self, e: f"PARTITION BY {self.sql(e, 'this')}",
            exp.RegexpExtract: lambda self, e: self.func(
                "REGEXP_EXTRACT",
                e.this,
                e.expression,
                e.args.get("position"),
                e.args.get("occurrence"),
            ),
            exp.RegexpExtractAll: lambda self, e: self.func(
                "REGEXP_EXTRACT_ALL", e.this, e.expression
            ),
            exp.RegexpReplace: regexp_replace_sql,
            exp.RegexpLike: rename_func("REGEXP_CONTAINS"),
            exp.ReturnsProperty: _returnsproperty_sql,
            exp.Rollback: lambda *_: "ROLLBACK TRANSACTION",
            exp.Select: transforms.preprocess(
                [
                    transforms.explode_to_unnest(),
                    transforms.unqualify_unnest,
                    transforms.eliminate_distinct_on,
                    _alias_ordered_group,
                    transforms.eliminate_semi_and_anti_joins,
                ]
            ),
            exp.SHA: rename_func("SHA1"),
            exp.SHA2: sha256_sql,
            exp.StabilityProperty: lambda self, e: (
                "DETERMINISTIC" if e.name == "IMMUTABLE" else "NOT DETERMINISTIC"
            ),
            exp.String: rename_func("STRING"),
            exp.StrPosition: str_position_sql,
            exp.StrToDate: _str_to_datetime_sql,
            exp.StrToTime: _str_to_datetime_sql,
            exp.TimeAdd: date_add_interval_sql("TIME", "ADD"),
            exp.TimeFromParts: rename_func("TIME"),
            exp.TimestampFromParts: rename_func("DATETIME"),
            exp.TimeSub: date_add_interval_sql("TIME", "SUB"),
            exp.TimestampAdd: date_add_interval_sql("TIMESTAMP", "ADD"),
            exp.TimestampDiff: rename_func("TIMESTAMP_DIFF"),
            exp.TimestampSub: date_add_interval_sql("TIMESTAMP", "SUB"),
            exp.TimeStrToTime: timestrtotime_sql,
            exp.Transaction: lambda *_: "BEGIN TRANSACTION",
            exp.TsOrDsAdd: _ts_or_ds_add_sql,
            exp.TsOrDsDiff: _ts_or_ds_diff_sql,
            exp.TsOrDsToTime: rename_func("TIME"),
            exp.TsOrDsToDatetime: rename_func("DATETIME"),
            exp.TsOrDsToTimestamp: rename_func("TIMESTAMP"),
            exp.Unhex: rename_func("FROM_HEX"),
            exp.UnixDate: rename_func("UNIX_DATE"),
            exp.UnixToTime: _unix_to_time_sql,
            exp.Uuid: lambda *_: "GENERATE_UUID()",
            exp.Values: _derived_table_values_to_unnest,
            exp.VariancePop: rename_func("VAR_POP"),
        }

        SUPPORTED_JSON_PATH_PARTS = {
            exp.JSONPathKey,
            exp.JSONPathRoot,
            exp.JSONPathSubscript,
        }

        TYPE_MAPPING = {
            **generator.Generator.TYPE_MAPPING,
            exp.DataType.Type.BIGDECIMAL: "BIGNUMERIC",
            exp.DataType.Type.BIGINT: "INT64",
            exp.DataType.Type.BINARY: "BYTES",
            exp.DataType.Type.BOOLEAN: "BOOL",
            exp.DataType.Type.CHAR: "STRING",
            exp.DataType.Type.DECIMAL: "NUMERIC",
            exp.DataType.Type.DOUBLE: "FLOAT64",
            exp.DataType.Type.FLOAT: "FLOAT64",
            exp.DataType.Type.INT: "INT64",
            exp.DataType.Type.NCHAR: "STRING",
            exp.DataType.Type.NVARCHAR: "STRING",
            exp.DataType.Type.SMALLINT: "INT64",
            exp.DataType.Type.TEXT: "STRING",
            exp.DataType.Type.TIMESTAMP: "DATETIME",
            exp.DataType.Type.TIMESTAMPTZ: "TIMESTAMP",
            exp.DataType.Type.TIMESTAMPLTZ: "TIMESTAMP",
            exp.DataType.Type.TINYINT: "INT64",
            exp.DataType.Type.ROWVERSION: "BYTES",
            exp.DataType.Type.UUID: "STRING",
            exp.DataType.Type.VARBINARY: "BYTES",
            exp.DataType.Type.VARCHAR: "STRING",
            exp.DataType.Type.VARIANT: "ANY TYPE",
        }

        PROPERTIES_LOCATION = {
            **generator.Generator.PROPERTIES_LOCATION,
            exp.PartitionedByProperty: exp.Properties.Location.POST_SCHEMA,
            exp.VolatileProperty: exp.Properties.Location.UNSUPPORTED,
        }

        # WINDOW comes after QUALIFY
        # https://cloud.google.com/bigquery/docs/reference/standard-sql/query-syntax#window_clause
        AFTER_HAVING_MODIFIER_TRANSFORMS = {
            "qualify": generator.Generator.AFTER_HAVING_MODIFIER_TRANSFORMS["qualify"],
            "windows": generator.Generator.AFTER_HAVING_MODIFIER_TRANSFORMS["windows"],
        }

        # from: https://cloud.google.com/bigquery/docs/reference/standard-sql/lexical#reserved_keywords
        RESERVED_KEYWORDS = {
            "all",
            "and",
            "any",
            "array",
            "as",
            "asc",
            "assert_rows_modified",
            "at",
            "between",
            "by",
            "case",
            "cast",
            "collate",
            "contains",
            "create",
            "cross",
            "cube",
            "current",
            "default",
            "define",
            "desc",
            "distinct",
            "else",
            "end",
            "enum",
            "escape",
            "except",
            "exclude",
            "exists",
            "extract",
            "false",
            "fetch",
            "following",
            "for",
            "from",
            "full",
            "group",
            "grouping",
            "groups",
            "hash",
            "having",
            "if",
            "ignore",
            "in",
            "inner",
            "intersect",
            "interval",
            "into",
            "is",
            "join",
            "lateral",
            "left",
            "like",
            "limit",
            "lookup",
            "merge",
            "natural",
            "new",
            "no",
            "not",
            "null",
            "nulls",
            "of",
            "on",
            "or",
            "order",
            "outer",
            "over",
            "partition",
            "preceding",
            "proto",
            "qualify",
            "range",
            "recursive",
            "respect",
            "right",
            "rollup",
            "rows",
            "select",
            "set",
            "some",
            "struct",
            "tablesample",
            "then",
            "to",
            "treat",
            "true",
            "unbounded",
            "union",
            "unnest",
            "using",
            "when",
            "where",
            "window",
            "with",
            "within",
        }

        def mod_sql(self, expression: exp.Mod) -> str:
            this = expression.this
            expr = expression.expression
            return self.func(
                "MOD",
                this.unnest() if isinstance(this, exp.Paren) else this,
                expr.unnest() if isinstance(expr, exp.Paren) else expr,
            )

        def column_parts(self, expression: exp.Column) -> str:
            if expression.meta.get("quoted_column"):
                # If a column reference is of the form `dataset.table`.name, we need
                # to preserve the quoted table path, otherwise the reference breaks
                table_parts = ".".join(p.name for p in expression.parts[:-1])
                table_path = self.sql(exp.Identifier(this=table_parts, quoted=True))
                return f"{table_path}.{self.sql(expression, 'this')}"

            return super().column_parts(expression)

        def table_parts(self, expression: exp.Table) -> str:
            # Depending on the context, `x.y` may not resolve to the same data source as `x`.`y`, so
            # we need to make sure the correct quoting is used in each case.
            #
            # For example, if there is a CTE x that clashes with a schema name, then the former will
            # return the table y in that schema, whereas the latter will return the CTE's y column:
            #
            # - WITH x AS (SELECT [1, 2] AS y) SELECT * FROM x, `x.y`   -> cross join
            # - WITH x AS (SELECT [1, 2] AS y) SELECT * FROM x, `x`.`y` -> implicit unnest
            if expression.meta.get("quoted_table"):
                table_parts = ".".join(p.name for p in expression.parts)
                return self.sql(exp.Identifier(this=table_parts, quoted=True))

            return super().table_parts(expression)

        def timetostr_sql(self, expression: exp.TimeToStr) -> str:
            this = expression.this
            if isinstance(this, exp.TsOrDsToDatetime):
                func_name = "FORMAT_DATETIME"
            elif isinstance(this, exp.TsOrDsToTimestamp):
                func_name = "FORMAT_TIMESTAMP"
            else:
                func_name = "FORMAT_DATE"

            time_expr = (
                this
                if isinstance(this, (exp.TsOrDsToDatetime, exp.TsOrDsToTimestamp, exp.TsOrDsToDate))
                else expression
            )
            return self.func(func_name, self.format_time(expression), time_expr.this)

        def eq_sql(self, expression: exp.EQ) -> str:
            # Operands of = cannot be NULL in BigQuery
            if isinstance(expression.left, exp.Null) or isinstance(expression.right, exp.Null):
                if not isinstance(expression.parent, exp.Update):
                    return "NULL"

            return self.binary(expression, "=")

        def attimezone_sql(self, expression: exp.AtTimeZone) -> str:
            parent = expression.parent

            # BigQuery allows CAST(.. AS {STRING|TIMESTAMP} [FORMAT <fmt> [AT TIME ZONE <tz>]]).
            # Only the TIMESTAMP one should use the below conversion, when AT TIME ZONE is included.
            if not isinstance(parent, exp.Cast) or not parent.to.is_type("text"):
                return self.func(
                    "TIMESTAMP", self.func("DATETIME", expression.this, expression.args.get("zone"))
                )

            return super().attimezone_sql(expression)

        def trycast_sql(self, expression: exp.TryCast) -> str:
            return self.cast_sql(expression, safe_prefix="SAFE_")

        def bracket_sql(self, expression: exp.Bracket) -> str:
            this = expression.this
            expressions = expression.expressions

            if len(expressions) == 1 and this and this.is_type(exp.DataType.Type.STRUCT):
                arg = expressions[0]
                if arg.type is None:
                    from sqlglot.optimizer.annotate_types import annotate_types

                    arg = annotate_types(arg)

                if arg.type and arg.type.this in exp.DataType.TEXT_TYPES:
                    # BQ doesn't support bracket syntax with string values for structs
                    return f"{self.sql(this)}.{arg.name}"

            expressions_sql = self.expressions(expression, flat=True)
            offset = expression.args.get("offset")

            if offset == 0:
                expressions_sql = f"OFFSET({expressions_sql})"
            elif offset == 1:
                expressions_sql = f"ORDINAL({expressions_sql})"
            elif offset is not None:
                self.unsupported(f"Unsupported array offset: {offset}")

            if expression.args.get("safe"):
                expressions_sql = f"SAFE_{expressions_sql}"

            return f"{self.sql(this)}[{expressions_sql}]"

        def in_unnest_op(self, expression: exp.Unnest) -> str:
            return self.sql(expression)

        def version_sql(self, expression: exp.Version) -> str:
            if expression.name == "TIMESTAMP":
                expression.set("this", "SYSTEM_TIME")
            return super().version_sql(expression)

        def contains_sql(self, expression: exp.Contains) -> str:
            this = expression.this
            expr = expression.expression

            if isinstance(this, exp.Lower) and isinstance(expr, exp.Lower):
                this = this.this
                expr = expr.this

            return self.func("CONTAINS_SUBSTR", this, expr)
