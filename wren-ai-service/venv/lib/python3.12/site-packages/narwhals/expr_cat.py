from __future__ import annotations

from typing import TYPE_CHECKING
from typing import Generic
from typing import TypeVar

if TYPE_CHECKING:
    from typing_extensions import Self

    from narwhals.expr import Expr

ExprT = TypeVar("ExprT", bound="Expr")


class ExprCatNamespace(Generic[ExprT]):
    def __init__(self: Self, expr: ExprT) -> None:
        self._expr = expr

    def get_categories(self: Self) -> ExprT:
        """Get unique categories from column.

        Returns:
            A new expression.

        Examples:
            Let's create some dataframes:

            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"fruits": ["apple", "mango", "mango"]}
            >>> df_pd = pd.DataFrame(data, dtype="category")
            >>> df_pl = pl.DataFrame(data, schema={"fruits": pl.Categorical})

            We define a dataframe-agnostic function to get unique categories
            from column 'fruits':

            >>> def agnostic_cat_get_categories(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("fruits").cat.get_categories()).to_native()

           We can then pass any supported library such as pandas or Polars to
           `agnostic_cat_get_categories`:

            >>> agnostic_cat_get_categories(df_pd)
              fruits
            0  apple
            1  mango

            >>> agnostic_cat_get_categories(df_pl)
            shape: (2, 1)
            ┌────────┐
            │ fruits │
            │ ---    │
            │ str    │
            ╞════════╡
            │ apple  │
            │ mango  │
            └────────┘
        """
        return self._expr.__class__(
            lambda plx: self._expr._to_compliant_expr(plx).cat.get_categories()
        )
