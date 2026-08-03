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

    ``ConnectorABC.query`` is typed as ``limit: int | None``. At runtime this
    helper still defends against accidental non-ints so every connector that
    interpolates LIMIT shares one contract:

    - ``None`` stays unlimited
    - ``bool`` is rejected (``bool`` is an ``int`` subclass)
    - non-integral numbers (e.g. ``-0.5``, ``1.5``, ``Decimal("1.5")``) are
      rejected — never truncated by ``int()``
    - non-numeric / overflow values raise ``ValueError``
    - negatives raise ``ValueError``

    Invalid limits surface as a consistent ``ValueError`` instead of a
    driver-level error after SQL interpolation.
    """
    if limit is None:
        return None
    if isinstance(limit, bool):
        raise ValueError("limit must be an integer, not bool")
    if isinstance(limit, float):
        if not limit.is_integer():
            raise ValueError(f"limit must be an integral value, got {limit!r}")
    try:
        coerced = int(limit)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"limit must be an integer, got {limit!r}") from exc
    # Reject truncation (Decimal/Fraction/etc.) via direct equality — no float()
    # so oversized ints do not surface OverflowError. Integral floats already
    # passed is_integer() above; plain int/str need no extra check.
    if not isinstance(limit, (int, float, str)) and limit != coerced:
        raise ValueError(f"limit must be an integral value, got {limit!r}")
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
