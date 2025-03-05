from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING
from typing import Any

from narwhals.exceptions import InvalidIntoExprError
from narwhals.utils import import_dtypes_module

if TYPE_CHECKING:
    from pyspark.sql import Column
    from pyspark.sql import types as pyspark_types

    from narwhals._spark_like.dataframe import SparkLikeLazyFrame
    from narwhals._spark_like.typing import IntoSparkLikeExpr
    from narwhals.dtypes import DType
    from narwhals.utils import Version


@lru_cache(maxsize=16)
def native_to_narwhals_dtype(
    dtype: pyspark_types.DataType,
    version: Version,
) -> DType:  # pragma: no cover
    dtypes = import_dtypes_module(version=version)
    from pyspark.sql import types as pyspark_types

    if isinstance(dtype, pyspark_types.DoubleType):
        return dtypes.Float64()
    if isinstance(dtype, pyspark_types.FloatType):
        return dtypes.Float32()
    if isinstance(dtype, pyspark_types.LongType):
        return dtypes.Int64()
    if isinstance(dtype, pyspark_types.IntegerType):
        return dtypes.Int32()
    if isinstance(dtype, pyspark_types.ShortType):
        return dtypes.Int16()
    string_types = [
        pyspark_types.StringType,
        pyspark_types.VarcharType,
        pyspark_types.CharType,
    ]
    if any(isinstance(dtype, t) for t in string_types):
        return dtypes.String()
    if isinstance(dtype, pyspark_types.BooleanType):
        return dtypes.Boolean()
    if isinstance(dtype, pyspark_types.DateType):
        return dtypes.Date()
    datetime_types = [
        pyspark_types.TimestampType,
        pyspark_types.TimestampNTZType,
    ]
    if any(isinstance(dtype, t) for t in datetime_types):
        return dtypes.Datetime()
    if isinstance(dtype, pyspark_types.DecimalType):  # pragma: no cover
        # TODO(unassigned): cover this in dtypes_test.py
        return dtypes.Decimal()
    return dtypes.Unknown()


def get_column_name(df: SparkLikeLazyFrame, column: Column) -> str:
    return str(df._native_frame.select(column).columns[0])


def _columns_from_expr(df: SparkLikeLazyFrame, expr: IntoSparkLikeExpr) -> list[Column]:
    if isinstance(expr, str):  # pragma: no cover
        from pyspark.sql import functions as F  # noqa: N812

        return [F.col(expr)]
    elif hasattr(expr, "__narwhals_expr__"):
        col_output_list = expr._call(df)
        if expr._output_names is not None and (
            len(col_output_list) != len(expr._output_names)
        ):  # pragma: no cover
            msg = "Safety assertion failed, please report a bug to https://github.com/narwhals-dev/narwhals/issues"
            raise AssertionError(msg)
        return col_output_list
    else:
        raise InvalidIntoExprError.from_invalid_type(type(expr))


def parse_exprs_and_named_exprs(
    df: SparkLikeLazyFrame, *exprs: IntoSparkLikeExpr, **named_exprs: IntoSparkLikeExpr
) -> dict[str, Column]:
    result_columns: dict[str, list[Column]] = {}
    for expr in exprs:
        column_list = _columns_from_expr(df, expr)
        if isinstance(expr, str):  # pragma: no cover
            output_names = [expr]
        elif expr._output_names is None:
            output_names = [get_column_name(df, col) for col in column_list]
        else:
            output_names = expr._output_names
        result_columns.update(zip(output_names, column_list))
    for col_alias, expr in named_exprs.items():
        columns_list = _columns_from_expr(df, expr)
        if len(columns_list) != 1:  # pragma: no cover
            msg = "Named expressions must return a single column"
            raise AssertionError(msg)
        result_columns[col_alias] = columns_list[0]
    return result_columns


def maybe_evaluate(df: SparkLikeLazyFrame, obj: Any) -> Any:
    from narwhals._spark_like.expr import SparkLikeExpr

    if isinstance(obj, SparkLikeExpr):
        column_results = obj._call(df)
        if len(column_results) != 1:  # pragma: no cover
            msg = "Multi-output expressions (e.g. `nw.all()` or `nw.col('a', 'b')`) not supported in this context"
            raise NotImplementedError(msg)
        column_result = column_results[0]
        if obj._returns_scalar:
            # Return scalar, let PySpark do its broadcasting
            from pyspark.sql import functions as F  # noqa: N812
            from pyspark.sql.window import Window

            return column_result.over(Window.partitionBy(F.lit(1)))
        return column_result
    return obj


def _std(_input: Column | str, ddof: int, np_version: tuple[int, ...]) -> Column:
    if np_version > (2, 0):
        from pyspark.sql import functions as F  # noqa: N812

        if ddof == 1:
            return F.stddev_samp(_input)

        n_rows = F.count(_input)
        return F.stddev_samp(_input) * F.sqrt((n_rows - 1) / (n_rows - ddof))

    from pyspark.pandas.spark.functions import stddev
    from pyspark.sql import functions as F  # noqa: N812

    input_col = F.col(_input) if isinstance(_input, str) else _input
    return stddev(input_col, ddof=ddof)


def _var(_input: Column | str, ddof: int, np_version: tuple[int, ...]) -> Column:
    if np_version > (2, 0):
        from pyspark.sql import functions as F  # noqa: N812

        if ddof == 1:
            return F.var_samp(_input)

        n_rows = F.count(_input)
        return F.var_samp(_input) * (n_rows - 1) / (n_rows - ddof)

    from pyspark.pandas.spark.functions import var
    from pyspark.sql import functions as F  # noqa: N812

    input_col = F.col(_input) if isinstance(_input, str) else _input
    return var(input_col, ddof=ddof)
