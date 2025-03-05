from __future__ import annotations

import typing as t

from sqlglot import exp, transforms, jsonpath
from sqlglot.dialects.dialect import (
    date_delta_sql,
    build_date_delta,
    timestamptrunc_sql,
)
from sqlglot.dialects.spark import Spark
from sqlglot.tokens import TokenType


def _build_json_extract(args: t.List) -> exp.JSONExtract:
    # Transform GET_JSON_OBJECT(expr, '$.<path>') -> expr:<path>
    this = args[0]
    path = args[1].name.lstrip("$.")
    return exp.JSONExtract(this=this, expression=path)


def _jsonextract_sql(
    self: Databricks.Generator, expression: exp.JSONExtract | exp.JSONExtractScalar
) -> str:
    this = self.sql(expression, "this")
    expr = self.sql(expression, "expression")
    return f"{this}:{expr}"


class Databricks(Spark):
    SAFE_DIVISION = False
    COPY_PARAMS_ARE_CSV = False

    class JSONPathTokenizer(jsonpath.JSONPathTokenizer):
        IDENTIFIERS = ["`", '"']

    class Parser(Spark.Parser):
        LOG_DEFAULTS_TO_LN = True
        STRICT_CAST = True
        COLON_IS_VARIANT_EXTRACT = True

        FUNCTIONS = {
            **Spark.Parser.FUNCTIONS,
            "DATEADD": build_date_delta(exp.DateAdd),
            "DATE_ADD": build_date_delta(exp.DateAdd),
            "DATEDIFF": build_date_delta(exp.DateDiff),
            "DATE_DIFF": build_date_delta(exp.DateDiff),
            "GET_JSON_OBJECT": _build_json_extract,
        }

        FACTOR = {
            **Spark.Parser.FACTOR,
            TokenType.COLON: exp.JSONExtract,
        }

    class Generator(Spark.Generator):
        TABLESAMPLE_SEED_KEYWORD = "REPEATABLE"
        COPY_PARAMS_ARE_WRAPPED = False
        COPY_PARAMS_EQ_REQUIRED = True
        JSON_PATH_SINGLE_QUOTE_ESCAPE = False
        QUOTE_JSON_PATH = False

        TRANSFORMS = {
            **Spark.Generator.TRANSFORMS,
            exp.DateAdd: date_delta_sql("DATEADD"),
            exp.DateDiff: date_delta_sql("DATEDIFF"),
            exp.DatetimeAdd: lambda self, e: self.func(
                "TIMESTAMPADD", e.unit, e.expression, e.this
            ),
            exp.DatetimeSub: lambda self, e: self.func(
                "TIMESTAMPADD",
                e.unit,
                exp.Mul(this=e.expression, expression=exp.Literal.number(-1)),
                e.this,
            ),
            exp.DatetimeTrunc: timestamptrunc_sql(),
            exp.Select: transforms.preprocess(
                [
                    transforms.eliminate_distinct_on,
                    transforms.unnest_to_explode,
                    transforms.any_to_exists,
                ]
            ),
            exp.JSONExtract: _jsonextract_sql,
            exp.JSONExtractScalar: _jsonextract_sql,
            exp.JSONPathRoot: lambda *_: "",
            exp.ToChar: lambda self, e: self.function_fallback_sql(e),
        }

        TRANSFORMS.pop(exp.TryCast)

        def columndef_sql(self, expression: exp.ColumnDef, sep: str = " ") -> str:
            constraint = expression.find(exp.GeneratedAsIdentityColumnConstraint)
            kind = expression.kind
            if (
                constraint
                and isinstance(kind, exp.DataType)
                and kind.this in exp.DataType.INTEGER_TYPES
            ):
                # only BIGINT generated identity constraints are supported
                expression.set("kind", exp.DataType.build("bigint"))

            return super().columndef_sql(expression, sep)

        def generatedasidentitycolumnconstraint_sql(
            self, expression: exp.GeneratedAsIdentityColumnConstraint
        ) -> str:
            expression.set("this", True)  # trigger ALWAYS in super class
            return super().generatedasidentitycolumnconstraint_sql(expression)

        def jsonpath_sql(self, expression: exp.JSONPath) -> str:
            expression.set("escape", None)
            return super().jsonpath_sql(expression)
