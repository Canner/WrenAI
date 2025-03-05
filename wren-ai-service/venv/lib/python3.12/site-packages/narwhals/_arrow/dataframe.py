from __future__ import annotations

from itertools import chain
from typing import TYPE_CHECKING
from typing import Any
from typing import Iterable
from typing import Iterator
from typing import Literal
from typing import Sequence
from typing import overload

from narwhals._arrow.utils import broadcast_series
from narwhals._arrow.utils import convert_str_slice_to_int_slice
from narwhals._arrow.utils import native_to_narwhals_dtype
from narwhals._arrow.utils import select_rows
from narwhals._arrow.utils import validate_dataframe_comparand
from narwhals._expression_parsing import evaluate_into_exprs
from narwhals.dependencies import is_numpy_array
from narwhals.utils import Implementation
from narwhals.utils import check_column_exists
from narwhals.utils import flatten
from narwhals.utils import generate_temporary_column_name
from narwhals.utils import is_sequence_but_not_str
from narwhals.utils import parse_columns_to_drop
from narwhals.utils import scale_bytes
from narwhals.utils import validate_backend_version

if TYPE_CHECKING:
    from types import ModuleType

    import numpy as np
    import pandas as pd
    import pyarrow as pa
    from typing_extensions import Self

    from narwhals._arrow.group_by import ArrowGroupBy
    from narwhals._arrow.namespace import ArrowNamespace
    from narwhals._arrow.series import ArrowSeries
    from narwhals._arrow.typing import IntoArrowExpr
    from narwhals.dtypes import DType
    from narwhals.typing import SizeUnit
    from narwhals.utils import Version

from narwhals.typing import CompliantDataFrame
from narwhals.typing import CompliantLazyFrame


