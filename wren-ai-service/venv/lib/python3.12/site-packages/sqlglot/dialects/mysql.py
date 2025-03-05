from __future__ import annotations

import typing as t

from sqlglot import exp, generator, parser, tokens, transforms
from sqlglot.dialects.dialect import (
    Dialect,
    NormalizationStrategy,
    arrow_json_extract_sql,
    date_add_interval_sql,
    datestrtodate_sql,
    build_formatted_time,
    isnull_to_is_null,
    locate_to_strposition,
    max_or_greatest,
    min_or_least,
    no_ilike_sql,
    no_paren_current_date_sql,
    no_pivot_sql,
    no_tablesample_sql,
    no_trycast_sql,
    build_date_delta,
    build_date_delta_with_interval,
    rename_func,
    strposition_to_locate_sql,
    unit_to_var,
    trim_sql,
    timestrtotime_sql,
)
from sqlglot.helper import seq_get
from sqlglot.tokens import TokenType


def _show_parser(*args: t.Any, **kwargs: t.Any) -> t.Callable[[MySQL.Parser], exp.Show]:
    def _parse(self: MySQL.Parser) -> exp.Show:
        return self._parse_show_mysql(*args, **kwargs)

    return _parse


def _date_trunc_sql(self: MySQL.Generator, expression: exp.DateTrunc) -> str:
    expr = self.sql(expression, "this")
    unit = expression.text("unit").upper()

    if unit == "WEEK":
        concat = f"CONCAT(YEAR({expr}), ' ', WEEK({expr}, 1), ' 1')"
        date_format = "%Y %u %w"
    elif unit == "MONTH":
        concat = f"CONCAT(YEAR({expr}), ' ', MONTH({expr}), ' 1')"
        date_format = "%Y %c %e"
    elif unit == "QUARTER":
        concat = f"CONCAT(YEAR({expr}), ' ', QUARTER({expr}) * 3 - 2, ' 1')"
        date_format = "%Y %c %e"
    elif unit == "YEAR":
        concat = f"CONCAT(YEAR({expr}), ' 1 1')"
        date_format = "%Y %c %e"
    else:
        if unit != "DAY":
            self.unsupported(f"Unexpected interval unit: {unit}")
        return self.func("DATE", expr)

    return self.func("STR_TO_DATE", concat, f"'{date_format}'")


# All specifiers for time parts (as opposed to date parts)
# https://dev.mysql.com/doc/refman/8.0/en/date-and-time-functions.html#function_date-format
TIME_SPECIFIERS = {"f", "H", "h", "I", "i", "k", "l", "p", "r", "S", "s", "T"}


def _has_time_specifier(date_format: str) -> bool:
    i = 0
    length = len(date_format)

    while i < length:
        if date_format[i] == "%":
            i += 1
            if i < length and date_format[i] in TIME_SPECIFIERS:
                return True
        i += 1
    return False


def _str_to_date(args: t.List) -> exp.StrToDate | exp.StrToTime:
    mysql_date_format = seq_get(args, 1)
    date_format = MySQL.format_time(mysql_date_format)
    this = seq_get(args, 0)

    if mysql_date_format and _has_time_specifier(mysql_date_format.name):
        return exp.StrToTime(this=this, format=date_format)

    return exp.StrToDate(this=this, format=date_format)


def _str_to_date_sql(
    self: MySQL.Generator, expression: exp.StrToDate | exp.StrToTime | exp.TsOrDsToDate
) -> str:
    return self.func("STR_TO_DATE", expression.this, self.format_time(expression))


def _unix_to_time_sql(self: MySQL.Generator, expression: exp.UnixToTime) -> str:
    scale = expression.args.get("scale")
    timestamp = expression.this

    if scale in (None, exp.UnixToTime.SECONDS):
        return self.func("FROM_UNIXTIME", timestamp, self.format_time(expression))

    return self.func(
        "FROM_UNIXTIME",
        exp.Div(this=timestamp, expression=exp.func("POW", 10, scale)),
        self.format_time(expression),
    )


def date_add_sql(
    kind: str,
) -> t.Callable[[generator.Generator, exp.Expression], str]:
    def func(self: generator.Generator, expression: exp.Expression) -> str:
        return self.func(
            f"DATE_{kind}",
            expression.this,
            exp.Interval(this=expression.expression, unit=unit_to_var(expression)),
        )

    return func


def _ts_or_ds_to_date_sql(self: MySQL.Generator, expression: exp.TsOrDsToDate) -> str:
    time_format = expression.args.get("format")
    return _str_to_date_sql(self, expression) if time_format else self.func("DATE", expression.this)


def _remove_ts_or_ds_to_date(
    to_sql: t.Optional[t.Callable[[MySQL.Generator, exp.Expression], str]] = None,
    args: t.Tuple[str, ...] = ("this",),
) -> t.Callable[[MySQL.Generator, exp.Func], str]:
    def func(self: MySQL.Generator, expression: exp.Func) -> str:
        for arg_key in args:
            arg = expression.args.get(arg_key)
            if isinstance(arg, exp.TsOrDsToDate) and not arg.args.get("format"):
                expression.set(arg_key, arg.this)

        return to_sql(self, expression) if to_sql else self.function_fallback_sql(expression)

    return func


