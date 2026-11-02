"""Coerce query result values into JSON-native types.

Shared by ``wren query --output json`` and the MCP ``query`` tool so the same
cell serializes the same way in both. Kept free of optional dependencies so
the CLI can import it without the ``mcp`` extra.
"""

from __future__ import annotations

import math
from datetime import date, time
from decimal import Decimal
from typing import Any


def normalize_value(value: Any) -> Any:
    """Recursively coerce a ``to_pylist()`` value into a JSON-native type.

    Dates and times become ISO 8601 strings. A scale-0 decimal (exponent 0,
    e.g. ``SUM`` of an integer column on DuckDB, MySQL or Postgres) becomes an
    ``int``; any other decimal becomes a ``float``. NaN and infinity become
    ``None``.
    """
    if isinstance(value, (date, time)):  # datetime is a date
        return value.isoformat()
    if isinstance(value, Decimal):
        if value.is_finite() and value.as_tuple().exponent == 0:
            return int(value)
        value = float(value)
    if isinstance(value, (bytes, bytearray)):
        return value.decode(errors="replace")
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if hasattr(value, "item"):  # numpy scalar
        return normalize_value(value.item())
    if isinstance(value, dict):
        return {k: normalize_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [normalize_value(v) for v in value]
    return value
