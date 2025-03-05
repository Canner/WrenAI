from __future__ import annotations

from typing import TYPE_CHECKING

from narwhals._expression_parsing import reuse_series_namespace_implementation

if TYPE_CHECKING:
    from typing_extensions import Self

    from narwhals._arrow.expr import ArrowExpr


class ArrowExprListNamespace:
    def __init__(self: Self, expr: ArrowExpr) -> None:
        self._expr = expr

    def len(self: Self) -> ArrowExpr:
        return reuse_series_namespace_implementation(self._expr, "list", "len")
