"""Apply declared default rules to one parsed query: pure, no I/O, no prose.

The check reads only SQL facts of a statement qualified against the manifest:
which models it reads, where each column reference originates (through CTEs,
derived tables and correlated subqueries), its conjunctive filter and join
atoms, and whether it aggregates. It never reads the question, rule prose,
aliases, comments or column names as strings.

A statement that cannot be parsed against the manifest earns **no verdict**
(``None``): the engine runs it and reports its own error class.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from sqlglot import exp, parse_one
from sqlglot.optimizer.normalize_identifiers import normalize_identifiers
from sqlglot.optimizer.qualify import qualify
from sqlglot.optimizer.scope import Scope, traverse_scope

from wren.declared_defaults import (
    Declaration,
    ExcludeRows,
    RequireRateJoin,
    SaleStatuses,
    models_of,
)

Pair = tuple[str, str]


@dataclass(frozen=True)
class _Origin:
    """Where a column reference comes from.

    ``direct`` is set only when the reference is a pure pass-through of one base
    column; ``taint`` holds every base column that contributes to its value.
    """

    direct: Pair | None
    taint: frozenset[Pair]


_UNKNOWN = _Origin(None, frozenset())


def _unparen(node: exp.Expression) -> exp.Expression:
    while isinstance(node, exp.Paren):
        node = node.this
    return node


_DATE_TYPES = exp.DataType.TEMPORAL_TYPES - {
    exp.DataType.Type.TIME,
    exp.DataType.Type.TIMETZ,
}


def _uncast_temporal(node: exp.Expression) -> exp.Expression:
    """``node`` without a ``CAST`` / ``::`` to a date or timestamp type, if it has one."""
    node = _unparen(node)
    while isinstance(node, exp.Cast) and node.to.this in _DATE_TYPES:
        node = _unparen(node.this)
    return node


def _conjuncts(node: exp.Expression) -> Iterable[exp.Expression]:
    node = _unparen(node)
    if isinstance(node, exp.And):
        yield from _conjuncts(node.left)
        yield from _conjuncts(node.right)
    else:
        yield node


def _disjuncts(node: exp.Expression) -> Iterable[exp.Expression]:
    node = _unparen(node)
    if isinstance(node, exp.Or):
        yield from _disjuncts(node.left)
        yield from _disjuncts(node.right)
    else:
        yield node


def _boolean(node: exp.Expression) -> bool | None:
    node = _unparen(node)
    return node.this if isinstance(node, exp.Boolean) else None


def _outer(join: exp.Join) -> bool:
    """Whether ``join`` keeps rows its ON clause does not match (any outer, semi or anti join)."""
    return bool(join.side) or (join.kind or "").upper() in {"SEMI", "ANTI"}


def _restricts(join: exp.Join, conjunct: exp.Expression) -> bool:
    """Whether ``conjunct`` of ``join``'s ON clause removes rows from the statement's result.

    An outer join keeps every row of its preserved side whatever the ON clause says, so an ON
    conjunct narrows only the nullable side's own rows. ``FULL`` keeps both sides, and a semi or
    anti join, bare or sided, does not return the right side at all, so none of their ON
    conjuncts is a filter. A joined side with no name (a parenthesised join group) cannot be told
    from the preserved side, so its conjuncts do not count either.
    """
    side = (join.side or "").upper()
    if side == "FULL" or (join.kind or "").upper() in {"SEMI", "ANTI"}:
        return False
    if not side:
        return True
    tables = {column.table for column in conjunct.find_all(exp.Column)}
    own = join.alias_or_name
    if not own or not tables or "" in tables:
        return False
    return tables == {own} if side == "LEFT" else own not in tables


class _Statement:
    """One qualified statement and the facts rules ask about it."""

    def __init__(self, ast: exp.Expression, checker: DefaultsChecker) -> None:
        self.ast = ast
        self.checker = checker
        scopes = traverse_scope(ast)
        self._live_scopes = set()

        def visit(scope):
            marker = id(scope.expression)
            if marker in self._live_scopes:
                return
            self._live_scopes.add(marker)
            for _alias, child in self._read_sources(scope):
                visit(child)
            for child in [*scope.union_scopes, *scope.subquery_scopes]:
                visit(child)

        if scopes:
            visit(scopes[-1])
        self.scopes = [
            scope for scope in scopes if id(scope.expression) in self._live_scopes
        ]
        self._scope_of = {id(scope.expression): scope for scope in scopes}
        self._origins: dict[int, _Origin] = {}

        def live(node):
            scope = self._scope_for(node)
            return scope is not None and id(scope.expression) in self._live_scopes

        filters: list[exp.Expression] = [
            w.this for w in ast.find_all(exp.Where) if live(w)
        ]
        joins = [
            (join, on)
            for join in ast.find_all(exp.Join)
            if live(join)
            if (on := join.args.get("on")) is not None
        ]
        filters += [h.this for h in ast.find_all(exp.Having) if live(h)]
        filters += [q.this for q in ast.find_all(exp.Qualify) if live(q)]
        self.roots = [*filters, *(on for _, on in joins)]
        self.conjuncts = [c for root in filters for c in _conjuncts(root)]
        # What reaches the fact rows: WHERE and the ON of an inner or comma join. A nullable-side
        # ON conjunct of an outer join narrows that side only, so an exclusion cannot rest on it.
        reaching = [(c, root) for root in filters for c in _conjuncts(root)]
        for join, on in joins:
            kept = [c for c in _conjuncts(on) if _restricts(join, c)]
            self.conjuncts += kept
            if not _outer(join):
                reaching += [(c, on) for c in kept]
        # Each filter is kept with the scope it sits in: whether it restricts a given read of a
        # covered model depends on how that read reaches the result (``_restricting``).
        self._filters = [
            (conjunct, id(scope.expression))
            for conjunct, root in reaching
            if (scope := self._scope_for(root)) is not None
        ]
        self._parents: dict[int, list[Scope]] = {}
        for scope in self.scopes:
            for _, source in self._read_sources(scope):
                self._parents.setdefault(id(source.expression), []).append(scope)
            for branch in scope.union_scopes:
                self._parents.setdefault(id(branch.expression), []).append(scope)
        # A table is read when some scope's source is that stored table. A CTE
        # that shadows a model name is a Scope source, while the table inside the
        # CTE body is still a Table source, so shadowing cannot hide a read.
        self.tables_read = {
            source.name
            for scope in scopes
            if id(scope.expression) in self._live_scopes
            for source in scope.sources.values()
            if isinstance(source, exp.Table) and source.name
        }
        self.aggregates = [node for node in ast.find_all(exp.AggFunc) if live(node)]
        self.groups = [node for node in ast.find_all(exp.Group) if live(node)]
        self.aggregated = bool(self.aggregates or self.groups)

    @staticmethod
    def _read_sources(scope: Scope) -> list[tuple[str, Scope]]:
        """The CTEs and derived tables ``scope`` reads from (not the CTEs merely in scope)."""
        read = {alias for alias, _ in scope.references}
        return [
            (alias, source)
            for alias, source in scope.sources.items()
            if isinstance(source, Scope) and alias in read
        ]

    def _restricting(self, read: Scope, path, flag: Pair) -> set[int]:
        """The scopes (by expression id) whose row filters restrict the rows ``read`` yields.

        The read's own scope and every scope that consumes it (a CTE or derived table is read
        by its consumer, a set-operation branch by the set operation), and for each of those the
        CTEs and derived tables it reads from, and a subquery that is a top-level conjunct as a
        positive ``IN`` or as an ``EXISTS`` correlated with the scope's rows. A scalar subquery,
        an uncorrelated ``EXISTS``, anything under ``NOT`` or ``OR`` and a sibling set-operation
        branch filter none of those rows.
        """
        consumers = {id(scope.expression): scope for scope, _alias, _source in path}
        restricting: set[int] = set()

        def visit(scope: Scope) -> None:
            if id(scope.expression) in restricting:
                return
            restricting.add(id(scope.expression))
            nullable = {
                join.this.alias_or_name
                for join in scope.expression.args.get("joins") or []
                if _outer(join)
            }
            for name, source in self._read_sources(scope):
                if name not in nullable:
                    visit(source)
            top = {id(c) for c in self._top_conjuncts(scope)}
            for sub in scope.subquery_scopes:
                node = sub.expression.parent
                while isinstance(node, (exp.Subquery, exp.Paren)):
                    node = node.parent
                if id(node) in top and (
                    (isinstance(node, exp.In) and self._keyed_to_flag(node, flag))
                    or (isinstance(node, exp.Exists) and self._exists_keyed(node, flag))
                ):
                    visit(sub)

        for scope in consumers.values():
            visit(scope)
        return restricting

    @staticmethod
    def _top_conjuncts(scope: Scope) -> list[exp.Expression]:
        select = scope.expression
        roots = [
            clause.this
            for key in ("where", "having", "qualify")
            if (clause := select.args.get(key)) is not None
        ]
        roots += [
            on
            for join in select.args.get("joins") or []
            if (on := join.args.get("on")) is not None
        ]
        return [c for root in roots for c in _conjuncts(root)]

    # -- column origins -------------------------------------------------

    def _scope_for(self, node: exp.Expression) -> Scope | None:
        current: exp.Expression | None = node
        while current is not None:
            scope = self._scope_of.get(id(current))
            if scope is not None:
                return scope
            current = current.parent
        return None

    def origin(self, column: exp.Column) -> _Origin:
        cached = self._origins.get(id(column))
        if cached is None:
            cached = self._origin(column, frozenset())
            self._origins[id(column)] = cached
        return cached

    def _origin(self, column: exp.Column, visiting: frozenset) -> _Origin:
        scope = self._scope_for(column)
        if scope is None or not column.table:
            return _UNKNOWN
        source = None
        while scope is not None:
            if column.table in scope.sources:
                source = scope.sources[column.table]
                break
            scope = scope.parent
        if isinstance(source, exp.Table):
            pair = (source.name, column.name)
            return _Origin(pair, frozenset({pair}))
        if isinstance(source, Scope):
            return self._through(source, column.name, visiting)
        return _UNKNOWN

    def _through(self, scope: Scope, name: str, visiting: frozenset) -> _Origin:
        key = (id(scope.expression), name)
        if key in visiting:
            return _UNKNOWN
        visiting = visiting | {key}
        names = list(scope.expression.named_selects)
        if name not in names:
            return _UNKNOWN
        found = self._nth(scope, names.index(name))
        if not found:
            return _UNKNOWN
        results: list[_Origin] = []
        for projection, owner in found:
            inner = _unparen(projection.unalias())
            if isinstance(inner, exp.Column):
                results.append(self._origin(inner, visiting))
            else:
                taint: frozenset[Pair] = frozenset()
                for column in inner.find_all(exp.Column):
                    taint |= self._origin(column, visiting).taint
                results.append(_Origin(None, taint))
        directs = {result.direct for result in results}
        direct = directs.pop() if len(directs) == 1 else None
        return _Origin(direct, frozenset().union(*(r.taint for r in results)))

    def _nth(self, scope: Scope, index: int) -> list[tuple[exp.Expression, Scope]]:
        if isinstance(scope.expression, exp.SetOperation):
            found: list[tuple[exp.Expression, Scope]] = []
            for branch in scope.union_scopes:
                found += self._nth(branch, index)
            return found
        selects = scope.expression.selects
        return [(selects[index], scope)] if index < len(selects) else []

    def direct(self, node: exp.Expression) -> Pair | None:
        node = _unparen(node)
        return self.origin(node).direct if isinstance(node, exp.Column) else None

    def taint(self, node: exp.Expression) -> frozenset[Pair]:
        taint: frozenset[Pair] = frozenset()
        for column in node.find_all(exp.Column):
            taint |= self.origin(column).taint
        return taint

    def canonical(self, node: exp.Expression) -> str | None:
        """SQL of ``node`` with every column rewritten to ``model.column`` origin."""
        wrapper = exp.Paren(this=node.copy())
        originals = list(node.find_all(exp.Column))
        for original, clone in zip(originals, list(wrapper.find_all(exp.Column))):
            direct = self.origin(original).direct
            if direct is None:
                return None
            clone.replace(exp.column(direct[1], table=direct[0]))
        for identifier in wrapper.find_all(exp.Identifier):
            identifier.set("quoted", False)
        return wrapper.this.sql()

    # -- exclude_rows ---------------------------------------------------

    def _is_flag(self, node: exp.Expression, flag: Pair) -> bool:
        node = _unparen(node)
        if isinstance(node, exp.Coalesce) and isinstance(
            node.this, (exp.Column, exp.Paren)
        ):
            node = _unparen(node.this)
        return isinstance(node, exp.Column) and self.origin(node).direct == flag

    def _flag_literal(self, node: exp.Expression, flag: Pair) -> bool | None:
        left, right = node.this, node.expression
        for side, other in ((left, right), (right, left)):
            literal = _boolean(other)
            if literal is not None and self._is_flag(side, flag):
                return literal
        return None

    def polarity(self, node: exp.Expression, rule: ExcludeRows) -> str | None:
        """``excl`` when ``node`` removes rows where the flag equals the excluded value.

        ``incl`` when it keeps only those rows; ``None`` when it is neither.
        """
        flag = self.checker.flag_of(rule)
        excluded = rule.exclude
        node = _unparen(node)
        if self._is_flag(node, flag):
            return "incl" if excluded else "excl"
        if isinstance(node, exp.Not):
            return self._negated(_unparen(node.this), rule, flag)
        if isinstance(node, exp.Or):
            found = False
            for part in _disjuncts(node):
                if self.polarity(part, rule) == "excl":
                    found = True
                elif not self._null_check_on_flag_model(part, flag):
                    return None
            return "excl" if found else None
        if isinstance(node, (exp.EQ, exp.NEQ, exp.Is, exp.NullSafeEQ, exp.NullSafeNEQ)):
            value = self._flag_literal(node, flag)
            if value is None:
                return None
            same = value == excluded
            if isinstance(node, (exp.EQ, exp.Is, exp.NullSafeEQ)):
                return "incl" if same else "excl"
            if isinstance(node, exp.NEQ):
                return "excl" if same else "incl"
            return "excl" if same else None
        return None

    def _null_check_on_flag_model(self, node: exp.Expression, flag: Pair) -> bool:
        """A NULL flag or a missing row identified by its declared entity key.

        A LEFT JOIN that keeps rows without a flag row tests the join key, not the
        flag itself.
        """
        if not (isinstance(node, exp.Is) and isinstance(node.expression, exp.Null)):
            return False
        column = self.direct(node.this)
        return column == flag or (
            column is not None
            and column[0] == flag[0]
            and column in self.checker.entity_keys
        )

    def _negated(
        self, inner: exp.Expression, rule: ExcludeRows, flag: Pair
    ) -> str | None:
        excluded = rule.exclude
        if self._is_flag(inner, flag):
            return "excl" if excluded else "incl"
        if isinstance(inner, exp.Exists):
            return (
                "excl"
                if self._exists_keyed(inner, flag) and self._selects_flag(inner, rule)
                else None
            )
        if isinstance(inner, exp.In):
            keyed = self._keyed_to_flag(inner, flag)
            return "excl" if keyed and self._selects_flag(inner, rule) else None
        if isinstance(
            inner, (exp.EQ, exp.NEQ, exp.Is, exp.NullSafeEQ, exp.NullSafeNEQ)
        ):
            value = self._flag_literal(inner, flag)
            if value is None:
                return None
            same = value == excluded
            if isinstance(inner, exp.EQ):
                return "excl" if same else "incl"
            if isinstance(inner, exp.NEQ):
                return "incl" if same else "excl"
            if isinstance(inner, (exp.Is, exp.NullSafeEQ)):
                return "excl" if same else None
            return "incl" if same else "excl"
        return None

    def _keyed_to_flag(self, node: exp.In, flag: Pair) -> bool:
        """Whether ``<column> IN (SELECT <key> FROM <flagged model> ...)`` compares the outer
        column with the flagged model's own key: the same column, or the two sides of one of
        the project's single-column relationships. Any other outer expression says nothing
        about which flagged rows its own rows belong to."""
        query = node.args.get("query")
        selects = getattr(query, "selects", None) or []
        outer = self.direct(node.this)
        chosen = self.direct(selects[0].unalias()) if len(selects) == 1 else None
        if outer is None or chosen is None or chosen[0] != flag[0]:
            return False
        return (outer == chosen and chosen in self.checker.entity_keys) or frozenset(
            (outer, chosen)
        ) in self.checker.joins

    def _selects_flag(self, subquery: exp.Expression, rule: ExcludeRows) -> bool:
        for where in subquery.find_all(exp.Where):
            if any(self.polarity(c, rule) == "incl" for c in _conjuncts(where.this)):
                return True
        return False

    def _addresses(self, rule: ExcludeRows, reaching: list[exp.Expression]) -> bool:
        flag = self.checker.flag_of(rule)
        if any(self.polarity(c, rule) == "incl" for c in reaching):
            return True
        grouped = [
            column for group in self.groups for column in group.find_all(exp.Column)
        ]
        aggregated = [
            column
            for aggregate in self.aggregates
            for column in aggregate.find_all(exp.Column)
        ]
        return any(flag in self.origin(column).taint for column in grouped + aggregated)

    def _column_routes(
        self,
        column,
        visiting=frozenset(),
        *,
        expressions=False,
        expression_columns=None,
    ):
        """Exact table instances and consuming aliases (pass-through by default)."""
        scope = self._scope_for(column)
        while scope is not None and column.table not in scope.sources:
            scope = scope.parent
        if scope is None:
            return []
        source = scope.sources.get(column.table)
        edge = (scope, column.table, source)
        if isinstance(source, exp.Table):
            return [(id(source), [edge])]
        if not isinstance(source, Scope):
            return []
        key = (id(source.expression), column.name)
        if key in visiting or column.name not in source.expression.named_selects:
            return []
        found = self._nth(
            source, list(source.expression.named_selects).index(column.name)
        )
        routes = []
        for projection, _owner in found:
            inner = _unparen(projection.unalias())
            if isinstance(inner, exp.Column):
                columns = [inner]
            elif expressions:
                columns = (
                    expression_columns(inner)
                    if expression_columns is not None
                    else list(inner.find_all(exp.Column))
                )
            else:
                columns = []
            for child in columns:
                routes += [
                    (table, [edge, *route])
                    for table, route in self._column_routes(
                        child,
                        visiting | {key},
                        expressions=expressions,
                        expression_columns=expression_columns,
                    )
                ]
        return routes

    def _read_paths(self, scope, alias, source, visiting=frozenset()):
        edge = (scope, alias, source)
        if (
            id(scope.expression) in visiting
            or id(scope.expression) not in self._live_scopes
        ):
            return []
        parents = []
        for parent in self.scopes:
            for name, child in self._read_sources(parent):
                if child is scope:
                    parents.append((parent, name, child))
            if scope in parent.union_scopes:
                parents.append((parent, None, scope))
        if not parents:
            return [[edge]]
        return [
            [edge, *path]
            for parent, name, child in parents
            for path in self._read_paths(
                parent, name, child, visiting | {id(scope.expression)}
            )
        ]

    @staticmethod
    def _route_fits(route, path):
        for owner, alias, source in route:
            for read_owner, read_alias, read_source in path:
                if owner is not read_owner or read_alias is None:
                    continue
                if (
                    isinstance(source, Scope)
                    and source is read_source
                    and alias != read_alias
                ):
                    return False
        return True

    def _entity_key(self, left, right):
        one, two = self.direct(left), self.direct(right)
        if one is None or two is None:
            return False
        return frozenset((one, two)) in self.checker.joins or (
            one == two and one in self.checker.entity_keys
        )

    def _exists_keyed(self, node, flag):
        query = _unparen(node.this)
        if isinstance(query, exp.Subquery):
            query = query.this
        if not isinstance(query, exp.Select):
            return False
        scope = self._scope_for(query)
        where = query.args.get("where")
        if scope is None or where is None:
            return False
        for term in _conjuncts(where.this):
            if not isinstance(term, exp.EQ):
                continue
            for inside, outside in (
                (term.this, term.expression),
                (term.expression, term.this),
            ):
                if not isinstance(inside, exp.Column) or not isinstance(
                    outside, exp.Column
                ):
                    continue
                if (
                    inside.table in scope.sources
                    and self.direct(inside) is not None
                    and self.direct(inside)[0] == flag[0]
                    and outside.table not in scope.sources
                    and self._entity_key(inside, outside)
                ):
                    return True
        return False

    def _exclusion_graph(self, reaching, path):
        graph = {}

        def connect(left, right):
            if not self._entity_key(left, right):
                return
            one = [
                table
                for table, route in self._column_routes(left)
                if self._route_fits(route, path)
            ]
            two = [
                table
                for table, route in self._column_routes(right)
                if self._route_fits(route, path)
            ]
            for a in one:
                for b in two:
                    graph.setdefault(a, set()).add(b)
                    graph.setdefault(b, set()).add(a)

        for term in reaching:
            if isinstance(term, exp.EQ):
                connect(term.this, term.expression)
            elif isinstance(term, exp.In) and term.args.get("query") is not None:
                chosen = term.args["query"].selects
                if len(chosen) == 1:
                    connect(term.this, chosen[0].unalias())
            elif isinstance(term, exp.Not) and isinstance(_unparen(term.this), exp.In):
                inner = _unparen(term.this)
                chosen = getattr(inner.args.get("query"), "selects", [])
                if len(chosen) == 1:
                    connect(inner.this, chosen[0].unalias())
            elif isinstance(term, exp.Not) and isinstance(
                _unparen(term.this), exp.Exists
            ):
                for where in term.find_all(exp.Where):
                    for atom in _conjuncts(where.this):
                        if isinstance(atom, exp.EQ):
                            connect(atom.this, atom.expression)
        return graph

    def fires_exclude(self, rule: ExcludeRows) -> bool:
        if rule.aggregated_only and not self.aggregated:
            return False
        covered = self.checker.covered_of(rule)
        return any(
            not self._excluded(scope, alias, source, path, rule)
            for scope in self.scopes
            for alias, source in scope.sources.items()
            if isinstance(source, exp.Table) and source.name in covered
            for path in self._read_paths(scope, alias, source)
        )

    def _excluded(self, read, alias, source, path, rule):
        flag = self.checker.flag_of(rule)
        restricting = self._restricting(read, path, flag)
        reaching = [c for c, scope_id in self._filters if scope_id in restricting]
        keys = [
            atom
            for scope in self.scopes
            if id(scope.expression) in restricting
            for join in scope.expression.args.get("joins") or []
            if _outer(join)
            if join.args.get("on") is not None
            for atom in _conjuncts(join.args["on"])
        ]
        graph = self._exclusion_graph([*reaching, *keys], path)
        connected, pending = set(), [id(source)]
        while pending:
            current = pending.pop()
            if current not in connected:
                connected.add(current)
                pending += list(graph.get(current, ()))

        def credits(node):
            columns = list(node.find_all(exp.Column))
            flagged = [
                column
                for column in columns
                if (pair := self.direct(column)) is not None and pair[0] == flag[0]
            ]
            relevant = flagged if self.polarity(node, rule) is not None else columns
            routes = [
                (table, route)
                for column in relevant
                for table, route in self._column_routes(column)
            ]
            return bool(routes) and all(
                table in connected and self._route_fits(route, path)
                for table, route in routes
            )

        applicable = [term for term in reaching if credits(term)]
        if rule.addresses_column and self._addresses(rule, applicable):
            # Aggregate/group exceptions must address this consuming read too.
            if any(self.polarity(c, rule) == "incl" for c in applicable) or any(
                credits(c) and flag in self.origin(c).taint
                for container in [*self.groups, *self.aggregates]
                for c in container.find_all(exp.Column)
            ):
                return True
        for atom in self.checker.atoms_of(rule):
            if any(self.canonical(c) == atom for c in applicable):
                return True
        return any(self.polarity(c, rule) == "excl" for c in applicable)

    # -- require_rate_join ----------------------------------------------

    def _condition_nodes(self, kind: type[exp.Expression]) -> list[exp.Expression]:
        return [node for root in self.roots for node in root.find_all(kind)]

    def fires_rate(self, rule: RequireRateJoin) -> bool:
        if rule.aggregated_only and not self.aggregated:
            return False
        return any(self._fires_rate_group(rule, group) for group in rule.amounts)

    def _fires_rate_group(self, rule, amount_group):
        norm = self.checker.norm_pair
        amounts = {norm(ref) for ref in amount_group.columns}
        currencies = {norm(amount_group.currency)}
        dates = {norm(ref) for ref in amount_group.dates}
        rate_currency, rate_date = norm(rule.rate_currency), norm(rule.rate_date)
        if not any(self.taint(aggregate) & amounts for aggregate in self.aggregates):
            return False
        if rule.groups_by_currency and self._groups_by_currency(currencies, amounts):
            return False
        if rule.filters_currency_literal and self._filters_currency_literal(
            currencies, amounts
        ):
            return False
        reads = [
            (id(source), path)
            for scope in self.scopes
            for alias, source in scope.sources.items()
            if isinstance(source, exp.Table)
            and source.name == self.checker.norm(rule.rate_model)
            for path in self._read_paths(scope, alias, source)
        ]

        def matching(column, *, expressions=False, expression_columns=None):
            return {
                index
                for table, route in self._column_routes(
                    column,
                    expressions=expressions,
                    expression_columns=expression_columns,
                )
                for index, (read, path) in enumerate(reads)
                if table == read and self._route_fits(route, path)
            }

        currency_joined, date_bounded = set(), set()
        for node in self._condition_nodes(exp.EQ):
            for side, other in (
                (node.this, node.expression),
                (node.expression, node.this),
            ):
                if (
                    self.direct(side) == rate_currency
                    and self.taint(other) & currencies
                ):
                    currency_joined |= matching(side)
        bounds = (
            [(node.this, node.expression) for node in self._condition_nodes(exp.LTE)]
            + [(node.expression, node.this) for node in self._condition_nodes(exp.GTE)]
            + [
                (node.this, node.args["high"])
                for node in self._condition_nodes(exp.Between)
                if node.args.get("high") is not None
            ]
        )
        for side, other in bounds:
            column = _uncast_temporal(side)
            if self.direct(column) == rate_date and self.taint(other) & dates:
                date_bounded |= matching(column)
        # An equality to a bounded scalar MAX(date) carries that upper bound
        # to the compared rate instance. Both instances still need their own
        # currency join; a free-standing bounded alias is not such a proof.
        for node in self._condition_nodes(exp.EQ):
            for side, other in (
                (node.this, node.expression),
                (node.expression, node.this),
            ):
                column = _uncast_temporal(side)
                if self.direct(column) != rate_date or not isinstance(
                    other, exp.Subquery
                ):
                    continue
                query = other.this
                if not isinstance(query, exp.Select) or len(query.selects) != 1:
                    continue
                value = _unparen(query.selects[0].unalias())
                if isinstance(value, exp.Max) and self.direct(value.this) == rate_date:
                    origins = matching(value.this)
                    if origins and origins <= currency_joined & date_bounded:
                        date_bounded |= matching(column)
        complete = currency_joined & date_bounded
        # When an aggregate actually consumes a rate value, every supplying
        # instance must carry both conditions; an unrelated complete join cannot
        # donate its proof to that value. No rate-valued expression is required.
        rate_values = {
            (self.checker.norm(rule.rate_model), self.checker.norm(column))
            for column in self.checker.schema.get(rule.rate_model, ())
        } - {rate_currency, rate_date}
        all_amounts = {norm(ref) for group in rule.amounts for ref in group.columns}

        def value_columns(node):
            taint = self.taint(node)
            if not taint & rate_values or (taint & all_amounts and not taint & amounts):
                return []
            if isinstance(node, exp.Column):
                return [node]
            # A sum may combine independently converted amount groups. Follow
            # this group's terms and rate-only siblings, including inside CTEs.
            return [
                column
                for child in node.iter_expressions()
                for column in value_columns(child)
            ]

        supplied = set()
        for aggregate in self.aggregates:
            if self.taint(aggregate) & amounts:
                for column in value_columns(aggregate):
                    supplied |= matching(
                        column, expressions=True, expression_columns=value_columns
                    )
        return not complete or not supplied <= complete

    def _amount_reads(self, amounts, expression=None):
        """Physical amount reads, including the exact CTE consumer of an aggregate."""
        reads = []
        for aggregate in self.aggregates if expression is None else [expression]:
            for column in aggregate.find_all(exp.Column):
                if not self.origin(column).taint & amounts:
                    continue
                for table, route in self._column_routes(
                    column,
                    expressions=True,
                    expression_columns=lambda node: [
                        c
                        for c in node.find_all(exp.Column)
                        if self.origin(c).taint & amounts
                    ],
                ):
                    scope, alias, source = route[-1]
                    for path in self._read_paths(scope, alias, source):
                        if all(
                            any(
                                owner is p and alias == a and source is s
                                for p, a, s in path
                            )
                            for owner, alias, source in route
                        ):
                            reads.append((table, path))
        return reads

    def _currency_reaches(self, column, table, path, terms):
        """A currency belongs to this amount row, directly or by a declared entity key."""
        graph = self._exclusion_graph(terms, path)
        connected, pending = set(), [table]
        while pending:
            current = pending.pop()
            if current not in connected:
                connected.add(current)
                pending.extend(graph.get(current, ()))
        routes = self._column_routes(column)
        return bool(routes) and all(
            source in connected and self._route_fits(route, path)
            for source, route in routes
        )

    def _filters_currency_literal(
        self, currencies: set[Pair], amounts: set[Pair]
    ) -> bool:
        literals = []
        for conjunct in self.conjuncts:
            if isinstance(conjunct, exp.EQ):
                for side, other in (
                    (conjunct.this, conjunct.expression),
                    (conjunct.expression, conjunct.this),
                ):
                    if self.direct(side) in currencies and _is_string(other):
                        literals.append((conjunct, side))
            elif isinstance(conjunct, exp.In) and conjunct.args.get("expressions"):
                if self.direct(conjunct.this) in currencies and all(
                    _is_string(value) for value in conjunct.expressions
                ):
                    literals.append((conjunct, conjunct.this))
        reads = self._amount_reads(amounts)
        for table, path in reads:
            restricting = self._restricting(path[0][0], path, next(iter(currencies)))
            terms = [term for term, scope in self._filters if scope in restricting]
            if not any(
                id(self._scope_for(term).expression) in restricting
                and any(term is candidate for candidate in terms)
                and self._currency_reaches(column, table, path, terms)
                for term, column in literals
            ):
                return False
        return bool(reads)

    def _groups_by_currency(self, currencies: set[Pair], amounts: set[Pair]) -> bool:
        reads = self._amount_reads(amounts)
        for table, path in reads:
            owners = {id(scope.expression) for scope, _, _ in path}
            terms = [
                term
                for scope in self.scopes
                if id(scope.expression) in owners
                for term in self._top_conjuncts(scope)
            ]
            if not any(
                id(self._scope_for(group).expression) in owners
                and self.direct(column) in currencies
                and self._currency_reaches(column, table, path, terms)
                for group in self.groups
                for column in group.find_all(exp.Column)
            ):
                return False
        return bool(reads)


def _is_string(node: exp.Expression) -> bool:
    node = _unparen(node)
    return isinstance(node, exp.Literal) and node.is_string


class DefaultsChecker:
    """Declared rules bound to one manifest and SQL dialect."""

    def __init__(
        self,
        declarations: Iterable[Declaration],
        manifest: dict,
        dialect: str | None,
        guarantees: dict[str, Iterable[str]] | None = None,
    ) -> None:
        self.rules = tuple(declarations)
        self.dialect = dialect
        # Rule ids each view's definition guarantees, by view name (see ``wren_view`` marks).
        self.guarantees = {
            name: frozenset(ids) for name, ids in (guarantees or {}).items()
        }
        self.schema = {
            model: {column: "TEXT" for column in columns}
            for model, columns in models_of(manifest).items()
        }
        self._atoms = {
            rule.id: tuple(self._atom(text) for text in rule.filtered_by)
            for rule in self.rules
            if isinstance(rule, ExcludeRows)
        }
        self.joins = self._join_pairs(manifest.get("relationships"))
        self.entity_keys = set()
        for model in manifest.get("models") or []:
            key = model.get("primaryKey", model.get("primary_key"))
            keys = [key] if isinstance(key, str) else key or []
            if len(keys) == 1:
                self.entity_keys.add((self.norm(model["name"]), self.norm(keys[0])))

    def _join_pairs(self, relationships) -> frozenset[frozenset[Pair]]:
        """The column pairs the manifest's relationships equate, one pair per relationship
        whose condition is a single ``model.column = model.column`` equality."""
        pairs: set[frozenset[Pair]] = set()
        for item in relationships or []:
            condition = item.get("condition") if isinstance(item, dict) else None
            if not isinstance(condition, str):
                continue
            try:
                node = _unparen(parse_one(condition, dialect=self.dialect))
            except Exception:  # noqa: BLE001 - an unreadable condition links nothing
                continue
            sides = (node.this, node.expression) if isinstance(node, exp.EQ) else ()
            columns = [side for side in sides if isinstance(side, exp.Column)]
            if len(columns) == 2 and all(c.table for c in columns):
                pairs.add(
                    frozenset((self.norm(c.table), self.norm(c.name)) for c in columns)
                )
        return frozenset(pairs)

    @property
    def ids(self) -> list[str]:
        return [rule.id for rule in self.rules]

    def norm(self, name: str) -> str:
        return normalize_identifiers(exp.to_identifier(name), self.dialect).name

    def norm_pair(self, ref) -> Pair:
        return (self.norm(ref.model), self.norm(ref.column))

    def flag_of(self, rule: ExcludeRows) -> Pair:
        return self.norm_pair(rule.column)

    def covered_of(self, rule: ExcludeRows) -> set[str]:
        return {self.norm(model) for model in rule.covered}

    def atoms_of(self, rule: ExcludeRows) -> tuple[str, ...]:
        return self._atoms[rule.id]

    def relevant_models(self, rule: Declaration) -> set[str]:
        """The models whose reads make ``rule`` apply to a statement."""
        if isinstance(rule, ExcludeRows):
            return self.covered_of(rule)
        if isinstance(rule, SaleStatuses):
            return {self.norm(rule.column.model)}
        return {self.norm(ref.model) for group in rule.amounts for ref in group.columns}

    def _atom(self, text: str) -> str:
        node = parse_one(text, dialect=self.dialect)
        wrapper = exp.Paren(this=node)
        for column in list(wrapper.find_all(exp.Column)):
            column.replace(
                exp.column(self.norm(column.name), table=self.norm(column.table))
            )
        for identifier in wrapper.find_all(exp.Identifier):
            identifier.set("quoted", False)
        return _unparen(wrapper.this).sql()

    def check(self, ast: exp.Expression) -> list[str] | None:
        """Ids of the declared rules the statement breaks; ``None`` for no verdict."""
        if not self.rules:
            return []
        if not isinstance(ast, exp.Query):
            return None
        try:
            qualified = qualify(
                ast.copy(),
                dialect=self.dialect,
                schema=self.schema,
                validate_qualify_columns=True,
                identify=False,
            )
            statement = _Statement(qualified, self)
        except Exception:  # noqa: BLE001 - any parse/qualify failure is "no verdict"
            return None
        from wren.declared_default_status import (  # noqa: PLC0415
            StatusUndetermined,
            judge,
        )

        try:
            fired = []
            for rule in self.rules:
                if isinstance(rule, ExcludeRows):
                    broken = statement.fires_exclude(rule)
                elif isinstance(rule, SaleStatuses):
                    broken = judge(statement, self, rule).outcome in {
                        "missing",
                        "subset",
                        "superset",
                    }
                else:
                    broken = statement.fires_rate(rule)
                if broken:
                    fired.append(rule.id)
            return fired
        except StatusUndetermined:
            return None
        except Exception:  # noqa: BLE001 - a checker fault is "no verdict", never a refusal
            return None
