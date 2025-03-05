from __future__ import annotations

import typing as t

from sqlglot import exp, generator, parser, tokens, transforms
from sqlglot.dialects.dialect import (
    Dialect,
    max_or_greatest,
    min_or_least,
    rename_func,
    to_number_with_nls_param,
)
from sqlglot.helper import seq_get
from sqlglot.tokens import TokenType


def _date_add_sql(
    kind: t.Literal["+", "-"],
) -> t.Callable[[Teradata.Generator, exp.DateAdd | exp.DateSub], str]:
    def func(self: Teradata.Generator, expression: exp.DateAdd | exp.DateSub) -> str:
        this = self.sql(expression, "this")
        unit = expression.args.get("unit")
        value = self._simplify_unless_literal(expression.expression)

        if not isinstance(value, exp.Literal):
            self.unsupported("Cannot add non literal")

        if isinstance(value, exp.Neg):
            kind_to_op = {"+": "-", "-": "+"}
            value = exp.Literal.string(value.this.to_py())
        else:
            kind_to_op = {"+": "+", "-": "-"}
            value.set("is_string", True)

        return f"{this} {kind_to_op[kind]} {self.sql(exp.Interval(this=value, unit=unit))}"

    return func


class Teradata(Dialect):
    SUPPORTS_SEMI_ANTI_JOIN = False
    TYPED_DIVISION = True

    TIME_MAPPING = {
        "YY": "%y",
        "Y4": "%Y",
        "YYYY": "%Y",
        "M4": "%B",
        "M3": "%b",
        "M": "%-M",
        "MI": "%M",
        "MM": "%m",
        "MMM": "%b",
        "MMMM": "%B",
        "D": "%-d",
        "DD": "%d",
        "D3": "%j",
        "DDD": "%j",
        "H": "%-H",
        "HH": "%H",
        "HH24": "%H",
        "S": "%-S",
        "SS": "%S",
        "SSSSSS": "%f",
        "E": "%a",
        "EE": "%a",
        "E3": "%a",
        "E4": "%A",
        "EEE": "%a",
        "EEEE": "%A",
    }

    class Tokenizer(tokens.Tokenizer):
        # Tested each of these and they work, although there is no
        # Teradata documentation explicitly mentioning them.
        HEX_STRINGS = [("X'", "'"), ("x'", "'"), ("0x", "")]
        # https://docs.teradata.com/r/Teradata-Database-SQL-Functions-Operators-Expressions-and-Predicates/March-2017/Comparison-Operators-and-Functions/Comparison-Operators/ANSI-Compliance
        # https://docs.teradata.com/r/SQL-Functions-Operators-Expressions-and-Predicates/June-2017/Arithmetic-Trigonometric-Hyperbolic-Operators/Functions
        KEYWORDS = {
            **tokens.Tokenizer.KEYWORDS,
            "**": TokenType.DSTAR,
            "^=": TokenType.NEQ,
            "BYTEINT": TokenType.SMALLINT,
            "COLLECT": TokenType.COMMAND,
            "DEL": TokenType.DELETE,
            "EQ": TokenType.EQ,
            "GE": TokenType.GTE,
            "GT": TokenType.GT,
            "HELP": TokenType.COMMAND,
            "INS": TokenType.INSERT,
            "LE": TokenType.LTE,
            "LT": TokenType.LT,
            "MINUS": TokenType.EXCEPT,
            "MOD": TokenType.MOD,
            "NE": TokenType.NEQ,
            "NOT=": TokenType.NEQ,
            "SAMPLE": TokenType.TABLE_SAMPLE,
            "SEL": TokenType.SELECT,
            "ST_GEOMETRY": TokenType.GEOMETRY,
            "TOP": TokenType.TOP,
            "UPD": TokenType.UPDATE,
        }
        KEYWORDS.pop("/*+")

        # Teradata does not support % as a modulo operator
        SINGLE_TOKENS = {**tokens.Tokenizer.SINGLE_TOKENS}
        SINGLE_TOKENS.pop("%")

    class Parser(parser.Parser):
        TABLESAMPLE_CSV = True
        VALUES_FOLLOWED_BY_PAREN = False

        CHARSET_TRANSLATORS = {
            "GRAPHIC_TO_KANJISJIS",
            "GRAPHIC_TO_LATIN",
            "GRAPHIC_TO_UNICODE",
            "GRAPHIC_TO_UNICODE_PadSpace",
            "KANJI1_KanjiEBCDIC_TO_UNICODE",
            "KANJI1_KanjiEUC_TO_UNICODE",
            "KANJI1_KANJISJIS_TO_UNICODE",
            "KANJI1_SBC_TO_UNICODE",
            "KANJISJIS_TO_GRAPHIC",
            "KANJISJIS_TO_LATIN",
            "KANJISJIS_TO_UNICODE",
            "LATIN_TO_GRAPHIC",
            "LATIN_TO_KANJISJIS",
            "LATIN_TO_UNICODE",
            "LOCALE_TO_UNICODE",
            "UNICODE_TO_GRAPHIC",
            "UNICODE_TO_GRAPHIC_PadGraphic",
            "UNICODE_TO_GRAPHIC_VarGraphic",
            "UNICODE_TO_KANJI1_KanjiEBCDIC",
            "UNICODE_TO_KANJI1_KanjiEUC",
            "UNICODE_TO_KANJI1_KANJISJIS",
            "UNICODE_TO_KANJI1_SBC",
            "UNICODE_TO_KANJISJIS",
            "UNICODE_TO_LATIN",
            "UNICODE_TO_LOCALE",
            "UNICODE_TO_UNICODE_FoldSpace",
            "UNICODE_TO_UNICODE_Fullwidth",
            "UNICODE_TO_UNICODE_Halfwidth",
            "UNICODE_TO_UNICODE_NFC",
            "UNICODE_TO_UNICODE_NFD",
            "UNICODE_TO_UNICODE_NFKC",
            "UNICODE_TO_UNICODE_NFKD",
        }

        FUNC_TOKENS = {*parser.Parser.FUNC_TOKENS}
        FUNC_TOKENS.remove(TokenType.REPLACE)

        STATEMENT_PARSERS = {
            **parser.Parser.STATEMENT_PARSERS,
            TokenType.DATABASE: lambda self: self.expression(
                exp.Use, this=self._parse_table(schema=False)
            ),
            TokenType.REPLACE: lambda self: self._parse_create(),
        }

        FUNCTION_PARSERS = {
            **parser.Parser.FUNCTION_PARSERS,
            # https://docs.teradata.com/r/SQL-Functions-Operators-Expressions-and-Predicates/June-2017/Data-Type-Conversions/TRYCAST
            "TRYCAST": parser.Parser.FUNCTION_PARSERS["TRY_CAST"],
            "RANGE_N": lambda self: self._parse_rangen(),
            "TRANSLATE": lambda self: self._parse_translate(self.STRICT_CAST),
        }

        FUNCTIONS = {
            **parser.Parser.FUNCTIONS,
            "CARDINALITY": exp.ArraySize.from_arg_list,
            "RANDOM": lambda args: exp.Rand(lower=seq_get(args, 0), upper=seq_get(args, 1)),
        }

        EXPONENT = {
            TokenType.DSTAR: exp.Pow,
        }

        def _parse_translate(self, strict: bool) -> exp.Expression:
            this = self._parse_assignment()

            if not self._match(TokenType.USING):
                self.raise_error("Expected USING in TRANSLATE")

            if self._match_texts(self.CHARSET_TRANSLATORS):
                charset_split = self._prev.text.split("_TO_")
                to = self.expression(exp.CharacterSet, this=charset_split[1])
            else:
                self.raise_error("Expected a character set translator after USING in TRANSLATE")

            return self.expression(exp.Cast if strict else exp.TryCast, this=this, to=to)

        # FROM before SET in Teradata UPDATE syntax
        # https://docs.teradata.com/r/Enterprise_IntelliFlex_VMware/Teradata-VantageTM-SQL-Data-Manipulation-Language-17.20/Statement-Syntax/UPDATE/UPDATE-Syntax-Basic-Form-FROM-Clause
        def _parse_update(self) -> exp.Update:
            return self.expression(
                exp.Update,
                **{  # type: ignore
                    "this": self._parse_table(alias_tokens=self.UPDATE_ALIAS_TOKENS),
                    "from": self._parse_from(joins=True),
                    "expressions": self._match(TokenType.SET)
                    and self._parse_csv(self._parse_equality),
                    "where": self._parse_where(),
                },
            )

        def _parse_rangen(self):
            this = self._parse_id_var()
            self._match(TokenType.BETWEEN)

            expressions = self._parse_csv(self._parse_assignment)
            each = self._match_text_seq("EACH") and self._parse_assignment()

            return self.expression(exp.RangeN, this=this, expressions=expressions, each=each)

        def _parse_index_params(self) -> exp.IndexParameters:
            this = super()._parse_index_params()

            if this.args.get("on"):
                this.set("on", None)
                self._retreat(self._index - 2)
            return this

    class Generator(generator.Generator):
        LIMIT_IS_TOP = True
        JOIN_HINTS = False
        TABLE_HINTS = False
        QUERY_HINTS = False
        TABLESAMPLE_KEYWORDS = "SAMPLE"
        LAST_DAY_SUPPORTS_DATE_PART = False
        CAN_IMPLEMENT_ARRAY_ANY = True
        TZ_TO_WITH_TIME_ZONE = True
        ARRAY_SIZE_NAME = "CARDINALITY"

        TYPE_MAPPING = {
            **generator.Generator.TYPE_MAPPING,
            exp.DataType.Type.GEOMETRY: "ST_GEOMETRY",
            exp.DataType.Type.DOUBLE: "DOUBLE PRECISION",
            exp.DataType.Type.TIMESTAMPTZ: "TIMESTAMP",
        }

        PROPERTIES_LOCATION = {
            **generator.Generator.PROPERTIES_LOCATION,
            exp.OnCommitProperty: exp.Properties.Location.POST_INDEX,
            exp.PartitionedByProperty: exp.Properties.Location.POST_EXPRESSION,
            exp.StabilityProperty: exp.Properties.Location.POST_CREATE,
        }

        TRANSFORMS = {
            **generator.Generator.TRANSFORMS,
            exp.ArgMax: rename_func("MAX_BY"),
            exp.ArgMin: rename_func("MIN_BY"),
            exp.Max: max_or_greatest,
            exp.Min: min_or_least,
            exp.Pow: lambda self, e: self.binary(e, "**"),
            exp.Rand: lambda self, e: self.func("RANDOM", e.args.get("lower"), e.args.get("upper")),
            exp.Select: transforms.preprocess(
                [transforms.eliminate_distinct_on, transforms.eliminate_semi_and_anti_joins]
            ),
            exp.StrToDate: lambda self,
            e: f"CAST({self.sql(e, 'this')} AS DATE FORMAT {self.format_time(e)})",
            exp.ToChar: lambda self, e: self.function_fallback_sql(e),
            exp.ToNumber: to_number_with_nls_param,
            exp.Use: lambda self, e: f"DATABASE {self.sql(e, 'this')}",
            exp.DateAdd: _date_add_sql("+"),
            exp.DateSub: _date_add_sql("-"),
            exp.Quarter: lambda self, e: self.sql(exp.Extract(this="QUARTER", expression=e.this)),
        }

        def currenttimestamp_sql(self, expression: exp.CurrentTimestamp) -> str:
            prefix, suffix = ("(", ")") if expression.this else ("", "")
            return self.func("CURRENT_TIMESTAMP", expression.this, prefix=prefix, suffix=suffix)

        def cast_sql(self, expression: exp.Cast, safe_prefix: t.Optional[str] = None) -> str:
            if expression.to.this == exp.DataType.Type.UNKNOWN and expression.args.get("format"):
                # We don't actually want to print the unknown type in CAST(<value> AS FORMAT <format>)
                expression.to.pop()

            return super().cast_sql(expression, safe_prefix=safe_prefix)

        def trycast_sql(self, expression: exp.TryCast) -> str:
            return self.cast_sql(expression, safe_prefix="TRY")

        def tablesample_sql(
            self,
            expression: exp.TableSample,
            tablesample_keyword: t.Optional[str] = None,
        ) -> str:
            return f"{self.sql(expression, 'this')} SAMPLE {self.expressions(expression)}"

        def partitionedbyproperty_sql(self, expression: exp.PartitionedByProperty) -> str:
            return f"PARTITION BY {self.sql(expression, 'this')}"

        # FROM before SET in Teradata UPDATE syntax
        # https://docs.teradata.com/r/Enterprise_IntelliFlex_VMware/Teradata-VantageTM-SQL-Data-Manipulation-Language-17.20/Statement-Syntax/UPDATE/UPDATE-Syntax-Basic-Form-FROM-Clause
        def update_sql(self, expression: exp.Update) -> str:
            this = self.sql(expression, "this")
            from_sql = self.sql(expression, "from")
            set_sql = self.expressions(expression, flat=True)
            where_sql = self.sql(expression, "where")
            sql = f"UPDATE {this}{from_sql} SET {set_sql}{where_sql}"
            return self.prepend_ctes(expression, sql)

        def mod_sql(self, expression: exp.Mod) -> str:
            return self.binary(expression, "MOD")

        def datatype_sql(self, expression: exp.DataType) -> str:
            type_sql = super().datatype_sql(expression)
            prefix_sql = expression.args.get("prefix")
            return f"SYSUDTLIB.{type_sql}" if prefix_sql else type_sql

        def rangen_sql(self, expression: exp.RangeN) -> str:
            this = self.sql(expression, "this")
            expressions_sql = self.expressions(expression)
            each_sql = self.sql(expression, "each")
            each_sql = f" EACH {each_sql}" if each_sql else ""

            return f"RANGE_N({this} BETWEEN {expressions_sql}{each_sql})"

        def createable_sql(self, expression: exp.Create, locations: t.DefaultDict) -> str:
            kind = self.sql(expression, "kind").upper()
            if kind == "TABLE" and locations.get(exp.Properties.Location.POST_NAME):
                this_name = self.sql(expression.this, "this")
                this_properties = self.properties(
                    exp.Properties(expressions=locations[exp.Properties.Location.POST_NAME]),
                    wrapped=False,
                    prefix=",",
                )
                this_schema = self.schema_columns_sql(expression.this)
                return f"{this_name}{this_properties}{self.sep()}{this_schema}"

            return super().createable_sql(expression, locations)

        def extract_sql(self, expression: exp.Extract) -> str:
            this = self.sql(expression, "this")
            if this.upper() != "QUARTER":
                return super().extract_sql(expression)

            to_char = exp.func("to_char", expression.expression, exp.Literal.string("Q"))
            return self.sql(exp.cast(to_char, exp.DataType.Type.INT))

        def interval_sql(self, expression: exp.Interval) -> str:
            multiplier = 0
            unit = expression.text("unit")

            if unit.startswith("WEEK"):
                multiplier = 7
            elif unit.startswith("QUARTER"):
                multiplier = 90

            if multiplier:
                return f"({multiplier} * {super().interval_sql(exp.Interval(this=expression.this, unit=exp.var('DAY')))})"

            return super().interval_sql(expression)
