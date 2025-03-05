from __future__ import annotations

from sqlglot import exp
from sqlglot.helper import seq_get
from sqlglot.dialects.postgres import Postgres

from sqlglot.tokens import TokenType
from sqlglot.transforms import (
    remove_unique_constraints,
    ctas_with_tmp_tables_to_create_tmp_view,
    preprocess,
)
import typing as t


class Materialize(Postgres):
    class Parser(Postgres.Parser):
        NO_PAREN_FUNCTION_PARSERS = {
            **Postgres.Parser.NO_PAREN_FUNCTION_PARSERS,
            "MAP": lambda self: self._parse_map(),
        }

        LAMBDAS = {
            **Postgres.Parser.LAMBDAS,
            TokenType.FARROW: lambda self, expressions: self.expression(
                exp.Kwarg, this=seq_get(expressions, 0), expression=self._parse_assignment()
            ),
        }

        def _parse_lambda_arg(self) -> t.Optional[exp.Expression]:
            return self._parse_field()

        def _parse_map(self) -> exp.ToMap:
            if self._match(TokenType.L_PAREN):
                to_map = self.expression(exp.ToMap, this=self._parse_select())
                self._match_r_paren()
                return to_map

            if not self._match(TokenType.L_BRACKET):
                self.raise_error("Expecting [")

            entries = [
                exp.PropertyEQ(this=e.this, expression=e.expression)
                for e in self._parse_csv(self._parse_lambda)
            ]

            if not self._match(TokenType.R_BRACKET):
                self.raise_error("Expecting ]")

            return self.expression(exp.ToMap, this=self.expression(exp.Struct, expressions=entries))

    class Generator(Postgres.Generator):
        SUPPORTS_CREATE_TABLE_LIKE = False

        TRANSFORMS = {
            **Postgres.Generator.TRANSFORMS,
            exp.AutoIncrementColumnConstraint: lambda self, e: "",
            exp.Create: preprocess(
                [
                    remove_unique_constraints,
                    ctas_with_tmp_tables_to_create_tmp_view,
                ]
            ),
            exp.GeneratedAsIdentityColumnConstraint: lambda self, e: "",
            exp.OnConflict: lambda self, e: "",
            exp.PrimaryKeyColumnConstraint: lambda self, e: "",
        }
        TRANSFORMS.pop(exp.ToMap)

        def propertyeq_sql(self, expression: exp.PropertyEQ) -> str:
            return self.binary(expression, "=>")

        def datatype_sql(self, expression: exp.DataType) -> str:
            if expression.is_type(exp.DataType.Type.LIST):
                if expression.expressions:
                    return f"{self.expressions(expression, flat=True)} LIST"
                return "LIST"

            if expression.is_type(exp.DataType.Type.MAP) and len(expression.expressions) == 2:
                key, value = expression.expressions
                return f"MAP[{self.sql(key)} => {self.sql(value)}]"

            return super().datatype_sql(expression)

        def list_sql(self, expression: exp.List) -> str:
            if isinstance(seq_get(expression.expressions, 0), exp.Select):
                return self.func("LIST", seq_get(expression.expressions, 0))

            return f"{self.normalize_func('LIST')}[{self.expressions(expression, flat=True)}]"

        def tomap_sql(self, expression: exp.ToMap) -> str:
            if isinstance(expression.this, exp.Select):
                return self.func("MAP", expression.this)
            return f"{self.normalize_func('MAP')}[{self.expressions(expression.this)}]"
