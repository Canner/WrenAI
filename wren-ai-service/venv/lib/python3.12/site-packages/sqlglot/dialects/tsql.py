from __future__ import annotations

import datetime
import re
import typing as t
from functools import partial, reduce

from sqlglot import exp, generator, parser, tokens, transforms
from sqlglot.dialects.dialect import (
    Dialect,
    NormalizationStrategy,
    any_value_to_max_sql,
    date_delta_sql,
    datestrtodate_sql,
    generatedasidentitycolumnconstraint_sql,
    max_or_greatest,
    min_or_least,
    build_date_delta,
    rename_func,
    trim_sql,
    timestrtotime_sql,
)
from sqlglot.helper import seq_get
from sqlglot.parser import build_coalesce
from sqlglot.time import format_time
from sqlglot.tokens import TokenType

if t.TYPE_CHECKING:
    from sqlglot._typing import E

FULL_FORMAT_TIME_MAPPING = {
    "weekday": "%A",
    "dw": "%A",
    "w": "%A",
    "month": "%B",
    "mm": "%B",
    "m": "%B",
}

DATE_DELTA_INTERVAL = {
    "year": "year",
    "yyyy": "year",
    "yy": "year",
    "quarter": "quarter",
    "qq": "quarter",
    "q": "quarter",
    "month": "month",
    "mm": "month",
    "m": "month",
    "week": "week",
    "ww": "week",
    "wk": "week",
    "day": "day",
    "dd": "day",
    "d": "day",
}


DATE_FMT_RE = re.compile("([dD]{1,2})|([mM]{1,2})|([yY]{1,4})|([hH]{1,2})|([sS]{1,2})")

# N = Numeric, C=Currency
TRANSPILE_SAFE_NUMBER_FMT = {"N", "C"}

DEFAULT_START_DATE = datetime.date(1900, 1, 1)

BIT_TYPES = {exp.EQ, exp.NEQ, exp.Is, exp.In, exp.Select, exp.Alias}

# Unsupported options:
# - OPTIMIZE FOR ( @variable_name { UNKNOWN | = <literal_constant> } [ , ...n ] )
# - TABLE HINT
OPTIONS: parser.OPTIONS_TYPE = {
    **dict.fromkeys(
        (
            "DISABLE_OPTIMIZED_PLAN_FORCING",
            "FAST",
            "IGNORE_NONCLUSTERED_COLUMNSTORE_INDEX",
            "LABEL",
            "MAXDOP",
            "MAXRECURSION",
            "MAX_GRANT_PERCENT",
            "MIN_GRANT_PERCENT",
            "NO_PERFORMANCE_SPOOL",
            "QUERYTRACEON",
            "RECOMPILE",
        ),
        tuple(),
    ),
    "CONCAT": ("UNION",),
    "DISABLE": ("EXTERNALPUSHDOWN", "SCALEOUTEXECUTION"),
    "EXPAND": ("VIEWS",),
    "FORCE": ("EXTERNALPUSHDOWN", "ORDER", "SCALEOUTEXECUTION"),
    "HASH": ("GROUP", "JOIN", "UNION"),
    "KEEP": ("PLAN",),
    "KEEPFIXED": ("PLAN",),
    "LOOP": ("JOIN",),
    "MERGE": ("JOIN", "UNION"),
    "OPTIMIZE": (("FOR", "UNKNOWN"),),
    "ORDER": ("GROUP",),
    "PARAMETERIZATION": ("FORCED", "SIMPLE"),
    "ROBUST": ("PLAN",),
    "USE": ("PLAN",),
}

OPTIONS_THAT_REQUIRE_EQUAL = ("MAX_GRANT_PERCENT", "MIN_GRANT_PERCENT", "LABEL")


def _build_formatted_time(
    exp_class: t.Type[E], full_format_mapping: t.Optional[bool] = None
) -> t.Callable[[t.List], E]:
    def _builder(args: t.List) -> E:
        assert len(args) == 2

        return exp_class(
            this=exp.cast(args[1], exp.DataType.Type.DATETIME),
            format=exp.Literal.string(
                format_time(
                    args[0].name.lower(),
                    (
                        {**TSQL.TIME_MAPPING, **FULL_FORMAT_TIME_MAPPING}
                        if full_format_mapping
                        else TSQL.TIME_MAPPING
                    ),
                )
            ),
        )

    return _builder


def _build_format(args: t.List) -> exp.NumberToStr | exp.TimeToStr:
    this = seq_get(args, 0)
    fmt = seq_get(args, 1)
    culture = seq_get(args, 2)

    number_fmt = fmt and (fmt.name in TRANSPILE_SAFE_NUMBER_FMT or not DATE_FMT_RE.search(fmt.name))

    if number_fmt:
        return exp.NumberToStr(this=this, format=fmt, culture=culture)

    if fmt:
        fmt = exp.Literal.string(
            format_time(fmt.name, TSQL.FORMAT_TIME_MAPPING)
            if len(fmt.name) == 1
            else format_time(fmt.name, TSQL.TIME_MAPPING)
        )

    return exp.TimeToStr(this=this, format=fmt, culture=culture)


def _build_eomonth(args: t.List) -> exp.LastDay:
    date = exp.TsOrDsToDate(this=seq_get(args, 0))
    month_lag = seq_get(args, 1)

    if month_lag is None:
        this: exp.Expression = date
    else:
        unit = DATE_DELTA_INTERVAL.get("month")
        this = exp.DateAdd(this=date, expression=month_lag, unit=unit and exp.var(unit))

    return exp.LastDay(this=this)


def _build_hashbytes(args: t.List) -> exp.Expression:
    kind, data = args
    kind = kind.name.upper() if kind.is_string else ""

    if kind == "MD5":
        args.pop(0)
        return exp.MD5(this=data)
    if kind in ("SHA", "SHA1"):
        args.pop(0)
        return exp.SHA(this=data)
    if kind == "SHA2_256":
        return exp.SHA2(this=data, length=exp.Literal.number(256))
    if kind == "SHA2_512":
        return exp.SHA2(this=data, length=exp.Literal.number(512))

    return exp.func("HASHBYTES", *args)


DATEPART_ONLY_FORMATS = {"DW", "WK", "HOUR", "QUARTER"}