class MySQL(Dialect):
    PROMOTE_TO_INFERRED_DATETIME_TYPE = True

    # https://dev.mysql.com/doc/refman/8.0/en/identifiers.html
    IDENTIFIERS_CAN_START_WITH_DIGIT = True

    # We default to treating all identifiers as case-sensitive, since it matches MySQL's
    # behavior on Linux systems. For MacOS and Windows systems, one can override this
    # setting by specifying `dialect="mysql, normalization_strategy = lowercase"`.
    #
    # See also https://dev.mysql.com/doc/refman/8.2/en/identifier-case-sensitivity.html
    NORMALIZATION_STRATEGY = NormalizationStrategy.CASE_SENSITIVE

    TIME_FORMAT = "'%Y-%m-%d %T'"
    DPIPE_IS_STRING_CONCAT = False
    SUPPORTS_USER_DEFINED_TYPES = False
    SUPPORTS_SEMI_ANTI_JOIN = False
    SAFE_DIVISION = True

    # https://prestodb.io/docs/current/functions/datetime.html#mysql-date-functions
    TIME_MAPPING = {
        "%M": "%B",
        "%c": "%-m",
        "%e": "%-d",
        "%h": "%I",
        "%i": "%M",
        "%s": "%S",
        "%u": "%W",
        "%k": "%-H",
        "%l": "%-I",
        "%T": "%H:%M:%S",
        "%W": "%A",
    }

    class Tokenizer(tokens.Tokenizer):
        QUOTES = ["'", '"']
        COMMENTS = ["--", "#", ("/*", "*/")]
        IDENTIFIERS = ["`"]
        STRING_ESCAPES = ["'", '"', "\\"]
        BIT_STRINGS = [("b'", "'"), ("B'", "'"), ("0b", "")]
        HEX_STRINGS = [("x'", "'"), ("X'", "'"), ("0x", "")]

        KEYWORDS = {
            **tokens.Tokenizer.KEYWORDS,
            "CHARSET": TokenType.CHARACTER_SET,
            # The DESCRIBE and EXPLAIN statements are synonyms.
            # https://dev.mysql.com/doc/refman/8.4/en/explain.html
            "EXPLAIN": TokenType.DESCRIBE,
            "FORCE": TokenType.FORCE,
            "IGNORE": TokenType.IGNORE,
            "KEY": TokenType.KEY,
            "LOCK TABLES": TokenType.COMMAND,
            "LONGBLOB": TokenType.LONGBLOB,
            "LONGTEXT": TokenType.LONGTEXT,
            "MEDIUMBLOB": TokenType.MEDIUMBLOB,
            "TINYBLOB": TokenType.TINYBLOB,
            "TINYTEXT": TokenType.TINYTEXT,
            "MEDIUMTEXT": TokenType.MEDIUMTEXT,
            "MEDIUMINT": TokenType.MEDIUMINT,
            "MEMBER OF": TokenType.MEMBER_OF,
            "SEPARATOR": TokenType.SEPARATOR,
            "START": TokenType.BEGIN,
            "SIGNED": TokenType.BIGINT,
            "SIGNED INTEGER": TokenType.BIGINT,
            "UNLOCK TABLES": TokenType.COMMAND,
            "UNSIGNED": TokenType.UBIGINT,
            "UNSIGNED INTEGER": TokenType.UBIGINT,
            "YEAR": TokenType.YEAR,
            "_ARMSCII8": TokenType.INTRODUCER,
            "_ASCII": TokenType.INTRODUCER,
            "_BIG5": TokenType.INTRODUCER,
            "_BINARY": TokenType.INTRODUCER,
            "_CP1250": TokenType.INTRODUCER,
            "_CP1251": TokenType.INTRODUCER,
            "_CP1256": TokenType.INTRODUCER,
            "_CP1257": TokenType.INTRODUCER,
            "_CP850": TokenType.INTRODUCER,
            "_CP852": TokenType.INTRODUCER,
            "_CP866": TokenType.INTRODUCER,
            "_CP932": TokenType.INTRODUCER,
            "_DEC8": TokenType.INTRODUCER,
            "_EUCJPMS": TokenType.INTRODUCER,
            "_EUCKR": TokenType.INTRODUCER,
            "_GB18030": TokenType.INTRODUCER,
            "_GB2312": TokenType.INTRODUCER,
            "_GBK": TokenType.INTRODUCER,
            "_GEOSTD8": TokenType.INTRODUCER,
            "_GREEK": TokenType.INTRODUCER,
            "_HEBREW": TokenType.INTRODUCER,
            "_HP8": TokenType.INTRODUCER,
            "_KEYBCS2": TokenType.INTRODUCER,
            "_KOI8R": TokenType.INTRODUCER,
            "_KOI8U": TokenType.INTRODUCER,
            "_LATIN1": TokenType.INTRODUCER,
            "_LATIN2": TokenType.INTRODUCER,
            "_LATIN5": TokenType.INTRODUCER,
            "_LATIN7": TokenType.INTRODUCER,
            "_MACCE": TokenType.INTRODUCER,
            "_MACROMAN": TokenType.INTRODUCER,
            "_SJIS": TokenType.INTRODUCER,
            "_SWE7": TokenType.INTRODUCER,
            "_TIS620": TokenType.INTRODUCER,
            "_UCS2": TokenType.INTRODUCER,
            "_UJIS": TokenType.INTRODUCER,
            # https://dev.mysql.com/doc/refman/8.0/en/string-literals.html
            "_UTF8": TokenType.INTRODUCER,
            "_UTF16": TokenType.INTRODUCER,
            "_UTF16LE": TokenType.INTRODUCER,
            "_UTF32": TokenType.INTRODUCER,
            "_UTF8MB3": TokenType.INTRODUCER,
            "_UTF8MB4": TokenType.INTRODUCER,
            "@@": TokenType.SESSION_PARAMETER,
        }

        COMMANDS = {*tokens.Tokenizer.COMMANDS, TokenType.REPLACE} - {TokenType.SHOW}

    class Parser(parser.Parser):
        FUNC_TOKENS = {
            *parser.Parser.FUNC_TOKENS,
            TokenType.DATABASE,
            TokenType.SCHEMA,
            TokenType.VALUES,
        }

        CONJUNCTION = {
            **parser.Parser.CONJUNCTION,
            TokenType.DAMP: exp.And,
            TokenType.XOR: exp.Xor,
        }

        DISJUNCTION = {
            **parser.Parser.DISJUNCTION,
            TokenType.DPIPE: exp.Or,
        }

        TABLE_ALIAS_TOKENS = (
            parser.Parser.TABLE_ALIAS_TOKENS - parser.Parser.TABLE_INDEX_HINT_TOKENS
        )

        RANGE_PARSERS = {
            **parser.Parser.RANGE_PARSERS,
            TokenType.MEMBER_OF: lambda self, this: self.expression(
                exp.JSONArrayContains,
                this=this,
                expression=self._parse_wrapped(self._parse_expression),
            ),
        }

        FUNCTIONS = {
            **parser.Parser.FUNCTIONS,
            "CHAR_LENGTH": exp.Length.from_arg_list,
            "CHARACTER_LENGTH": exp.Length.from_arg_list,
            "CONVERT_TZ": lambda args: exp.ConvertTimezone(
                source_tz=seq_get(args, 1), target_tz=seq_get(args, 2), timestamp=seq_get(args, 0)
            ),
            "DATE": lambda args: exp.TsOrDsToDate(this=seq_get(args, 0)),
            "DATE_ADD": build_date_delta_with_interval(exp.DateAdd),
            "DATE_FORMAT": build_formatted_time(exp.TimeToStr, "mysql"),
            "DATE_SUB": build_date_delta_with_interval(exp.DateSub),
            "DAY": lambda args: exp.Day(this=exp.TsOrDsToDate(this=seq_get(args, 0))),
            "DAYOFMONTH": lambda args: exp.DayOfMonth(this=exp.TsOrDsToDate(this=seq_get(args, 0))),
            "DAYOFWEEK": lambda args: exp.DayOfWeek(this=exp.TsOrDsToDate(this=seq_get(args, 0))),
            "DAYOFYEAR": lambda args: exp.DayOfYear(this=exp.TsOrDsToDate(this=seq_get(args, 0))),
            "FORMAT": exp.NumberToStr.from_arg_list,
            "FROM_UNIXTIME": build_formatted_time(exp.UnixToTime, "mysql"),
            "ISNULL": isnull_to_is_null,
            "LOCATE": locate_to_strposition,
            "MAKETIME": exp.TimeFromParts.from_arg_list,
            "MONTH": lambda args: exp.Month(this=exp.TsOrDsToDate(this=seq_get(args, 0))),
            "MONTHNAME": lambda args: exp.TimeToStr(
                this=exp.TsOrDsToDate(this=seq_get(args, 0)),
                format=exp.Literal.string("%B"),
            ),
            "STR_TO_DATE": _str_to_date,
            "TIMESTAMPDIFF": build_date_delta(exp.TimestampDiff),
            "TO_DAYS": lambda args: exp.paren(
                exp.DateDiff(
                    this=exp.TsOrDsToDate(this=seq_get(args, 0)),
                    expression=exp.TsOrDsToDate(this=exp.Literal.string("0000-01-01")),
                    unit=exp.var("DAY"),
                )
                + 1
            ),
            "WEEK": lambda args: exp.Week(
                this=exp.TsOrDsToDate(this=seq_get(args, 0)), mode=seq_get(args, 1)
            ),
            "WEEKOFYEAR": lambda args: exp.WeekOfYear(this=exp.TsOrDsToDate(this=seq_get(args, 0))),
            "YEAR": lambda args: exp.Year(this=exp.TsOrDsToDate(this=seq_get(args, 0))),
        }

        FUNCTION_PARSERS = {
            **parser.Parser.FUNCTION_PARSERS,
            "CHAR": lambda self: self.expression(
                exp.Chr,
                expressions=self._parse_csv(self._parse_assignment),
                charset=self._match(TokenType.USING) and self._parse_var(),
            ),
            "GROUP_CONCAT": lambda self: self._parse_group_concat(),
            # https://dev.mysql.com/doc/refman/5.7/en/miscellaneous-functions.html#function_values
            "VALUES": lambda self: self.expression(
                exp.Anonymous, this="VALUES", expressions=[self._parse_id_var()]
            ),
            "JSON_VALUE": lambda self: self._parse_json_value(),
        }

        STATEMENT_PARSERS = {
            **parser.Parser.STATEMENT_PARSERS,
            TokenType.SHOW: lambda self: self._parse_show(),
        }

        SHOW_PARSERS = {
            "BINARY LOGS": _show_parser("BINARY LOGS"),
            "MASTER LOGS": _show_parser("BINARY LOGS"),
            "BINLOG EVENTS": _show_parser("BINLOG EVENTS"),
            "CHARACTER SET": _show_parser("CHARACTER SET"),
            "CHARSET": _show_parser("CHARACTER SET"),
            "COLLATION": _show_parser("COLLATION"),
            "FULL COLUMNS": _show_parser("COLUMNS", target="FROM", full=True),
            "COLUMNS": _show_parser("COLUMNS", target="FROM"),
            "CREATE DATABASE": _show_parser("CREATE DATABASE", target=True),
            "CREATE EVENT": _show_parser("CREATE EVENT", target=True),
            "CREATE FUNCTION": _show_parser("CREATE FUNCTION", target=True),
            "CREATE PROCEDURE": _show_parser("CREATE PROCEDURE", target=True),
            "CREATE TABLE": _show_parser("CREATE TABLE", target=True),
            "CREATE TRIGGER": _show_parser("CREATE TRIGGER", target=True),
            "CREATE VIEW": _show_parser("CREATE VIEW", target=True),
            "DATABASES": _show_parser("DATABASES"),
            "SCHEMAS": _show_parser("DATABASES"),
            "ENGINE": _show_parser("ENGINE", target=True),
            "STORAGE ENGINES": _show_parser("ENGINES"),
            "ENGINES": _show_parser("ENGINES"),
            "ERRORS": _show_parser("ERRORS"),
            "EVENTS": _show_parser("EVENTS"),
            "FUNCTION CODE": _show_parser("FUNCTION CODE", target=True),
            "FUNCTION STATUS": _show_parser("FUNCTION STATUS"),
            "GRANTS": _show_parser("GRANTS", target="FOR"),
            "INDEX": _show_parser("INDEX", target="FROM"),
            "MASTER STATUS": _show_parser("MASTER STATUS"),
            "OPEN TABLES": _show_parser("OPEN TABLES"),
            "PLUGINS": _show_parser("PLUGINS"),
            "PROCEDURE CODE": _show_parser("PROCEDURE CODE", target=True),
            "PROCEDURE STATUS": _show_parser("PROCEDURE STATUS"),
            "PRIVILEGES": _show_parser("PRIVILEGES"),
            "FULL PROCESSLIST": _show_parser("PROCESSLIST", full=True),
            "PROCESSLIST": _show_parser("PROCESSLIST"),
            "PROFILE": _show_parser("PROFILE"),
            "PROFILES": _show_parser("PROFILES"),
            "RELAYLOG EVENTS": _show_parser("RELAYLOG EVENTS"),
            "REPLICAS": _show_parser("REPLICAS"),
            "SLAVE HOSTS": _show_parser("REPLICAS"),
            "REPLICA STATUS": _show_parser("REPLICA STATUS"),
            "SLAVE STATUS": _show_parser("REPLICA STATUS"),
            "GLOBAL STATUS": _show_parser("STATUS", global_=True),
            "SESSION STATUS": _show_parser("STATUS"),
            "STATUS": _show_parser("STATUS"),
            "TABLE STATUS": _show_parser("TABLE STATUS"),
            "FULL TABLES": _show_parser("TABLES", full=True),
            "TABLES": _show_parser("TABLES"),
            "TRIGGERS": _show_parser("TRIGGERS"),
            "GLOBAL VARIABLES": _show_parser("VARIABLES", global_=True),
            "SESSION VARIABLES": _show_parser("VARIABLES"),
            "VARIABLES": _show_parser("VARIABLES"),
            "WARNINGS": _show_parser("WARNINGS"),
        }

        PROPERTY_PARSERS = {
            **parser.Parser.PROPERTY_PARSERS,
            "LOCK": lambda self: self._parse_property_assignment(exp.LockProperty),
        }

        SET_PARSERS = {
            **parser.Parser.SET_PARSERS,
            "PERSIST": lambda self: self._parse_set_item_assignment("PERSIST"),
            "PERSIST_ONLY": lambda self: self._parse_set_item_assignment("PERSIST_ONLY"),
            "CHARACTER SET": lambda self: self._parse_set_item_charset("CHARACTER SET"),
            "CHARSET": lambda self: self._parse_set_item_charset("CHARACTER SET"),
            "NAMES": lambda self: self._parse_set_item_names(),
        }

        CONSTRAINT_PARSERS = {
            **parser.Parser.CONSTRAINT_PARSERS,
            "FULLTEXT": lambda self: self._parse_index_constraint(kind="FULLTEXT"),
            "INDEX": lambda self: self._parse_index_constraint(),
            "KEY": lambda self: self._parse_index_constraint(),
            "SPATIAL": lambda self: self._parse_index_constraint(kind="SPATIAL"),
        }

        ALTER_PARSERS = {
            **parser.Parser.ALTER_PARSERS,
            "MODIFY": lambda self: self._parse_alter_table_alter(),
        }

        SCHEMA_UNNAMED_CONSTRAINTS = {
            *parser.Parser.SCHEMA_UNNAMED_CONSTRAINTS,
            "FULLTEXT",
            "INDEX",
            "KEY",
            "SPATIAL",
        }

        PROFILE_TYPES: parser.OPTIONS_TYPE = {
            **dict.fromkeys(("ALL", "CPU", "IPC", "MEMORY", "SOURCE", "SWAPS"), tuple()),
            "BLOCK": ("IO",),
            "CONTEXT": ("SWITCHES",),
            "PAGE": ("FAULTS",),
        }

        TYPE_TOKENS = {
            *parser.Parser.TYPE_TOKENS,
            TokenType.SET,
        }

        ENUM_TYPE_TOKENS = {
            *parser.Parser.ENUM_TYPE_TOKENS,
            TokenType.SET,
        }

        # SELECT [ ALL | DISTINCT | DISTINCTROW ] [ <OPERATION_MODIFIERS> ]
        OPERATION_MODIFIERS = {
            "HIGH_PRIORITY",
            "STRAIGHT_JOIN",
            "SQL_SMALL_RESULT",
            "SQL_BIG_RESULT",
            "SQL_BUFFER_RESULT",
            "SQL_NO_CACHE",
            "SQL_CALC_FOUND_ROWS",
        }

        LOG_DEFAULTS_TO_LN = True
        STRING_ALIASES = True
        VALUES_FOLLOWED_BY_PAREN = False
        SUPPORTS_PARTITION_SELECTION = True

        def _parse_primary_key_part(self) -> t.Optional[exp.Expression]:
            this = self._parse_id_var()
            if not self._match(TokenType.L_PAREN):
                return this

            expression = self._parse_number()
            self._match_r_paren()
            return self.expression(exp.ColumnPrefix, this=this, expression=expression)

        def _parse_index_constraint(
            self, kind: t.Optional[str] = None
        ) -> exp.IndexColumnConstraint:
            if kind:
                self._match_texts(("INDEX", "KEY"))

            this = self._parse_id_var(any_token=False)
            index_type = self._match(TokenType.USING) and self._advance_any() and self._prev.text
            expressions = self._parse_wrapped_csv(self._parse_ordered)

            options = []
            while True:
                if self._match_text_seq("KEY_BLOCK_SIZE"):
                    self._match(TokenType.EQ)
                    opt = exp.IndexConstraintOption(key_block_size=self._parse_number())
                elif self._match(TokenType.USING):
                    opt = exp.IndexConstraintOption(using=self._advance_any() and self._prev.text)
                elif self._match_text_seq("WITH", "PARSER"):
                    opt = exp.IndexConstraintOption(parser=self._parse_var(any_token=True))
                elif self._match(TokenType.COMMENT):
                    opt = exp.IndexConstraintOption(comment=self._parse_string())
                elif self._match_text_seq("VISIBLE"):
                    opt = exp.IndexConstraintOption(visible=True)
                elif self._match_text_seq("INVISIBLE"):
                    opt = exp.IndexConstraintOption(visible=False)
                elif self._match_text_seq("ENGINE_ATTRIBUTE"):
                    self._match(TokenType.EQ)
                    opt = exp.IndexConstraintOption(engine_attr=self._parse_string())
                elif self._match_text_seq("SECONDARY_ENGINE_ATTRIBUTE"):
                    self._match(TokenType.EQ)
                    opt = exp.IndexConstraintOption(secondary_engine_attr=self._parse_string())
                else:
                    opt = None

                if not opt:
                    break

                options.append(opt)

            return self.expression(
                exp.IndexColumnConstraint,
                this=this,
                expressions=expressions,
                kind=kind,
                index_type=index_type,
                options=options,
            )

        def _parse_show_mysql(
            self,
            this: str,
            target: bool | str = False,
            full: t.Optional[bool] = None,
            global_: t.Optional[bool] = None,
        ) -> exp.Show:
            if target:
                if isinstance(target, str):
                    self._match_text_seq(target)
                target_id = self._parse_id_var()
            else:
                target_id = None

            log = self._parse_string() if self._match_text_seq("IN") else None

            if this in ("BINLOG EVENTS", "RELAYLOG EVENTS"):
                position = self._parse_number() if self._match_text_seq("FROM") else None
                db = None
            else:
                position = None
                db = None

                if self._match(TokenType.FROM):
                    db = self._parse_id_var()
                elif self._match(TokenType.DOT):
                    db = target_id
                    target_id = self._parse_id_var()

            channel = self._parse_id_var() if self._match_text_seq("FOR", "CHANNEL") else None

            like = self._parse_string() if self._match_text_seq("LIKE") else None
            where = self._parse_where()

            if this == "PROFILE":
                types = self._parse_csv(lambda: self._parse_var_from_options(self.PROFILE_TYPES))
                query = self._parse_number() if self._match_text_seq("FOR", "QUERY") else None
                offset = self._parse_number() if self._match_text_seq("OFFSET") else None
                limit = self._parse_number() if self._match_text_seq("LIMIT") else None
            else:
                types, query = None, None
                offset, limit = self._parse_oldstyle_limit()

            mutex = True if self._match_text_seq("MUTEX") else None
            mutex = False if self._match_text_seq("STATUS") else mutex

            return self.expression(
                exp.Show,
                this=this,
                target=target_id,
                full=full,
                log=log,
                position=position,
                db=db,
                channel=channel,
                like=like,
                where=where,
                types=types,
                query=query,
                offset=offset,
                limit=limit,
                mutex=mutex,
                **{"global": global_},  # type: ignore
            )

        def _parse_oldstyle_limit(
            self,
        ) -> t.Tuple[t.Optional[exp.Expression], t.Optional[exp.Expression]]:
            limit = None
            offset = None
            if self._match_text_seq("LIMIT"):
                parts = self._parse_csv(self._parse_number)
                if len(parts) == 1:
                    limit = parts[0]
                elif len(parts) == 2:
                    limit = parts[1]
                    offset = parts[0]

            return offset, limit

        def _parse_set_item_charset(self, kind: str) -> exp.Expression:
            this = self._parse_string() or self._parse_unquoted_field()
            return self.expression(exp.SetItem, this=this, kind=kind)

        def _parse_set_item_names(self) -> exp.Expression:
            charset = self._parse_string() or self._parse_unquoted_field()
            if self._match_text_seq("COLLATE"):
                collate = self._parse_string() or self._parse_unquoted_field()
            else:
                collate = None

            return self.expression(exp.SetItem, this=charset, collate=collate, kind="NAMES")

        def _parse_type(
            self, parse_interval: bool = True, fallback_to_identifier: bool = False
        ) -> t.Optional[exp.Expression]:
            # mysql binary is special and can work anywhere, even in order by operations
            # it operates like a no paren func
            if self._match(TokenType.BINARY, advance=False):
                data_type = self._parse_types(check_func=True, allow_identifiers=False)

                if isinstance(data_type, exp.DataType):
                    return self.expression(exp.Cast, this=self._parse_column(), to=data_type)

            return super()._parse_type(
                parse_interval=parse_interval, fallback_to_identifier=fallback_to_identifier
            )

        def _parse_group_concat(self) -> t.Optional[exp.Expression]:
            def concat_exprs(
                node: t.Optional[exp.Expression], exprs: t.List[exp.Expression]
            ) -> exp.Expression:
                if isinstance(node, exp.Distinct) and len(node.expressions) > 1:
                    concat_exprs = [
                        self.expression(exp.Concat, expressions=node.expressions, safe=True)
                    ]
                    node.set("expressions", concat_exprs)
                    return node
                if len(exprs) == 1:
                    return exprs[0]
                return self.expression(exp.Concat, expressions=args, safe=True)

            args = self._parse_csv(self._parse_lambda)

            if args:
                order = args[-1] if isinstance(args[-1], exp.Order) else None

                if order:
                    # Order By is the last (or only) expression in the list and has consumed the 'expr' before it,
                    # remove 'expr' from exp.Order and add it back to args
                    args[-1] = order.this
                    order.set("this", concat_exprs(order.this, args))

                this = order or concat_exprs(args[0], args)
            else:
                this = None

            separator = self._parse_field() if self._match(TokenType.SEPARATOR) else None

            return self.expression(exp.GroupConcat, this=this, separator=separator)

        def _parse_json_value(self) -> exp.JSONValue:
            this = self._parse_bitwise()
            self._match(TokenType.COMMA)
            path = self._parse_bitwise()

            returning = self._match(TokenType.RETURNING) and self._parse_type()

            return self.expression(
                exp.JSONValue,
                this=this,
                path=self.dialect.to_json_path(path),
                returning=returning,
                on_condition=self._parse_on_condition(),
            )

    class Generator(generator.Generator):
        INTERVAL_ALLOWS_PLURAL_FORM = False
        LOCKING_READS_SUPPORTED = True
        NULL_ORDERING_SUPPORTED = None
        JOIN_HINTS = False
        TABLE_HINTS = True
        DUPLICATE_KEY_UPDATE_WITH_SET = False
        QUERY_HINT_SEP = " "
        VALUES_AS_TABLE = False
        NVL2_SUPPORTED = False
        LAST_DAY_SUPPORTS_DATE_PART = False
        JSON_TYPE_REQUIRED_FOR_EXTRACTION = True
        JSON_PATH_BRACKETED_KEY_SUPPORTED = False
        JSON_KEY_VALUE_PAIR_SEP = ","
        SUPPORTS_TO_NUMBER = False
        PARSE_JSON_NAME: t.Optional[str] = None
        PAD_FILL_PATTERN_IS_REQUIRED = True
        WRAP_DERIVED_VALUES = False
        VARCHAR_REQUIRES_SIZE = True
        SUPPORTS_MEDIAN = False

        TRANSFORMS = {
            **generator.Generator.TRANSFORMS,
            exp.ArrayAgg: rename_func("GROUP_CONCAT"),
            exp.CurrentDate: no_paren_current_date_sql,
            exp.DateDiff: _remove_ts_or_ds_to_date(
                lambda self, e: self.func("DATEDIFF", e.this, e.expression), ("this", "expression")
            ),
            exp.DateAdd: _remove_ts_or_ds_to_date(date_add_sql("ADD")),
            exp.DateStrToDate: datestrtodate_sql,
            exp.DateSub: _remove_ts_or_ds_to_date(date_add_sql("SUB")),
            exp.DateTrunc: _date_trunc_sql,
            exp.Day: _remove_ts_or_ds_to_date(),
            exp.DayOfMonth: _remove_ts_or_ds_to_date(rename_func("DAYOFMONTH")),
            exp.DayOfWeek: _remove_ts_or_ds_to_date(rename_func("DAYOFWEEK")),
            exp.DayOfYear: _remove_ts_or_ds_to_date(rename_func("DAYOFYEAR")),
            exp.GroupConcat: lambda self,
            e: f"""GROUP_CONCAT({self.sql(e, "this")} SEPARATOR {self.sql(e, "separator") or "','"})""",
            exp.ILike: no_ilike_sql,
            exp.JSONExtractScalar: arrow_json_extract_sql,
            exp.Length: rename_func("CHAR_LENGTH"),
            exp.Max: max_or_greatest,
            exp.Min: min_or_least,
            exp.Month: _remove_ts_or_ds_to_date(),
            exp.NullSafeEQ: lambda self, e: self.binary(e, "<=>"),
            exp.NullSafeNEQ: lambda self, e: f"NOT {self.binary(e, '<=>')}",
            exp.NumberToStr: rename_func("FORMAT"),
            exp.Pivot: no_pivot_sql,
            exp.Select: transforms.preprocess(
                [
                    transforms.eliminate_distinct_on,
                    transforms.eliminate_semi_and_anti_joins,
                    transforms.eliminate_qualify,
                    transforms.eliminate_full_outer_join,
                    transforms.unnest_generate_date_array_using_recursive_cte,
                ]
            ),
            exp.StrPosition: strposition_to_locate_sql,
            exp.StrToDate: _str_to_date_sql,
            exp.StrToTime: _str_to_date_sql,
            exp.Stuff: rename_func("INSERT"),
            exp.TableSample: no_tablesample_sql,
            exp.TimeFromParts: rename_func("MAKETIME"),
            exp.TimestampAdd: date_add_interval_sql("DATE", "ADD"),
            exp.TimestampDiff: lambda self, e: self.func(
                "TIMESTAMPDIFF", unit_to_var(e), e.expression, e.this
            ),
            exp.TimestampSub: date_add_interval_sql("DATE", "SUB"),
            exp.TimeStrToUnix: rename_func("UNIX_TIMESTAMP"),
            exp.TimeStrToTime: lambda self, e: timestrtotime_sql(
                self,
                e,
                include_precision=not e.args.get("zone"),
            ),
            exp.TimeToStr: _remove_ts_or_ds_to_date(
                lambda self, e: self.func("DATE_FORMAT", e.this, self.format_time(e))
            ),
            exp.Trim: trim_sql,
            exp.TryCast: no_trycast_sql,
            exp.TsOrDsAdd: date_add_sql("ADD"),
            exp.TsOrDsDiff: lambda self, e: self.func("DATEDIFF", e.this, e.expression),
            exp.TsOrDsToDate: _ts_or_ds_to_date_sql,
            exp.UnixToTime: _unix_to_time_sql,
            exp.Week: _remove_ts_or_ds_to_date(),
            exp.WeekOfYear: _remove_ts_or_ds_to_date(rename_func("WEEKOFYEAR")),
            exp.Year: _remove_ts_or_ds_to_date(),
        }

        UNSIGNED_TYPE_MAPPING = {
            exp.DataType.Type.UBIGINT: "BIGINT",
            exp.DataType.Type.UINT: "INT",
            exp.DataType.Type.UMEDIUMINT: "MEDIUMINT",
            exp.DataType.Type.USMALLINT: "SMALLINT",
            exp.DataType.Type.UTINYINT: "TINYINT",
            exp.DataType.Type.UDECIMAL: "DECIMAL",
        }

        TIMESTAMP_TYPE_MAPPING = {
            exp.DataType.Type.TIMESTAMP: "DATETIME",
            exp.DataType.Type.TIMESTAMPTZ: "TIMESTAMP",
            exp.DataType.Type.TIMESTAMPLTZ: "TIMESTAMP",
        }

        TYPE_MAPPING = {
            **generator.Generator.TYPE_MAPPING,
            **UNSIGNED_TYPE_MAPPING,
            **TIMESTAMP_TYPE_MAPPING,
        }

        TYPE_MAPPING.pop(exp.DataType.Type.MEDIUMTEXT)
        TYPE_MAPPING.pop(exp.DataType.Type.LONGTEXT)
        TYPE_MAPPING.pop(exp.DataType.Type.TINYTEXT)
        TYPE_MAPPING.pop(exp.DataType.Type.MEDIUMBLOB)
        TYPE_MAPPING.pop(exp.DataType.Type.LONGBLOB)
        TYPE_MAPPING.pop(exp.DataType.Type.TINYBLOB)

        PROPERTIES_LOCATION = {
            **generator.Generator.PROPERTIES_LOCATION,
            exp.TransientProperty: exp.Properties.Location.UNSUPPORTED,
            exp.VolatileProperty: exp.Properties.Location.UNSUPPORTED,
        }

        LIMIT_FETCH = "LIMIT"

        LIMIT_ONLY_LITERALS = True

        CHAR_CAST_MAPPING = dict.fromkeys(
            (
                exp.DataType.Type.LONGTEXT,
                exp.DataType.Type.LONGBLOB,
                exp.DataType.Type.MEDIUMBLOB,
                exp.DataType.Type.MEDIUMTEXT,
                exp.DataType.Type.TEXT,
                exp.DataType.Type.TINYBLOB,
                exp.DataType.Type.TINYTEXT,
                exp.DataType.Type.VARCHAR,
            ),
            "CHAR",
        )
        SIGNED_CAST_MAPPING = dict.fromkeys(
            (
                exp.DataType.Type.BIGINT,
                exp.DataType.Type.BOOLEAN,
                exp.DataType.Type.INT,
                exp.DataType.Type.SMALLINT,
                exp.DataType.Type.TINYINT,
                exp.DataType.Type.MEDIUMINT,
            ),
            "SIGNED",
        )

        # MySQL doesn't support many datatypes in cast.
        # https://dev.mysql.com/doc/refman/8.0/en/cast-functions.html#function_cast
        CAST_MAPPING = {
            **CHAR_CAST_MAPPING,
            **SIGNED_CAST_MAPPING,
            exp.DataType.Type.UBIGINT: "UNSIGNED",
        }

        TIMESTAMP_FUNC_TYPES = {
            exp.DataType.Type.TIMESTAMPTZ,
            exp.DataType.Type.TIMESTAMPLTZ,
        }

        # https://dev.mysql.com/doc/refman/8.0/en/keywords.html
        RESERVED_KEYWORDS = {
            "accessible",
            "add",
            "all",
            "alter",
            "analyze",
            "and",
            "as",
            "asc",
            "asensitive",
            "before",
            "between",
            "bigint",
            "binary",
            "blob",
            "both",
            "by",
            "call",
            "cascade",
            "case",
            "change",
            "char",
            "character",
            "check",
            "collate",
            "column",
            "condition",
            "constraint",
            "continue",
            "convert",
            "create",
            "cross",
            "cube",
            "cume_dist",
            "current_date",
            "current_time",
            "current_timestamp",
            "current_user",
            "cursor",
            "database",
            "databases",
            "day_hour",
            "day_microsecond",
            "day_minute",
            "day_second",
            "dec",
            "decimal",
            "declare",
            "default",
            "delayed",
            "delete",
            "dense_rank",
            "desc",
            "describe",
            "deterministic",
            "distinct",
            "distinctrow",
            "div",
            "double",
            "drop",
            "dual",
            "each",
            "else",
            "elseif",
            "empty",
            "enclosed",
            "escaped",
            "except",
            "exists",
            "exit",
            "explain",
            "false",
            "fetch",
            "first_value",
            "float",
            "float4",
            "float8",
            "for",
            "force",
            "foreign",
            "from",
            "fulltext",
            "function",
            "generated",
            "get",
            "grant",
            "group",
            "grouping",
            "groups",
            "having",
            "high_priority",
            "hour_microsecond",
            "hour_minute",
            "hour_second",
            "if",
            "ignore",
            "in",
            "index",
            "infile",
            "inner",
            "inout",
            "insensitive",
            "insert",
            "int",
            "int1",
            "int2",
            "int3",
            "int4",
            "int8",
            "integer",
            "intersect",
            "interval",
            "into",
            "io_after_gtids",
            "io_before_gtids",
            "is",
            "iterate",
            "join",
            "json_table",
            "key",
            "keys",
            "kill",
            "lag",
            "last_value",
            "lateral",
            "lead",
            "leading",
            "leave",
            "left",
            "like",
            "limit",
            "linear",
            "lines",
            "load",
            "localtime",
            "localtimestamp",
            "lock",
            "long",
            "longblob",
            "longtext",
            "loop",
            "low_priority",
            "master_bind",
            "master_ssl_verify_server_cert",
            "match",
            "maxvalue",
            "mediumblob",
            "mediumint",
            "mediumtext",
            "middleint",
            "minute_microsecond",
            "minute_second",
            "mod",
            "modifies",
            "natural",
            "not",
            "no_write_to_binlog",
            "nth_value",
            "ntile",
            "null",
            "numeric",
            "of",
            "on",
            "optimize",
            "optimizer_costs",
            "option",
            "optionally",
            "or",
            "order",
            "out",
            "outer",
            "outfile",
            "over",
            "partition",
            "percent_rank",
            "precision",
            "primary",
            "procedure",
            "purge",
            "range",
            "rank",
            "read",
            "reads",
            "read_write",
            "real",
            "recursive",
            "references",
            "regexp",
            "release",
            "rename",
            "repeat",
            "replace",
            "require",
            "resignal",
            "restrict",
            "return",
            "revoke",
            "right",
            "rlike",
            "row",
            "rows",
            "row_number",
            "schema",
            "schemas",
            "second_microsecond",
            "select",
            "sensitive",
            "separator",
            "set",
            "show",
            "signal",
            "smallint",
            "spatial",
            "specific",
            "sql",
            "sqlexception",
            "sqlstate",
            "sqlwarning",
            "sql_big_result",
            "sql_calc_found_rows",
            "sql_small_result",
            "ssl",
            "starting",
            "stored",
            "straight_join",
            "system",
            "table",
            "terminated",
            "then",
            "tinyblob",
            "tinyint",
            "tinytext",
            "to",
            "trailing",
            "trigger",
            "true",
            "undo",
            "union",
            "unique",
            "unlock",
            "unsigned",
            "update",
            "usage",
            "use",
            "using",
            "utc_date",
            "utc_time",
            "utc_timestamp",
            "values",
            "varbinary",
            "varchar",
            "varcharacter",
            "varying",
            "virtual",
            "when",
            "where",
            "while",
            "window",
            "with",
            "write",
            "xor",
            "year_month",
            "zerofill",
        }

        def array_sql(self, expression: exp.Array) -> str:
            self.unsupported("Arrays are not supported by MySQL")
            return self.function_fallback_sql(expression)

        def arraycontainsall_sql(self, expression: exp.ArrayContainsAll) -> str:
            self.unsupported("Array operations are not supported by MySQL")
            return self.function_fallback_sql(expression)

        def dpipe_sql(self, expression: exp.DPipe) -> str:
            return self.func("CONCAT", *expression.flatten())

        def extract_sql(self, expression: exp.Extract) -> str:
            unit = expression.name
            if unit and unit.lower() == "epoch":
                return self.func("UNIX_TIMESTAMP", expression.expression)

            return super().extract_sql(expression)

        def datatype_sql(self, expression: exp.DataType) -> str:
            if (
                self.VARCHAR_REQUIRES_SIZE
                and expression.is_type(exp.DataType.Type.VARCHAR)
                and not expression.expressions
            ):
                # `VARCHAR` must always have a size - if it doesn't, we always generate `TEXT`
                return "TEXT"

            # https://dev.mysql.com/doc/refman/8.0/en/numeric-type-syntax.html
            result = super().datatype_sql(expression)
            if expression.this in self.UNSIGNED_TYPE_MAPPING:
                result = f"{result} UNSIGNED"

            return result

        def jsonarraycontains_sql(self, expression: exp.JSONArrayContains) -> str:
            return f"{self.sql(expression, 'this')} MEMBER OF({self.sql(expression, 'expression')})"

        def cast_sql(self, expression: exp.Cast, safe_prefix: t.Optional[str] = None) -> str:
            if expression.to.this in self.TIMESTAMP_FUNC_TYPES:
                return self.func("TIMESTAMP", expression.this)

            to = self.CAST_MAPPING.get(expression.to.this)

            if to:
                expression.to.set("this", to)
            return super().cast_sql(expression)

        def show_sql(self, expression: exp.Show) -> str:
            this = f" {expression.name}"
            full = " FULL" if expression.args.get("full") else ""
            global_ = " GLOBAL" if expression.args.get("global") else ""

            target = self.sql(expression, "target")
            target = f" {target}" if target else ""
            if expression.name in ("COLUMNS", "INDEX"):
                target = f" FROM{target}"
            elif expression.name == "GRANTS":
                target = f" FOR{target}"

            db = self._prefixed_sql("FROM", expression, "db")

            like = self._prefixed_sql("LIKE", expression, "like")
            where = self.sql(expression, "where")

            types = self.expressions(expression, key="types")
            types = f" {types}" if types else types
            query = self._prefixed_sql("FOR QUERY", expression, "query")

            if expression.name == "PROFILE":
                offset = self._prefixed_sql("OFFSET", expression, "offset")
                limit = self._prefixed_sql("LIMIT", expression, "limit")
            else:
                offset = ""
                limit = self._oldstyle_limit_sql(expression)

            log = self._prefixed_sql("IN", expression, "log")
            position = self._prefixed_sql("FROM", expression, "position")

            channel = self._prefixed_sql("FOR CHANNEL", expression, "channel")

            if expression.name == "ENGINE":
                mutex_or_status = " MUTEX" if expression.args.get("mutex") else " STATUS"
            else:
                mutex_or_status = ""

            return f"SHOW{full}{global_}{this}{target}{types}{db}{query}{log}{position}{channel}{mutex_or_status}{like}{where}{offset}{limit}"

        def altercolumn_sql(self, expression: exp.AlterColumn) -> str:
            dtype = self.sql(expression, "dtype")
            if not dtype:
                return super().altercolumn_sql(expression)

            this = self.sql(expression, "this")
            return f"MODIFY COLUMN {this} {dtype}"

        def _prefixed_sql(self, prefix: str, expression: exp.Expression, arg: str) -> str:
            sql = self.sql(expression, arg)
            return f" {prefix} {sql}" if sql else ""

        def _oldstyle_limit_sql(self, expression: exp.Show) -> str:
            limit = self.sql(expression, "limit")
            offset = self.sql(expression, "offset")
            if limit:
                limit_offset = f"{offset}, {limit}" if offset else limit
                return f" LIMIT {limit_offset}"
            return ""

        def chr_sql(self, expression: exp.Chr) -> str:
            this = self.expressions(sqls=[expression.this] + expression.expressions)
            charset = expression.args.get("charset")
            using = f" USING {self.sql(charset)}" if charset else ""
            return f"CHAR({this}{using})"

        def timestamptrunc_sql(self, expression: exp.TimestampTrunc) -> str:
            unit = expression.args.get("unit")

            # Pick an old-enough date to avoid negative timestamp diffs
            start_ts = "'0000-01-01 00:00:00'"

            # Source: https://stackoverflow.com/a/32955740
            timestamp_diff = build_date_delta(exp.TimestampDiff)([unit, start_ts, expression.this])
            interval = exp.Interval(this=timestamp_diff, unit=unit)
            dateadd = build_date_delta_with_interval(exp.DateAdd)([start_ts, interval])

            return self.sql(dateadd)

        def converttimezone_sql(self, expression: exp.ConvertTimezone) -> str:
            from_tz = expression.args.get("source_tz")
            to_tz = expression.args.get("target_tz")
            dt = expression.args.get("timestamp")

            return self.func("CONVERT_TZ", dt, from_tz, to_tz)

        def attimezone_sql(self, expression: exp.AtTimeZone) -> str:
            self.unsupported("AT TIME ZONE is not supported by MySQL")
            return self.sql(expression.this)
