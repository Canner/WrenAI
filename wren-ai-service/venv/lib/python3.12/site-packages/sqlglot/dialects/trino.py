from __future__ import annotations

from sqlglot import exp, parser
from sqlglot.dialects.dialect import merge_without_target_sql, trim_sql, timestrtotime_sql
from sqlglot.dialects.presto import Presto
from sqlglot.tokens import TokenType


class Trino(Presto):
    SUPPORTS_USER_DEFINED_TYPES = False
    LOG_BASE_FIRST = True

    class Tokenizer(Presto.Tokenizer):
        HEX_STRINGS = [("X'", "'")]

    class Parser(Presto.Parser):
        FUNCTION_PARSERS = {
            **Presto.Parser.FUNCTION_PARSERS,
            "TRIM": lambda self: self._parse_trim(),
            "JSON_QUERY": lambda self: self._parse_json_query(),
            "LISTAGG": lambda self: self._parse_string_agg(),
        }

        JSON_QUERY_OPTIONS: parser.OPTIONS_TYPE = {
            **dict.fromkeys(
                ("WITH", "WITHOUT"),
                (
                    ("CONDITIONAL", "WRAPPER"),
                    ("CONDITIONAL", "ARRAY", "WRAPPED"),
                    ("UNCONDITIONAL", "WRAPPER"),
                    ("UNCONDITIONAL", "ARRAY", "WRAPPER"),
                ),
            ),
        }

        def _parse_json_query(self):
            return self.expression(
                exp.JSONExtract,
                this=self._parse_bitwise(),
                expression=self._match(TokenType.COMMA) and self._parse_bitwise(),
                option=self._parse_var_from_options(self.JSON_QUERY_OPTIONS, raise_unmatched=False),
                json_query=True,
            )

    class Generator(Presto.Generator):
        TRANSFORMS = {
            **Presto.Generator.TRANSFORMS,
            exp.ArraySum: lambda self,
            e: f"REDUCE({self.sql(e, 'this')}, 0, (acc, x) -> acc + x, acc -> acc)",
            exp.Merge: merge_without_target_sql,
            exp.TimeStrToTime: lambda self, e: timestrtotime_sql(self, e, include_precision=True),
            exp.Trim: trim_sql,
            exp.JSONExtract: lambda self, e: self.jsonextract_sql(e),
        }

        SUPPORTED_JSON_PATH_PARTS = {
            exp.JSONPathKey,
            exp.JSONPathRoot,
            exp.JSONPathSubscript,
        }

        def jsonextract_sql(self, expression: exp.JSONExtract) -> str:
            if not expression.args.get("json_query"):
                return super().jsonextract_sql(expression)

            json_path = self.sql(expression, "expression")
            option = self.sql(expression, "option")
            option = f" {option}" if option else ""

            return self.func("JSON_QUERY", expression.this, json_path + option)

        def groupconcat_sql(self, expression: exp.GroupConcat) -> str:
            this = expression.this
            separator = expression.args.get("separator") or exp.Literal.string(",")

            if isinstance(this, exp.Order):
                if this.this:
                    this = this.this.pop()

                on_overflow = self.sql(expression, "on_overflow")
                on_overflow = f" ON OVERFLOW {on_overflow}" if on_overflow else ""
                return f"LISTAGG({self.format_args(this, separator)}{on_overflow}) WITHIN GROUP ({self.sql(expression.this).lstrip()})"

            return super().groupconcat_sql(expression)
