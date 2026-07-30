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
    """
    return _TRAILING_SEMICOLONS_RE.sub("", sql)


def coerce_limit(limit: int | None) -> int | None:
    """Validate and coerce a user-supplied ``limit`` to a non-negative ``int``.

    Connectors train-plan LIMIT by interpolating the value into SQL. ``int()``
    rejects injection strings like ``"5 OR 1=1"``; negatives are rejected so
    engines never see ``LIMIT -1`` (undefined / dialect-dependent).
    """
    if limit is None:
        return None
    coerced = int(limit)
    if coerced < 0:
        raise ValueError(f"limit must be non-negative, got {coerced}")
    return coerced


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
