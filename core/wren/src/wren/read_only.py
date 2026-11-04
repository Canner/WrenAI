"""Conservative SQL admission for host-governed analytical queries.

This is an opt-in boundary, independent of the ordinary CLI query policy. Only
one query statement and known analytical functions are admitted. Unknown UDFs,
reader functions, commands, nested writes, locks and SELECT INTO fail closed.
Database credentials and trusted model definitions remain host responsibilities.
"""

from sqlglot import exp, parse
from sqlglot.optimizer.scope import Scope, traverse_scope

from wren.model.error import ErrorCode, ErrorPhase, WrenError

# Keys are sqlglot ``Expression.key`` values (the lower-cased class name), not
# SQL spellings: ``COUNT_IF`` is ``countif``, ``DATE_TRUNC`` is ``datetrunc``.
_FUNCTIONS = frozenset(
    "abs avg sum count min max round ceil floor coalesce nullif if case cast "
    "trycast extract date dateadd datesub datediff datetrunc timestamptrunc "
    "timetostr strtodate strtotime currentdate currenttimestamp "
    "lower upper trim ltrim rtrim length substring concat concatws replace "
    "row_number rownumber rank denserank lag lead firstvalue lastvalue "
    "stddev stddevpop stddevsamp variance variancepop percentilecont "
    "percentiledisc greatest least power sqrt year month day dayofmonth "
    "dayofweek dayofyear week quarter hour minute second "
    # sqlglot models the boolean connectors and the EXISTS predicate as
    # ``Func`` nodes. They are syntax, not callable functions: without them
    # every ``WHERE a AND b`` is rejected.
    "and or xor exists "
    # Read-only aggregates and predicates analytical SQL commonly uses.
    "countif anyvalue median approxdistinct regexplike".split()
)


class NotReadOnlyError(ValueError):
    """Not a single read-only query: writes, DDL, commands, locks, several statements."""


class UnsupportedFunctionError(ValueError):
    """A read-only query that uses a function or form outside the allowlist."""


def check_read_only_query(sql: str, dialect: str | None) -> None:
    """Raise ``NotReadOnlyError`` or ``UnsupportedFunctionError`` for a refused query.

    Side effects are looked for in the whole tree before any function is judged, so a
    write nested under an unsupported function is still reported as a write.
    """
    statements = parse(sql, dialect=dialect)
    if len(statements) != 1:
        raise NotReadOnlyError("Expected one analytical query")
    statement = statements[0]
    nodes = list(statement.walk())
    if any(
        isinstance(n, (exp.DML, exp.DDL, exp.Command, exp.Into, exp.Lock))
        for n in nodes
    ):
        raise NotReadOnlyError("Query contains an operation with side effects")
    if not isinstance(statement, (exp.Select, exp.Union, exp.Intersect, exp.Except)):
        inner = statement
        while isinstance(inner, exp.Subquery):
            inner = inner.this
        if inner is not statement and isinstance(
            inner, (exp.Select, exp.Union, exp.Intersect, exp.Except)
        ):
            raise UnsupportedFunctionError("A parenthesised query is not supported")
        raise NotReadOnlyError("Expected one analytical query")
    for node in nodes:
        if isinstance(node, exp.Func) and (
            isinstance(node, exp.Anonymous) or node.key not in _FUNCTIONS
        ):
            raise UnsupportedFunctionError("Query uses an unsupported function")
        # Qualified calls can resolve to a user-defined function even when
        # their unqualified spelling looks like a built-in aggregate.
        if isinstance(node, exp.Dot) and isinstance(node.expression, exp.Func):
            raise UnsupportedFunctionError("Qualified functions are not supported")


def validate_read_only_query(sql: str, dialect: str | None) -> None:
    """Raise before planning or connector creation for unsupported SQL."""
    try:
        check_read_only_query(sql, dialect)
    except Exception as error:
        raise WrenError(
            ErrorCode.INVALID_SQL,
            "SQL is not supported by the read-only analytical query policy.",
            phase=ErrorPhase.SQL_POLICY_CHECK,
        ) from error


class NoSourceTablesError(WrenError):
    """A query that reads no stored table. Callers classify it by type, never by text."""

    def __init__(self) -> None:
        super().__init__(
            ErrorCode.INVALID_SQL,
            "The query reads no table, so its values cannot come from the data; "
            "query at least one model.",
            phase=ErrorPhase.SQL_POLICY_CHECK,
        )