def _format_sql(self: TSQL.Generator, expression: exp.NumberToStr | exp.TimeToStr) -> str:
    fmt = expression.args["format"]

    if not isinstance(expression, exp.NumberToStr):
        if fmt.is_string:
            mapped_fmt = format_time(fmt.name, TSQL.INVERSE_TIME_MAPPING)

            name = (mapped_fmt or "").upper()
            if name in DATEPART_ONLY_FORMATS:
                return self.func("DATEPART", name, expression.this)

            fmt_sql = self.sql(exp.Literal.string(mapped_fmt))
        else:
            fmt_sql = self.format_time(expression) or self.sql(fmt)
    else:
        fmt_sql = self.sql(fmt)

    return self.func("FORMAT", expression.this, fmt_sql, expression.args.get("culture"))


def _string_agg_sql(self: TSQL.Generator, expression: exp.GroupConcat) -> str:
    this = expression.this
    distinct = expression.find(exp.Distinct)
    if distinct:
        # exp.Distinct can appear below an exp.Order or an exp.GroupConcat expression
        self.unsupported("T-SQL STRING_AGG doesn't support DISTINCT.")
        this = distinct.pop().expressions[0]

    order = ""
    if isinstance(expression.this, exp.Order):
        if expression.this.this:
            this = expression.this.this.pop()
        # Order has a leading space
        order = f" WITHIN GROUP ({self.sql(expression.this)[1:]})"

    separator = expression.args.get("separator") or exp.Literal.string(",")
    return f"STRING_AGG({self.format_args(this, separator)}){order}"


def _build_date_delta(
    exp_class: t.Type[E], unit_mapping: t.Optional[t.Dict[str, str]] = None
) -> t.Callable[[t.List], E]:
    def _builder(args: t.List) -> E:
        unit = seq_get(args, 0)
        if unit and unit_mapping:
            unit = exp.var(unit_mapping.get(unit.name.lower(), unit.name))

        start_date = seq_get(args, 1)
        if start_date and start_date.is_number:
            # Numeric types are valid DATETIME values
            if start_date.is_int:
                adds = DEFAULT_START_DATE + datetime.timedelta(days=int(start_date.this))
                start_date = exp.Literal.string(adds.strftime("%F"))
            else:
                # We currently don't handle float values, i.e. they're not converted to equivalent DATETIMEs.
                # This is not a problem when generating T-SQL code, it is when transpiling to other dialects.
                return exp_class(this=seq_get(args, 2), expression=start_date, unit=unit)

        return exp_class(
            this=exp.TimeStrToTime(this=seq_get(args, 2)),
            expression=exp.TimeStrToTime(this=start_date),
            unit=unit,
        )

    return _builder


def qualify_derived_table_outputs(expression: exp.Expression) -> exp.Expression:
    """Ensures all (unnamed) output columns are aliased for CTEs and Subqueries."""
    alias = expression.args.get("alias")

    if (
        isinstance(expression, (exp.CTE, exp.Subquery))
        and isinstance(alias, exp.TableAlias)
        and not alias.columns
    ):
        from sqlglot.optimizer.qualify_columns import qualify_outputs

        # We keep track of the unaliased column projection indexes instead of the expressions
        # themselves, because the latter are going to be replaced by new nodes when the aliases
        # are added and hence we won't be able to reach these newly added Alias parents
        query = expression.this
        unaliased_column_indexes = (
            i for i, c in enumerate(query.selects) if isinstance(c, exp.Column) and not c.alias
        )

        qualify_outputs(query)

        # Preserve the quoting information of columns for newly added Alias nodes
        query_selects = query.selects
        for select_index in unaliased_column_indexes:
            alias = query_selects[select_index]
            column = alias.this
            if isinstance(column.this, exp.Identifier):
                alias.args["alias"].set("quoted", column.this.quoted)

    return expression


# https://learn.microsoft.com/en-us/sql/t-sql/functions/datetimefromparts-transact-sql?view=sql-server-ver16#syntax
def _build_datetimefromparts(args: t.List) -> exp.TimestampFromParts:
    return exp.TimestampFromParts(
        year=seq_get(args, 0),
        month=seq_get(args, 1),
        day=seq_get(args, 2),
        hour=seq_get(args, 3),
        min=seq_get(args, 4),
        sec=seq_get(args, 5),
        milli=seq_get(args, 6),
    )


# https://learn.microsoft.com/en-us/sql/t-sql/functions/timefromparts-transact-sql?view=sql-server-ver16#syntax
def _build_timefromparts(args: t.List) -> exp.TimeFromParts:
    return exp.TimeFromParts(
        hour=seq_get(args, 0),
        min=seq_get(args, 1),
        sec=seq_get(args, 2),
        fractions=seq_get(args, 3),
        precision=seq_get(args, 4),
    )


def _build_with_arg_as_text(
    klass: t.Type[exp.Expression],
) -> t.Callable[[t.List[exp.Expression]], exp.Expression]:
    def _parse(args: t.List[exp.Expression]) -> exp.Expression:
        this = seq_get(args, 0)

        if this and not this.is_string:
            this = exp.cast(this, exp.DataType.Type.TEXT)

        expression = seq_get(args, 1)
        kwargs = {"this": this}

        if expression:
            kwargs["expression"] = expression

        return klass(**kwargs)

    return _parse


# https://learn.microsoft.com/en-us/sql/t-sql/functions/parsename-transact-sql?view=sql-server-ver16
def _build_parsename(args: t.List) -> exp.SplitPart | exp.Anonymous:
    # PARSENAME(...) will be stored into exp.SplitPart if:
    # - All args are literals
    # - The part index (2nd arg) is <= 4 (max valid value, otherwise TSQL returns NULL)
    if len(args) == 2 and all(isinstance(arg, exp.Literal) for arg in args):
        this = args[0]
        part_index = args[1]
        split_count = len(this.name.split("."))
        if split_count <= 4:
            return exp.SplitPart(
                this=this,
                delimiter=exp.Literal.string("."),
                part_index=exp.Literal.number(split_count + 1 - part_index.to_py()),
            )

    return exp.Anonymous(this="PARSENAME", expressions=args)


