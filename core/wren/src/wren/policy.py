"""SQL policy validation for strict query mode.

Validates that a parsed SQL AST only references tables defined in the MDL
manifest and does not use any denied functions.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Iterable

from sqlglot import exp, parse_one
from sqlglot.errors import SqlglotError

from wren.config import WrenConfig
from wren.model.error import ErrorCode, ErrorPhase, WrenError

# Row-expansion operators (UNNEST / FLATTEN / EXPLODE) are not data sources —
# they restructure an array/struct expression that is already in query scope
# (e.g. a governed model column like ``orders.items``), so they never read data
# outside the manifest and must not be treated as a disallowed table-valued
# function. The class mapping is stable across dialects: ``UNNEST`` ->
# ``exp.Unnest`` (trino/postgres/duckdb), Snowflake ``FLATTEN`` -> ``exp.Explode``,
# so no per-dialect name matching is needed.
#
# Note: ``UNNEST(read_csv(...))`` is therefore also allowed, but that is an
# instance of the broader pre-existing gap (data-reading TVFs in non-source
# positions — already reachable today via projection/WHERE subqueries, since
# strict mode only governs the top-level source position) and is tracked
# separately. It is not a regression introduced here.
_ROW_EXPANSION_FUNCS: tuple[type[exp.Func], ...] = (exp.Unnest, exp.Explode)

# Dialects we probe when canonicalising the user's denylist. sqlglot can map
# the same function name (e.g. ``version()``) onto different concrete AST
# subclasses depending on the dialect — postgres/mysql/duckdb/trino/clickhouse
# normalise to ``CurrentVersion`` while tsql/oracle/bigquery/snowflake keep it
# as ``Anonymous``. Probing each dialect ensures the canonical class key is
# captured regardless of which one the user's SQL ends up parsed with.
_CANONICALISE_DIALECTS: tuple[str | None, ...] = (
    None,
    "postgres",
    "mysql",
    "tsql",
    "oracle",
    "bigquery",
    "snowflake",
    "clickhouse",
    "trino",
    "duckdb",
)


def resolve_model_name(
    name: str,
    quoted: bool,
    model_names: Iterable[str],
) -> str | None:
    """Resolve a SQL table identifier to a manifest model name.

    Follows the SQL convention used across Wren's CTE rewriter, policy check,
    and manifest extractor: a quoted identifier must match a model name
    case-sensitively; an unquoted identifier prefers an exact case match but
    falls back to a case-insensitive scan. Returns ``None`` if no model
    matches.
    """
    model_set = (
        model_names if isinstance(model_names, (set, frozenset)) else set(model_names)
    )
    if name in model_set:
        return name
    if quoted:
        return None
    name_lower = name.lower()
    for candidate in model_set:
        if candidate.lower() == name_lower:
            return candidate
    return None


def validate_sql_policy(
    ast: exp.Expression,
    model_names: set[str],
    config: WrenConfig,
) -> None:
    """Raise ``WrenError`` if the SQL violates strict-mode policies.

    Parameters
    ----------
    ast:
        Parsed sqlglot AST of the user query.
    model_names:
        Set of model names defined in the MDL manifest.
    config:
        Wren configuration with strict_mode and denied_functions settings.
    """
    if config.strict_mode:
        _check_tables(ast, model_names)
    if config.denied_functions:
        _check_functions(ast, config.denied_functions)


def _visible_cte_names(node: exp.Expression) -> set[str]:
    """Return CTE names visible at *node*'s scope by walking up the AST."""
    names: set[str] = set()
    cursor = node.parent
    while cursor is not None:
        # A WITH clause is visible to its parent SELECT and siblings.
        with_clause = cursor.args.get("with_") if hasattr(cursor, "args") else None
        if isinstance(with_clause, exp.With):
            for cte in with_clause.expressions:
                alias = cte.args.get("alias")
                if alias:
                    cte_name = (
                        alias.this.name
                        if isinstance(alias.this, exp.Identifier)
                        else str(alias.this)
                    )
                    names.add(cte_name.lower())
        cursor = cursor.parent
    return names


