"""Schema.

Adapted from Polars implementation at:
https://github.com/pola-rs/polars/blob/main/py-polars/polars/schema.py.
"""

from __future__ import annotations

from collections import OrderedDict
from typing import TYPE_CHECKING
from typing import Iterable
from typing import Mapping

if TYPE_CHECKING:
    from narwhals.dtypes import DType

    BaseSchema = OrderedDict[str, DType]
else:
    # Python 3.8 does not support generic OrderedDict at runtime
    BaseSchema = OrderedDict

__all__ = ["Schema"]


class Schema(BaseSchema):
    """Ordered mapping of column names to their data type.

    Arguments:
        schema: Mapping[str, DType] | Iterable[tuple[str, DType]] | None
            The schema definition given by column names and their associated.
            *instantiated* Narwhals data type. Accepts a mapping or an iterable of tuples.

    Examples:
        Define a schema by passing *instantiated* data types.

        >>> import narwhals as nw
        >>> schema = nw.Schema({"foo": nw.Int8(), "bar": nw.String()})
        >>> schema
        Schema({'foo': Int8, 'bar': String})

        Access the data type associated with a specific column name.

        >>> schema["foo"]
        Int8

        Access various schema properties using the `names`, `dtypes`, and `len` methods.

        >>> schema.names()
        ['foo', 'bar']
        >>> schema.dtypes()
        [Int8, String]
        >>> schema.len()
        2
    """

    def __init__(
        self, schema: Mapping[str, DType] | Iterable[tuple[str, DType]] | None = None
    ) -> None:
        schema = schema or {}
        super().__init__(schema)

    def names(self) -> list[str]:
        """Get the column names of the schema.

        Returns:
            Column names.
        """
        return list(self.keys())

    def dtypes(self) -> list[DType]:
        """Get the data types of the schema.

        Returns:
            Data types of schema.
        """
        return list(self.values())

    def len(self) -> int:
        """Get the number of columns in the schema.

        Returns:
            Number of columns.
        """
        return len(self)