def _build_json_query(args: t.List, dialect: Dialect) -> exp.JSONExtract:
    if len(args) == 1:
        # The default value for path is '$'. As a result, if you don't provide a
        # value for path, JSON_QUERY returns the input expression.
        args.append(exp.Literal.string("$"))

    return parser.build_extract_json_with_path(exp.JSONExtract)(args, dialect)


def _json_extract_sql(
    self: TSQL.Generator, expression: exp.JSONExtract | exp.JSONExtractScalar
) -> str:
    json_query = self.func("JSON_QUERY", expression.this, expression.expression)
    json_value = self.func("JSON_VALUE", expression.this, expression.expression)
    return self.func("ISNULL", json_query, json_value)


def _timestrtotime_sql(self: TSQL.Generator, expression: exp.TimeStrToTime):
    sql = timestrtotime_sql(self, expression)
    if expression.args.get("zone"):
        # If there is a timezone, produce an expression like:
        # CAST('2020-01-01 12:13:14-08:00' AS DATETIMEOFFSET) AT TIME ZONE 'UTC'
        # If you dont have AT TIME ZONE 'UTC', wrapping that expression in another cast back to DATETIME2 just drops the timezone information
        return self.sql(exp.AtTimeZone(this=sql, zone=exp.Literal.string("UTC")))
    return sql


