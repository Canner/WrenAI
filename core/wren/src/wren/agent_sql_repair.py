"""Bounded syntax repair, never an alternate authorization or execution path.

Only reorder ASOF's LEFT keyword and bind one unambiguous missing table alias.
Everything returned here must still pass AdHocSQL.prepare and service policy.
Repair constraints describe the worker's own failed SQL, not business-rule proof.
"""

import re

import sqlglot
from sqlglot import exp
from sqlglot.dialects import Dialect
from sqlglot.optimizer.scope import traverse_scope
from sqlglot.tokens import TokenType


def repair_syntax(sql: str, schema: dict) -> tuple[str, list[str]]:
    codes = []
    try:
        tokens = Dialect.get_or_raise("duckdb").tokenize(sql)
    except sqlglot.errors.SqlglotError:
        return sql, codes
    edits = []
    for a, b, c in zip(tokens, tokens[1:], tokens[2:]):
        if (a.token_type, b.token_type, c.token_type) == (
            TokenType.LEFT,
            TokenType.ASOF,
            TokenType.JOIN,
        ) and re.fullmatch(r"LEFT\s+ASOF\s+JOIN", sql[a.start : c.end + 1], re.I):
            edits.append((a.start, c.end + 1))
    for start, end in reversed(edits):
        sql = sql[:start] + "ASOF LEFT JOIN" + sql[end:]
    if edits:
        codes.append("asof_keyword_order")
    try:
        statements = sqlglot.parse(sql, read="duckdb")
    except sqlglot.errors.SqlglotError:
        return sql, codes
    # Never infer across CTEs, subqueries, self joins or multiple statements.
    if len(statements) != 1 or not isinstance(statements[0], exp.Select):
        return sql, codes
    tree = statements[0]
    scopes = list(traverse_scope(tree))
    if len(scopes) != 1:
        return sql, codes
    scope = scopes[0]
    names = [t.name for t in tree.find_all(exp.Table)]
    if len(names) != len(set(names)):
        return sql, codes
    unknown = {
        c.table for c in scope.columns if c.table and c.table not in scope.sources
    }
    if len(unknown) != 1:
        return sql, codes
    alias = next(iter(unknown))
    columns = {c.name for c in scope.columns if c.table == alias}
    candidates = [
        table
        for table in scope.sources.values()
        if isinstance(table, exp.Table)
        and not table.alias
        and not table.db
        and not table.catalog
        and table.name in schema
        and columns <= set(schema[table.name])
        and not any(c.table == table.name for c in scope.columns)
    ]
    if len(candidates) == 1:
        # Retain the identifier's quoting; never interpret its text as SQL.
        identifier = next(c.args["table"] for c in scope.columns if c.table == alias)
        candidates[0].set("alias", exp.TableAlias(this=identifier.copy()))
        sql = tree.sql(dialect="duckdb")
        codes.append("missing_table_alias")
    return sql, codes


def _constraints(sql):
    try:
        tree = sqlglot.parse_one(sql, read="duckdb")
        scopes = list(traverse_scope(tree))
    except (sqlglot.errors.SqlglotError, ValueError):
        return None
    # Complex query equivalence is deliberately not inferred here.
    if not isinstance(tree, exp.Select) or len(scopes) != 1:
        return None
    scope = scopes[0]
    if any(not isinstance(t, exp.Table) for t in scope.sources.values()):
        return None

    def canonical(node):
        node = node.copy()
        for col in node.find_all(exp.Column):
            source = scope.sources.get(col.table)
            if source is not None:
                col.set("table", source.this.copy())
        return node.sql(dialect="duckdb", normalize=True)

    joins = set()
    for join in tree.args.get("joins") or []:
        if join.args.get("method") == "ASOF" and join.args.get("side") == "LEFT":
            if join.args.get("on") is None:
                return None
            joins.add((join.this.name.lower(), canonical(join.args["on"])))
    windows = set()
    where = tree.args.get("where")
    if where is not None:
        # Only plain conjunctive bounds; never mistake an OR arm for mandatory scope.
        predicates = (
            list(where.this.flatten())
            if isinstance(where.this, exp.And)
            else [where.this]
        )
        for predicate in predicates:
            if isinstance(
                predicate, (exp.GT, exp.GTE, exp.LT, exp.LTE, exp.Between)
            ) and any(
                x.is_string and re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:[ T].*)?", x.this)
                for x in predicate.find_all(exp.Literal)
            ):
                windows.add(canonical(predicate))
    return joins, windows


class RepairScope:
    """Keep temporal joins/windows across retries of a failed statement.

    Reset after a successful query: the analyst may legitimately refine its next query.
    This is not an oracle for the first statement or arbitrary SQL equivalence.
    """

    def __init__(self):
        self.pending = None

    def failed(self, sql):
        if self.pending is None:
            self.pending = _constraints(sql)

    def changed(self, sql):
        if self.pending is None or not any(self.pending):
            return False
        current = _constraints(sql)
        return (
            current is None
            or not self.pending[0] <= current[0]
            or (bool(self.pending[1]) and self.pending[1] != current[1])
        )

    def succeeded(self):
        self.pending = None


def execution_diagnostic(error):
    """Fixed private hints only; never relay driver text, data or physical paths."""
    message = str(error)
    if "must appear in the GROUP BY" in message:
        return (
            "grouping_expression",
            "Every selected expression must be grouped or aggregated. Group by the exact selected bucket expression and requested dimensions; a bucket alias may collide with a source column. Aggregate the entire numeric measure expression using the metric definition (for an additive total, SUM of the row-level expression). Do not add measure inputs to GROUP BY or use ANY_VALUE to hide the error: that changes the requested grain. Preserve the source, metric, date window and joins.",
        )
    return (
        None,
        "Check bound columns and declared table aliases. Use ASOF LEFT JOIN in that order for a row-preserving temporal lookup. Preserve the metric, conversion, date window and joins while repairing syntax. Return at most 100 rows and 20 columns; never infer data from an error.",
    )


def temporal_join_hint(sql):
    """Diagnose a missing ASOF inequality without inventing its column bindings."""
    try:
        tree = sqlglot.parse_one(sql, read="duckdb")
    except sqlglot.errors.SqlglotError:
        return None
    for join in tree.find_all(exp.Join):
        if join.args.get("method") != "ASOF":
            continue
        on = join.args.get("on")
        if on is None or not any(on.find_all(exp.GT, exp.GTE, exp.LT, exp.LTE)):
            return (
                "The ASOF join has no temporal inequality in its ON clause. Equality alone cannot select the latest prior row. "
                "For a latest-prior lookup, retain the matching key equality AND add the bound transaction timestamp >= the bound lookup timestamp in that same ON clause, using authorized column definitions. "
                "Keep LEFT to preserve unmatched base rows, retain existing filters and conversion, and do not join unrelated fact tables to repair this condition."
            )
    return None
