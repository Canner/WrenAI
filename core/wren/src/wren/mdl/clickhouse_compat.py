"""Translate dialect-neutral SQL constructs ClickHouse rejects or answers wrongly.

Queries are written in dialect-neutral SQL and the engine translates them to the
target dialect (``skills_content/usage/references/wren-sql.md``, rule 2). sqlglot's
ClickHouse generator passes a few constructs through verbatim that ClickHouse
either rejects or evaluates differently from the SQL meaning. :func:`translate` rewrites exactly those, on the AST, right before the
rewriter renders the final ClickHouse SQL.

Every rewrite targets a construct that fails on ClickHouse today, or (``LAG`` /
``LEAD``) runs but returns a different answer than the SQL means:

* ``LAG`` / ``LEAD`` -> ``lagInFrame`` / ``leadInFrame`` over the whole partition.
  As emitted, ClickHouse evaluates them over a frame ending at the current row and
  fills a missing neighbour with the type's default: ``LEAD`` returns ``0`` for
  every row and ``LAG`` returns ``0`` instead of ``NULL`` at the first. The
  explicit frame and ``toNullable`` restore the SQL meaning.
* ``CUME_DIST()`` -> ``count(*) OVER (same window) / count(*) OVER (partition)``.
  An ordered window's default frame includes peers, which is CUME_DIST's numerator.
* ``EXTRACT(DOW FROM d)`` -> ``toDayOfWeek(d) % 7`` (Sunday = 0);
  ``EXTRACT(ISODOW FROM d)`` -> ``toDayOfWeek(d)`` (Monday = 1 .. Sunday = 7).
* ``CAST(NULL AS T)`` -> ``CAST(NULL AS Nullable(T))``.
* A correlated ``EXISTS`` over one table, correlated only by equalities, becomes a
  NULL-safe ``IN``. Any other shape is left as written.
* ``SUM(c) AS c ... HAVING SUM(c) > 0``: ClickHouse resolves the alias ``c``
  inside the aggregate and fails with ILLEGAL_AGGREGATION. A bare column inside an
  aggregate that an *aggregate* output alias shadows is qualified with its table,
  which an alias never is. Shadowing by a non-aggregate alias already runs on
  ClickHouse and is left alone.
"""

from __future__ import annotations

from sqlglot import exp

_DOW_UNITS = frozenset({"DOW", "DAYOFWEEK", "ISODOW"})

# The only parts of an EXISTS subquery the IN rewrite carries over. Anything else
# (aggregates aside) changes which rows exist: HAVING, QUALIFY, OFFSET, WITH,
# ClickHouse's PREWHERE, ... A subquery using one is left as written.
_EXISTS_KEEPS = frozenset({"expressions", "from_", "where", "distinct"})


def translate(ast: exp.Expression) -> exp.Expression:
    """Rewrite *ast* in place for ClickHouse and return it."""
    _lag_lead(ast)
    _cume_dist(ast)
    _extract_dow(ast)
    _null_cast(ast)
    _correlated_exists(ast)
    _aggregate_alias_shadowing(ast)
    return ast


def _whole_partition() -> exp.WindowSpec:
    """``ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING``."""
    return exp.WindowSpec(
        kind="ROWS",
        start="UNBOUNDED",
        start_side="PRECEDING",
        end="UNBOUNDED",
        end_side="FOLLOWING",
    )