class TSQL(Dialect):
    SUPPORTS_SEMI_ANTI_JOIN = False
    LOG_BASE_FIRST = False
    TYPED_DIVISION = True
    CONCAT_COALESCE = True
    NORMALIZATION_STRATEGY = NormalizationStrategy.CASE_INSENSITIVE

    TIME_FORMAT = "'yyyy-mm-dd hh:mm:ss'"

    TIME_MAPPING = {
        "year": "%Y",
        "dayofyear": "%j",
        "day": "%d",
        "dy": "%d",
        "y": "%Y",
        "week": "%W",
        "ww": "%W",
        "wk": "%W",
        "hour": "%h",
        "hh": "%I",
        "minute": "%M",
        "mi": "%M",
        "n": "%M",
        "second": "%S",
        "ss": "%S",
        "s": "%-S",
        "millisecond": "%f",
        "ms": "%f",
        "weekday": "%w",
        "dw": "%w",
        "month": "%m",
        "mm": "%M",
        "m": "%-M",
        "Y": "%Y",
        "YYYY": "%Y",
        "YY": "%y",
        "MMMM": "%B",
        "MMM": "%b",
        "MM": "%m",
        "M": "%-m",
        "dddd": "%A",
        "dd": "%d",
        "d": "%-d",
        "HH": "%H",
        "H": "%-H",
        "h": "%-I",
        "ffffff": "%f",
        "yyyy": "%Y",
        "yy": "%y",
    }

    CONVERT_FORMAT_MAPPING = {
        "0": "%b %d %Y %-I:%M%p",
        "1": "%m/%d/%y",
        "2": "%y.%m.%d",
        "3": "%d/%m/%y",
        "4": "%d.%m.%y",
        "5": "%d-%m-%y",
        "6": "%d %b %y",
        "7": "%b %d, %y",
        "8": "%H:%M:%S",
        "9": "%b %d %Y %-I:%M:%S:%f%p",
        "10": "mm-dd-yy",
        "11": "yy/mm/dd",
        "12": "yymmdd",
        "13": "%d %b %Y %H:%M:ss:%f",
        "14": "%H:%M:%S:%f",
        "20": "%Y-%m-%d %H:%M:%S",
        "21": "%Y-%m-%d %H:%M:%S.%f",
        "22": "%m/%d/%y %-I:%M:%S %p",
        "23": "%Y-%m-%d",
        "24": "%H:%M:%S",
        "25": "%Y-%m-%d %H:%M:%S.%f",
        "100": "%b %d %Y %-I:%M%p",
        "101": "%m/%d/%Y",
        "102": "%Y.%m.%d",
        "103": "%d/%m/%Y",
        "104": "%d.%m.%Y",
        "105": "%d-%m-%Y",
        "106": "%d %b %Y",
        "107": "%b %d, %Y",
        "108": "%H:%M:%S",
        "109": "%b %d %Y %-I:%M:%S:%f%p",
        "110": "%m-%d-%Y",
        "111": "%Y/%m/%d",
        "112": "%Y%m%d",
        "113": "%d %b %Y %H:%M:%S:%f",
        "114": "%H:%M:%S:%f",
        "120": "%Y-%m-%d %H:%M:%S",
        "121": "%Y-%m-%d %H:%M:%S.%f",
    }

    FORMAT_TIME_MAPPING = {
        "y": "%B %Y",
        "d": "%m/%d/%Y",
        "H": "%-H",
        "h": "%-I",
        "s": "%Y-%m-%d %H:%M:%S",
        "D": "%A,%B,%Y",
        "f": "%A,%B,%Y %-I:%M %p",
        "F": "%A,%B,%Y %-I:%M:%S %p",
        "g": "%m/%d/%Y %-I:%M %p",
        "G": "%m/%d/%Y %-I:%M:%S %p",
        "M": "%B %-d",
        "m": "%B %-d",
        "O": "%Y-%m-%dT%H:%M:%S",
        "u": "%Y-%M-%D %H:%M:%S%z",
        "U": "%A, %B %D, %Y %H:%M:%S%z",
        "T": "%-I:%M:%S %p",
        "t": "%-I:%M",
        "Y": "%a %Y",
    }

    class Tokenizer(tokens.Tokenizer):
        IDENTIFIERS = [("[", "]"), '"']
        QUOTES = ["'", '"']
        HEX_STRINGS = [("0x", ""), ("0X", "")]
        VAR_SINGLE_TOKENS = {"@", "$", "#"}

        KEYWORDS = {
            **tokens.Tokenizer.KEYWORDS,
            "CLUSTERED INDEX": TokenType.INDEX,
            "DATETIME2": TokenType.DATETIME,
            "DATETIMEOFFSET": TokenType.TIMESTAMPTZ,
            "DECLARE": TokenType.DECLARE,
            "EXEC": TokenType.COMMAND,
            "FOR SYSTEM_TIME": TokenType.TIMESTAMP_SNAPSHOT,
            "IMAGE": TokenType.IMAGE,
            "MONEY": TokenType.MONEY,
            "NONCLUSTERED INDEX": TokenType.INDEX,
            "NTEXT": TokenType.TEXT,
            "OPTION": TokenType.OPTION,
            "OUTPUT": TokenType.RETURNING,
            "PRINT": TokenType.COMMAND,
            "PROC": TokenType.PROCEDURE,
            "REAL": TokenType.FLOAT,
            "ROWVERSION": TokenType.ROWVERSION,
            "SMALLDATETIME": TokenType.DATETIME,
            "SMALLMONEY": TokenType.SMALLMONEY,
            "SQL_VARIANT": TokenType.VARIANT,
            "SYSTEM_USER": TokenType.CURRENT_USER,
            "TOP": TokenType.TOP,
            "TIMESTAMP": TokenType.ROWVERSION,
            "TINYINT": TokenType.UTINYINT,
            "UNIQUEIDENTIFIER": TokenType.UNIQUEIDENTIFIER,
            "UPDATE STATISTICS": TokenType.COMMAND,
            "XML": TokenType.XML,
        }
        KEYWORDS.pop("/*+")

        COMMANDS = {*tokens.Tokenizer.COMMANDS, TokenType.END}

    class Parser(parser.Parser):
        SET_REQUIRES_ASSIGNMENT_DELIMITER = False
        LOG_DEFAULTS_TO_LN = True
        ALTER_TABLE_ADD_REQUIRED_FOR_EACH_COLUMN = False
        STRING_ALIASES = True
        NO_PAREN_IF_COMMANDS = False

        QUERY_MODIFIER_PARSERS = {
            **parser.Parser.QUERY_MODIFIER_PARSERS,
            TokenType.OPTION: lambda self: ("options", self._parse_options()),
        }

        FUNCTIONS = {
            **parser.Parser.FUNCTIONS,
            "CHARINDEX": lambda args: exp.StrPosition(
                this=seq_get(args, 1),
                substr=seq_get(args, 0),
                position=seq_get(args, 2),
            ),
            "COUNT": lambda args: exp.Count(
                this=seq_get(args, 0), expressions=args[1:], big_int=False
            ),
            "COUNT_BIG": lambda args: exp.Count(
                this=seq_get(args, 0), expressions=args[1:], big_int=True
            ),
            "DATEADD": build_date_delta(exp.DateAdd, unit_mapping=DATE_DELTA_INTERVAL),
            "DATEDIFF": _build_date_delta(exp.DateDiff, unit_mapping=DATE_DELTA_INTERVAL),
            "DATENAME": _build_formatted_time(exp.TimeToStr, full_format_mapping=True),
            "DATEPART": _build_formatted_time(exp.TimeToStr),
            "DATETIMEFROMPARTS": _build_datetimefromparts,
            "EOMONTH": _build_eomonth,
            "FORMAT": _build_format,
            "GETDATE": exp.CurrentTimestamp.from_arg_list,
            "HASHBYTES": _build_hashbytes,
            "ISNULL": build_coalesce,
            "JSON_QUERY": _build_json_query,
            "JSON_VALUE": parser.build_extract_json_with_path(exp.JSONExtractScalar),
            "LEN": _build_with_arg_as_text(exp.Length),
            "LEFT": _build_with_arg_as_text(exp.Left),
            "RIGHT": _build_with_arg_as_text(exp.Right),
            "PARSENAME": _build_parsename,
            "REPLICATE": exp.Repeat.from_arg_list,
            "SQUARE": lambda args: exp.Pow(this=seq_get(args, 0), expression=exp.Literal.number(2)),
            "SYSDATETIME": exp.CurrentTimestamp.from_arg_list,
            "SUSER_NAME": exp.CurrentUser.from_arg_list,
            "SUSER_SNAME": exp.CurrentUser.from_arg_list,
            "SYSTEM_USER": exp.CurrentUser.from_arg_list,
            "TIMEFROMPARTS": _build_timefromparts,
        }

        JOIN_HINTS = {"LOOP", "HASH", "MERGE", "REMOTE"}

        PROCEDURE_OPTIONS = dict.fromkeys(
            ("ENCRYPTION", "RECOMPILE", "SCHEMABINDING", "NATIVE_COMPILATION", "EXECUTE"), tuple()
        )

        RETURNS_TABLE_TOKENS = parser.Parser.ID_VAR_TOKENS - {
            TokenType.TABLE,
            *parser.Parser.TYPE_TOKENS,
        }

        STATEMENT_PARSERS = {
            **parser.Parser.STATEMENT_PARSERS,
            TokenType.DECLARE: lambda self: self._parse_declare(),
        }

        RANGE_PARSERS = {
            **parser.Parser.RANGE_PARSERS,
            TokenType.DCOLON: lambda self, this: self.expression(
                exp.ScopeResolution,
                this=this,
                expression=self._parse_function() or self._parse_var(any_token=True),
            ),
        }

        NO_PAREN_FUNCTION_PARSERS = {
            **parser.Parser.NO_PAREN_FUNCTION_PARSERS,
            "NEXT": lambda self: self._parse_next_value_for(),
        }

        # The DCOLON (::) operator serves as a scope resolution (exp.ScopeResolution) operator in T-SQL
        COLUMN_OPERATORS = {
            **parser.Parser.COLUMN_OPERATORS,
            TokenType.DCOLON: lambda self, this, to: self.expression(exp.Cast, this=this, to=to)
            if isinstance(to, exp.DataType) and to.this != exp.DataType.Type.USERDEFINED
            else self.expression(exp.ScopeResolution, this=this, expression=to),
        }

        def _parse_dcolon(self) -> t.Optional[exp.Expression]:
            # We want to use _parse_types() if the first token after :: is a known type,
            # otherwise we could parse something like x::varchar(max) into a function
            if self._match_set(self.TYPE_TOKENS, advance=False):
                return self._parse_types()

            return self._parse_function() or self._parse_types()

        def _parse_options(self) -> t.Optional[t.List[exp.Expression]]:
            if not self._match(TokenType.OPTION):
                return None

            def _parse_option() -> t.Optional[exp.Expression]:
                option = self._parse_var_from_options(OPTIONS)
                if not option:
                    return None

                self._match(TokenType.EQ)
                return self.expression(
                    exp.QueryOption, this=option, expression=self._parse_primary_or_var()
                )

            return self._parse_wrapped_csv(_parse_option)

        def _parse_projections(self) -> t.List[exp.Expression]:
            """
            T-SQL supports the syntax alias = expression in the SELECT's projection list,
            so we transform all parsed Selects to convert their EQ projections into Aliases.

            See: https://learn.microsoft.com/en-us/sql/t-sql/queries/select-clause-transact-sql?view=sql-server-ver16#syntax
            """
            return [
                (
                    exp.alias_(projection.expression, projection.this.this, copy=False)
                    if isinstance(projection, exp.EQ) and isinstance(projection.this, exp.Column)
                    else projection
                )
                for projection in super()._parse_projections()
            ]

        def _parse_commit_or_rollback(self) -> exp.Commit | exp.Rollback:
            """Applies to SQL Server and Azure SQL Database
            COMMIT [ { TRAN | TRANSACTION }
                [ transaction_name | @tran_name_variable ] ]
                [ WITH ( DELAYED_DURABILITY = { OFF | ON } ) ]

            ROLLBACK { TRAN | TRANSACTION }
                [ transaction_name | @tran_name_variable
                | savepoint_name | @savepoint_variable ]
            """
            rollback = self._prev.token_type == TokenType.ROLLBACK

            self._match_texts(("TRAN", "TRANSACTION"))
            this = self._parse_id_var()

            if rollback:
                return self.expression(exp.Rollback, this=this)

            durability = None
            if self._match_pair(TokenType.WITH, TokenType.L_PAREN):
                self._match_text_seq("DELAYED_DURABILITY")
                self._match(TokenType.EQ)

                if self._match_text_seq("OFF"):
                    durability = False
                else:
                    self._match(TokenType.ON)
                    durability = True

                self._match_r_paren()

            return self.expression(exp.Commit, this=this, durability=durability)

        def _parse_transaction(self) -> exp.Transaction | exp.Command:
            """Applies to SQL Server and Azure SQL Database
            BEGIN { TRAN | TRANSACTION }
            [ { transaction_name | @tran_name_variable }
            [ WITH MARK [ 'description' ] ]
            ]
            """
            if self._match_texts(("TRAN", "TRANSACTION")):
                transaction = self.expression(exp.Transaction, this=self._parse_id_var())
                if self._match_text_seq("WITH", "MARK"):
                    transaction.set("mark", self._parse_string())

                return transaction

            return self._parse_as_command(self._prev)

        def _parse_returns(self) -> exp.ReturnsProperty:
            table = self._parse_id_var(any_token=False, tokens=self.RETURNS_TABLE_TOKENS)
            returns = super()._parse_returns()
            returns.set("table", table)
            return returns

        def _parse_convert(
            self, strict: bool, safe: t.Optional[bool] = None
        ) -> t.Optional[exp.Expression]:
            this = self._parse_types()
            self._match(TokenType.COMMA)
            args = [this, *self._parse_csv(self._parse_assignment)]
            convert = exp.Convert.from_arg_list(args)
            convert.set("safe", safe)
            convert.set("strict", strict)
            return convert

        def _parse_user_defined_function(
            self, kind: t.Optional[TokenType] = None
        ) -> t.Optional[exp.Expression]:
            this = super()._parse_user_defined_function(kind=kind)

            if (
                kind == TokenType.FUNCTION
                or isinstance(this, exp.UserDefinedFunction)
                or self._match(TokenType.ALIAS, advance=False)
            ):
                return this

            if not self._match(TokenType.WITH, advance=False):
                expressions = self._parse_csv(self._parse_function_parameter)
            else:
                expressions = None

            return self.expression(exp.UserDefinedFunction, this=this, expressions=expressions)

        def _parse_id_var(
            self,
            any_token: bool = True,
            tokens: t.Optional[t.Collection[TokenType]] = None,
        ) -> t.Optional[exp.Expression]:
            is_temporary = self._match(TokenType.HASH)
            is_global = is_temporary and self._match(TokenType.HASH)

            this = super()._parse_id_var(any_token=any_token, tokens=tokens)
            if this:
                if is_global:
                    this.set("global", True)
                elif is_temporary:
                    this.set("temporary", True)

            return this

        def _parse_create(self) -> exp.Create | exp.Command:
            create = super()._parse_create()

            if isinstance(create, exp.Create):
                table = create.this.this if isinstance(create.this, exp.Schema) else create.this
                if isinstance(table, exp.Table) and table.this.args.get("temporary"):
                    if not create.args.get("properties"):
                        create.set("properties", exp.Properties(expressions=[]))

                    create.args["properties"].append("expressions", exp.TemporaryProperty())

            return create

        def _parse_if(self) -> t.Optional[exp.Expression]:
            index = self._index

            if self._match_text_seq("OBJECT_ID"):
                self._parse_wrapped_csv(self._parse_string)
                if self._match_text_seq("IS", "NOT", "NULL") and self._match(TokenType.DROP):
                    return self._parse_drop(exists=True)
                self._retreat(index)

            return super()._parse_if()

        def _parse_unique(self) -> exp.UniqueColumnConstraint:
            if self._match_texts(("CLUSTERED", "NONCLUSTERED")):
                this = self.CONSTRAINT_PARSERS[self._prev.text.upper()](self)
            else:
                this = self._parse_schema(self._parse_id_var(any_token=False))

            return self.expression(exp.UniqueColumnConstraint, this=this)

        def _parse_partition(self) -> t.Optional[exp.Partition]:
            if not self._match_text_seq("WITH", "(", "PARTITIONS"):
                return None

            def parse_range():
                low = self._parse_bitwise()
                high = self._parse_bitwise() if self._match_text_seq("TO") else None

                return (
                    self.expression(exp.PartitionRange, this=low, expression=high) if high else low
                )

            partition = self.expression(
                exp.Partition, expressions=self._parse_wrapped_csv(parse_range)
            )

            self._match_r_paren()

            return partition

        def _parse_declare(self) -> exp.Declare | exp.Command:
            index = self._index
            expressions = self._try_parse(partial(self._parse_csv, self._parse_declareitem))

            if not expressions or self._curr:
                self._retreat(index)
                return self._parse_as_command(self._prev)

            return self.expression(exp.Declare, expressions=expressions)

        def _parse_declareitem(self) -> t.Optional[exp.DeclareItem]:
            var = self._parse_id_var()
            if not var:
                return None

            value = None
            self._match(TokenType.ALIAS)
            if self._match(TokenType.TABLE):
                data_type = self._parse_schema()
            else:
                data_type = self._parse_types()
                if self._match(TokenType.EQ):
                    value = self._parse_bitwise()

            return self.expression(exp.DeclareItem, this=var, kind=data_type, default=value)

    class Generator(generator.Generator):
        LIMIT_IS_TOP = True
        QUERY_HINTS = False
        RETURNING_END = False
        NVL2_SUPPORTED = False
        ALTER_TABLE_INCLUDE_COLUMN_KEYWORD = False
        LIMIT_FETCH = "FETCH"
        COMPUTED_COLUMN_WITH_TYPE = False
        CTE_RECURSIVE_KEYWORD_REQUIRED = False
        ENSURE_BOOLS = True
        NULL_ORDERING_SUPPORTED = None
        SUPPORTS_SINGLE_ARG_CONCAT = False
        TABLESAMPLE_SEED_KEYWORD = "REPEATABLE"
        SUPPORTS_SELECT_INTO = True
        JSON_PATH_BRACKETED_KEY_SUPPORTED = False
        SUPPORTS_TO_NUMBER = False
        SET_OP_MODIFIERS = False
        COPY_PARAMS_EQ_REQUIRED = True
        PARSE_JSON_NAME = None
        EXCEPT_INTERSECT_SUPPORT_ALL_CLAUSE = False

        EXPRESSIONS_WITHOUT_NESTED_CTES = {
            exp.Create,
            exp.Delete,
            exp.Insert,
            exp.Intersect,
            exp.Except,
            exp.Merge,
            exp.Select,
            exp.Subquery,
            exp.Union,
            exp.Update,
        }

        SUPPORTED_JSON_PATH_PARTS = {
            exp.JSONPathKey,
            exp.JSONPathRoot,
            exp.JSONPathSubscript,
        }

        TYPE_MAPPING = {
            **generator.Generator.TYPE_MAPPING,
            exp.DataType.Type.BOOLEAN: "BIT",
            exp.DataType.Type.DECIMAL: "NUMERIC",
            exp.DataType.Type.DATETIME: "DATETIME2",
            exp.DataType.Type.DOUBLE: "FLOAT",
            exp.DataType.Type.INT: "INTEGER",
            exp.DataType.Type.ROWVERSION: "ROWVERSION",
            exp.DataType.Type.TEXT: "VARCHAR(MAX)",
            exp.DataType.Type.TIMESTAMP: "DATETIME2",
            exp.DataType.Type.TIMESTAMPTZ: "DATETIMEOFFSET",
            exp.DataType.Type.UTINYINT: "TINYINT",
            exp.DataType.Type.VARIANT: "SQL_VARIANT",
        }

        TYPE_MAPPING.pop(exp.DataType.Type.NCHAR)
        TYPE_MAPPING.pop(exp.DataType.Type.NVARCHAR)

        TRANSFORMS = {
            **generator.Generator.TRANSFORMS,
            exp.AnyValue: any_value_to_max_sql,
            exp.ArrayToString: rename_func("STRING_AGG"),
            exp.AutoIncrementColumnConstraint: lambda *_: "IDENTITY",
            exp.DateAdd: date_delta_sql("DATEADD"),
            exp.DateDiff: date_delta_sql("DATEDIFF"),
            exp.CTE: transforms.preprocess([qualify_derived_table_outputs]),
            exp.CurrentDate: rename_func("GETDATE"),
            exp.CurrentTimestamp: rename_func("GETDATE"),
            exp.DateStrToDate: datestrtodate_sql,
            exp.Extract: rename_func("DATEPART"),
            exp.GeneratedAsIdentityColumnConstraint: generatedasidentitycolumnconstraint_sql,
            exp.GroupConcat: _string_agg_sql,
            exp.If: rename_func("IIF"),
            exp.JSONExtract: _json_extract_sql,
            exp.JSONExtractScalar: _json_extract_sql,
            exp.LastDay: lambda self, e: self.func("EOMONTH", e.this),
            exp.Ln: rename_func("LOG"),
            exp.Max: max_or_greatest,
            exp.MD5: lambda self, e: self.func("HASHBYTES", exp.Literal.string("MD5"), e.this),
            exp.Min: min_or_least,
            exp.NumberToStr: _format_sql,
            exp.Repeat: rename_func("REPLICATE"),
            exp.Select: transforms.preprocess(
                [
                    transforms.eliminate_distinct_on,
                    transforms.eliminate_semi_and_anti_joins,
                    transforms.eliminate_qualify,
                    transforms.unnest_generate_date_array_using_recursive_cte,
                ]
            ),
            exp.Stddev: rename_func("STDEV"),
            exp.StrPosition: lambda self, e: self.func(
                "CHARINDEX", e.args.get("substr"), e.this, e.args.get("position")
            ),
            exp.Subquery: transforms.preprocess([qualify_derived_table_outputs]),
            exp.SHA: lambda self, e: self.func("HASHBYTES", exp.Literal.string("SHA1"), e.this),
            exp.SHA2: lambda self, e: self.func(
                "HASHBYTES", exp.Literal.string(f"SHA2_{e.args.get('length', 256)}"), e.this
            ),
            exp.TemporaryProperty: lambda self, e: "",
            exp.TimeStrToTime: _timestrtotime_sql,
            exp.TimeToStr: _format_sql,
            exp.Trim: trim_sql,
            exp.TsOrDsAdd: date_delta_sql("DATEADD", cast=True),
            exp.TsOrDsDiff: date_delta_sql("DATEDIFF"),
        }

        TRANSFORMS.pop(exp.ReturnsProperty)

        PROPERTIES_LOCATION = {
            **generator.Generator.PROPERTIES_LOCATION,
            exp.VolatileProperty: exp.Properties.Location.UNSUPPORTED,
        }

        def scope_resolution(self, rhs: str, scope_name: str) -> str:
            return f"{scope_name}::{rhs}"

        def select_sql(self, expression: exp.Select) -> str:
            if expression.args.get("offset"):
                if not expression.args.get("order"):
                    # ORDER BY is required in order to use OFFSET in a query, so we use
                    # a noop order by, since we don't really care about the order.
                    # See: https://www.microsoftpressstore.com/articles/article.aspx?p=2314819
                    expression.order_by(exp.select(exp.null()).subquery(), copy=False)

                limit = expression.args.get("limit")
                if isinstance(limit, exp.Limit):
                    # TOP and OFFSET can't be combined, we need use FETCH instead of TOP
                    # we replace here because otherwise TOP would be generated in select_sql
                    limit.replace(exp.Fetch(direction="FIRST", count=limit.expression))

            return super().select_sql(expression)

        def convert_sql(self, expression: exp.Convert) -> str:
            name = "TRY_CONVERT" if expression.args.get("safe") else "CONVERT"
            return self.func(
                name, expression.this, expression.expression, expression.args.get("style")
            )

        def queryoption_sql(self, expression: exp.QueryOption) -> str:
            option = self.sql(expression, "this")
            value = self.sql(expression, "expression")
            if value:
                optional_equal_sign = "= " if option in OPTIONS_THAT_REQUIRE_EQUAL else ""
                return f"{option} {optional_equal_sign}{value}"
            return option

        def lateral_op(self, expression: exp.Lateral) -> str:
            cross_apply = expression.args.get("cross_apply")
            if cross_apply is True:
                return "CROSS APPLY"
            if cross_apply is False:
                return "OUTER APPLY"

            # TODO: perhaps we can check if the parent is a Join and transpile it appropriately
            self.unsupported("LATERAL clause is not supported.")
            return "LATERAL"

        def splitpart_sql(self: TSQL.Generator, expression: exp.SplitPart) -> str:
            this = expression.this
            split_count = len(this.name.split("."))
            delimiter = expression.args.get("delimiter")
            part_index = expression.args.get("part_index")

            if (
                not all(isinstance(arg, exp.Literal) for arg in (this, delimiter, part_index))
                or (delimiter and delimiter.name != ".")
                or not part_index
                or split_count > 4
            ):
                self.unsupported(
                    "SPLIT_PART can be transpiled to PARSENAME only for '.' delimiter and literal values"
                )
                return ""

            return self.func(
                "PARSENAME", this, exp.Literal.number(split_count + 1 - part_index.to_py())
            )

        def timefromparts_sql(self, expression: exp.TimeFromParts) -> str:
            nano = expression.args.get("nano")
            if nano is not None:
                nano.pop()
                self.unsupported("Specifying nanoseconds is not supported in TIMEFROMPARTS.")

            if expression.args.get("fractions") is None:
                expression.set("fractions", exp.Literal.number(0))
            if expression.args.get("precision") is None:
                expression.set("precision", exp.Literal.number(0))

            return rename_func("TIMEFROMPARTS")(self, expression)

        def timestampfromparts_sql(self, expression: exp.TimestampFromParts) -> str:
            zone = expression.args.get("zone")
            if zone is not None:
                zone.pop()
                self.unsupported("Time zone is not supported in DATETIMEFROMPARTS.")

            nano = expression.args.get("nano")
            if nano is not None:
                nano.pop()
                self.unsupported("Specifying nanoseconds is not supported in DATETIMEFROMPARTS.")

            if expression.args.get("milli") is None:
                expression.set("milli", exp.Literal.number(0))

            return rename_func("DATETIMEFROMPARTS")(self, expression)

        def setitem_sql(self, expression: exp.SetItem) -> str:
            this = expression.this
            if isinstance(this, exp.EQ) and not isinstance(this.left, exp.Parameter):
                # T-SQL does not use '=' in SET command, except when the LHS is a variable.
                return f"{self.sql(this.left)} {self.sql(this.right)}"

            return super().setitem_sql(expression)

        def boolean_sql(self, expression: exp.Boolean) -> str:
            if type(expression.parent) in BIT_TYPES or isinstance(
                expression.find_ancestor(exp.Values, exp.Select), exp.Values
            ):
                return "1" if expression.this else "0"

            return "(1 = 1)" if expression.this else "(1 = 0)"

        def is_sql(self, expression: exp.Is) -> str:
            if isinstance(expression.expression, exp.Boolean):
                return self.binary(expression, "=")
            return self.binary(expression, "IS")

        def createable_sql(self, expression: exp.Create, locations: t.DefaultDict) -> str:
            sql = self.sql(expression, "this")
            properties = expression.args.get("properties")

            if sql[:1] != "#" and any(
                isinstance(prop, exp.TemporaryProperty)
                for prop in (properties.expressions if properties else [])
            ):
                sql = f"[#{sql[1:]}" if sql.startswith("[") else f"#{sql}"

            return sql

        def create_sql(self, expression: exp.Create) -> str:
            kind = expression.kind
            exists = expression.args.pop("exists", None)

            like_property = expression.find(exp.LikeProperty)
            if like_property:
                ctas_expression = like_property.this
            else:
                ctas_expression = expression.expression

            if kind == "VIEW":
                expression.this.set("catalog", None)
                with_ = expression.args.get("with")
                if ctas_expression and with_:
                    # We've already preprocessed the Create expression to bubble up any nested CTEs,
                    # but CREATE VIEW actually requires the WITH clause to come after it so we need
                    # to amend the AST by moving the CTEs to the CREATE VIEW statement's query.
                    ctas_expression.set("with", with_.pop())

            sql = super().create_sql(expression)

            table = expression.find(exp.Table)

            # Convert CTAS statement to SELECT .. INTO ..
            if kind == "TABLE" and ctas_expression:
                if isinstance(ctas_expression, exp.UNWRAPPED_QUERIES):
                    ctas_expression = ctas_expression.subquery()

                select_into = exp.select("*").from_(exp.alias_(ctas_expression, "temp", table=True))
                select_into.set("into", exp.Into(this=table))

                if like_property:
                    select_into.limit(0, copy=False)

                sql = self.sql(select_into)

            if exists:
                identifier = self.sql(exp.Literal.string(exp.table_name(table) if table else ""))
                sql_with_ctes = self.prepend_ctes(expression, sql)
                sql_literal = self.sql(exp.Literal.string(sql_with_ctes))
                if kind == "SCHEMA":
                    return f"""IF NOT EXISTS (SELECT * FROM information_schema.schemata WHERE schema_name = {identifier}) EXEC({sql_literal})"""
                elif kind == "TABLE":
                    assert table
                    where = exp.and_(
                        exp.column("table_name").eq(table.name),
                        exp.column("table_schema").eq(table.db) if table.db else None,
                        exp.column("table_catalog").eq(table.catalog) if table.catalog else None,
                    )
                    return f"""IF NOT EXISTS (SELECT * FROM information_schema.tables WHERE {where}) EXEC({sql_literal})"""
                elif kind == "INDEX":
                    index = self.sql(exp.Literal.string(expression.this.text("this")))
                    return f"""IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = object_id({identifier}) AND name = {index}) EXEC({sql_literal})"""
            elif expression.args.get("replace"):
                sql = sql.replace("CREATE OR REPLACE ", "CREATE OR ALTER ", 1)

            return self.prepend_ctes(expression, sql)

        def count_sql(self, expression: exp.Count) -> str:
            func_name = "COUNT_BIG" if expression.args.get("big_int") else "COUNT"
            return rename_func(func_name)(self, expression)

        def offset_sql(self, expression: exp.Offset) -> str:
            return f"{super().offset_sql(expression)} ROWS"

        def version_sql(self, expression: exp.Version) -> str:
            name = "SYSTEM_TIME" if expression.name == "TIMESTAMP" else expression.name
            this = f"FOR {name}"
            expr = expression.expression
            kind = expression.text("kind")
            if kind in ("FROM", "BETWEEN"):
                args = expr.expressions
                sep = "TO" if kind == "FROM" else "AND"
                expr_sql = f"{self.sql(seq_get(args, 0))} {sep} {self.sql(seq_get(args, 1))}"
            else:
                expr_sql = self.sql(expr)

            expr_sql = f" {expr_sql}" if expr_sql else ""
            return f"{this} {kind}{expr_sql}"

        def returnsproperty_sql(self, expression: exp.ReturnsProperty) -> str:
            table = expression.args.get("table")
            table = f"{table} " if table else ""
            return f"RETURNS {table}{self.sql(expression, 'this')}"

        def returning_sql(self, expression: exp.Returning) -> str:
            into = self.sql(expression, "into")
            into = self.seg(f"INTO {into}") if into else ""
            return f"{self.seg('OUTPUT')} {self.expressions(expression, flat=True)}{into}"

        def transaction_sql(self, expression: exp.Transaction) -> str:
            this = self.sql(expression, "this")
            this = f" {this}" if this else ""
            mark = self.sql(expression, "mark")
            mark = f" WITH MARK {mark}" if mark else ""
            return f"BEGIN TRANSACTION{this}{mark}"

        def commit_sql(self, expression: exp.Commit) -> str:
            this = self.sql(expression, "this")
            this = f" {this}" if this else ""
            durability = expression.args.get("durability")
            durability = (
                f" WITH (DELAYED_DURABILITY = {'ON' if durability else 'OFF'})"
                if durability is not None
                else ""
            )
            return f"COMMIT TRANSACTION{this}{durability}"

        def rollback_sql(self, expression: exp.Rollback) -> str:
            this = self.sql(expression, "this")
            this = f" {this}" if this else ""
            return f"ROLLBACK TRANSACTION{this}"

        def identifier_sql(self, expression: exp.Identifier) -> str:
            identifier = super().identifier_sql(expression)

            if expression.args.get("global"):
                identifier = f"##{identifier}"
            elif expression.args.get("temporary"):
                identifier = f"#{identifier}"

            return identifier

        def constraint_sql(self, expression: exp.Constraint) -> str:
            this = self.sql(expression, "this")
            expressions = self.expressions(expression, flat=True, sep=" ")
            return f"CONSTRAINT {this} {expressions}"

        def length_sql(self, expression: exp.Length) -> str:
            return self._uncast_text(expression, "LEN")

        def right_sql(self, expression: exp.Right) -> str:
            return self._uncast_text(expression, "RIGHT")

        def left_sql(self, expression: exp.Left) -> str:
            return self._uncast_text(expression, "LEFT")

        def _uncast_text(self, expression: exp.Expression, name: str) -> str:
            this = expression.this
            if isinstance(this, exp.Cast) and this.is_type(exp.DataType.Type.TEXT):
                this_sql = self.sql(this, "this")
            else:
                this_sql = self.sql(this)
            expression_sql = self.sql(expression, "expression")
            return self.func(name, this_sql, expression_sql if expression_sql else None)

        def partition_sql(self, expression: exp.Partition) -> str:
            return f"WITH (PARTITIONS({self.expressions(expression, flat=True)}))"

        def alter_sql(self, expression: exp.Alter) -> str:
            action = seq_get(expression.args.get("actions") or [], 0)
            if isinstance(action, exp.AlterRename):
                return f"EXEC sp_rename '{self.sql(expression.this)}', '{action.this.name}'"
            return super().alter_sql(expression)

        def drop_sql(self, expression: exp.Drop) -> str:
            if expression.args["kind"] == "VIEW":
                expression.this.set("catalog", None)
            return super().drop_sql(expression)

        def declare_sql(self, expression: exp.Declare) -> str:
            return f"DECLARE {self.expressions(expression, flat=True)}"

        def declareitem_sql(self, expression: exp.DeclareItem) -> str:
            variable = self.sql(expression, "this")
            default = self.sql(expression, "default")
            default = f" = {default}" if default else ""

            kind = self.sql(expression, "kind")
            if isinstance(expression.args.get("kind"), exp.Schema):
                kind = f"TABLE {kind}"

            return f"{variable} AS {kind}{default}"

        def options_modifier(self, expression: exp.Expression) -> str:
            options = self.expressions(expression, key="options")
            return f" OPTION{self.wrap(options)}" if options else ""

        def dpipe_sql(self, expression: exp.DPipe) -> str:
            return self.sql(
                reduce(lambda x, y: exp.Add(this=x, expression=y), expression.flatten())
            )
