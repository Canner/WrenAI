from __future__ import annotations

from itertools import chain
from typing import TYPE_CHECKING
from typing import Any
from typing import Iterable
from typing import Literal
from typing import Sequence

from narwhals._spark_like.utils import native_to_narwhals_dtype
from narwhals._spark_like.utils import parse_exprs_and_named_exprs
from narwhals.utils import Implementation
from narwhals.utils import check_column_exists
from narwhals.utils import flatten
from narwhals.utils import parse_columns_to_drop
from narwhals.utils import parse_version
from narwhals.utils import validate_backend_version

if TYPE_CHECKING:
    from pyspark.sql import DataFrame
    from typing_extensions import Self

    from narwhals._spark_like.expr import SparkLikeExpr
    from narwhals._spark_like.group_by import SparkLikeLazyGroupBy
    from narwhals._spark_like.namespace import SparkLikeNamespace
    from narwhals._spark_like.typing import IntoSparkLikeExpr
    from narwhals.dtypes import DType
    from narwhals.utils import Version


class SparkLikeLazyFrame:
    def __init__(
        self,
        native_dataframe: DataFrame,
        *,
        backend_version: tuple[int, ...],
        version: Version,
    ) -> None:
        self._native_frame = native_dataframe
        self._backend_version = backend_version
        self._implementation = Implementation.PYSPARK
        self._version = version
        validate_backend_version(self._implementation, self._backend_version)

    def __native_namespace__(self) -> Any:  # pragma: no cover
        if self._implementation is Implementation.PYSPARK:
            return self._implementation.to_native_namespace()

        msg = f"Expected pyspark, got: {type(self._implementation)}"  # pragma: no cover
        raise AssertionError(msg)

    def __narwhals_namespace__(self) -> SparkLikeNamespace:
        from narwhals._spark_like.namespace import SparkLikeNamespace

        return SparkLikeNamespace(
            backend_version=self._backend_version, version=self._version
        )

    def __narwhals_lazyframe__(self) -> Self:
        return self

    def _change_version(self, version: Version) -> Self:
        return self.__class__(
            self._native_frame, backend_version=self._backend_version, version=version
        )

    def _from_native_frame(self, df: DataFrame) -> Self:
        return self.__class__(
            df, backend_version=self._backend_version, version=self._version
        )

    @property
    def columns(self) -> list[str]:
        return self._native_frame.columns  # type: ignore[no-any-return]

    def collect(self) -> Any:
        import pandas as pd  # ignore-banned-import()

        from narwhals._pandas_like.dataframe import PandasLikeDataFrame

        return PandasLikeDataFrame(
            native_dataframe=self._native_frame.toPandas(),
            implementation=Implementation.PANDAS,
            backend_version=parse_version(pd.__version__),
            version=self._version,
        )

    def select(
        self: Self,
        *exprs: IntoSparkLikeExpr,
        **named_exprs: IntoSparkLikeExpr,
    ) -> Self:
        if exprs and all(isinstance(x, str) for x in exprs) and not named_exprs:
            # This is a simple select
            return self._from_native_frame(self._native_frame.select(*exprs))

        new_columns = parse_exprs_and_named_exprs(self, *exprs, **named_exprs)

        if not new_columns:
            # return empty dataframe, like Polars does
            from pyspark.sql.types import StructType

            spark_session = self._native_frame.sparkSession
            spark_df = spark_session.createDataFrame([], StructType([]))

            return self._from_native_frame(spark_df)

        new_columns_list = [col.alias(col_name) for col_name, col in new_columns.items()]
        return self._from_native_frame(self._native_frame.select(*new_columns_list))

    def filter(self, *predicates: SparkLikeExpr, **constraints: Any) -> Self:
        plx = self.__narwhals_namespace__()
        expr = plx.all_horizontal(
            *chain(predicates, (plx.col(name) == v for name, v in constraints.items()))
        )
        # `[0]` is safe as all_horizontal's expression only returns a single column
        condition = expr._call(self)[0]
        spark_df = self._native_frame.where(condition)
        return self._from_native_frame(spark_df)

    @property
    def schema(self) -> dict[str, DType]:
        return {
            field.name: native_to_narwhals_dtype(
                dtype=field.dataType, version=self._version
            )
            for field in self._native_frame.schema
        }

    def collect_schema(self) -> dict[str, DType]:
        return self.schema

    def with_columns(
        self: Self,
        *exprs: IntoSparkLikeExpr,
        **named_exprs: IntoSparkLikeExpr,
    ) -> Self:
        new_columns_map = parse_exprs_and_named_exprs(self, *exprs, **named_exprs)
        return self._from_native_frame(self._native_frame.withColumns(new_columns_map))

    def drop(self: Self, columns: list[str], strict: bool) -> Self:  # noqa: FBT001
        columns_to_drop = parse_columns_to_drop(
            compliant_frame=self, columns=columns, strict=strict
        )
        return self._from_native_frame(self._native_frame.drop(*columns_to_drop))

    def head(self: Self, n: int) -> Self:
        spark_session = self._native_frame.sparkSession

        return self._from_native_frame(
            spark_session.createDataFrame(self._native_frame.take(num=n))
        )

    def group_by(self: Self, *keys: str, drop_null_keys: bool) -> SparkLikeLazyGroupBy:
        from narwhals._spark_like.group_by import SparkLikeLazyGroupBy

        return SparkLikeLazyGroupBy(
            df=self, keys=list(keys), drop_null_keys=drop_null_keys
        )

    def sort(
        self: Self,
        by: str | Iterable[str],
        *more_by: str,
        descending: bool | Sequence[bool] = False,
        nulls_last: bool = False,
    ) -> Self:
        import pyspark.sql.functions as F  # noqa: N812

        flat_by = flatten([*flatten([by]), *more_by])
        if isinstance(descending, bool):
            descending = [descending] * len(flat_by)

        if nulls_last:
            sort_funcs = (
                F.desc_nulls_last if d else F.asc_nulls_last for d in descending
            )
        else:
            sort_funcs = (
                F.desc_nulls_first if d else F.asc_nulls_first for d in descending
            )

        sort_cols = [sort_f(col) for col, sort_f in zip(flat_by, sort_funcs)]
        return self._from_native_frame(self._native_frame.sort(*sort_cols))

    def drop_nulls(self: Self, subset: str | list[str] | None) -> Self:
        return self._from_native_frame(self._native_frame.dropna(subset=subset))

    def rename(self: Self, mapping: dict[str, str]) -> Self:
        import pyspark.sql.functions as F  # noqa: N812

        rename_mapping = {
            colname: mapping.get(colname, colname) for colname in self.columns
        }
        return self._from_native_frame(
            self._native_frame.select(
                [F.col(old).alias(new) for old, new in rename_mapping.items()]
            )
        )

    def unique(
        self: Self,
        subset: list[str] | None = None,
        *,
        keep: Literal["any", "none"],
    ) -> Self:
        if keep != "any":
            msg = "`LazyFrame.unique` with PySpark backend only supports `keep='any'`."
            raise ValueError(msg)
        check_column_exists(self.columns, subset)
        return self._from_native_frame(self._native_frame.dropDuplicates(subset=subset))

    def join(
        self,
        other: Self,
        how: Literal["inner", "left", "cross", "semi", "anti"],
        left_on: str | list[str] | None,
        right_on: str | list[str] | None,
        suffix: str,
    ) -> Self:
        import pyspark.sql.functions as F  # noqa: N812

        self_native = self._native_frame
        other_native = other._native_frame

        left_columns = self.columns
        right_columns = other.columns

        if isinstance(left_on, str):
            left_on = [left_on]
        if isinstance(right_on, str):
            right_on = [right_on]

        # create a mapping for columns on other
        # `right_on` columns will be renamed as `left_on`
        # the remaining columns will be either added the suffix or left unchanged.
        rename_mapping = {
            **dict(zip(right_on or [], left_on or [])),
            **{
                colname: f"{colname}{suffix}" if colname in left_columns else colname
                for colname in list(set(right_columns).difference(set(right_on or [])))
            },
        }
        other = other_native.select(
            [F.col(old).alias(new) for old, new in rename_mapping.items()]
        )

        # If how in {"semi", "anti"}, then resulting columns are same as left columns
        # Otherwise, we add the right columns with the new mapping, while keeping the
        # original order of right_columns.
        col_order = left_columns

        if how in {"inner", "left", "cross"}:
            col_order.extend(
                [
                    rename_mapping[colname]
                    for colname in right_columns
                    if colname not in (right_on or [])
                ]
            )

        return self._from_native_frame(
            self_native.join(other=other, on=left_on, how=how).select(col_order)
        )
