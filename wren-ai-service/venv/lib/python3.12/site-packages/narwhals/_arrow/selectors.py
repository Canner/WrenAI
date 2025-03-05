from __future__ import annotations

from typing import TYPE_CHECKING
from typing import Any
from typing import NoReturn
from typing import Sequence

from narwhals._arrow.expr import ArrowExpr
from narwhals.utils import Implementation
from narwhals.utils import import_dtypes_module

if TYPE_CHECKING:
    from typing_extensions import Self

    from narwhals._arrow.dataframe import ArrowDataFrame
    from narwhals._arrow.series import ArrowSeries
    from narwhals.dtypes import DType
    from narwhals.utils import Version


class ArrowSelectorNamespace:
    def __init__(
        self: Self, *, backend_version: tuple[int, ...], version: Version
    ) -> None:
        self._backend_version = backend_version
        self._implementation = Implementation.PYARROW
        self._version = version

    def by_dtype(self: Self, dtypes: list[DType | type[DType]]) -> ArrowSelector:
        def func(df: ArrowDataFrame) -> list[ArrowSeries]:
            return [df[col] for col in df.columns if df.schema[col] in dtypes]

        return ArrowSelector(
            func,
            depth=0,
            function_name="type_selector",
            root_names=None,
            output_names=None,
            backend_version=self._backend_version,
            version=self._version,
            kwargs={"dtypes": dtypes},
        )

    def numeric(self: Self) -> ArrowSelector:
        dtypes = import_dtypes_module(self._version)
        return self.by_dtype(
            [
                dtypes.Int64,
                dtypes.Int32,
                dtypes.Int16,
                dtypes.Int8,
                dtypes.UInt64,
                dtypes.UInt32,
                dtypes.UInt16,
                dtypes.UInt8,
                dtypes.Float64,
                dtypes.Float32,
            ],
        )

    def categorical(self: Self) -> ArrowSelector:
        dtypes = import_dtypes_module(self._version)
        return self.by_dtype([dtypes.Categorical])

    def string(self: Self) -> ArrowSelector:
        dtypes = import_dtypes_module(self._version)
        return self.by_dtype([dtypes.String])

    def boolean(self: Self) -> ArrowSelector:
        dtypes = import_dtypes_module(self._version)
        return self.by_dtype([dtypes.Boolean])

    def all(self: Self) -> ArrowSelector:
        def func(df: ArrowDataFrame) -> list[ArrowSeries]:
            return [df[col] for col in df.columns]

        return ArrowSelector(
            func,
            depth=0,
            function_name="type_selector",
            root_names=None,
            output_names=None,
            backend_version=self._backend_version,
            version=self._version,
            kwargs={},
        )


class ArrowSelector(ArrowExpr):
    def __repr__(self: Self) -> str:  # pragma: no cover
        return (
            f"ArrowSelector("
            f"depth={self._depth}, "
            f"function_name={self._function_name}, "
            f"root_names={self._root_names}, "
            f"output_names={self._output_names}"
        )

    def _to_expr(self: Self) -> ArrowExpr:
        return ArrowExpr(
            self._call,
            depth=self._depth,
            function_name=self._function_name,
            root_names=self._root_names,
            output_names=self._output_names,
            backend_version=self._backend_version,
            version=self._version,
            kwargs=self._kwargs,
        )

    def __sub__(self: Self, other: Self | Any) -> ArrowSelector | Any:
        if isinstance(other, ArrowSelector):

            def call(df: ArrowDataFrame) -> list[ArrowSeries]:
                lhs = self._call(df)
                rhs = other._call(df)
                return [x for x in lhs if x.name not in {x.name for x in rhs}]

            return ArrowSelector(
                call,
                depth=0,
                function_name="type_selector",
                root_names=None,
                output_names=None,
                backend_version=self._backend_version,
                version=self._version,
                kwargs={**self._kwargs, "other": other},
            )
        else:
            return self._to_expr() - other

    def __or__(self: Self, other: Self | Any) -> ArrowSelector | Any:
        if isinstance(other, ArrowSelector):

            def call(df: ArrowDataFrame) -> Sequence[ArrowSeries]:
                lhs = self(df)
                rhs = other(df)
                return [*(x for x in lhs if x.name not in {x.name for x in rhs}), *rhs]

            return ArrowSelector(
                call,
                depth=0,
                function_name="type_selector",
                root_names=None,
                output_names=None,
                backend_version=self._backend_version,
                version=self._version,
                kwargs={**self._kwargs, "other": other},
            )
        else:
            return self._to_expr() | other

    def __and__(self: Self, other: Self | Any) -> ArrowSelector | Any:
        if isinstance(other, ArrowSelector):

            def call(df: ArrowDataFrame) -> list[ArrowSeries]:
                lhs = self._call(df)
                rhs = other._call(df)
                return [x for x in lhs if x.name in {x.name for x in rhs}]

            return ArrowSelector(
                call,
                depth=0,
                function_name="type_selector",
                root_names=None,
                output_names=None,
                backend_version=self._backend_version,
                version=self._version,
                kwargs={**self._kwargs, "other": other},
            )
        else:
            return self._to_expr() & other

    def __invert__(self: Self) -> ArrowSelector:
        return (
            ArrowSelectorNamespace(
                backend_version=self._backend_version, version=self._version
            ).all()
            - self
        )

    def __rsub__(self: Self, other: Any) -> NoReturn:
        raise NotImplementedError

    def __rand__(self: Self, other: Any) -> NoReturn:
        raise NotImplementedError

    def __ror__(self: Self, other: Any) -> NoReturn:
        raise NotImplementedError
