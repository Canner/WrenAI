from __future__ import annotations

from itertools import chain
from typing import TYPE_CHECKING
from typing import Any
from typing import Iterable
from typing import Iterator
from typing import Literal
from typing import Sequence
from typing import overload

from narwhals._expression_parsing import evaluate_into_exprs
from narwhals._pandas_like.utils import broadcast_series
from narwhals._pandas_like.utils import convert_str_slice_to_int_slice
from narwhals._pandas_like.utils import create_compliant_series
from narwhals._pandas_like.utils import horizontal_concat
from narwhals._pandas_like.utils import native_to_narwhals_dtype
from narwhals._pandas_like.utils import pivot_table
from narwhals._pandas_like.utils import rename
from narwhals._pandas_like.utils import select_columns_by_name
from narwhals._pandas_like.utils import validate_dataframe_comparand
from narwhals.dependencies import is_numpy_array
from narwhals.utils import Implementation
from narwhals.utils import check_column_exists
from narwhals.utils import flatten
from narwhals.utils import generate_temporary_column_name
from narwhals.utils import import_dtypes_module
from narwhals.utils import is_sequence_but_not_str
from narwhals.utils import parse_columns_to_drop
from narwhals.utils import scale_bytes
from narwhals.utils import validate_backend_version

if TYPE_CHECKING:
    from types import ModuleType

    import numpy as np
    import pandas as pd
    from typing_extensions import Self

    from narwhals._pandas_like.group_by import PandasLikeGroupBy
    from narwhals._pandas_like.namespace import PandasLikeNamespace
    from narwhals._pandas_like.series import PandasLikeSeries
    from narwhals._pandas_like.typing import IntoPandasLikeExpr
    from narwhals.dtypes import DType
    from narwhals.typing import SizeUnit
    from narwhals.utils import Version