def _identifier_key(name: str, quoted: bool, dialect: str | None) -> str:
    """Identifier equality for the dialects that governed stdio supports."""
    if dialect == "postgres":
        return name if quoted else name.lower()
    # DuckDB compares quoted and unquoted identifiers without case sensitivity.
    return name.casefold()


def _cte_matches(source: Scope, name: str, quoted: bool, dialect: str | None) -> bool:
    parent = source.expression.parent
    cte = (
        parent
        if isinstance(parent, exp.CTE)
        else source.expression.find_ancestor(exp.CTE)
    )
    alias = cte.args.get("alias") if cte is not None else None
    identifier = alias.this if isinstance(alias, exp.TableAlias) else None
    cte_name = identifier.name if isinstance(identifier, exp.Identifier) else None
    if cte_name is None:
        return False
    return _identifier_key(name, quoted, dialect) == _identifier_key(
        cte_name, bool(identifier.args.get("quoted")), dialect
    )


def cte_reference_ids(ast: exp.Expression, dialect: str | None = "duckdb") -> set[int]:
    """Table nodes naming a visible CTE using the database identifier rules."""
    found = set()
    for scope in traverse_scope(ast):
        for _alias, node in scope.references:
            if (
                isinstance(node, exp.Table)
                and not node.db
                and not node.catalog
                and any(
                    _cte_matches(
                        source,
                        node.name,
                        bool(node.this.args.get("quoted")),
                        dialect,
                    )
                    for source in scope.cte_sources.values()
                )
            ):
                found.add(id(node))
    return found


def _visible_cte_source(
    scope: Scope, node: exp.Table, dialect: str | None = "duckdb"
) -> Scope | None:
    """Return the CTE that shadows an unqualified table reference, if known."""
    if node.db or node.catalog:
        return None
    visible = {
        id(source): source
        for source in scope.cte_sources.values()
        if _cte_matches(source, node.name, bool(node.this.args.get("quoted")), dialect)
    }
    if not visible:
        return None

    # Identifier-matched shadowing follows the nearest WITH.
    owners = {}
    parent = node.parent
    while parent is not None:
        owners[id(parent)] = len(owners)
        parent = parent.parent
    bindings = []
    for source in visible.values():
        cte = source.expression.find_ancestor(exp.CTE)
        if cte is not None and cte.parent is not None:
            owner = cte.parent.parent
            if id(owner) in owners:
                bindings.append((owners[id(owner)], source))
    if not bindings:
        return None
    nearest = min(distance for distance, _ in bindings)
    choices = {
        id(source): source for distance, source in bindings if distance == nearest
    }
    return next(iter(choices.values())) if len(choices) == 1 else None


def consumed_scopes(scopes: list[Scope], dialect: str | None = "duckdb") -> list[Scope]:
    """Return scopes that can contribute to a query's result.

    CTE definitions are available to their parent scope without being consumed.
    Follow one only when a reachable scope references it; scalar subqueries and
    set-operation branches are themselves part of the reachable expression.
    """
    live = set()

    def visit(scope: Scope) -> None:
        if id(scope) in live:
            return
        live.add(id(scope))
        for alias, node in scope.references:
            source = (
                _visible_cte_source(scope, node, dialect)
                if isinstance(node, exp.Table)
                else scope.sources.get(alias)
            )
            if isinstance(source, Scope):
                visit(source)
        for child in [*scope.union_scopes, *scope.subquery_scopes]:
            visit(child)

    if scopes:
        visit(scopes[-1])
    return [scope for scope in scopes if id(scope) in live]


def require_source_tables(
    ast: exp.Expression, dialect: str | None = "duckdb"
) -> list[str]:
    """Return the tables a parsed query reads, refusing one that reads none.

    A query's CTE names are not sources where that CTE is visible. DuckDB compares
    quoted and unquoted names case-insensitively, whereas PostgreSQL preserves quoted
    spelling while folding unquoted names. A table function such as
    ``generate_series(1, 12)`` parses as a table with an empty name and reads
    no stored data, so it is not a source either.

    Callers check this before execution: a SELECT over literals alone returns
    numbers the caller typed, never values read from a model.
    Only consumed scopes are followed; an unused CTE supplies no grounding.
    This is a statement read-set check, not a proof that every output cell is
    model-derived; the legacy transport does not expose per-cell provenance.
    """
    scopes = consumed_scopes(traverse_scope(ast), dialect)
    tables = set()
    for scope in scopes:
        for alias, node in scope.references:
            if isinstance(node, exp.Table):
                if _visible_cte_source(scope, node, dialect) is not None:
                    continue
                if node.name:
                    tables.add(node.name)
    if not tables:
        raise NoSourceTablesError()
    return sorted(tables)