def _lag_lead(ast: exp.Expression) -> None:
    """``LAG`` / ``LEAD`` -> ``lagInFrame`` / ``leadInFrame`` over the partition."""
    for window in list(ast.find_all(exp.Window)):
        fn = window.this
        if not isinstance(fn, exp.Lag | exp.Lead):
            continue
        resolved = _named_window(window)
        if resolved is None:
            continue
        partition, order = resolved
        name = "lagInFrame" if isinstance(fn, exp.Lag) else "leadInFrame"
        args: list[exp.Expression] = [
            exp.Anonymous(this="toNullable", expressions=[fn.this.copy()])
        ]
        offset, default = fn.args.get("offset"), fn.args.get("default")
        if offset is not None or default is not None:
            args.append(offset.copy() if offset is not None else exp.Literal.number(1))
        if default is not None:
            args.append(default.copy())
        window.set("this", exp.Anonymous(this=name, expressions=args))
        # Inline a named window: the frame is replaced, so ``OVER w`` cannot stay.
        window.set("alias", None)
        window.set("partition_by", [p.copy() for p in partition])
        window.set("order", order.copy() if order is not None else None)
        window.set("spec", _whole_partition())


def _named_window(
    window: exp.Window,
) -> tuple[list[exp.Expression], exp.Order | None] | None:
    """Effective ``PARTITION BY`` and ``ORDER BY`` of *window*, or None.

    ``OVER w`` and ``OVER (w ORDER BY ...)`` keep the clauses in the owning SELECT's
    ``WINDOW w AS (...)``, which may itself extend another named window. A window
    names its base in ``alias``. None when a name does not resolve, so the caller
    leaves the query as written.
    """
    partition = list(window.args.get("partition_by") or [])
    order = window.args.get("order")
    base = window.args.get("alias")
    if base is None:
        return partition, order
    select = window.find_ancestor(exp.Select)
    definitions = {
        w.this.name: w
        for w in (select.args.get("windows") or [] if select else [])
        if isinstance(w.this, exp.Identifier)
    }
    seen: set[str] = set()
    while base is not None:
        definition = definitions.get(base.name)
        if definition is None or base.name in seen:
            return None
        seen.add(base.name)
        partition = partition or list(definition.args.get("partition_by") or [])
        order = order if order is not None else definition.args.get("order")
        base = definition.args.get("alias")
    return partition, order


def _cume_dist(ast: exp.Expression) -> None:
    """``CUME_DIST()`` -> rows up to and including peers / rows in the partition."""
    for window in list(ast.find_all(exp.Window)):
        if not isinstance(window.this, exp.CumeDist):
            continue
        resolved = _named_window(window)
        if resolved is None:
            continue
        partition, order = resolved
        upto = exp.Window(
            this=exp.Count(this=exp.Star()),
            partition_by=[p.copy() for p in partition],
            order=order.copy() if order is not None else None,
        )
        total = exp.Window(
            this=exp.Count(this=exp.Star()),
            partition_by=[p.copy() for p in partition],
        )
        window.replace(exp.Paren(this=exp.Div(this=upto, expression=total)))


def _extract_dow(ast: exp.Expression) -> None:
    """``EXTRACT(DOW | DAYOFWEEK | ISODOW FROM d)`` -> ``toDayOfWeek``."""
    for node in list(ast.find_all(exp.Extract)):
        unit = node.this.name.upper() if isinstance(node.this, exp.Var) else ""
        if unit not in _DOW_UNITS:
            continue
        day = exp.Anonymous(this="toDayOfWeek", expressions=[node.expression.copy()])
        if unit == "ISODOW":
            node.replace(day)
        else:
            seven = exp.Literal.number(7)
            node.replace(exp.Paren(this=exp.Mod(this=day, expression=seven)))


def _null_cast(ast: exp.Expression) -> None:
    """``CAST(NULL AS T)`` -> ``CAST(NULL AS Nullable(T))``."""
    for cast in list(ast.find_all(exp.Cast)):
        to = cast.args.get("to")
        if not isinstance(cast.this, exp.Null) or not isinstance(to, exp.DataType):
            continue
        # sqlglot's ClickHouse dialect carries Nullable(T) as T with nullable=True.
        if to.args.get("nullable"):
            continue
        nullable = to.copy()
        nullable.set("nullable", True)
        cast.set("to", nullable)


def _single_table(select: exp.Select) -> exp.Table | None:
    """The only table *select* reads, or None for a join or a derived table."""
    from_ = select.args.get("from_")
    if from_ is None or select.args.get("joins"):
        return None
    return from_.this if isinstance(from_.this, exp.Table) else None


