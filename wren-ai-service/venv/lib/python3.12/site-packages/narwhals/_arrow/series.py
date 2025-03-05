from __future__ import annotations

from typing import TYPE_CHECKING
from typing import Any
from typing import Iterable
from typing import Iterator
from typing import Literal
from typing import Sequence
from typing import overload

from narwhals._arrow.series_cat import ArrowSeriesCatNamespace
from narwhals._arrow.series_dt import ArrowSeriesDateTimeNamespace
from narwhals._arrow.series_list import ArrowSeriesListNamespace
from narwhals._arrow.series_str import ArrowSeriesStringNamespace
from narwhals._arrow.utils import broadcast_and_extract_native
from narwhals._arrow.utils import cast_for_truediv
from narwhals._arrow.utils import floordiv_compat
from narwhals._arrow.utils import narwhals_to_native_dtype
from narwhals._arrow.utils import native_to_narwhals_dtype
from narwhals._arrow.utils import pad_series
from narwhals.typing import CompliantSeries
from narwhals.utils import Implementation
from narwhals.utils import generate_temporary_column_name
from narwhals.utils import import_dtypes_module
from narwhals.utils import validate_backend_version

if TYPE_CHECKING:
    from types import ModuleType

    import numpy as np
    import pandas as pd
    import pyarrow as pa
    from typing_extensions import Self

    from narwhals._arrow.dataframe import ArrowDataFrame
    from narwhals._arrow.namespace import ArrowNamespace
    from narwhals.dtypes import DType
    from narwhals.utils import Version


def maybe_extract_py_scalar(value: Any, return_py_scalar: bool) -> Any:  # noqa: FBT001
    if return_py_scalar:
        return getattr(value, "as_py", lambda: value)()
    return value


