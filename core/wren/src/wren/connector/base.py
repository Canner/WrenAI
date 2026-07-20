from __future__ import annotations

import re
from abc import ABC, abstractmethod
from typing import Any

import pyarrow as pa

_TRAILING_SEMICOLONS_RE = re.compile(r"[;\s]+\Z")

MAX_ROW_LIMIT = 10000


def strip_trailing_semicolon(sql: str) -> str:
    """Strip any trailing ``;`` characters and surrounding whitespace.

    Connectors often subquery-wrap or EXPLAIN user SQL. Engines reject a
    trailing semicolon inside those forms (e.g. ``SELECT * FROM (SELECT 1;)``
    or ``EXPLAIN SELECT 1;``). Only the *terminating* run of semicolons and
    whitespace is removed, so semicolons inside string literals
    (``SELECT 'a;b'``) are preserved.
    """
    return _TRAILING_SEMICOLONS_RE.sub("", sql)


class ConnectorABC(ABC):
    @abstractmethod
    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        pass

    @abstractmethod
    def dry_run(self, sql: str) -> None:
        pass

    @abstractmethod
    def close(self) -> None:
        pass

    # ------------------------------------------------------------------
    # Shared limit utilities for all connectors
    # ------------------------------------------------------------------

    def _normalize_limit(self, limit: int | None, max_limit: int = MAX_ROW_LIMIT) -> int:
        """Validate and normalize a row limit across all connectors.

        Parameters
        ----------
        limit:
            User-supplied limit. ``None`` uses *max_limit*. Negative values
            are treated as "no limit" and return *max_limit* (matching SQL
            convention where ``LIMIT -1`` means unlimited).
        max_limit:
            Absolute ceiling. The returned limit is clamped to ``[0, max_limit]``
            (zero is permitted for dry-run / EXPLAIN).

        Returns
        -------
        int
            A safe, clamped non-negative integer guaranteed to be within *max_limit*.
        """
        if limit is None:
            return max_limit
        try:
            limit = int(limit)
        except (TypeError, ValueError, OverflowError):
            limit = max_limit
        if limit < 0:
            limit = max_limit
        return min(limit, max_limit)

    def _apply_limit_param(self, sql: str, limit: int | None,
                           param_style: str = "qmark") -> tuple[str, list[Any] | None]:
        """Apply a parameterized LIMIT clause to *sql*.

        When *limit* is ``None`` the SQL is returned unchanged (no wrapping).
        When *limit* is an integer it is normalized, clamped, and injected
        as a parameter so the caller can do::

            sql, params = self._apply_limit_param(sql, limit)
            cursor.execute(sql, params)

        Supported *param_style* values (PEP 249):
          - ``"qmark"`` — ``?`` (used by pyodbc, pymssql, DuckDB, sqlite3)
          - ``"format"`` — ``%s`` (used by psycopg, MySQLdb, Trino, ClickHouse)

        Never interpolates the limit into the SQL string directly.
        """
        if limit is None:
            return strip_trailing_semicolon(sql), None
        limit = self._normalize_limit(limit)
        placeholder = "%s" if param_style == "format" else "?"
        wrapped = (
            f"SELECT * FROM ({strip_trailing_semicolon(sql)}) AS _q "
            f"LIMIT {placeholder}"
        )
        return wrapped, [limit]

    def _apply_limit_inline(self, sql: str, limit: int | None) -> str:
        """Apply a LIMIT clause by inline (non-parameterized) interpolation.

        **Unsafe fallback** for connectors whose driver does not support
        parameterised queries (e.g. Snowflake, BigQuery via certain drivers).
        The limit is still normalised and clamped so the integer value is safe,
        but prefer ``_apply_limit_param`` wherever the driver supports it.
        """
        if limit is None:
            return strip_trailing_semicolon(sql)
        limit = self._normalize_limit(limit)
        return f"{strip_trailing_semicolon(sql)}\nLIMIT {limit}"
