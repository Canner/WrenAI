from __future__ import annotations

import re
from abc import ABC, abstractmethod

import pyarrow as pa

_TRAILING_SEMICOLONS_RE = re.compile(r"[;\s]+\Z")


def strip_trailing_semicolon(sql: str) -> str:
    """Strip any trailing ``;`` characters and surrounding whitespace.

    Connectors often subquery-wrap or EXPLAIN user SQL. Engines reject a
    trailing semicolon inside those forms (e.g. ``SELECT * FROM (SELECT 1;)``
    or ``EXPLAIN SELECT 1;``). Only the *terminating* run of semicolons and
    whitespace is removed, so semicolons inside string literals
    (``SELECT 'a;b'``) are preserved.

    Non-string inputs (None/bytes) coerce to ``""`` so call sites that pass
    placeholders do not raise TypeError inside the re engine.
    """
    if not isinstance(sql, str):
        return ""
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
