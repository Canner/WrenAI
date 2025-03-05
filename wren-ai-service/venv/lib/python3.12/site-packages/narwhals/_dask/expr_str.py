from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from typing_extensions import Self

    from narwhals._dask.expr import DaskExpr


class DaskExprStringNamespace:
    def __init__(self, expr: DaskExpr) -> None:
        self._compliant_expr = expr

    def len_chars(self) -> DaskExpr:
        return self._compliant_expr._from_call(
            lambda _input: _input.str.len(),
            "len",
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def replace(
        self, pattern: str, value: str, *, literal: bool = False, n: int = 1
    ) -> DaskExpr:
        return self._compliant_expr._from_call(
            lambda _input, pattern, value, literal, n: _input.str.replace(
                pattern, value, regex=not literal, n=n
            ),
            "replace",
            pattern=pattern,
            value=value,
            literal=literal,
            n=n,
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def replace_all(self, pattern: str, value: str, *, literal: bool = False) -> DaskExpr:
        return self._compliant_expr._from_call(
            lambda _input, pattern, value, literal: _input.str.replace(
                pattern, value, n=-1, regex=not literal
            ),
            "replace",
            pattern=pattern,
            value=value,
            literal=literal,
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def strip_chars(self, characters: str | None = None) -> DaskExpr:
        return self._compliant_expr._from_call(
            lambda _input, characters: _input.str.strip(characters),
            "strip",
            characters=characters,
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def starts_with(self, prefix: str) -> DaskExpr:
        return self._compliant_expr._from_call(
            lambda _input, prefix: _input.str.startswith(prefix),
            "starts_with",
            prefix=prefix,
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def ends_with(self, suffix: str) -> DaskExpr:
        return self._compliant_expr._from_call(
            lambda _input, suffix: _input.str.endswith(suffix),
            "ends_with",
            suffix=suffix,
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def contains(self, pattern: str, *, literal: bool = False) -> DaskExpr:
        return self._compliant_expr._from_call(
            lambda _input, pattern, literal: _input.str.contains(
                pat=pattern, regex=not literal
            ),
            "contains",
            pattern=pattern,
            literal=literal,
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def slice(self, offset: int, length: int | None = None) -> DaskExpr:
        return self._compliant_expr._from_call(
            lambda _input, offset, length: _input.str.slice(
                start=offset, stop=offset + length if length else None
            ),
            "slice",
            offset=offset,
            length=length,
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def to_datetime(self: Self, format: str | None) -> DaskExpr:  # noqa: A002
        import dask.dataframe as dd

        return self._compliant_expr._from_call(
            lambda _input, format: dd.to_datetime(_input, format=format),
            "to_datetime",
            format=format,
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def to_uppercase(self) -> DaskExpr:
        return self._compliant_expr._from_call(
            lambda _input: _input.str.upper(),
            "to_uppercase",
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def to_lowercase(self) -> DaskExpr:
        return self._compliant_expr._from_call(
            lambda _input: _input.str.lower(),
            "to_lowercase",
            returns_scalar=self._compliant_expr._returns_scalar,
        )