def _check_tables(
    ast: exp.Expression,
    model_names: set[str],
) -> None:
    for table in ast.find_all(exp.Table):
        name = table.name
        if not name:
            # Table nodes with no name are table-valued functions
            # (e.g. read_csv(), generate_series()). Block them in strict mode.
            sql_text = table.sql()
            if sql_text:
                raise WrenError(
                    ErrorCode.MODEL_NOT_FOUND,
                    f"Table-valued function '{sql_text}' is not allowed. "
                    "In strict mode, all table references must correspond to MDL models.",
                    phase=ErrorPhase.SQL_POLICY_CHECK,
                )
            continue
        quoted = (
            bool(table.this.quoted) if isinstance(table.this, exp.Identifier) else False
        )
        if resolve_model_name(name, quoted, model_names) is not None:
            continue
        if name.lower() in _visible_cte_names(table):
            continue
        raise WrenError(
            ErrorCode.MODEL_NOT_FOUND,
            f"Table '{name}' is not defined in the MDL manifest. "
            "In strict mode, all table references must correspond to MDL models.",
            phase=ErrorPhase.SQL_POLICY_CHECK,
        )

    # Func subclasses used as query sources (e.g. UNNEST, generate_series)
    # produce no exp.Table node at all. They can appear both as the FROM
    # source AND as a JOIN source (e.g. ``orders CROSS JOIN UNNEST(items)``),
    # so scan both — checking only FROM let a table-valued function slip
    # through strict mode whenever it was reached via a JOIN.
    for clause in ast.find_all(exp.From, exp.Join):
        source = clause.this
        if isinstance(source, exp.Alias):
            source = source.this
        # LATERAL-wrapped TVFs (e.g. ``LATERAL FLATTEN(...)`` /
        # ``LATERAL generate_series(...)``) parse to an exp.Lateral node that
        # *wraps* the function rather than being an exp.Func itself, so the
        # bare-Func check below would miss them. Unwrap to inspect the inner
        # source — this is the same "TVF reached via JOIN" bug class.
        if isinstance(source, exp.Lateral):
            source = source.this
            if isinstance(source, exp.Alias):
                source = source.this
        if isinstance(source, _ROW_EXPANSION_FUNCS):
            # Row-expansion over an in-scope expression (e.g. a governed model
            # column) reads nothing outside the manifest — allow it.
            continue
        if isinstance(source, exp.Func):
            raise WrenError(
                ErrorCode.MODEL_NOT_FOUND,
                f"Table-valued function '{source.sql()}' is not allowed. "
                "In strict mode, all table references must correspond to MDL models.",
                phase=ErrorPhase.SQL_POLICY_CHECK,
            )


@lru_cache(maxsize=128)
def _canonical_denied(denied: frozenset[str]) -> frozenset[str]:
    """Expand the user's denylist to also cover sqlglot's canonical keys.

    sqlglot >=29 maps several common functions onto concrete subclasses —
    e.g. ``version()`` becomes ``exp.CurrentVersion`` in
    postgres/mysql/duckdb/trino/clickhouse (with ``type(node).key ==
    "currentversion"``), while in tsql/oracle/bigquery/snowflake it stays
    as ``exp.Anonymous(name="version")``. A user denylist entry of
    ``"version"`` would only match the anonymous case without this
    expansion. Probing each known dialect collects every class key the
    name might land on at parse time and adds them all to the result.
    """
    expanded: set[str] = {d.lower() for d in denied}
    for name in list(expanded):
        for dialect in _CANONICALISE_DIALECTS:
            try:
                ast = parse_one(f"SELECT {name}()", dialect=dialect)
            except SqlglotError:
                # A malformed denylist entry can fail tokenizing or parsing on
                # some dialects; skip it for this dialect rather than crashing
                # validation (SqlglotError covers ParseError and TokenError).
                continue
            first_func = next(ast.find_all(exp.Func), None)
            if first_func is not None and not isinstance(first_func, exp.Anonymous):
                expanded.add(type(first_func).key.lower())
    return frozenset(expanded)


def _check_functions(
    ast: exp.Expression,
    denied: frozenset[str],
) -> None:
    canonical = _canonical_denied(denied)
    for func in ast.find_all(exp.Func):
        if isinstance(func, exp.Anonymous):
            name = func.name
        else:
            name = type(func).key
        if name.lower() in canonical:
            raise WrenError(
                ErrorCode.BLOCKED_FUNCTION,
                f"Function '{name}' is not allowed. "
                "This function is on the denied list.",
                phase=ErrorPhase.SQL_POLICY_CHECK,
            )
