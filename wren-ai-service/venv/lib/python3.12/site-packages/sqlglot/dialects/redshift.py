from __future__ import annotations

import typing as t

from sqlglot import exp, transforms
from sqlglot.dialects.dialect import (
    NormalizationStrategy,
    concat_to_dpipe_sql,
    concat_ws_to_dpipe_sql,
    date_delta_sql,
    generatedasidentitycolumnconstraint_sql,
    json_extract_segments,
    no_tablesample_sql,
    rename_func,
    map_date_part,
)
from sqlglot.dialects.postgres import Postgres
from sqlglot.helper import seq_get
from sqlglot.tokens import TokenType
from sqlglot.parser import build_convert_timezone

if t.TYPE_CHECKING:
    from sqlglot._typing import E


def _build_date_delta(expr_type: t.Type[E]) -> t.Callable[[t.List], E]:
    def _builder(args: t.List) -> E:
        expr = expr_type(
            this=seq_get(args, 2),
            expression=seq_get(args, 1),
            unit=map_date_part(seq_get(args, 0)),
        )
        if expr_type is exp.TsOrDsAdd:
            expr.set("return_type", exp.DataType.build("TIMESTAMP"))

        return expr

    return _builder


class Redshift(Postgres):
    # https://docs.aws.amazon.com/redshift/latest/dg/r_names.html
    NORMALIZATION_STRATEGY = NormalizationStrategy.CASE_INSENSITIVE

    SUPPORTS_USER_DEFINED_TYPES = False
    INDEX_OFFSET = 0
    COPY_PARAMS_ARE_CSV = False
    HEX_LOWERCASE = True
    HAS_DISTINCT_ARRAY_CONSTRUCTORS = True

    # ref: https://docs.aws.amazon.com/redshift/latest/dg/r_FORMAT_strings.html
    TIME_FORMAT = "'YYYY-MM-DD HH24:MI:SS'"
    TIME_MAPPING = {**Postgres.TIME_MAPPING, "MON": "%b", "HH24": "%H", "HH": "%I"}

    class Parser(Postgres.Parser):
        FUNCTIONS = {
            **Postgres.Parser.FUNCTIONS,
            "ADD_MONTHS": lambda args: exp.TsOrDsAdd(
                this=seq_get(args, 0),
                expression=seq_get(args, 1),
                unit=exp.var("month"),
                return_type=exp.DataType.build("TIMESTAMP"),
            ),
            "CONVERT_TIMEZONE": lambda args: build_convert_timezone(args, "UTC"),
            "DATEADD": _build_date_delta(exp.TsOrDsAdd),
            "DATE_ADD": _build_date_delta(exp.TsOrDsAdd),
            "DATEDIFF": _build_date_delta(exp.TsOrDsDiff),
            "DATE_DIFF": _build_date_delta(exp.TsOrDsDiff),
            "GETDATE": exp.CurrentTimestamp.from_arg_list,
            "LISTAGG": exp.GroupConcat.from_arg_list,
            "SPLIT_TO_ARRAY": lambda args: exp.StringToArray(
                this=seq_get(args, 0), expression=seq_get(args, 1) or exp.Literal.string(",")
            ),
            "STRTOL": exp.FromBase.from_arg_list,
        }

        NO_PAREN_FUNCTION_PARSERS = {
            **Postgres.Parser.NO_PAREN_FUNCTION_PARSERS,
            "APPROXIMATE": lambda self: self._parse_approximate_count(),
            "SYSDATE": lambda self: self.expression(exp.CurrentTimestamp, sysdate=True),
        }

        SUPPORTS_IMPLICIT_UNNEST = True

        def _parse_table(
            self,
            schema: bool = False,
            joins: bool = False,
            alias_tokens: t.Optional[t.Collection[TokenType]] = None,
            parse_bracket: bool = False,
            is_db_reference: bool = False,
            parse_partition: bool = False,
        ) -> t.Optional[exp.Expression]:
            # Redshift supports UNPIVOTing SUPER objects, e.g. `UNPIVOT foo.obj[0] AS val AT attr`
            unpivot = self._match(TokenType.UNPIVOT)
            table = super()._parse_table(
                schema=schema,
                joins=joins,
                alias_tokens=alias_tokens,
                parse_bracket=parse_bracket,
                is_db_reference=is_db_reference,
            )

            return self.expression(exp.Pivot, this=table, unpivot=True) if unpivot else table

        def _parse_convert(
            self, strict: bool, safe: t.Optional[bool] = None
        ) -> t.Optional[exp.Expression]:
            to = self._parse_types()
            self._match(TokenType.COMMA)
            this = self._parse_bitwise()
            return self.expression(exp.TryCast, this=this, to=to, safe=safe)

        def _parse_approximate_count(self) -> t.Optional[exp.ApproxDistinct]:
            index = self._index - 1
            func = self._parse_function()

            if isinstance(func, exp.Count) and isinstance(func.this, exp.Distinct):
                return self.expression(exp.ApproxDistinct, this=seq_get(func.this.expressions, 0))
            self._retreat(index)
            return None

    class Tokenizer(Postgres.Tokenizer):
        BIT_STRINGS = []
        HEX_STRINGS = []
        STRING_ESCAPES = ["\\", "'"]

        KEYWORDS = {
            **Postgres.Tokenizer.KEYWORDS,
            "(+)": TokenType.JOIN_MARKER,
            "HLLSKETCH": TokenType.HLLSKETCH,
            "MINUS": TokenType.EXCEPT,
            "SUPER": TokenType.SUPER,
            "TOP": TokenType.TOP,
            "UNLOAD": TokenType.COMMAND,
            "VARBYTE": TokenType.VARBINARY,
            "BINARY VARYING": TokenType.VARBINARY,
        }
        KEYWORDS.pop("VALUES")

        # Redshift allows # to appear as a table identifier prefix
        SINGLE_TOKENS = Postgres.Tokenizer.SINGLE_TOKENS.copy()
        SINGLE_TOKENS.pop("#")

    class Generator(Postgres.Generator):
        LOCKING_READS_SUPPORTED = False
        QUERY_HINTS = False
        VALUES_AS_TABLE = False
        TZ_TO_WITH_TIME_ZONE = True
        NVL2_SUPPORTED = True
        LAST_DAY_SUPPORTS_DATE_PART = False
        CAN_IMPLEMENT_ARRAY_ANY = False
        MULTI_ARG_DISTINCT = True
        COPY_PARAMS_ARE_WRAPPED = False
        HEX_FUNC = "TO_HEX"
        PARSE_JSON_NAME = "JSON_PARSE"
        ARRAY_CONCAT_IS_VAR_LEN = False
        SUPPORTS_CONVERT_TIMEZONE = True
        EXCEPT_INTERSECT_SUPPORT_ALL_CLAUSE = False
        SUPPORTS_MEDIAN = True

        # Redshift doesn't have `WITH` as part of their with_properties so we remove it
        WITH_PROPERTIES_PREFIX = " "

        TYPE_MAPPING = {
            **Postgres.Generator.TYPE_MAPPING,
            exp.DataType.Type.BINARY: "VARBYTE",
            exp.DataType.Type.INT: "INTEGER",
            exp.DataType.Type.TIMETZ: "TIME",
            exp.DataType.Type.TIMESTAMPTZ: "TIMESTAMP",
            exp.DataType.Type.VARBINARY: "VARBYTE",
            exp.DataType.Type.ROWVERSION: "VARBYTE",
        }

        TRANSFORMS = {
            **Postgres.Generator.TRANSFORMS,
            exp.ArrayConcat: lambda self, e: self.arrayconcat_sql(e, name="ARRAY_CONCAT"),
            exp.Concat: concat_to_dpipe_sql,
            exp.ConcatWs: concat_ws_to_dpipe_sql,
            exp.ApproxDistinct: lambda self,
            e: f"APPROXIMATE COUNT(DISTINCT {self.sql(e, 'this')})",
            exp.CurrentTimestamp: lambda self, e: (
                "SYSDATE" if e.args.get("sysdate") else "GETDATE()"
            ),
            exp.DateAdd: date_delta_sql("DATEADD"),
            exp.DateDiff: date_delta_sql("DATEDIFF"),
            exp.DistKeyProperty: lambda self, e: self.func("DISTKEY", e.this),
            exp.DistStyleProperty: lambda self, e: self.naked_property(e),
            exp.Explode: lambda self, e: self.explode_sql(e),
            exp.FromBase: rename_func("STRTOL"),
            exp.GeneratedAsIdentityColumnConstraint: generatedasidentitycolumnconstraint_sql,
            exp.JSONExtract: json_extract_segments("JSON_EXTRACT_PATH_TEXT"),
            exp.JSONExtractScalar: json_extract_segments("JSON_EXTRACT_PATH_TEXT"),
            exp.GroupConcat: rename_func("LISTAGG"),
            exp.Hex: lambda self, e: self.func("UPPER", self.func("TO_HEX", self.sql(e, "this"))),
            exp.Select: transforms.preprocess(
                [
                    transforms.eliminate_distinct_on,
                    transforms.eliminate_semi_and_anti_joins,
                    transforms.unqualify_unnest,
                    transforms.unnest_generate_date_array_using_recursive_cte,
                ]
            ),
            exp.SortKeyProperty: lambda self,
            e: f"{'COMPOUND ' if e.args['compound'] else ''}SORTKEY({self.format_args(*e.this)})",
            exp.StartsWith: lambda self,
            e: f"{self.sql(e.this)} LIKE {self.sql(e.expression)} || '%'",
            exp.StringToArray: rename_func("SPLIT_TO_ARRAY"),
            exp.TableSample: no_tablesample_sql,
            exp.TsOrDsAdd: date_delta_sql("DATEADD"),
            exp.TsOrDsDiff: date_delta_sql("DATEDIFF"),
            exp.UnixToTime: lambda self,
            e: f"(TIMESTAMP 'epoch' + {self.sql(e.this)} * INTERVAL '1 SECOND')",
        }

        # Postgres maps exp.Pivot to no_pivot_sql, but Redshift support pivots
        TRANSFORMS.pop(exp.Pivot)

        # Postgres doesn't support JSON_PARSE, but Redshift does
        TRANSFORMS.pop(exp.ParseJSON)

        # Redshift uses the POW | POWER (expr1, expr2) syntax instead of expr1 ^ expr2 (postgres)
        TRANSFORMS.pop(exp.Pow)

        # Redshift supports these functions
        TRANSFORMS.pop(exp.AnyValue)
        TRANSFORMS.pop(exp.LastDay)
        TRANSFORMS.pop(exp.SHA2)

        RESERVED_KEYWORDS = {
            "aes128",
            "aes256",
            "all",
            "allowoverwrite",
            "analyse",
            "analyze",
            "and",
            "any",
            "array",
            "as",
            "asc",
            "authorization",
            "az64",
            "backup",
            "between",
            "binary",
            "blanksasnull",
            "both",
            "bytedict",
            "bzip2",
            "case",
            "cast",
            "check",
            "collate",
            "column",
            "constraint",
            "create",
            "credentials",
            "cross",
            "current_date",
            "current_time",
            "current_timestamp",
            "current_user",
            "current_user_id",
            "default",
            "deferrable",
            "deflate",
            "defrag",
            "delta",
            "delta32k",
            "desc",
            "disable",
            "distinct",
            "do",
            "else",
            "emptyasnull",
            "enable",
            "encode",
            "encrypt     ",
            "encryption",
            "end",
            "except",
            "explicit",
            "false",
            "for",
            "foreign",
            "freeze",
            "from",
            "full",
            "globaldict256",
            "globaldict64k",
            "grant",
            "group",
            "gzip",
            "having",
            "identity",
            "ignore",
            "ilike",
            "in",
            "initially",
            "inner",
            "intersect",
            "interval",
            "into",
            "is",
            "isnull",
            "join",
            "leading",
            "left",
            "like",
            "limit",
            "localtime",
            "localtimestamp",
            "lun",
            "luns",
            "lzo",
            "lzop",
            "minus",
            "mostly16",
            "mostly32",
            "mostly8",
            "natural",
            "new",
            "not",
            "notnull",
            "null",
            "nulls",
            "off",
            "offline",
            "offset",
            "oid",
            "old",
            "on",
            "only",
            "open",
            "or",
            "order",
            "outer",
            "overlaps",
            "parallel",
            "partition",
            "percent",
            "permissions",
            "pivot",
            "placing",
            "primary",
            "raw",
            "readratio",
            "recover",
            "references",
            "rejectlog",
            "resort",
            "respect",
            "restore",
            "right",
            "select",
            "session_user",
            "similar",
            "snapshot",
            "some",
            "sysdate",
            "system",
            "table",
            "tag",
            "tdes",
            "text255",
            "text32k",
            "then",
            "timestamp",
            "to",
            "top",
            "trailing",
            "true",
            "truncatecolumns",
            "type",
            "union",
            "unique",
            "unnest",
            "unpivot",
            "user",
            "using",
            "verbose",
            "wallet",
            "when",
            "where",
            "with",
            "without",
        }

        def unnest_sql(self, expression: exp.Unnest) -> str:
            args = expression.expressions
            num_args = len(args)

            if num_args != 1:
                self.unsupported(f"Unsupported number of arguments in UNNEST: {num_args}")
                return ""

            if isinstance(expression.find_ancestor(exp.From, exp.Join, exp.Select), exp.Select):
                self.unsupported("Unsupported UNNEST when not used in FROM/JOIN clauses")
                return ""

            arg = self.sql(seq_get(args, 0))

            alias = self.expressions(expression.args.get("alias"), key="columns", flat=True)
            return f"{arg} AS {alias}" if alias else arg

        def cast_sql(self, expression: exp.Cast, safe_prefix: t.Optional[str] = None) -> str:
            if expression.is_type(exp.DataType.Type.JSON):
                # Redshift doesn't support a JSON type, so casting to it is treated as a noop
                return self.sql(expression, "this")

            return super().cast_sql(expression, safe_prefix=safe_prefix)

        def datatype_sql(self, expression: exp.DataType) -> str:
            """
            Redshift converts the `TEXT` data type to `VARCHAR(255)` by default when people more generally mean
            VARCHAR of max length which is `VARCHAR(max)` in Redshift. Therefore if we get a `TEXT` data type
            without precision we convert it to `VARCHAR(max)` and if it does have precision then we just convert
            `TEXT` to `VARCHAR`.
            """
            if expression.is_type("text"):
                expression.set("this", exp.DataType.Type.VARCHAR)
                precision = expression.args.get("expressions")

                if not precision:
                    expression.append("expressions", exp.var("MAX"))

            return super().datatype_sql(expression)

        def alterset_sql(self, expression: exp.AlterSet) -> str:
            exprs = self.expressions(expression, flat=True)
            exprs = f" TABLE PROPERTIES ({exprs})" if exprs else ""
            location = self.sql(expression, "location")
            location = f" LOCATION {location}" if location else ""
            file_format = self.expressions(expression, key="file_format", flat=True, sep=" ")
            file_format = f" FILE FORMAT {file_format}" if file_format else ""

            return f"SET{exprs}{location}{file_format}"

        def array_sql(self, expression: exp.Array) -> str:
            if expression.args.get("bracket_notation"):
                return super().array_sql(expression)

            return rename_func("ARRAY")(self, expression)

        def explode_sql(self, expression: exp.Explode) -> str:
            self.unsupported("Unsupported EXPLODE() function")
            return ""
