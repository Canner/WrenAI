from __future__ import annotations

import typing as t

from sqlglot import exp
from sqlglot.dialects.dialect import Dialect, DialectType

if t.TYPE_CHECKING:
    from sqlglot._typing import E


@t.overload
def normalize_identifiers(expression: E, dialect: DialectType = None) -> E: ...


@t.overload
def normalize_identifiers(expression: str, dialect: DialectType = None) -> exp.Identifier: ...


def normalize_identifiers(expression, dialect=None):
    """
    Normalize identifiers by converting them to either lower or upper case,
    ensuring the semantics are preserved in each case (e.g. by respecting
    case-sensitivity).

    This transformation reflects how identifiers would be resolved by the engine corresponding
    to each SQL dialect, and plays a very important role in the standardization of the AST.

    It's possible to make this a no-op by adding a special comment next to the
    identifier of interest:

        SELECT a /* sqlglot.meta case_sensitive */ FROM table

    In this example, the identifier `a` will not be normalized.

    Note:
        Some dialects (e.g. DuckDB) treat all identifiers as case-insensitive even
        when they're quoted, so in these cases all identifiers are normalized.

    Example:
        >>> import sqlglot
        >>> expression = sqlglot.parse_one('SELECT Bar.A AS A FROM "Foo".Bar')
        >>> normalize_identifiers(expression).sql()
        'SELECT bar.a AS a FROM "Foo".bar'
        >>> normalize_identifiers("foo", dialect="snowflake").sql(dialect="snowflake")
        'FOO'

    Args:
        expression: The expression to transform.
        dialect: The dialect to use in order to decide how to normalize identifiers.

    Returns:
        The transformed expression.
    """
    dialect = Dialect.get_or_raise(dialect)

    if isinstance(expression, str):
        expression = exp.parse_identifier(expression, dialect=dialect)

    for node in expression.walk(prune=lambda n: n.meta.get("case_sensitive")):
        if not node.meta.get("case_sensitive"):
            dialect.normalize_identifier(node)

    return expression
