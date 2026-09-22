from __future__ import annotations

import re
from abc import ABC, abstractmethod

import pyarrow as pa
from sqlglot import Dialect
from sqlglot.errors import TokenError
from sqlglot.tokens import TokenType

_TRAILING_SEMICOLONS_RE = re.compile(r"[;\s]+\Z")


def strip_trailing_semicolon(sql: str, dialect: str | None = None) -> str:
    """Strip the terminating ``;`` and anything after it (whitespace/comments).

    Connectors often subquery-wrap or EXPLAIN user SQL. Engines reject a
    trailing semicolon inside those forms (e.g. ``SELECT * FROM (SELECT 1;)``
    or ``EXPLAIN SELECT 1;``), and a comment after the semicolon defeats an
    end-anchored strip, leaving the ``;`` inside the wrapped subquery.

    Lexing is delegated to sqlglot's dialect-aware tokenizer rather than a
    hand-written scanner: which escapes (``\\'``), quote styles (``$$..$$``,
    backticks, ``[brackets]``, ``q'[..]'``) and comment markers exist is a
    per-dialect property, and a scanner in this file would have to re-encode
    it for every connector. Comments attach to the preceding token, so "only
    comments after the ``;``" needs no special handling — the last token is
    simply ``SEMICOLON``.

    Only the *terminating* run of semicolons is removed: ``;`` inside string
    literals (``SELECT 'a;b'``) or inside comments is preserved, and SQL
    without a trailing semicolon is returned unchanged.

    Raises no error for input the tokenizer cannot lex (an unterminated string
    or block comment): those fall back to the previous end-anchored behaviour,
    which is never worse than what this function replaced.
    """
    try:
        tokens = Dialect.get_or_raise(dialect).tokenize(sql)
    except TokenError:
        # Unterminated string/comment or a form the tokenizer rejects:
        # degrade to the previous end-anchored strip, never worse than before.
        return _TRAILING_SEMICOLONS_RE.sub("", sql)
    cut = None
    for token in reversed(tokens):
        if token.token_type is not TokenType.SEMICOLON:
            break
        cut = token.start
    return sql[:cut].rstrip() if cut is not None else sql


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
    #: sqlglot dialect name for this connector, assigned by
    #: ``wren.connector.factory.get_connector`` from the ``DataSource``. Left
    #: ``None`` for connectors built directly (tests, ad-hoc use), which makes
    #: ``_strip`` fall back to sqlglot's default dialect.
    dialect: str | None = None

    def _strip(self, sql: str) -> str:
        """``strip_trailing_semicolon`` using this connector's dialect."""
        return strip_trailing_semicolon(sql, self.dialect)

    @abstractmethod
    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        pass

    @abstractmethod
    def dry_run(self, sql: str) -> None:
        pass

    @abstractmethod
    def close(self) -> None:
        pass
