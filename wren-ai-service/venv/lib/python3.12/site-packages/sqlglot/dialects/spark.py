from __future__ import annotations

import typing as t

from sqlglot import exp
from sqlglot.dialects.dialect import rename_func, unit_to_var, timestampdiff_sql, build_date_delta
from sqlglot.dialects.hive import _build_with_ignore_nulls
from sqlglot.dialects.spark2 import Spark2, temporary_storage_provider, _build_as_cast
from sqlglot.helper import ensure_list, seq_get
from sqlglot.transforms import (
    ctas_with_tmp_tables_to_create_tmp_view,
    remove_unique_constraints,
    preprocess,
    move_partitioned_by_to_schema_columns,
)


def _build_datediff(args: t.List) -> exp.Expression:
    """
    Although Spark docs don't mention the "unit" argument, Spark3 added support for
    it at some point. Databricks also supports this variant (see below).

    For example, in spark-sql (v3.3.1):
    - SELECT DATEDIFF('2020-01-01', '2020-01-05') results in -4
    - SELECT DATEDIFF(day, '2020-01-01', '2020-01-05') results in 4

    See also:
    - https://docs.databricks.com/sql/language-manual/functions/datediff3.html
    - https://docs.databricks.com/sql/language-manual/functions/datediff.html
    """
    unit = None
    this = seq_get(args, 0)
    expression = seq_get(args, 1)

    if len(args) == 3:
        unit = exp.var(t.cast(exp.Expression, this).name)
        this = args[2]

    return exp.DateDiff(
        this=exp.TsOrDsToDate(this=this), expression=exp.TsOrDsToDate(this=expression), unit=unit
    )


def _build_dateadd(args: t.List) -> exp.Expression:
    expression = seq_get(args, 1)

    if len(args) == 2:
        # DATE_ADD(startDate, numDays INTEGER)
        # https://docs.databricks.com/en/sql/language-manual/functions/date_add.html
        return exp.TsOrDsAdd(
            this=seq_get(args, 0), expression=expression, unit=exp.Literal.string("DAY")
        )

    # DATE_ADD / DATEADD / TIMESTAMPADD(unit, value integer, expr)
    # https://docs.databricks.com/en/sql/language-manual/functions/date_add3.html
    return exp.TimestampAdd(this=seq_get(args, 2), expression=expression, unit=seq_get(args, 0))


def _normalize_partition(e: exp.Expression) -> exp.Expression:
    """Normalize the expressions in PARTITION BY (<expression>, <expression>, ...)"""
    if isinstance(e, str):
        return exp.to_identifier(e)
    if isinstance(e, exp.Literal):
        return exp.to_identifier(e.name)
    return e


def _dateadd_sql(self: Spark.Generator, expression: exp.TsOrDsAdd | exp.TimestampAdd) -> str:
    if not expression.unit or (
        isinstance(expression, exp.TsOrDsAdd) and expression.text("unit").upper() == "DAY"
    ):
        # Coming from Hive/Spark2 DATE_ADD or roundtripping the 2-arg version of Spark3/DB
        return self.func("DATE_ADD", expression.this, expression.expression)

    this = self.func(
        "DATE_ADD",
        unit_to_var(expression),
        expression.expression,
        expression.this,
    )

    if isinstance(expression, exp.TsOrDsAdd):
        # The 3 arg version of DATE_ADD produces a timestamp in Spark3/DB but possibly not
        # in other dialects
        return_type = expression.return_type
        if not return_type.is_type(exp.DataType.Type.TIMESTAMP, exp.DataType.Type.DATETIME):
            this = f"CAST({this} AS {return_type})"

    return this


