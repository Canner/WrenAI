from __future__ import annotations

import typing as t

from sqlglot.executor.env import ENV

if t.TYPE_CHECKING:
    from sqlglot.executor.table import Table, TableIter


class Context:
    """
    Execution context for sql expressions.

    Context is used to hold relevant data tables which can then be queried on with eval.

    References to columns can either be scalar or vectors. When set_row is used, column references
    evaluate to scalars while set_range evaluates to vectors. This allows convenient and efficient
    evaluation of aggregation functions.
    """

    def __init__(self, tables: t.Dict[str, Table], env: t.Optional[t.Dict] = None) -> None:
        """
        Args
            tables: representing the scope of the current execution context.
            env: dictionary of functions within the execution context.
        """
        self.tables = tables
        self._table: t.Optional[Table] = None
        self.range_readers = {name: table.range_reader for name, table in self.tables.items()}
        self.row_readers = {name: table.reader for name, table in tables.items()}
        self.env = {**ENV, **(env or {}), "scope": self.row_readers}

    def eval(self, code):
        return eval(code, self.env)

    def eval_tuple(self, codes):
        return tuple(self.eval(code) for code in codes)

    @property
    def table(self) -> Table:
        if self._table is None:
            self._table = list(self.tables.values())[0]

            for other in self.tables.values():
                if self._table.columns != other.columns:
                    raise Exception("Columns are different.")
                if len(self._table.rows) != len(other.rows):
                    raise Exception("Rows are different.")

        return self._table

    def add_columns(self, *columns: str) -> None:
        for table in self.tables.values():
            table.add_columns(*columns)

    @property
    def columns(self) -> t.Tuple:
        return self.table.columns

    def __iter__(self):
        self.env["scope"] = self.row_readers
        for i in range(len(self.table.rows)):
            for table in self.tables.values():
                reader = table[i]
            yield reader, self

    def table_iter(self, table: str) -> TableIter:
        self.env["scope"] = self.row_readers
        return iter(self.tables[table])

    def filter(self, condition) -> None:
        rows = [reader.row for reader, _ in self if self.eval(condition)]

        for table in self.tables.values():
            table.rows = rows

    def sort(self, key) -> None:
        def sort_key(row: t.Tuple) -> t.Tuple:
            self.set_row(row)
            return tuple((t is None, t) for t in self.eval_tuple(key))

        self.table.rows.sort(key=sort_key)

    def set_row(self, row: t.Tuple) -> None:
        for table in self.tables.values():
            table.reader.row = row
        self.env["scope"] = self.row_readers

    def set_index(self, index: int) -> None:
        for table in self.tables.values():
            table[index]
        self.env["scope"] = self.row_readers

    def set_range(self, start: int, end: int) -> None:
        for name in self.tables:
            self.range_readers[name].range = range(start, end)
        self.env["scope"] = self.range_readers

    def __contains__(self, table: str) -> bool:
        return table in self.tables