def _correlation(
    cond: exp.Expression, inner: str
) -> tuple[exp.Column, exp.Column] | None:
    """``(outer, inner)`` columns of an ``inner.k = outer.k`` equality, else None."""
    if not isinstance(cond, exp.EQ):
        return None
    left, right = cond.this, cond.expression
    if not isinstance(left, exp.Column) or not isinstance(right, exp.Column):
        return None
    if left.table == inner and right.table and right.table != inner:
        return right, left
    if right.table == inner and left.table and left.table != inner:
        return left, right
    return None


def _not_null(column: exp.Column) -> exp.Expression:
    """``NOT column IS NULL``."""
    return exp.Not(this=exp.Is(this=column.copy(), expression=exp.Null()))


def _row_preserving(sub: exp.Select) -> bool:
    """Whether *sub* has a row for exactly the rows its WHERE keeps.

    An aggregate without GROUP BY always yields one row, so ``EXISTS (SELECT
    COUNT(*) ...)`` is always true; any clause outside ``_EXISTS_KEEPS`` would be
    dropped by the rewrite.
    """
    if any(value for key, value in sub.args.items() if key not in _EXISTS_KEEPS):
        return False
    return not any(e.find(exp.AggFunc) for e in sub.expressions)


def _correlated_exists(ast: exp.Expression) -> None:
    """A correlated ``EXISTS`` -> a NULL-safe ``IN``, for the shapes it can prove."""
    for node in list(ast.find_all(exp.Exists)):
        sub = node.this
        if not isinstance(sub, exp.Select) or not _row_preserving(sub):
            continue
        table = _single_table(sub)
        where = sub.args.get("where")
        if table is None or where is None:
            continue
        inner = table.alias_or_name
        conds = (
            list(where.this.flatten())
            if isinstance(where.this, exp.And)
            else [where.this]
        )
        keys: list[tuple[exp.Column, exp.Column]] = []
        local: list[exp.Expression] = []
        understood = True
        for cond in conds:
            pair = _correlation(cond, inner)
            if pair is not None:
                keys.append(pair)
            elif all(c.table == inner for c in cond.find_all(exp.Column)):
                local.append(cond)
            else:
                understood = False
                break
        if not understood or not keys:
            continue
        outer = [o for o, _ in keys]
        inner_cols = [i.copy() for _, i in keys]
        filters = [c.copy() for c in local] + [_not_null(c) for c in inner_cols]
        subquery = exp.select(*inner_cols).from_(table.copy()).where(exp.and_(*filters))
        lhs: exp.Expression = (
            outer[0].copy()
            if len(outer) == 1
            else exp.Tuple(expressions=[o.copy() for o in outer])
        )
        present = exp.and_(
            *[_not_null(o) for o in outer],
            exp.In(this=lhs, query=exp.Subquery(this=subquery)),
        )
        # ``NOT EXISTS`` is the parent's NOT around this node, so it becomes
        # NOT (keys IS NOT NULL AND keys IN (...)): a NULL key stays unmatched.
        node.replace(exp.Paren(this=present))


def _aggregate_alias_shadowing(ast: exp.Expression) -> None:
    """Qualify a column inside an aggregate that an aggregate output alias shadows."""
    for select in list(ast.find_all(exp.Select)):
        table = _single_table(select)
        if table is None:
            continue
        aliases = {
            e.alias
            for e in select.expressions
            if isinstance(e, exp.Alias) and e.this.find(exp.AggFunc) is not None
        }
        if not aliases:
            continue
        qualifier = exp.to_identifier(table.alias_or_name)
        for agg in list(select.find_all(exp.AggFunc)):
            if agg.find_ancestor(exp.Select) is not select:
                continue
            for column in agg.find_all(exp.Column):
                if not column.table and column.name in aliases:
                    column.set("table", qualifier.copy())