class ArrowDataFrame(CompliantDataFrame, CompliantLazyFrame):
    # --- not in the spec ---
    def __init__(
        self: Self,
        native_dataframe: pa.Table,
        *,
        backend_version: tuple[int, ...],
        version: Version,
    ) -> None:
        self._native_frame = native_dataframe
        self._implementation = Implementation.PYARROW
        self._backend_version = backend_version
        self._version = version
        validate_backend_version(self._implementation, self._backend_version)

    def __narwhals_namespace__(self: Self) -> ArrowNamespace:
        from narwhals._arrow.namespace import ArrowNamespace

        return ArrowNamespace(
            backend_version=self._backend_version, version=self._version
        )

    def __native_namespace__(self: Self) -> ModuleType:
        if self._implementation is Implementation.PYARROW:
            return self._implementation.to_native_namespace()

        msg = f"Expected pyarrow, got: {type(self._implementation)}"  # pragma: no cover
        raise AssertionError(msg)

    def __narwhals_dataframe__(self: Self) -> Self:
        return self

    def __narwhals_lazyframe__(self: Self) -> Self:
        return self

    def _change_version(self: Self, version: Version) -> Self:
        return self.__class__(
            self._native_frame, backend_version=self._backend_version, version=version
        )

    def _from_native_frame(self: Self, df: pa.Table) -> Self:
        return self.__class__(
            df, backend_version=self._backend_version, version=self._version
        )

    @property
    def shape(self: Self) -> tuple[int, int]:
        return self._native_frame.shape  # type: ignore[no-any-return]

    def __len__(self: Self) -> int:
        return len(self._native_frame)

    def row(self: Self, index: int) -> tuple[Any, ...]:
        return tuple(col[index] for col in self._native_frame)

    @overload
    def rows(self: Self, *, named: Literal[True]) -> list[dict[str, Any]]: ...

    @overload
    def rows(self: Self, *, named: Literal[False]) -> list[tuple[Any, ...]]: ...

    @overload
    def rows(
        self: Self, *, named: bool
    ) -> list[tuple[Any, ...]] | list[dict[str, Any]]: ...

    def rows(self: Self, *, named: bool) -> list[tuple[Any, ...]] | list[dict[str, Any]]:
        if not named:
            return list(self.iter_rows(named=False, buffer_size=512))  # type: ignore[return-value]
        return self._native_frame.to_pylist()  # type: ignore[no-any-return]

    def iter_rows(
        self: Self, *, named: bool, buffer_size: int
    ) -> Iterator[tuple[Any, ...]] | Iterator[dict[str, Any]]:
        df = self._native_frame
        num_rows = df.num_rows

        if not named:
            for i in range(0, num_rows, buffer_size):
                rows = df[i : i + buffer_size].to_pydict().values()
                yield from zip(*rows)
        else:
            for i in range(0, num_rows, buffer_size):
                yield from df[i : i + buffer_size].to_pylist()

    def get_column(self: Self, name: str) -> ArrowSeries:
        from narwhals._arrow.series import ArrowSeries

        if not isinstance(name, str):
            msg = f"Expected str, got: {type(name)}"
            raise TypeError(msg)

        return ArrowSeries(
            self._native_frame[name],
            name=name,
            backend_version=self._backend_version,
            version=self._version,
        )

    def __array__(self: Self, dtype: Any, copy: bool | None) -> np.ndarray:
        return self._native_frame.__array__(dtype, copy=copy)

    @overload
    def __getitem__(self: Self, item: tuple[Sequence[int], str | int]) -> ArrowSeries: ...  # type: ignore[overload-overlap]

    @overload
    def __getitem__(self: Self, item: Sequence[int]) -> ArrowDataFrame: ...

    @overload
    def __getitem__(self: Self, item: str) -> ArrowSeries: ...

    @overload
    def __getitem__(self: Self, item: slice) -> ArrowDataFrame: ...

    @overload
    def __getitem__(self: Self, item: tuple[slice, slice]) -> ArrowDataFrame: ...

    def __getitem__(
        self: Self,
        item: (
            str
            | slice
            | Sequence[int]
            | Sequence[str]
            | tuple[Sequence[int], str | int]
            | tuple[slice, str | int]
            | tuple[slice, slice]
        ),
    ) -> ArrowSeries | ArrowDataFrame:
        if isinstance(item, tuple):
            item = tuple(list(i) if is_sequence_but_not_str(i) else i for i in item)  # type: ignore[assignment]

        if isinstance(item, str):
            from narwhals._arrow.series import ArrowSeries

            return ArrowSeries(
                self._native_frame[item],
                name=item,
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
                return self._from_native_frame(self._native_frame.slice(0, 0).select([]))
            selected_rows = select_rows(self._native_frame, item[0])
            return self._from_native_frame(selected_rows.select(item[1]))

        elif isinstance(item, tuple) and len(item) == 2:
            if isinstance(item[1], slice):
                columns = self.columns
                if item[1] == slice(None):
                    if isinstance(item[0], Sequence) and len(item[0]) == 0:
                        return self._from_native_frame(self._native_frame.slice(0, 0))
                    return self._from_native_frame(self._native_frame.take(item[0]))
                if isinstance(item[1].start, str) or isinstance(item[1].stop, str):
                    start, stop, step = convert_str_slice_to_int_slice(item[1], columns)
                    return self._from_native_frame(
                        self._native_frame.take(item[0]).select(columns[start:stop:step])
                    )
                if isinstance(item[1].start, int) or isinstance(item[1].stop, int):
                    return self._from_native_frame(
                        self._native_frame.take(item[0]).select(
                            columns[item[1].start : item[1].stop : item[1].step]
                        )
                    )
                msg = f"Expected slice of integers or strings, got: {type(item[1])}"  # pragma: no cover
                raise TypeError(msg)  # pragma: no cover
            from narwhals._arrow.series import ArrowSeries

            # PyArrow columns are always strings
            col_name = item[1] if isinstance(item[1], str) else self.columns[item[1]]
            if isinstance(item[0], str):  # pragma: no cover
                msg = "Can not slice with tuple with the first element as a str"
                raise TypeError(msg)
            if (isinstance(item[0], slice)) and (item[0] == slice(None)):
                return ArrowSeries(
                    self._native_frame[col_name],
                    name=col_name,
                    backend_version=self._backend_version,
                    version=self._version,
                )
            selected_rows = select_rows(self._native_frame, item[0])
            return ArrowSeries(
                selected_rows[col_name],
                name=col_name,
                backend_version=self._backend_version,
                version=self._version,
            )

        elif isinstance(item, slice):
            if item.step is not None and item.step != 1:
                msg = "Slicing with step is not supported on PyArrow tables"
                raise NotImplementedError(msg)
            columns = self.columns
            if isinstance(item.start, str) or isinstance(item.stop, str):
                start, stop, step = convert_str_slice_to_int_slice(item, columns)
                return self._from_native_frame(
                    self._native_frame.select(columns[start:stop:step])
                )
            start = item.start or 0
            stop = item.stop if item.stop is not None else len(self._native_frame)
            return self._from_native_frame(self._native_frame.slice(start, stop - start))

        elif isinstance(item, Sequence) or (is_numpy_array(item) and item.ndim == 1):
            if (
                isinstance(item, Sequence)
                and all(isinstance(x, str) for x in item)
                and len(item) > 0
            ):
                return self._from_native_frame(self._native_frame.select(item))
            if isinstance(item, Sequence) and len(item) == 0:
                return self._from_native_frame(self._native_frame.slice(0, 0))
            return self._from_native_frame(self._native_frame.take(item))

        else:  # pragma: no cover
            msg = f"Expected str or slice, got: {type(item)}"
            raise TypeError(msg)

    @property
    def schema(self: Self) -> dict[str, DType]:
        schema = self._native_frame.schema
        return {
            name: native_to_narwhals_dtype(dtype, self._version)
            for name, dtype in zip(schema.names, schema.types)
        }

    def collect_schema(self: Self) -> dict[str, DType]:
        return self.schema

    def estimated_size(self: Self, unit: SizeUnit) -> int | float:
        sz = self._native_frame.nbytes
        return scale_bytes(sz, unit)

    @property
    def columns(self: Self) -> list[str]:
        return self._native_frame.schema.names  # type: ignore[no-any-return]

    def select(self: Self, *exprs: IntoArrowExpr, **named_exprs: IntoArrowExpr) -> Self:
        import pyarrow as pa

        new_series = evaluate_into_exprs(self, *exprs, **named_exprs)
        if not new_series:
            # return empty dataframe, like Polars does
            return self._from_native_frame(self._native_frame.__class__.from_arrays([]))
        names = [s.name for s in new_series]
        df = pa.Table.from_arrays(broadcast_series(new_series), names=names)
        return self._from_native_frame(df)

    def with_columns(
        self: Self, *exprs: IntoArrowExpr, **named_exprs: IntoArrowExpr
    ) -> Self:
        native_frame = self._native_frame
        new_columns = evaluate_into_exprs(self, *exprs, **named_exprs)

        length = len(self)
        columns = self.columns

        for col_value in new_columns:
            col_name = col_value.name

            column = validate_dataframe_comparand(
                length=length, other=col_value, backend_version=self._backend_version
            )

            native_frame = (
                native_frame.set_column(
                    columns.index(col_name), field_=col_name, column=column
                )
                if col_name in columns
                else native_frame.append_column(field_=col_name, column=column)
            )

        return self._from_native_frame(native_frame)

    def group_by(self: Self, *keys: str, drop_null_keys: bool) -> ArrowGroupBy:
        from narwhals._arrow.group_by import ArrowGroupBy

        return ArrowGroupBy(self, list(keys), drop_null_keys=drop_null_keys)

    def join(
        self: Self,
        other: Self,
        *,
        how: Literal["left", "inner", "cross", "anti", "semi"],
        left_on: str | list[str] | None,
        right_on: str | list[str] | None,
        suffix: str,
    ) -> Self:
        how_to_join_map = {
            "anti": "left anti",
            "semi": "left semi",
            "inner": "inner",
            "left": "left outer",
        }

        if how == "cross":
            plx = self.__narwhals_namespace__()
            key_token = generate_temporary_column_name(
                n_bytes=8, columns=[*self.columns, *other.columns]
            )

            return self._from_native_frame(
                self.with_columns(**{key_token: plx.lit(0, None)})
                ._native_frame.join(
                    other.with_columns(**{key_token: plx.lit(0, None)})._native_frame,
                    keys=key_token,
                    right_keys=key_token,
                    join_type="inner",
                    right_suffix=suffix,
                )
                .drop([key_token]),
            )

        return self._from_native_frame(
            self._native_frame.join(
                other._native_frame,
                keys=left_on,
                right_keys=right_on,
                join_type=how_to_join_map[how],
                right_suffix=suffix,
            ),
        )

    def join_asof(
        self: Self,
        other: Self,
        *,
        left_on: str | None,
        right_on: str | None,
        on: str | None,
        by_left: str | list[str] | None,
        by_right: str | list[str] | None,
        by: str | list[str] | None,
        strategy: Literal["backward", "forward", "nearest"],
    ) -> Self:
        msg = "join_asof is not yet supported on PyArrow tables"  # pragma: no cover
        raise NotImplementedError(msg)

    def drop(self: Self, columns: list[str], strict: bool) -> Self:  # noqa: FBT001
        to_drop = parse_columns_to_drop(
            compliant_frame=self, columns=columns, strict=strict
        )
        return self._from_native_frame(self._native_frame.drop(to_drop))

    def drop_nulls(self: Self, subset: str | list[str] | None) -> Self:
        if subset is None:
            return self._from_native_frame(self._native_frame.drop_null())
        subset = [subset] if isinstance(subset, str) else subset
        plx = self.__narwhals_namespace__()
        return self.filter(~plx.any_horizontal(plx.col(*subset).is_null()))

    def sort(
        self: Self,
        by: str | Iterable[str],
        *more_by: str,
        descending: bool | Sequence[bool],
        nulls_last: bool,
    ) -> Self:
        flat_keys = flatten([*flatten([by]), *more_by])
        df = self._native_frame

        if isinstance(descending, bool):
            order = "descending" if descending else "ascending"
            sorting = [(key, order) for key in flat_keys]
        else:
            sorting = [
                (key, "descending" if is_descending else "ascending")
                for key, is_descending in zip(flat_keys, descending)
            ]

        null_placement = "at_end" if nulls_last else "at_start"

        return self._from_native_frame(df.sort_by(sorting, null_placement=null_placement))

    def to_pandas(self: Self) -> pd.DataFrame:
        return self._native_frame.to_pandas()

    def to_numpy(self: Self) -> np.ndarray:
        import numpy as np  # ignore-banned-import

        return np.column_stack([col.to_numpy() for col in self._native_frame.columns])

    @overload
    def to_dict(self: Self, *, as_series: Literal[True]) -> dict[str, ArrowSeries]: ...

    @overload
    def to_dict(self: Self, *, as_series: Literal[False]) -> dict[str, list[Any]]: ...

    def to_dict(
        self: Self, *, as_series: bool
    ) -> dict[str, ArrowSeries] | dict[str, list[Any]]:
        df = self._native_frame

        names_and_values = zip(df.column_names, df.columns)
        if as_series:
            from narwhals._arrow.series import ArrowSeries

            return {
                name: ArrowSeries(
                    col,
                    name=name,
                    backend_version=self._backend_version,
                    version=self._version,
                )
                for name, col in names_and_values
            }
        else:
            return {name: col.to_pylist() for name, col in names_and_values}

    def with_row_index(self: Self, name: str) -> Self:
        import pyarrow as pa

        df = self._native_frame
        cols = self.columns

        row_indices = pa.array(range(df.num_rows))
        return self._from_native_frame(
            df.append_column(name, row_indices).select([name, *cols])
        )

    def filter(self: Self, *predicates: IntoArrowExpr, **constraints: Any) -> Self:
        if (
            len(predicates) == 1
            and isinstance(predicates[0], list)
            and all(isinstance(x, bool) for x in predicates[0])
            and not constraints
        ):
            mask = predicates[0]
        else:
            plx = self.__narwhals_namespace__()
            expr = plx.all_horizontal(
                *chain(
                    predicates, (plx.col(name) == v for name, v in constraints.items())
                )
            )
            # `[0]` is safe as all_horizontal's expression only returns a single column
            mask = expr._call(self)[0]._native_series
        return self._from_native_frame(self._native_frame.filter(mask))

    def null_count(self: Self) -> Self:
        import pyarrow as pa

        df = self._native_frame
        names_and_values = zip(df.column_names, df.columns)

        return self._from_native_frame(
            pa.table({name: [col.null_count] for name, col in names_and_values})
        )

    def head(self: Self, n: int) -> Self:
        df = self._native_frame
        if n >= 0:
            return self._from_native_frame(df.slice(0, n))
        else:
            num_rows = df.num_rows
            return self._from_native_frame(df.slice(0, max(0, num_rows + n)))

    def tail(self: Self, n: int) -> Self:
        df = self._native_frame
        if n >= 0:
            num_rows = df.num_rows
            return self._from_native_frame(df.slice(max(0, num_rows - n)))
        else:
            return self._from_native_frame(df.slice(abs(n)))

    def lazy(self: Self) -> Self:
        return self

    def collect(self: Self) -> ArrowDataFrame:
        return ArrowDataFrame(
            self._native_frame,
            backend_version=self._backend_version,
            version=self._version,
        )

    def clone(self: Self) -> Self:
        msg = "clone is not yet supported on PyArrow tables"
        raise NotImplementedError(msg)

    def is_empty(self: Self) -> bool:
        return self.shape[0] == 0

    def item(self: Self, row: int | None, column: int | str | None) -> Any:
        from narwhals._arrow.series import maybe_extract_py_scalar

        if row is None and column is None:
            if self.shape != (1, 1):
                msg = (
                    "can only call `.item()` if the dataframe is of shape (1, 1),"
                    " or if explicit row/col values are provided;"
                    f" frame has shape {self.shape!r}"
                )
                raise ValueError(msg)
            return maybe_extract_py_scalar(
                self._native_frame[0][0], return_py_scalar=True
            )

        elif row is None or column is None:
            msg = "cannot call `.item()` with only one of `row` or `column`"
            raise ValueError(msg)

        _col = self.columns.index(column) if isinstance(column, str) else column
        return maybe_extract_py_scalar(
            self._native_frame[_col][row], return_py_scalar=True
        )

    def rename(self: Self, mapping: dict[str, str]) -> Self:
        df = self._native_frame
        new_cols = [mapping.get(c, c) for c in df.column_names]
        return self._from_native_frame(df.rename_columns(new_cols))

    def write_parquet(self: Self, file: Any) -> None:
        import pyarrow.parquet as pp

        pp.write_table(self._native_frame, file)

    def write_csv(self: Self, file: Any) -> Any:
        import pyarrow as pa
        import pyarrow.csv as pa_csv

        pa_table = self._native_frame
        if file is None:
            csv_buffer = pa.BufferOutputStream()
            pa_csv.write_csv(pa_table, csv_buffer)
            return csv_buffer.getvalue().to_pybytes().decode()
        return pa_csv.write_csv(pa_table, file)

    def is_duplicated(self: Self) -> ArrowSeries:
        import pyarrow as pa
        import pyarrow.compute as pc

        from narwhals._arrow.series import ArrowSeries

        columns = self.columns
        index_token = generate_temporary_column_name(n_bytes=8, columns=columns)
        col_token = generate_temporary_column_name(
            n_bytes=8, columns=[*columns, index_token]
        )
        df = self.with_row_index(index_token)._native_frame
        row_count = (
            df.append_column(col_token, pa.repeat(pa.scalar(1), len(self)))
            .group_by(columns)
            .aggregate([(col_token, "sum")])
        )
        is_duplicated = pc.greater(
            df.join(
                row_count,
                keys=columns,
                right_keys=columns,
                join_type="left outer",
                use_threads=False,
            )
            .sort_by(index_token)
            .column(f"{col_token}_sum"),
            1,
        )
        res = ArrowSeries(
            is_duplicated,
            name="",
            backend_version=self._backend_version,
            version=self._version,
        )
        return res.fill_null(res.null_count() > 1, strategy=None, limit=None)

    def is_unique(self: Self) -> ArrowSeries:
        import pyarrow.compute as pc

        from narwhals._arrow.series import ArrowSeries

        is_duplicated = self.is_duplicated()._native_series

        return ArrowSeries(
            pc.invert(is_duplicated),
            name="",
            backend_version=self._backend_version,
            version=self._version,
        )

    def unique(
        self: Self,
        subset: list[str] | None,
        *,
        keep: Literal["any", "first", "last", "none"],
        maintain_order: bool = False,
    ) -> Self:
        # The param `maintain_order` is only here for compatibility with the Polars API
        # and has no effect on the output.
        import numpy as np  # ignore-banned-import
        import pyarrow as pa
        import pyarrow.compute as pc

        df = self._native_frame
        check_column_exists(self.columns, subset)
        subset = subset or self.columns

        if keep in {"any", "first", "last"}:
            agg_func_map = {"any": "min", "first": "min", "last": "max"}

            agg_func = agg_func_map[keep]
            col_token = generate_temporary_column_name(n_bytes=8, columns=self.columns)
            keep_idx = (
                df.append_column(col_token, pa.array(np.arange(len(self))))
                .group_by(subset)
                .aggregate([(col_token, agg_func)])
                .column(f"{col_token}_{agg_func}")
            )

            return self._from_native_frame(pc.take(df, keep_idx))

        keep_idx = self.select(*subset).is_unique()
        return self.filter(keep_idx)

    def gather_every(self: Self, n: int, offset: int = 0) -> Self:
        return self._from_native_frame(self._native_frame[offset::n])

    def to_arrow(self: Self) -> pa.Table:
        return self._native_frame

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

        frame = self._native_frame
        num_rows = len(self)
        if n is None and fraction is not None:
            n = int(num_rows * fraction)

        rng = np.random.default_rng(seed=seed)
        idx = np.arange(0, num_rows)
        mask = rng.choice(idx, size=n, replace=with_replacement)

        return self._from_native_frame(pc.take(frame, mask))

    def unpivot(
        self: Self,
        on: str | list[str] | None,
        index: str | list[str] | None,
        variable_name: str | None,
        value_name: str | None,
    ) -> Self:
        import pyarrow as pa

        native_frame = self._native_frame
        variable_name = variable_name if variable_name is not None else "variable"
        value_name = value_name if value_name is not None else "value"

        index_: list[str] = (
            [] if index is None else [index] if isinstance(index, str) else index
        )
        on_: list[str] = (
            [c for c in self.columns if c not in index_]
            if on is None
            else [on]
            if isinstance(on, str)
            else on
        )

        n_rows = len(self)

        promote_kwargs = (
            {"promote_options": "permissive"}
            if self._backend_version >= (14, 0, 0)
            else {}
        )
        return self._from_native_frame(
            pa.concat_tables(
                [
                    pa.Table.from_arrays(
                        [
                            *[native_frame.column(idx_col) for idx_col in index_],
                            pa.array([on_col] * n_rows, pa.string()),
                            native_frame.column(on_col),
                        ],
                        names=[*index_, variable_name, value_name],
                    )
                    for on_col in on_
                ],
                **promote_kwargs,
            )
        )
        # TODO(Unassigned): Even with promote_options="permissive", pyarrow does not
        # upcast numeric to non-numeric (e.g. string) datatypes