class ArrowSeries(CompliantSeries):
    def __init__(
        self: Self,
        native_series: pa.ChunkedArray,
        *,
        name: str,
        backend_version: tuple[int, ...],
        version: Version,
    ) -> None:
        self._name = name
        self._native_series = native_series
        self._implementation = Implementation.PYARROW
        self._backend_version = backend_version
        self._version = version
        validate_backend_version(self._implementation, self._backend_version)

    def _change_version(self: Self, version: Version) -> Self:
        return self.__class__(
            self._native_series,
            name=self._name,
            backend_version=self._backend_version,
            version=version,
        )

    def _from_native_series(self: Self, series: pa.ChunkedArray | pa.Array) -> Self:
        import pyarrow as pa

        if isinstance(series, pa.Array):
            series = pa.chunked_array([series])
        return self.__class__(
            series,
            name=self._name,
            backend_version=self._backend_version,
            version=self._version,
        )

    @classmethod
    def _from_iterable(
        cls: type[Self],
        data: Iterable[Any],
        name: str,
        *,
        backend_version: tuple[int, ...],
        version: Version,
    ) -> Self:
        import pyarrow as pa

        return cls(
            pa.chunked_array([data]),
            name=name,
            backend_version=backend_version,
            version=version,
        )

    def __narwhals_namespace__(self: Self) -> ArrowNamespace:
        from narwhals._arrow.namespace import ArrowNamespace

        return ArrowNamespace(
            backend_version=self._backend_version, version=self._version
        )

    def __len__(self: Self) -> int:
        return len(self._native_series)

    def __eq__(self: Self, other: object) -> Self:  # type: ignore[override]
        import pyarrow.compute as pc

        ser, other = broadcast_and_extract_native(self, other, self._backend_version)
        return self._from_native_series(pc.equal(ser, other))

    def __ne__(self: Self, other: object) -> Self:  # type: ignore[override]
        import pyarrow.compute as pc

        ser, other = broadcast_and_extract_native(self, other, self._backend_version)
        return self._from_native_series(pc.not_equal(ser, other))

    def __ge__(self: Self, other: Any) -> Self:
        import pyarrow.compute as pc

        ser, other = broadcast_and_extract_native(self, other, self._backend_version)
        return self._from_native_series(pc.greater_equal(ser, other))

    def __gt__(self: Self, other: Any) -> Self:
        import pyarrow.compute as pc

        ser, other = broadcast_and_extract_native(self, other, self._backend_version)
        return self._from_native_series(pc.greater(ser, other))

    def __le__(self: Self, other: Any) -> Self:
        import pyarrow.compute as pc

        ser, other = broadcast_and_extract_native(self, other, self._backend_version)
        return self._from_native_series(pc.less_equal(ser, other))

    def __lt__(self: Self, other: Any) -> Self:
        import pyarrow.compute as pc

        ser, other = broadcast_and_extract_native(self, other, self._backend_version)
        return self._from_native_series(pc.less(ser, other))

    def __and__(self: Self, other: Any) -> Self:
        import pyarrow.compute as pc

        ser, other = broadcast_and_extract_native(self, other, self._backend_version)
        return self._from_native_series(pc.and_kleene(ser, other))

    def __rand__(self: Self, other: Any) -> Self:
        import pyarrow.compute as pc

        ser, other = broadcast_and_extract_native(self, other, self._backend_version)
        return self._from_native_series(pc.and_kleene(other, ser))

    def __or__(self: Self, other: Any) -> Self:
        import pyarrow.compute as pc

        ser, other = broadcast_and_extract_native(self, other, self._backend_version)
        return self._from_native_series(pc.or_kleene(ser, other))

    def __ror__(self: Self, other: Any) -> Self:
        import pyarrow.compute as pc

        ser, other = broadcast_and_extract_native(self, other, self._backend_version)
        return self._from_native_series(pc.or_kleene(other, ser))

    def __add__(self: Self, other: Any) -> Self:
        import pyarrow.compute as pc

        ser, other = broadcast_and_extract_native(self, other, self._backend_version)
        return self._from_native_series(pc.add(ser, other))

    def __radd__(self: Self, other: Any) -> Self:
        return self + other  # type: ignore[no-any-return]

    def __sub__(self: Self, other: Any) -> Self:
        import pyarrow.compute as pc

        ser, other = broadcast_and_extract_native(self, other, self._backend_version)
        return self._from_native_series(pc.subtract(ser, other))

    def __rsub__(self: Self, other: Any) -> Self:
        return (self - other) * (-1)  # type: ignore[no-any-return]

    def __mul__(self: Self, other: Any) -> Self:
        import pyarrow.compute as pc

        ser, other = broadcast_and_extract_native(self, other, self._backend_version)
        return self._from_native_series(pc.multiply(ser, other))

    def __rmul__(self: Self, other: Any) -> Self:
        return self * other  # type: ignore[no-any-return]

    def __pow__(self: Self, other: Any) -> Self:
        import pyarrow.compute as pc

        ser, other = broadcast_and_extract_native(self, other, self._backend_version)
        return self._from_native_series(pc.power(ser, other))

    def __rpow__(self: Self, other: Any) -> Self:
        import pyarrow.compute as pc

        ser, other = broadcast_and_extract_native(self, other, self._backend_version)
        return self._from_native_series(pc.power(other, ser))

    def __floordiv__(self: Self, other: Any) -> Self:
        ser, other = broadcast_and_extract_native(self, other, self._backend_version)
        return self._from_native_series(floordiv_compat(ser, other))

    def __rfloordiv__(self: Self, other: Any) -> Self:
        ser, other = broadcast_and_extract_native(self, other, self._backend_version)
        return self._from_native_series(floordiv_compat(other, ser))

    def __truediv__(self: Self, other: Any) -> Self:
        import pyarrow as pa
        import pyarrow.compute as pc

        ser, other = broadcast_and_extract_native(self, other, self._backend_version)
        if not isinstance(other, (pa.Array, pa.ChunkedArray)):
            # scalar
            other = pa.scalar(other)
        return self._from_native_series(pc.divide(*cast_for_truediv(ser, other)))

    def __rtruediv__(self: Self, other: Any) -> Self:
        import pyarrow as pa
        import pyarrow.compute as pc

        ser, other = broadcast_and_extract_native(self, other, self._backend_version)
        if not isinstance(other, (pa.Array, pa.ChunkedArray)):
            # scalar
            other = pa.scalar(other)
        return self._from_native_series(pc.divide(*cast_for_truediv(other, ser)))

    def __mod__(self: Self, other: Any) -> Self:
        import pyarrow.compute as pc

        floor_div = (self // other)._native_series
        ser, other = broadcast_and_extract_native(self, other, self._backend_version)
        res = pc.subtract(ser, pc.multiply(floor_div, other))
        return self._from_native_series(res)

    def __rmod__(self: Self, other: Any) -> Self:
        import pyarrow.compute as pc

        floor_div = (other // self)._native_series
        ser, other = broadcast_and_extract_native(self, other, self._backend_version)
        res = pc.subtract(other, pc.multiply(floor_div, ser))
        return self._from_native_series(res)

    def __invert__(self: Self) -> Self:
        import pyarrow.compute as pc

        return self._from_native_series(pc.invert(self._native_series))

    def len(self: Self, *, _return_py_scalar: bool = True) -> int:
        return maybe_extract_py_scalar(len(self._native_series), _return_py_scalar)  # type: ignore[no-any-return]

    def filter(self: Self, other: Any) -> Self:
        if not (isinstance(other, list) and all(isinstance(x, bool) for x in other)):
            ser, other = broadcast_and_extract_native(self, other, self._backend_version)
        else:
            ser = self._native_series
        return self._from_native_series(ser.filter(other))

    def mean(self: Self, *, _return_py_scalar: bool = True) -> int:
        import pyarrow.compute as pc

        return maybe_extract_py_scalar(pc.mean(self._native_series), _return_py_scalar)  # type: ignore[no-any-return]

    def median(self: Self, *, _return_py_scalar: bool = True) -> int:
        import pyarrow.compute as pc

        from narwhals.exceptions import InvalidOperationError

        if not self.dtype.is_numeric():
            msg = "`median` operation not supported for non-numeric input type."
            raise InvalidOperationError(msg)

        return maybe_extract_py_scalar(  # type: ignore[no-any-return]
            pc.approximate_median(self._native_series), _return_py_scalar
        )

    def min(self: Self, *, _return_py_scalar: bool = True) -> int:
        import pyarrow.compute as pc

        return maybe_extract_py_scalar(pc.min(self._native_series), _return_py_scalar)  # type: ignore[no-any-return]

    def max(self: Self, *, _return_py_scalar: bool = True) -> int:
        import pyarrow.compute as pc

        return maybe_extract_py_scalar(pc.max(self._native_series), _return_py_scalar)  # type: ignore[no-any-return]

    def arg_min(self: Self, *, _return_py_scalar: bool = True) -> int:
        import pyarrow.compute as pc

        index_min = pc.index(self._native_series, pc.min(self._native_series))
        return maybe_extract_py_scalar(index_min, _return_py_scalar)  # type: ignore[no-any-return]

    def arg_max(self: Self, *, _return_py_scalar: bool = True) -> int:
        import pyarrow.compute as pc

        index_max = pc.index(self._native_series, pc.max(self._native_series))
        return maybe_extract_py_scalar(index_max, _return_py_scalar)  # type: ignore[no-any-return]

    def sum(self: Self, *, _return_py_scalar: bool = True) -> int:
        import pyarrow.compute as pc

        return maybe_extract_py_scalar(  # type: ignore[no-any-return]
            pc.sum(self._native_series, min_count=0), _return_py_scalar
        )

    def drop_nulls(self: Self) -> ArrowSeries:
        import pyarrow.compute as pc

        return self._from_native_series(pc.drop_null(self._native_series))

    def shift(self: Self, n: int) -> Self:
        import pyarrow as pa

        ca = self._native_series

        if n > 0:
            result = pa.concat_arrays([pa.nulls(n, ca.type), *ca[:-n].chunks])
        elif n < 0:
            result = pa.concat_arrays([*ca[-n:].chunks, pa.nulls(-n, ca.type)])
        else:
            result = ca
        return self._from_native_series(result)

    def std(self: Self, ddof: int, *, _return_py_scalar: bool = True) -> float:
        import pyarrow.compute as pc

        return maybe_extract_py_scalar(  # type: ignore[no-any-return]
            pc.stddev(self._native_series, ddof=ddof), _return_py_scalar
        )

    def var(self: Self, ddof: int, *, _return_py_scalar: bool = True) -> float:
        import pyarrow.compute as pc

        return maybe_extract_py_scalar(  # type: ignore[no-any-return]
            pc.variance(self._native_series, ddof=ddof), _return_py_scalar
        )

    def skew(self: Self, *, _return_py_scalar: bool = True) -> float | None:
        import pyarrow.compute as pc

        ser = self._native_series
        ser_not_null = pc.drop_null(ser)
        if len(ser_not_null) == 0:
            return None
        elif len(ser_not_null) == 1:
            return float("nan")
        elif len(ser_not_null) == 2:
            return 0.0
        else:
            m = pc.subtract(ser_not_null, pc.mean(ser_not_null))
            m2 = pc.mean(pc.power(m, 2))
            m3 = pc.mean(pc.power(m, 3))
            # Biased population skewness
            return maybe_extract_py_scalar(  # type: ignore[no-any-return]
                pc.divide(m3, pc.power(m2, 1.5)), _return_py_scalar
            )

    def count(self: Self, *, _return_py_scalar: bool = True) -> int:
        import pyarrow.compute as pc

        return maybe_extract_py_scalar(pc.count(self._native_series), _return_py_scalar)  # type: ignore[no-any-return]

    def n_unique(self: Self, *, _return_py_scalar: bool = True) -> int:
        import pyarrow.compute as pc

        unique_values = pc.unique(self._native_series)
        return maybe_extract_py_scalar(  # type: ignore[no-any-return]
            pc.count(unique_values, mode="all"), _return_py_scalar
        )

    def __native_namespace__(self: Self) -> ModuleType:
        if self._implementation is Implementation.PYARROW:
            return self._implementation.to_native_namespace()

        msg = f"Expected pyarrow, got: {type(self._implementation)}"  # pragma: no cover
        raise AssertionError(msg)

    @property
    def name(self: Self) -> str:
        return self._name

    def __narwhals_series__(self: Self) -> Self:
        return self

    @overload
    def __getitem__(self: Self, idx: int) -> Any: ...

    @overload
    def __getitem__(self: Self, idx: slice | Sequence[int]) -> Self: ...

    def __getitem__(self: Self, idx: int | slice | Sequence[int]) -> Any | Self:
        if isinstance(idx, int):
            return maybe_extract_py_scalar(
                self._native_series[idx], return_py_scalar=True
            )
        if isinstance(idx, Sequence):
            return self._from_native_series(self._native_series.take(idx))
        return self._from_native_series(self._native_series[idx])

    def scatter(self: Self, indices: int | Sequence[int], values: Any) -> Self:
        import numpy as np  # ignore-banned-import
        import pyarrow as pa
        import pyarrow.compute as pc

        mask = np.zeros(self.len(), dtype=bool)
        mask[indices] = True
        if isinstance(values, self.__class__):
            ser, values = broadcast_and_extract_native(
                self, values, self._backend_version
            )
        else:
            ser = self._native_series
        if isinstance(values, pa.ChunkedArray):
            values = values.combine_chunks()
        if not isinstance(values, pa.Array):
            values = pa.array(values)
        result = pc.replace_with_mask(ser, mask, values.take(indices))
        return self._from_native_series(result)

    def to_list(self: Self) -> list[Any]:
        return self._native_series.to_pylist()  # type: ignore[no-any-return]

    def __array__(self: Self, dtype: Any = None, copy: bool | None = None) -> np.ndarray:
        return self._native_series.__array__(dtype=dtype, copy=copy)

    def to_numpy(self: Self) -> np.ndarray:
        return self._native_series.to_numpy()

    def alias(self: Self, name: str) -> Self:
        return self.__class__(
            self._native_series,
            name=name,
            backend_version=self._backend_version,
            version=self._version,
        )

    @property
    def dtype(self: Self) -> DType:
        return native_to_narwhals_dtype(self._native_series.type, self._version)

    def abs(self: Self) -> Self:
        import pyarrow.compute as pc

        return self._from_native_series(pc.abs(self._native_series))

    def cum_sum(self: Self, *, reverse: bool) -> Self:
        import pyarrow.compute as pc

        native_series = self._native_series
        result = (
            pc.cumulative_sum(native_series, skip_nulls=True)
            if not reverse
            else pc.cumulative_sum(native_series[::-1], skip_nulls=True)[::-1]
        )
        return self._from_native_series(result)

    def round(self: Self, decimals: int) -> Self:
        import pyarrow.compute as pc

        return self._from_native_series(
            pc.round(self._native_series, decimals, round_mode="half_towards_infinity")
        )

    def diff(self: Self) -> Self:
        import pyarrow.compute as pc

        return self._from_native_series(
            pc.pairwise_diff(self._native_series.combine_chunks())
        )

    def any(self: Self, *, _return_py_scalar: bool = True) -> bool:
        import pyarrow.compute as pc

        return maybe_extract_py_scalar(  # type: ignore[no-any-return]
            pc.any(self._native_series, min_count=0), _return_py_scalar
        )

    def all(self: Self, *, _return_py_scalar: bool = True) -> bool:
        import pyarrow.compute as pc

        return maybe_extract_py_scalar(  # type: ignore[no-any-return]
            pc.all(self._native_series, min_count=0), _return_py_scalar
        )

    def is_between(
        self,
        lower_bound: Any,
        upper_bound: Any,
        closed: Literal["left", "right", "none", "both"],
    ) -> Self:
        import pyarrow.compute as pc

        ser = self._native_series
        _, lower_bound = broadcast_and_extract_native(
            self, lower_bound, self._backend_version
        )
        _, upper_bound = broadcast_and_extract_native(
            self, upper_bound, self._backend_version
        )
        if closed == "left":
            ge = pc.greater_equal(ser, lower_bound)
            lt = pc.less(ser, upper_bound)
            res = pc.and_kleene(ge, lt)
        elif closed == "right":
            gt = pc.greater(ser, lower_bound)
            le = pc.less_equal(ser, upper_bound)
            res = pc.and_kleene(gt, le)
        elif closed == "none":
            gt = pc.greater(ser, lower_bound)
            lt = pc.less(ser, upper_bound)
            res = pc.and_kleene(gt, lt)
        elif closed == "both":
            ge = pc.greater_equal(ser, lower_bound)
            le = pc.less_equal(ser, upper_bound)
            res = pc.and_kleene(ge, le)
        else:  # pragma: no cover
            raise AssertionError
        return self._from_native_series(res)

    def is_empty(self: Self) -> bool:
        return len(self) == 0

    def is_null(self: Self) -> Self:
        ser = self._native_series
        return self._from_native_series(ser.is_null())

    def is_nan(self: Self) -> Self:
        import pyarrow.compute as pc

        return self._from_native_series(pc.is_nan(self._native_series))

    def cast(self: Self, dtype: DType) -> Self:
        import pyarrow.compute as pc

        ser = self._native_series
        dtype = narwhals_to_native_dtype(dtype, self._version)
        return self._from_native_series(pc.cast(ser, dtype))

    def null_count(self: Self, *, _return_py_scalar: bool = True) -> int:
        return maybe_extract_py_scalar(self._native_series.null_count, _return_py_scalar)  # type: ignore[no-any-return]

    def head(self: Self, n: int) -> Self:
        ser = self._native_series
        if n >= 0:
            return self._from_native_series(ser.slice(0, n))
        else:
            num_rows = len(ser)
            return self._from_native_series(ser.slice(0, max(0, num_rows + n)))

    def tail(self: Self, n: int) -> Self:
        ser = self._native_series
        if n >= 0:
            num_rows = len(ser)
            return self._from_native_series(ser.slice(max(0, num_rows - n)))
        else:
            return self._from_native_series(ser.slice(abs(n)))

    def is_in(self: Self, other: Any) -> Self:
        import pyarrow as pa
        import pyarrow.compute as pc

        value_set = pa.array(other)
        ser = self._native_series
        return self._from_native_series(pc.is_in(ser, value_set=value_set))

    def arg_true(self: Self) -> Self:
        import numpy as np  # ignore-banned-import

        ser = self._native_series
        res = np.flatnonzero(ser)
        return self._from_iterable(
            res,
            name=self.name,
            backend_version=self._backend_version,
            version=self._version,
        )

    def item(self: Self, index: int | None = None) -> Any:
        if index is None:
            if len(self) != 1:
                msg = (
                    "can only call '.item()' if the Series is of length 1,"
                    f" or an explicit index is provided (Series is of length {len(self)})"
                )
                raise ValueError(msg)
            return maybe_extract_py_scalar(self._native_series[0], return_py_scalar=True)
        return maybe_extract_py_scalar(self._native_series[index], return_py_scalar=True)

    def value_counts(
        self: Self,
        *,
        sort: bool = False,
        parallel: bool = False,
        name: str | None = None,
        normalize: bool = False,
    ) -> ArrowDataFrame:
        """Parallel is unused, exists for compatibility."""
        import pyarrow as pa
        import pyarrow.compute as pc

        from narwhals._arrow.dataframe import ArrowDataFrame

        index_name_ = "index" if self._name is None else self._name
        value_name_ = name or ("proportion" if normalize else "count")

        val_count = pc.value_counts(self._native_series)
        values = val_count.field("values")
        counts = val_count.field("counts")

        if normalize:
            counts = pc.divide(*cast_for_truediv(counts, pc.sum(counts)))

        val_count = pa.Table.from_arrays(
            [values, counts], names=[index_name_, value_name_]
        )

        if sort:
            val_count = val_count.sort_by([(value_name_, "descending")])

        return ArrowDataFrame(
            val_count, backend_version=self._backend_version, version=self._version
        )

    def zip_with(self: Self, mask: Self, other: Self) -> Self:
        import pyarrow.compute as pc

        mask = mask._native_series.combine_chunks()
        return self._from_native_series(
            pc.if_else(
                mask,
                self._native_series,
                other._native_series,
            )
        )

    def sample(
        self: Self,
        n: int | None,
        *,
        fraction: float | None,
        with_replacement: bool,
        seed: int | None,
    ) -> Self:
        import numpy as np  # ignore-banned-import
        import pyarrow.compute as pc

        ser = self._native_series
        num_rows = len(self)

        if n is None and fraction is not None:
            n = int(num_rows * fraction)

        rng = np.random.default_rng(seed=seed)
        idx = np.arange(0, num_rows)
        mask = rng.choice(idx, size=n, replace=with_replacement)

        return self._from_native_series(pc.take(ser, mask))

    def fill_null(
        self: Self,
        value: Any | None,
        strategy: Literal["forward", "backward"] | None,
        limit: int | None,
    ) -> Self:
        import numpy as np  # ignore-banned-import
        import pyarrow as pa
        import pyarrow.compute as pc

        def fill_aux(
            arr: pa.Array,
            limit: int,
            direction: Literal["forward", "backward"] | None = None,
        ) -> pa.Array:
            # this algorithm first finds the indices of the valid values to fill all the null value positions
            # then it calculates the distance of each new index and the original index
            # if the distance is equal to or less than the limit and the original value is null, it is replaced
            valid_mask = pc.is_valid(arr)
            indices = pa.array(np.arange(len(arr)), type=pa.int64())
            if direction == "forward":
                valid_index = np.maximum.accumulate(np.where(valid_mask, indices, -1))
                distance = indices - valid_index
            else:
                valid_index = np.minimum.accumulate(
                    np.where(valid_mask[::-1], indices[::-1], len(arr))
                )[::-1]
                distance = valid_index - indices
            return pc.if_else(
                pc.and_(
                    pc.is_null(arr),
                    pc.less_equal(distance, pa.scalar(limit)),
                ),
                arr.take(valid_index),
                arr,
            )

        ser = self._native_series
        dtype = ser.type

        if value is not None:
            res_ser = self._from_native_series(pc.fill_null(ser, pa.scalar(value, dtype)))
        elif limit is None:
            fill_func = (
                pc.fill_null_forward if strategy == "forward" else pc.fill_null_backward
            )
            res_ser = self._from_native_series(fill_func(ser))
        else:
            res_ser = self._from_native_series(fill_aux(ser, limit, strategy))

        return res_ser

    def to_frame(self: Self) -> ArrowDataFrame:
        import pyarrow as pa

        from narwhals._arrow.dataframe import ArrowDataFrame

        df = pa.Table.from_arrays([self._native_series], names=[self.name])
        return ArrowDataFrame(
            df, backend_version=self._backend_version, version=self._version
        )

    def to_pandas(self: Self) -> pd.Series:
        import pandas as pd  # ignore-banned-import()

        return pd.Series(self._native_series, name=self.name)

    def is_duplicated(self: Self) -> ArrowSeries:
        return self.to_frame().is_duplicated().alias(self.name)

    def is_unique(self: Self) -> ArrowSeries:
        return self.to_frame().is_unique().alias(self.name)

    def is_first_distinct(self: Self) -> Self:
        import numpy as np  # ignore-banned-import
        import pyarrow as pa
        import pyarrow.compute as pc

        row_number = pa.array(np.arange(len(self)))
        col_token = generate_temporary_column_name(n_bytes=8, columns=[self.name])
        first_distinct_index = (
            pa.Table.from_arrays([self._native_series], names=[self.name])
            .append_column(col_token, row_number)
            .group_by(self.name)
            .aggregate([(col_token, "min")])
            .column(f"{col_token}_min")
        )

        return self._from_native_series(pc.is_in(row_number, first_distinct_index))

    def is_last_distinct(self: Self) -> Self:
        import numpy as np  # ignore-banned-import
        import pyarrow as pa
        import pyarrow.compute as pc

        row_number = pa.array(np.arange(len(self)))
        col_token = generate_temporary_column_name(n_bytes=8, columns=[self.name])
        last_distinct_index = (
            pa.Table.from_arrays([self._native_series], names=[self.name])
            .append_column(col_token, row_number)
            .group_by(self.name)
            .aggregate([(col_token, "max")])
            .column(f"{col_token}_max")
        )

        return self._from_native_series(pc.is_in(row_number, last_distinct_index))

    def is_sorted(self: Self, *, descending: bool) -> bool:
        if not isinstance(descending, bool):
            msg = f"argument 'descending' should be boolean, found {type(descending)}"
            raise TypeError(msg)
        import pyarrow.compute as pc

        ser = self._native_series
        if descending:
            result = pc.all(pc.greater_equal(ser[:-1], ser[1:]))
        else:
            result = pc.all(pc.less_equal(ser[:-1], ser[1:]))
        return maybe_extract_py_scalar(result, return_py_scalar=True)  # type: ignore[no-any-return]

    def unique(self: Self, *, maintain_order: bool) -> ArrowSeries:
        # The param `maintain_order` is only here for compatibility with the Polars API
        # and has no effect on the output.
        import pyarrow.compute as pc

        return self._from_native_series(pc.unique(self._native_series))

    def replace_strict(
        self, old: Sequence[Any], new: Sequence[Any], *, return_dtype: DType | None
    ) -> ArrowSeries:
        import pyarrow as pa
        import pyarrow.compute as pc

        # https://stackoverflow.com/a/79111029/4451315
        idxs = pc.index_in(self._native_series, pa.array(old))
        result_native = pc.take(pa.array(new), idxs)
        if return_dtype is not None:
            result_native.cast(narwhals_to_native_dtype(return_dtype, self._version))
        result = self._from_native_series(result_native)
        if result.is_null().sum() != self.is_null().sum():
            msg = (
                "replace_strict did not replace all non-null values.\n\n"
                "The following did not get replaced: "
                f"{self.filter(~self.is_null() & result.is_null()).unique(maintain_order=False).to_list()}"
            )
            raise ValueError(msg)
        return result

    def sort(self: Self, *, descending: bool, nulls_last: bool) -> ArrowSeries:
        import pyarrow.compute as pc

        series = self._native_series
        order = "descending" if descending else "ascending"
        null_placement = "at_end" if nulls_last else "at_start"
        sorted_indices = pc.array_sort_indices(
            series, order=order, null_placement=null_placement
        )

        return self._from_native_series(pc.take(series, sorted_indices))

    def to_dummies(self: Self, *, separator: str, drop_first: bool) -> ArrowDataFrame:
        import numpy as np  # ignore-banned-import
        import pyarrow as pa

        from narwhals._arrow.dataframe import ArrowDataFrame

        series = self._native_series
        name = self._name
        da = series.dictionary_encode(null_encoding="encode").combine_chunks()

        columns = np.zeros((len(da.dictionary), len(da)), np.int8)
        columns[da.indices, np.arange(len(da))] = 1
        null_col_pa, null_col_pl = f"{name}{separator}None", f"{name}{separator}null"
        cols = [
            {null_col_pa: null_col_pl}.get(
                f"{name}{separator}{v}", f"{name}{separator}{v}"
            )
            for v in da.dictionary
        ]

        output_order = (
            [
                null_col_pl,
                *sorted([c for c in cols if c != null_col_pl])[int(drop_first) :],
            ]
            if null_col_pl in cols
            else sorted(cols)[int(drop_first) :]
        )
        return ArrowDataFrame(
            pa.Table.from_arrays(columns, names=cols),
            backend_version=self._backend_version,
            version=self._version,
        ).select(*output_order)

    def quantile(
        self: Self,
        quantile: float,
        interpolation: Literal["nearest", "higher", "lower", "midpoint", "linear"],
        *,
        _return_py_scalar: bool = True,
    ) -> Any:
        import pyarrow.compute as pc

        return maybe_extract_py_scalar(
            pc.quantile(self._native_series, q=quantile, interpolation=interpolation)[0],
            _return_py_scalar,
        )

    def gather_every(self: Self, n: int, offset: int = 0) -> Self:
        return self._from_native_series(self._native_series[offset::n])

    def clip(
        self: Self, lower_bound: Self | Any | None, upper_bound: Self | Any | None
    ) -> Self:
        import pyarrow.compute as pc

        arr = self._native_series
        _, lower_bound = broadcast_and_extract_native(
            self, lower_bound, self._backend_version
        )
        _, upper_bound = broadcast_and_extract_native(
            self, upper_bound, self._backend_version
        )
        arr = pc.max_element_wise(arr, lower_bound)
        arr = pc.min_element_wise(arr, upper_bound)

        return self._from_native_series(arr)

    def to_arrow(self: Self) -> pa.Array:
        return self._native_series.combine_chunks()

    def mode(self: Self) -> ArrowSeries:
        plx = self.__narwhals_namespace__()
        col_token = generate_temporary_column_name(n_bytes=8, columns=[self.name])
        return self.value_counts(name=col_token, normalize=False).filter(
            plx.col(col_token) == plx.col(col_token).max()
        )[self.name]

    def is_finite(self: Self) -> Self:
        import pyarrow.compute as pc

        return self._from_native_series(pc.is_finite(self._native_series))

    def cum_count(self: Self, *, reverse: bool) -> Self:
        dtypes = import_dtypes_module(self._version)
        return (~self.is_null()).cast(dtypes.UInt32()).cum_sum(reverse=reverse)

    def cum_min(self: Self, *, reverse: bool) -> Self:
        if self._backend_version < (13, 0, 0):
            msg = "cum_min method is not supported for pyarrow < 13.0.0"
            raise NotImplementedError(msg)

        import pyarrow.compute as pc

        native_series = self._native_series

        result = (
            pc.cumulative_min(native_series, skip_nulls=True)
            if not reverse
            else pc.cumulative_min(native_series[::-1], skip_nulls=True)[::-1]
        )
        return self._from_native_series(result)

    def cum_max(self: Self, *, reverse: bool) -> Self:
        if self._backend_version < (13, 0, 0):
            msg = "cum_max method is not supported for pyarrow < 13.0.0"
            raise NotImplementedError(msg)

        import pyarrow.compute as pc

        native_series = self._native_series

        result = (
            pc.cumulative_max(native_series, skip_nulls=True)
            if not reverse
            else pc.cumulative_max(native_series[::-1], skip_nulls=True)[::-1]
        )
        return self._from_native_series(result)

    def cum_prod(self: Self, *, reverse: bool) -> Self:
        if self._backend_version < (13, 0, 0):
            msg = "cum_max method is not supported for pyarrow < 13.0.0"
            raise NotImplementedError(msg)

        import pyarrow.compute as pc

        native_series = self._native_series

        result = (
            pc.cumulative_prod(native_series, skip_nulls=True)
            if not reverse
            else pc.cumulative_prod(native_series[::-1], skip_nulls=True)[::-1]
        )
        return self._from_native_series(result)

    def rolling_sum(
        self: Self,
        window_size: int,
        *,
        min_periods: int | None,
        center: bool,
    ) -> Self:
        import pyarrow.compute as pc

        min_periods = min_periods if min_periods is not None else window_size
        padded_series, offset = pad_series(self, window_size=window_size, center=center)

        cum_sum = padded_series.cum_sum(reverse=False).fill_null(
            value=None, strategy="forward", limit=None
        )
        rolling_sum = (
            cum_sum
            - cum_sum.shift(window_size).fill_null(value=0, strategy=None, limit=None)
            if window_size != 0
            else cum_sum
        )

        valid_count = padded_series.cum_count(reverse=False)
        count_in_window = valid_count - valid_count.shift(window_size).fill_null(
            value=0, strategy=None, limit=None
        )

        result = self._from_native_series(
            pc.if_else(
                (count_in_window >= min_periods)._native_series,
                rolling_sum._native_series,
                None,
            )
        )
        return result[offset:]

    def rolling_mean(
        self: Self,
        window_size: int,
        *,
        min_periods: int | None,
        center: bool,
    ) -> Self:
        import pyarrow.compute as pc

        min_periods = min_periods if min_periods is not None else window_size
        padded_series, offset = pad_series(self, window_size=window_size, center=center)

        cum_sum = padded_series.cum_sum(reverse=False).fill_null(
            value=None, strategy="forward", limit=None
        )
        rolling_sum = (
            cum_sum
            - cum_sum.shift(window_size).fill_null(value=0, strategy=None, limit=None)
            if window_size != 0
            else cum_sum
        )

        valid_count = padded_series.cum_count(reverse=False)
        count_in_window = valid_count - valid_count.shift(window_size).fill_null(
            value=0, strategy=None, limit=None
        )

        result = (
            self._from_native_series(
                pc.if_else(
                    (count_in_window >= min_periods)._native_series,
                    rolling_sum._native_series,
                    None,
                )
            )
            / count_in_window
        )
        return result[offset:]

    def rolling_var(
        self: Self,
        window_size: int,
        *,
        min_periods: int | None,
        center: bool,
        ddof: int,
    ) -> Self:
        import pyarrow.compute as pc  # ignore-banned-import

        min_periods = min_periods if min_periods is not None else window_size
        padded_series, offset = pad_series(self, window_size=window_size, center=center)

        cum_sum = padded_series.cum_sum(reverse=False).fill_null(
            value=None, strategy="forward", limit=None
        )
        rolling_sum = (
            cum_sum
            - cum_sum.shift(window_size).fill_null(value=0, strategy=None, limit=None)
            if window_size != 0
            else cum_sum
        )

        cum_sum_sq = (
            padded_series.__pow__(2)
            .cum_sum(reverse=False)
            .fill_null(value=None, strategy="forward", limit=None)
        )
        rolling_sum_sq = (
            cum_sum_sq
            - cum_sum_sq.shift(window_size).fill_null(value=0, strategy=None, limit=None)
            if window_size != 0
            else cum_sum_sq
        )

        valid_count = padded_series.cum_count(reverse=False)
        count_in_window = valid_count - valid_count.shift(window_size).fill_null(
            value=0, strategy=None, limit=None
        )

        result = self._from_native_series(
            pc.if_else(
                (count_in_window >= min_periods)._native_series,
                (rolling_sum_sq - (rolling_sum**2 / count_in_window))._native_series,
                None,
            )
        ) / self._from_native_series(
            pc.max_element_wise((count_in_window - ddof)._native_series, 0)
        )

        return result[offset:]

    def rolling_std(
        self: Self,
        window_size: int,
        *,
        min_periods: int | None,
        center: bool,
        ddof: int,
    ) -> Self:
        return (
            self.rolling_var(
                window_size=window_size, min_periods=min_periods, center=center, ddof=ddof
            )
            ** 0.5
        )

    def rank(
        self: Self,
        method: Literal["average", "min", "max", "dense", "ordinal"],
        *,
        descending: bool,
    ) -> Self:
        if method == "average":
            msg = (
                "`rank` with `method='average' is not supported for pyarrow backend. "
                "The available methods are {'min', 'max', 'dense', 'ordinal'}."
            )
            raise ValueError(msg)

        import pyarrow as pa  # ignore-banned-import
        import pyarrow.compute as pc  # ignore-banned-import

        sort_keys = "descending" if descending else "ascending"
        tiebreaker = "first" if method == "ordinal" else method

        native_series = self._native_series
        if self._backend_version < (14, 0, 0):  # pragma: no cover
            native_series = native_series.combine_chunks()

        null_mask = pc.is_null(native_series)

        rank = pc.rank(native_series, sort_keys=sort_keys, tiebreaker=tiebreaker)

        result = pc.if_else(null_mask, pa.scalar(None), rank)
        return self._from_native_series(result)

    def __iter__(self: Self) -> Iterator[Any]:
        yield from (
            maybe_extract_py_scalar(x, return_py_scalar=True)
            for x in self._native_series.__iter__()
        )

    def __contains__(self: Self, other: Any) -> bool:
        from pyarrow import ArrowInvalid  # ignore-banned-imports
        from pyarrow import ArrowNotImplementedError  # ignore-banned-imports
        from pyarrow import ArrowTypeError  # ignore-banned-imports

        try:
            import pyarrow as pa
            import pyarrow.compute as pc

            native_series = self._native_series
            other_ = (
                pa.scalar(other)
                if other is not None
                else pa.scalar(None, type=native_series.type)
            )
            return maybe_extract_py_scalar(  # type: ignore[no-any-return]
                pc.is_in(other_, native_series),
                return_py_scalar=True,
            )
        except (ArrowInvalid, ArrowNotImplementedError, ArrowTypeError) as exc:
            from narwhals.exceptions import InvalidOperationError

            msg = f"Unable to compare other of type {type(other)} with series of type {self.dtype}."
            raise InvalidOperationError(msg) from exc

    @property
    def shape(self: Self) -> tuple[int]:
        return (len(self._native_series),)

    @property
    def dt(self: Self) -> ArrowSeriesDateTimeNamespace:
        return ArrowSeriesDateTimeNamespace(self)

    @property
    def cat(self: Self) -> ArrowSeriesCatNamespace:
        return ArrowSeriesCatNamespace(self)

    @property
    def str(self: Self) -> ArrowSeriesStringNamespace:
        return ArrowSeriesStringNamespace(self)

    @property
    def list(self: Self) -> ArrowSeriesListNamespace:
        return ArrowSeriesListNamespace(self)