class PandasLikeDataFrame:
    # --- not in the spec ---
    def __init__(
        self,
        native_dataframe: Any,
        *,
        implementation: Implementation,
        backend_version: tuple[int, ...],
        version: Version,
    ) -> None:
        self._validate_columns(native_dataframe.columns)
        self._native_frame = native_dataframe
        self._implementation = implementation
        self._backend_version = backend_version
        self._version = version
        validate_backend_version(self._implementation, self._backend_version)

    def __narwhals_dataframe__(self) -> Self:
        return self

    def __narwhals_lazyframe__(self) -> Self:
        return self

    def __narwhals_namespace__(self) -> PandasLikeNamespace:
        from narwhals._pandas_like.namespace import PandasLikeNamespace

        return PandasLikeNamespace(
            self._implementation, self._backend_version, version=self._version
        )

    def __native_namespace__(self: Self) -> ModuleType:
        if self._implementation in {
            Implementation.PANDAS,
            Implementation.MODIN,
            Implementation.CUDF,
        }:
            return self._implementation.to_native_namespace()

        msg = f"Expected pandas/modin/cudf, got: {type(self._implementation)}"  # pragma: no cover
        raise AssertionError(msg)

    def __len__(self) -> int:
        return len(self._native_frame)

    def _validate_columns(self, columns: pd.Index) -> None:
        try:
            len_unique_columns = len(columns.drop_duplicates())
        except Exception:  # noqa: BLE001  # pragma: no cover
            msg = f"Expected hashable (e.g. str or int) column names, got: {columns}"
            raise ValueError(msg) from None

        if len(columns) != len_unique_columns:
            from collections import Counter

            counter = Counter(columns)
            msg = ""
            for key, value in counter.items():
                if value > 1:
                    msg += f"\n- '{key}' {value} times"
            msg = f"Expected unique column names, got:{msg}"
            raise ValueError(msg)

    def _change_version(self, version: Version) -> Self:
        return self.__class__(
            self._native_frame,
            implementation=self._implementation,
            backend_version=self._backend_version,
            version=version,
        )

    def _from_native_frame(self, df: Any) -> Self:
        return self.__class__(
            df,
            implementation=self._implementation,
            backend_version=self._backend_version,
            version=self._version,
        )

    def get_column(self, name: str) -> PandasLikeSeries:
        from narwhals._pandas_like.series import PandasLikeSeries

        return PandasLikeSeries(
            self._native_frame[name],
            implementation=self._implementation,
            backend_version=self._backend_version,
            version=self._version,
        )

    def __array__(self, dtype: Any = None, copy: bool | None = None) -> np.ndarray:
        return self.to_numpy(dtype=dtype, copy=copy)

    @overload
    def __getitem__(self, item: tuple[Sequence[int], str | int]) -> PandasLikeSeries: ...  # type: ignore[overload-overlap]

    @overload
    def __getitem__(self, item: Sequence[int]) -> PandasLikeDataFrame: ...

    @overload
    def __getitem__(self, item: str) -> PandasLikeSeries: ...  # type: ignore[overload-overlap]

    @overload
    def __getitem__(self, item: Sequence[str]) -> PandasLikeDataFrame: ...

    @overload
    def __getitem__(self, item: slice) -> PandasLikeDataFrame: ...

    @overload
    def __getitem__(self, item: tuple[slice, slice]) -> Self: ...

    @overload
    def __getitem__(
        self, item: tuple[Sequence[int], Sequence[int] | slice]
    ) -> PandasLikeDataFrame: ...

    @overload
    def __getitem__(self, item: tuple[slice, Sequence[int]]) -> PandasLikeDataFrame: ...

    def __getitem__(
        self,
        item: (
            str
            | int
            | slice
            | Sequence[int]
            | Sequence[str]
            | tuple[Sequence[int], str | int]
            | tuple[slice | Sequence[int], Sequence[int] | slice]
            | tuple[slice, slice]
        ),
    ) -> PandasLikeSeries | PandasLikeDataFrame:
        if isinstance(item, tuple):
            item = tuple(list(i) if is_sequence_but_not_str(i) else i for i in item)  # type: ignore[assignment]

        if isinstance(item, str):
            from narwhals._pandas_like.series import PandasLikeSeries

            return PandasLikeSeries(
                self._native_frame[item],
                implementation=self._implementation,
                backend_version=self._backend_version,
                version=self._version,
            )

        elif (
            isinstance(item, tuple)
            and len(item) == 2
            and is_sequence_but_not_str(item[1])
        ):
            if len(item[1]) == 0:
                # Return empty dataframe
                return self._from_native_frame(self._native_frame.__class__())
            if all(isinstance(x, int) for x in item[1]):
                return self._from_native_frame(self._native_frame.iloc[item])
            if all(isinstance(x, str) for x in item[1]):
                indexer = (
                    item[0],
                    self._native_frame.columns.get_indexer(item[1]),
                )
                return self._from_native_frame(self._native_frame.iloc[indexer])
            msg = (
                f"Expected sequence str or int, got: {type(item[1])}"  # pragma: no cover
            )
            raise TypeError(msg)  # pragma: no cover

        elif isinstance(item, tuple) and len(item) == 2 and isinstance(item[1], slice):
            columns = self._native_frame.columns
            if item[1] == slice(None):
                return self._from_native_frame(self._native_frame.iloc[item[0], :])
            if isinstance(item[1].start, str) or isinstance(item[1].stop, str):
                start, stop, step = convert_str_slice_to_int_slice(item[1], columns)
                return self._from_native_frame(
                    self._native_frame.iloc[item[0], slice(start, stop, step)]
                )
            if isinstance(item[1].start, int) or isinstance(item[1].stop, int):
                return self._from_native_frame(
                    self._native_frame.iloc[
                        item[0], slice(item[1].start, item[1].stop, item[1].step)
                    ]
                )
            msg = f"Expected slice of integers or strings, got: {type(item[1])}"  # pragma: no cover
            raise TypeError(msg)  # pragma: no cover

        elif isinstance(item, tuple) and len(item) == 2:
            from narwhals._pandas_like.series import PandasLikeSeries

            if isinstance(item[1], str):
                item = (item[0], self._native_frame.columns.get_loc(item[1]))  # type: ignore[assignment]
                native_series = self._native_frame.iloc[item]
            elif isinstance(item[1], int):
                native_series = self._native_frame.iloc[item]
            else:  # pragma: no cover
                msg = f"Expected str or int, got: {type(item[1])}"
                raise TypeError(msg)

            return PandasLikeSeries(
                native_series,
                implementation=self._implementation,
                backend_version=self._backend_version,
                version=self._version,
            )

        elif is_sequence_but_not_str(item) or (is_numpy_array(item) and item.ndim == 1):
            if all(isinstance(x, str) for x in item) and len(item) > 0:
                return self._from_native_frame(
                    select_columns_by_name(
                        self._native_frame,
                        item,
                        self._backend_version,
                        self._implementation,
                    )
                )
            return self._from_native_frame(self._native_frame.iloc[item])

        elif isinstance(item, slice):
            if isinstance(item.start, str) or isinstance(item.stop, str):
                start, stop, step = convert_str_slice_to_int_slice(
                    item, self._native_frame.columns
                )
                return self._from_native_frame(
                    self._native_frame.iloc[:, slice(start, stop, step)]
                )
            return self._from_native_frame(self._native_frame.iloc[item])

        else:  # pragma: no cover
            msg = f"Expected str or slice, got: {type(item)}"
            raise TypeError(msg)

    # --- properties ---
    @property
    def columns(self) -> list[str]:
        return self._native_frame.columns.tolist()  # type: ignore[no-any-return]

    @overload
    def rows(
        self,
        *,
        named: Literal[True],
    ) -> list[dict[str, Any]]: ...

    @overload
    def rows(
        self,
        *,
        named: Literal[False] = False,
    ) -> list[tuple[Any, ...]]: ...

    @overload
    def rows(
        self,
        *,
        named: bool,
    ) -> list[tuple[Any, ...]] | list[dict[str, Any]]: ...

    def rows(
        self, *, named: bool = False
    ) -> list[tuple[Any, ...]] | list[dict[str, Any]]:
        if not named:
            # cuDF does not support itertuples. But it does support to_dict!
            if self._implementation is Implementation.CUDF:
                # Extract the row values from the named rows
                return [tuple(row.values()) for row in self.rows(named=True)]

            return list(self._native_frame.itertuples(index=False, name=None))

        return self._native_frame.to_dict(orient="records")  # type: ignore[no-any-return]

    def iter_rows(
        self,
        *,
        named: bool = False,
        buffer_size: int = 512,
    ) -> Iterator[list[tuple[Any, ...]]] | Iterator[list[dict[str, Any]]]:
        # The param ``buffer_size`` is only here for compatibility with the Polars API
        # and has no effect on the output.
        if not named:
            yield from self._native_frame.itertuples(index=False, name=None)
        else:
            col_names = self._native_frame.columns
            yield from (
                dict(zip(col_names, row))
                for row in self._native_frame.itertuples(index=False)
            )  # type: ignore[misc]

    @property
    def schema(self) -> dict[str, DType]:
        return {
            col: native_to_narwhals_dtype(
                self._native_frame[col], self._version, self._implementation
            )
            for col in self._native_frame.columns
        }

    def collect_schema(self) -> dict[str, DType]:
        return self.schema

    # --- reshape ---
    def select(
        self,
        *exprs: IntoPandasLikeExpr,
        **named_exprs: IntoPandasLikeExpr,
    ) -> Self:
        if exprs and all(isinstance(x, str) for x in exprs) and not named_exprs:
            # This is a simple slice => fastpath!
            column_names = list(exprs)
            return self._from_native_frame(
                select_columns_by_name(
                    self._native_frame,
                    column_names,  # type: ignore[arg-type]
                    self._backend_version,
                    self._implementation,
                )
            )
        new_series = evaluate_into_exprs(self, *exprs, **named_exprs)
        if not new_series:
            # return empty dataframe, like Polars does
            return self._from_native_frame(self._native_frame.__class__())
        new_series = broadcast_series(new_series)
        df = horizontal_concat(
            new_series,
            implementation=self._implementation,
            backend_version=self._backend_version,
        )
        return self._from_native_frame(df)

    def drop_nulls(self, subset: str | list[str] | None) -> Self:
        if subset is None:
            return self._from_native_frame(self._native_frame.dropna(axis=0))
        subset = [subset] if isinstance(subset, str) else subset
        plx = self.__narwhals_namespace__()
        return self.filter(~plx.any_horizontal(plx.col(*subset).is_null()))

    def estimated_size(self, unit: SizeUnit) -> int | float:
        sz = self._native_frame.memory_usage(deep=True).sum()
        return scale_bytes(sz, unit=unit)

    def with_row_index(self, name: str) -> Self:
        row_index = create_compliant_series(
            range(len(self._native_frame)),
            index=self._native_frame.index,
            implementation=self._implementation,
            backend_version=self._backend_version,
            version=self._version,
        ).alias(name)
        return self._from_native_frame(
            horizontal_concat(
                [row_index._native_series, self._native_frame],
                implementation=self._implementation,
                backend_version=self._backend_version,
            )
        )

    def row(self, row: int) -> tuple[Any, ...]:
        return tuple(x for x in self._native_frame.iloc[row])

    def filter(self, *predicates: IntoPandasLikeExpr, **constraints: Any) -> Self:
        plx = self.__narwhals_namespace__()
        if (
            len(predicates) == 1
            and isinstance(predicates[0], list)
            and all(isinstance(x, bool) for x in predicates[0])
            and not constraints
        ):
            _mask = predicates[0]
        else:
            expr = plx.all_horizontal(
                *chain(
                    predicates, (plx.col(name) == v for name, v in constraints.items())
                )
            )
            # `[0]` is safe as all_horizontal's expression only returns a single column
            mask = expr._call(self)[0]
            _mask = validate_dataframe_comparand(self._native_frame.index, mask)
        return self._from_native_frame(self._native_frame.loc[_mask])

    def with_columns(
        self,
        *exprs: IntoPandasLikeExpr,
        **named_exprs: IntoPandasLikeExpr,
    ) -> Self:
        index = self._native_frame.index
        new_columns = evaluate_into_exprs(self, *exprs, **named_exprs)
        if not new_columns and len(self) == 0:
            return self

        new_column_name_to_new_column_map = {s.name: s for s in new_columns}
        to_concat = []
        # Make sure to preserve column order
        for name in self._native_frame.columns:
            if name in new_column_name_to_new_column_map:
                to_concat.append(
                    validate_dataframe_comparand(
                        index, new_column_name_to_new_column_map.pop(name)
                    )
                )
            else:
                to_concat.append(self._native_frame[name])
        to_concat.extend(
            validate_dataframe_comparand(index, new_column_name_to_new_column_map[s])
            for s in new_column_name_to_new_column_map
        )

        df = horizontal_concat(
            to_concat,
            implementation=self._implementation,
            backend_version=self._backend_version,
        )
        return self._from_native_frame(df)

    def rename(self, mapping: dict[str, str]) -> Self:
        return self._from_native_frame(
            rename(
                self._native_frame,
                columns=mapping,
                implementation=self._implementation,
                backend_version=self._backend_version,
            )
        )

    def drop(self: Self, columns: list[str], strict: bool) -> Self:  # noqa: FBT001
        to_drop = parse_columns_to_drop(
            compliant_frame=self, columns=columns, strict=strict
        )
        return self._from_native_frame(self._native_frame.drop(columns=to_drop))

    # --- transform ---
    def sort(
        self,
        by: str | Iterable[str],
        *more_by: str,
        descending: bool | Sequence[bool],
        nulls_last: bool,
    ) -> Self:
        flat_keys = flatten([*flatten([by]), *more_by])
        df = self._native_frame
        if isinstance(descending, bool):
            ascending: bool | list[bool] = not descending
        else:
            ascending = [not d for d in descending]
        na_position = "last" if nulls_last else "first"
        return self._from_native_frame(
            df.sort_values(flat_keys, ascending=ascending, na_position=na_position)
        )

    # --- convert ---
    def collect(self) -> PandasLikeDataFrame:
        return PandasLikeDataFrame(
            self._native_frame,
            implementation=self._implementation,
            backend_version=self._backend_version,
            version=self._version,
        )

    # --- actions ---
    def group_by(self, *keys: str, drop_null_keys: bool) -> PandasLikeGroupBy:
        from narwhals._pandas_like.group_by import PandasLikeGroupBy

        return PandasLikeGroupBy(
            self,
            list(keys),
            drop_null_keys=drop_null_keys,
        )

    def join(
        self,
        other: Self,
        *,
        how: Literal["left", "inner", "cross", "anti", "semi"] = "inner",
        left_on: str | list[str] | None,
        right_on: str | list[str] | None,
        suffix: str,
    ) -> Self:
        if isinstance(left_on, str):
            left_on = [left_on]
        if isinstance(right_on, str):
            right_on = [right_on]
        if how == "cross":
            if (
                self._implementation is Implementation.MODIN
                or self._implementation is Implementation.CUDF
            ) or (
                self._implementation is Implementation.PANDAS
                and self._backend_version < (1, 4)
            ):
                key_token = generate_temporary_column_name(
                    n_bytes=8, columns=[*self.columns, *other.columns]
                )

                return self._from_native_frame(
                    self._native_frame.assign(**{key_token: 0})
                    .merge(
                        other._native_frame.assign(**{key_token: 0}),
                        how="inner",
                        left_on=key_token,
                        right_on=key_token,
                        suffixes=("", suffix),
                    )
                    .drop(columns=key_token),
                )
            else:
                return self._from_native_frame(
                    self._native_frame.merge(
                        other._native_frame,
                        how="cross",
                        suffixes=("", suffix),
                    ),
                )

        if how == "anti":
            if self._implementation is Implementation.CUDF:
                return self._from_native_frame(
                    self._native_frame.merge(
                        other._native_frame,
                        how="leftanti",
                        left_on=left_on,
                        right_on=right_on,
                    )
                )
            else:
                indicator_token = generate_temporary_column_name(
                    n_bytes=8, columns=[*self.columns, *other.columns]
                )
                if right_on is None:  # pragma: no cover
                    msg = "`right_on` cannot be `None` in anti-join"
                    raise TypeError(msg)

                # rename to avoid creating extra columns in join
                other_native = rename(
                    select_columns_by_name(
                        other._native_frame,
                        right_on,
                        self._backend_version,
                        self._implementation,
                    ),
                    columns=dict(zip(right_on, left_on)),  # type: ignore[arg-type]
                    implementation=self._implementation,
                    backend_version=self._backend_version,
                ).drop_duplicates()
                return self._from_native_frame(
                    self._native_frame.merge(
                        other_native,
                        how="outer",
                        indicator=indicator_token,
                        left_on=left_on,
                        right_on=left_on,
                    )
                    .loc[lambda t: t[indicator_token] == "left_only"]
                    .drop(columns=indicator_token)
                )

        if how == "semi":
            if right_on is None:  # pragma: no cover
                msg = "`right_on` cannot be `None` in semi-join"
                raise TypeError(msg)
            # rename to avoid creating extra columns in join
            other_native = (
                rename(
                    select_columns_by_name(
                        other._native_frame,
                        right_on,
                        self._backend_version,
                        self._implementation,
                    ),
                    columns=dict(zip(right_on, left_on)),  # type: ignore[arg-type]
                    implementation=self._implementation,
                    backend_version=self._backend_version,
                ).drop_duplicates()  # avoids potential rows duplication from inner join
            )
            return self._from_native_frame(
                self._native_frame.merge(
                    other_native,
                    how="inner",
                    left_on=left_on,
                    right_on=left_on,
                )
            )

        if how == "left":
            other_native = other._native_frame
            result_native = self._native_frame.merge(
                other_native,
                how="left",
                left_on=left_on,
                right_on=right_on,
                suffixes=("", suffix),
            )
            extra = []
            for left_key, right_key in zip(left_on, right_on):  # type: ignore[arg-type]
                if right_key != left_key and right_key not in self.columns:
                    extra.append(right_key)
                elif right_key != left_key:
                    extra.append(f"{right_key}{suffix}")
            return self._from_native_frame(result_native.drop(columns=extra))

        return self._from_native_frame(
            self._native_frame.merge(
                other._native_frame,
                left_on=left_on,
                right_on=right_on,
                how=how,
                suffixes=("", suffix),
            ),
        )

    def join_asof(
        self,
        other: Self,
        *,
        left_on: str | None = None,
        right_on: str | None = None,
        on: str | None = None,
        by_left: str | list[str] | None = None,
        by_right: str | list[str] | None = None,
        by: str | list[str] | None = None,
        strategy: Literal["backward", "forward", "nearest"] = "backward",
    ) -> Self:
        plx = self.__native_namespace__()
        return self._from_native_frame(
            plx.merge_asof(
                self._native_frame,
                other._native_frame,
                left_on=left_on,
                right_on=right_on,
                on=on,
                left_by=by_left,
                right_by=by_right,
                by=by,
                direction=strategy,
                suffixes=("", "_right"),
            ),
        )

    # --- partial reduction ---

    def head(self, n: int) -> Self:
        return self._from_native_frame(self._native_frame.head(n))

    def tail(self, n: int) -> Self:
        return self._from_native_frame(self._native_frame.tail(n))

    def unique(
        self: Self,
        subset: list[str] | None,
        *,
        keep: Literal["any", "first", "last", "none"] = "any",
        maintain_order: bool = False,
    ) -> Self:
        # The param `maintain_order` is only here for compatibility with the Polars API
        # and has no effect on the output.
        mapped_keep = {"none": False, "any": "first"}.get(keep, keep)
        check_column_exists(self.columns, subset)
        return self._from_native_frame(
            self._native_frame.drop_duplicates(subset=subset, keep=mapped_keep)
        )

    # --- lazy-only ---
    def lazy(self) -> Self:
        return self

    @property
    def shape(self) -> tuple[int, int]:
        return self._native_frame.shape  # type: ignore[no-any-return]

    def to_dict(self, *, as_series: bool = False) -> dict[str, Any]:
        from narwhals._pandas_like.series import PandasLikeSeries

        if as_series:
            return {
                col: PandasLikeSeries(
                    self._native_frame[col],
                    implementation=self._implementation,
                    backend_version=self._backend_version,
                    version=self._version,
                )
                for col in self.columns
            }
        return self._native_frame.to_dict(orient="list")  # type: ignore[no-any-return]

    def to_numpy(self, dtype: Any = None, copy: bool | None = None) -> Any:
        from narwhals._pandas_like.series import PANDAS_TO_NUMPY_DTYPE_MISSING

        if copy is None:
            # pandas default differs from Polars, but cuDF default is True
            copy = self._implementation is Implementation.CUDF

        dtypes = import_dtypes_module(self._version)

        to_convert = [
            key
            for key, val in self.schema.items()
            if val == dtypes.Datetime and val.time_zone is not None  # type: ignore[attr-defined]
        ]
        if to_convert:
            df = self.with_columns(
                self.__narwhals_namespace__()
                .col(*to_convert)
                .dt.convert_time_zone("UTC")
                .dt.replace_time_zone(None)
            )._native_frame
        else:
            df = self._native_frame

        if dtype is not None:
            return df.to_numpy(dtype=dtype, copy=copy)

        # pandas return `object` dtype for nullable dtypes if dtype=None,
        # so we cast each Series to numpy and let numpy find a common dtype.
        # If there aren't any dtypes where `to_numpy()` is "broken" (i.e. it
        # returns Object) then we just call `to_numpy()` on the DataFrame.
        for col_dtype in df.dtypes:
            if str(col_dtype) in PANDAS_TO_NUMPY_DTYPE_MISSING:
                import numpy as np

                return np.hstack(
                    [self[col].to_numpy(copy=copy)[:, None] for col in self.columns]
                )
        return df.to_numpy(copy=copy)

    def to_pandas(self) -> Any:
        if self._implementation is Implementation.PANDAS:
            return self._native_frame
        if self._implementation is Implementation.MODIN:
            return self._native_frame._to_pandas()
        return self._native_frame.to_pandas()  # pragma: no cover

    def write_parquet(self, file: Any) -> Any:
        self._native_frame.to_parquet(file)

    def write_csv(self, file: Any = None) -> Any:
        return self._native_frame.to_csv(file, index=False)

    # --- descriptive ---
    def is_duplicated(self: Self) -> PandasLikeSeries:
        from narwhals._pandas_like.series import PandasLikeSeries

        return PandasLikeSeries(
            self._native_frame.duplicated(keep=False),
            implementation=self._implementation,
            backend_version=self._backend_version,
            version=self._version,
        )

    def is_empty(self: Self) -> bool:
        return self._native_frame.empty  # type: ignore[no-any-return]

    def is_unique(self: Self) -> PandasLikeSeries:
        from narwhals._pandas_like.series import PandasLikeSeries

        return PandasLikeSeries(
            ~self._native_frame.duplicated(keep=False),
            implementation=self._implementation,
            backend_version=self._backend_version,
            version=self._version,
        )

    def null_count(self: Self) -> PandasLikeDataFrame:
        return PandasLikeDataFrame(
            self._native_frame.isna().sum(axis=0).to_frame().transpose(),
            implementation=self._implementation,
            backend_version=self._backend_version,
            version=self._version,
        )

    def item(self: Self, row: int | None = None, column: int | str | None = None) -> Any:
        if row is None and column is None:
            if self.shape != (1, 1):
                msg = (
                    "can only call `.item()` if the dataframe is of shape (1, 1),"
                    " or if explicit row/col values are provided;"
                    f" frame has shape {self.shape!r}"
                )
                raise ValueError(msg)
            return self._native_frame.iloc[0, 0]

        elif row is None or column is None:
            msg = "cannot call `.item()` with only one of `row` or `column`"
            raise ValueError(msg)

        _col = self.columns.index(column) if isinstance(column, str) else column
        return self._native_frame.iloc[row, _col]

    def clone(self: Self) -> Self:
        return self._from_native_frame(self._native_frame.copy())

    def gather_every(self: Self, n: int, offset: int = 0) -> Self:
        return self._from_native_frame(self._native_frame.iloc[offset::n])

    def pivot(
        self: Self,
        on: str | list[str],
        *,
        index: str | list[str] | None,
        values: str | list[str] | None,
        aggregate_function: Any | None,
        sort_columns: bool,
        separator: str = "_",
    ) -> Self:
        if self._implementation is Implementation.PANDAS and (
            self._backend_version < (1, 1)
        ):  # pragma: no cover
            msg = "pivot is only supported for pandas>=1.1"
            raise NotImplementedError(msg)
        if self._implementation is Implementation.MODIN:
            msg = "pivot is not supported for Modin backend due to https://github.com/modin-project/modin/issues/7409."
            raise NotImplementedError(msg)
        from itertools import product

        frame = self._native_frame

        if isinstance(on, str):
            on = [on]

        if isinstance(values, str):
            values = [values]
        if isinstance(index, str):
            index = [index]

        if index is None:
            index = [c for c in self.columns if c not in {*on, *values}]  # type: ignore[misc]

        if values is None:
            values = [c for c in self.columns if c not in {*on, *index}]

        if aggregate_function is None:
            result = frame.pivot(columns=on, index=index, values=values)
        elif aggregate_function == "len":
            result = (
                frame.groupby([*on, *index])
                .agg({v: "size" for v in values})
                .reset_index()
                .pivot(columns=on, index=index, values=values)
            )
        else:
            result = pivot_table(
                df=self,
                values=values,
                index=index,
                columns=on,
                aggregate_function=aggregate_function,
            )

        # Put columns in the right order
        if sort_columns and self._implementation is Implementation.CUDF:
            uniques = {
                col: sorted(self._native_frame[col].unique().to_arrow().to_pylist())
                for col in on
            }
        elif sort_columns:
            uniques = {
                col: sorted(self._native_frame[col].unique().tolist()) for col in on
            }
        elif self._implementation is Implementation.CUDF:
            uniques = {
                col: self._native_frame[col].unique().to_arrow().to_pylist() for col in on
            }
        else:
            uniques = {col: self._native_frame[col].unique().tolist() for col in on}
        all_lists = [values, *list(uniques.values())]
        ordered_cols = list(product(*all_lists))
        result = result.loc[:, ordered_cols]
        columns = result.columns.tolist()

        n_on = len(on)
        if n_on == 1:
            new_columns = [
                separator.join(col).strip() if len(values) > 1 else col[-1]
                for col in columns
            ]
        else:
            new_columns = [
                separator.join([col[0], '{"' + '","'.join(col[-n_on:]) + '"}'])
                if len(values) > 1
                else '{"' + '","'.join(col[-n_on:]) + '"}'
                for col in columns
            ]
        result.columns = new_columns
        result.columns.names = [""]  # type: ignore[attr-defined]
        return self._from_native_frame(result.reset_index())

    def to_arrow(self: Self) -> Any:
        if self._implementation is Implementation.CUDF:
            return self._native_frame.to_arrow(preserve_index=False)

        import pyarrow as pa  # ignore-banned-import()

        return pa.Table.from_pandas(self._native_frame)

    def sample(
        self: Self,
        n: int | None = None,
        *,
        fraction: float | None = None,
        with_replacement: bool = False,
        seed: int | None = None,
    ) -> Self:
        return self._from_native_frame(
            self._native_frame.sample(
                n=n, frac=fraction, replace=with_replacement, random_state=seed
            )
        )

    def unpivot(
        self: Self,
        on: str | list[str] | None,
        index: str | list[str] | None,
        variable_name: str | None,
        value_name: str | None,
    ) -> Self:
        return self._from_native_frame(
            self._native_frame.melt(
                id_vars=index,
                value_vars=on,
                var_name=variable_name if variable_name is not None else "variable",
                value_name=value_name if value_name is not None else "value",
            )
        )

    def explode(self: Self, columns: str | Sequence[str], *more_columns: str) -> Self:
        from narwhals.exceptions import InvalidOperationError

        dtypes = import_dtypes_module(self._version)

        to_explode = (
            [columns, *more_columns]
            if isinstance(columns, str)
            else [*columns, *more_columns]
        )
        schema = self.collect_schema()
        for col_to_explode in to_explode:
            dtype = schema[col_to_explode]

            if dtype != dtypes.List:
                msg = (
                    f"`explode` operation not supported for dtype `{dtype}`, "
                    "expected List type"
                )
                raise InvalidOperationError(msg)

        if len(to_explode) == 1:
            return self._from_native_frame(self._native_frame.explode(to_explode[0]))
        else:
            native_frame = self._native_frame
            anchor_series = native_frame[to_explode[0]].list.len()

            if not all(
                (native_frame[col_name].list.len() == anchor_series).all()
                for col_name in to_explode[1:]
            ):
                from narwhals.exceptions import ShapeError

                msg = "exploded columns must have matching element counts"
                raise ShapeError(msg)

            original_columns = self.columns
            other_columns = [c for c in original_columns if c not in to_explode]

            exploded_frame = native_frame[[*other_columns, to_explode[0]]].explode(
                to_explode[0]
            )
            exploded_series = [
                native_frame[col_name].explode().to_frame() for col_name in to_explode[1:]
            ]

            plx = self.__native_namespace__()
            return self._from_native_frame(
                plx.concat([exploded_frame, *exploded_series], axis=1)[original_columns]
            )