class Spark(Spark2):
    SUPPORTS_ORDER_BY_ALL = True

    class Tokenizer(Spark2.Tokenizer):
        STRING_ESCAPES_ALLOWED_IN_RAW_STRINGS = False

        RAW_STRINGS = [
            (prefix + q, q)
            for q in t.cast(t.List[str], Spark2.Tokenizer.QUOTES)
            for prefix in ("r", "R")
        ]

    class Parser(Spark2.Parser):
        FUNCTIONS = {
            **Spark2.Parser.FUNCTIONS,
            "ANY_VALUE": _build_with_ignore_nulls(exp.AnyValue),
            "DATE_ADD": _build_dateadd,
            "DATEADD": _build_dateadd,
            "TIMESTAMPADD": _build_dateadd,
            "TIMESTAMPDIFF": build_date_delta(exp.TimestampDiff),
            "DATEDIFF": _build_datediff,
            "DATE_DIFF": _build_datediff,
            "TIMESTAMP_LTZ": _build_as_cast("TIMESTAMP_LTZ"),
            "TIMESTAMP_NTZ": _build_as_cast("TIMESTAMP_NTZ"),
            "TRY_ELEMENT_AT": lambda args: exp.Bracket(
                this=seq_get(args, 0),
                expressions=ensure_list(seq_get(args, 1)),
                offset=1,
                safe=True,
            ),
        }

        def _parse_generated_as_identity(
            self,
        ) -> (
            exp.GeneratedAsIdentityColumnConstraint
            | exp.ComputedColumnConstraint
            | exp.GeneratedAsRowColumnConstraint
        ):
            this = super()._parse_generated_as_identity()
            if this.expression:
                return self.expression(exp.ComputedColumnConstraint, this=this.expression)
            return this

    class Generator(Spark2.Generator):
        SUPPORTS_TO_NUMBER = True
        PAD_FILL_PATTERN_IS_REQUIRED = False
        SUPPORTS_CONVERT_TIMEZONE = True
        SUPPORTS_MEDIAN = True
        SUPPORTS_UNIX_SECONDS = True

        TYPE_MAPPING = {
            **Spark2.Generator.TYPE_MAPPING,
            exp.DataType.Type.MONEY: "DECIMAL(15, 4)",
            exp.DataType.Type.SMALLMONEY: "DECIMAL(6, 4)",
            exp.DataType.Type.UNIQUEIDENTIFIER: "STRING",
            exp.DataType.Type.TIMESTAMPLTZ: "TIMESTAMP_LTZ",
            exp.DataType.Type.TIMESTAMPNTZ: "TIMESTAMP_NTZ",
        }

        TRANSFORMS = {
            **Spark2.Generator.TRANSFORMS,
            exp.ArrayConstructCompact: lambda self, e: self.func(
                "ARRAY_COMPACT", self.func("ARRAY", *e.expressions)
            ),
            exp.Create: preprocess(
                [
                    remove_unique_constraints,
                    lambda e: ctas_with_tmp_tables_to_create_tmp_view(
                        e, temporary_storage_provider
                    ),
                    move_partitioned_by_to_schema_columns,
                ]
            ),
            exp.PartitionedByProperty: lambda self,
            e: f"PARTITIONED BY {self.wrap(self.expressions(sqls=[_normalize_partition(e) for e in e.this.expressions], skip_first=True))}",
            exp.StartsWith: rename_func("STARTSWITH"),
            exp.TsOrDsAdd: _dateadd_sql,
            exp.TimestampAdd: _dateadd_sql,
            exp.DatetimeDiff: timestampdiff_sql,
            exp.TimestampDiff: timestampdiff_sql,
            exp.TryCast: lambda self, e: (
                self.trycast_sql(e) if e.args.get("safe") else self.cast_sql(e)
            ),
        }
        TRANSFORMS.pop(exp.AnyValue)
        TRANSFORMS.pop(exp.DateDiff)
        TRANSFORMS.pop(exp.Group)

        def bracket_sql(self, expression: exp.Bracket) -> str:
            if expression.args.get("safe"):
                key = seq_get(self.bracket_offset_expressions(expression, index_offset=1), 0)
                return self.func("TRY_ELEMENT_AT", expression.this, key)

            return super().bracket_sql(expression)

        def computedcolumnconstraint_sql(self, expression: exp.ComputedColumnConstraint) -> str:
            return f"GENERATED ALWAYS AS ({self.sql(expression, 'this')})"

        def anyvalue_sql(self, expression: exp.AnyValue) -> str:
            return self.function_fallback_sql(expression)

        def datediff_sql(self, expression: exp.DateDiff) -> str:
            end = self.sql(expression, "this")
            start = self.sql(expression, "expression")

            if expression.unit:
                return self.func("DATEDIFF", unit_to_var(expression), start, end)

            return self.func("DATEDIFF", end, start)
