from __future__ import annotations

from typing import TYPE_CHECKING
from typing import Generic
from typing import TypeVar

if TYPE_CHECKING:
    from typing_extensions import Self

    from narwhals.expr import Expr

ExprT = TypeVar("ExprT", bound="Expr")


class ExprListNamespace(Generic[ExprT]):
    def __init__(self: Self, expr: ExprT) -> None:
        self._expr = expr

    def len(self: Self) -> ExprT:
        """Return the number of elements in each list.

        Null values count towards the total.

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [[1, 2], [3, 4, None], None, []]}

            Let's define a dataframe-agnostic function:

            >>> def agnostic_list_len(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.with_columns(a_len=nw.col("a").list.len()).to_native()

            We can then pass pandas / PyArrow / Polars / any other supported library:

            >>> agnostic_list_len(
            ...     pd.DataFrame(data).astype({"a": pd.ArrowDtype(pa.list_(pa.int64()))})
            ... )  # doctest: +SKIP
                           a  a_len
            0        [1. 2.]      2
            1  [ 3.  4. nan]      3
            2           <NA>   <NA>
            3             []      0

            >>> agnostic_list_len(pl.DataFrame(data))
            shape: (4, 2)
            ┌──────────────┬───────┐
            │ a            ┆ a_len │
            │ ---          ┆ ---   │
            │ list[i64]    ┆ u32   │
            ╞══════════════╪═══════╡
            │ [1, 2]       ┆ 2     │
            │ [3, 4, null] ┆ 3     │
            │ null         ┆ null  │
            │ []           ┆ 0     │
            └──────────────┴───────┘

            >>> agnostic_list_len(pa.table(data))
            pyarrow.Table
            a: list<item: int64>
              child 0, item: int64
            a_len: uint32
            ----
            a: [[[1,2],[3,4,null],null,[]]]
            a_len: [[2,3,null,0]]
        """
        return self._expr.__class__(
            lambda plx: self._expr._to_compliant_expr(plx).list.len()
        )
