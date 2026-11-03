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
        self.scopes = scopes
        self._scope_of = {id(scope.expression): scope for scope in scopes}
        self._origins: dict[int, _Origin] = {}
        filters: list[exp.Expression] = [w.this for w in ast.find_all(exp.Where)]
        joins = [
            (join, on)
            for join in ast.find_all(exp.Join)
            if (on := join.args.get("on")) is not None
        ]
        filters += [h.this for h in ast.find_all(exp.Having)]
        filters += [q.this for q in ast.find_all(exp.Qualify)]
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
        for scope in scopes:
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
            for source in scope.sources.values()
            if isinstance(source, exp.Table) and source.name
        }
        self.aggregates = list(ast.find_all(exp.AggFunc))
        self.aggregated = bool(self.aggregates) or ast.find(exp.Group) is not None

    @staticmethod
    def _read_sources(scope: Scope) -> list[tuple[str, Scope]]:
        """The CTEs and derived tables ``scope`` reads from (not the CTEs merely in scope)."""
        read = {alias for alias, _ in scope.references}
        return [
            (alias, source)
            for alias, source in scope.sources.items()
            if isinstance(source, Scope) and alias in read
        ]

    def _restricting(self, read: Scope) -> set[int]:
        """The scopes (by expression id) whose row filters restrict the rows ``read`` yields.

        The read's own scope and every scope that consumes it (a CTE or derived table is read
        by its consumer, a set-operation branch by the set operation), and for each of those the
        CTEs and derived tables it reads from, and a subquery that is a top-level conjunct as a
        positive ``IN`` or as an ``EXISTS`` correlated with the scope's rows. A scalar subquery,
        an uncorrelated ``EXISTS``, anything under ``NOT`` or ``OR`` and a sibling set-operation
        branch filter none of those rows.
        """
        consumers: dict[int, Scope] = {}
        stack = [read]
        while stack:
            scope = stack.pop()
            if id(scope.expression) not in consumers:
                consumers[id(scope.expression)] = scope
                stack += self._parents.get(id(scope.expression), [])
        restricting: set[int] = set()

        def visit(scope: Scope) -> None:
            if id(scope.expression) in restricting:
                return
            restricting.add(id(scope.expression))
            for _, source in self._read_sources(scope):
                visit(source)
            top = {id(c) for c in self._top_conjuncts(scope)}
            for sub in scope.subquery_scopes:
                node = sub.expression.parent
                while isinstance(node, (exp.Subquery, exp.Paren)):
                    node = node.parent
                if id(node) in top and (
                    isinstance(node, exp.In)
                    or (isinstance(node, exp.Exists) and sub.external_columns)
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
        """``<column> IS NULL`` where the column belongs to the flag's own model.

        A LEFT JOIN that keeps rows without a flag row tests the join key, not the
        flag itself.
        """
        if not (isinstance(node, exp.Is) and isinstance(node.expression, exp.Null)):
            return False
        column = self.direct(node.this)
        return column is not None and column[0] == flag[0]

    def _negated(
        self, inner: exp.Expression, rule: ExcludeRows, flag: Pair
    ) -> str | None:
        excluded = rule.exclude
        if self._is_flag(inner, flag):
            return "excl" if excluded else "incl"
        if isinstance(inner, exp.Exists):
            return "excl" if self._selects_flag(inner, rule) else None
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
        return outer == chosen or frozenset((outer, chosen)) in self.checker.joins

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
            column
            for group in self.ast.find_all(exp.Group)
            for column in group.find_all(exp.Column)
        ]
        aggregated = [
            column
            for aggregate in self.aggregates
            for column in aggregate.find_all(exp.Column)
        ]
        return any(flag in self.origin(column).taint for column in grouped + aggregated)

    def fires_exclude(self, rule: ExcludeRows) -> bool:
        if not (self.checker.covered_of(rule) & self.tables_read):
            return False
        if rule.aggregated_only and not self.aggregated:
            return False
        covered = self.checker.covered_of(rule)
        return any(
            not self._excluded(scope, rule)
            for scope in self.scopes
            if covered
            & {s.name for s in scope.sources.values() if isinstance(s, exp.Table)}
        )

    def _excluded(self, read: Scope, rule: ExcludeRows) -> bool:
        """Whether the filters that restrict ``read``'s rows exclude the rule's flagged rows."""
        restricting = self._restricting(read)
        reaching = [c for c, scope_id in self._filters if scope_id in restricting]
        if rule.addresses_column and self._addresses(rule, reaching):
            return True
        for atom in self.checker.atoms_of(rule):
            if any(self.canonical(c) == atom for c in reaching):
                return True
        return any(self.polarity(c, rule) == "excl" for c in reaching)

    # -- require_rate_join ----------------------------------------------

    def _condition_nodes(self, kind: type[exp.Expression]) -> list[exp.Expression]:
        return [node for root in self.roots for node in root.find_all(kind)]

    def fires_rate(self, rule: RequireRateJoin) -> bool:
        if rule.aggregated_only and not self.aggregated:
            return False
        norm = self.checker.norm_pair
        amounts = {norm(ref) for group in rule.amounts for ref in group.columns}
        currencies = {norm(group.currency) for group in rule.amounts}
        dates = {norm(ref) for group in rule.amounts for ref in group.dates}
        rate_currency, rate_date = norm(rule.rate_currency), norm(rule.rate_date)
        if not any(self.taint(aggregate) & amounts for aggregate in self.aggregates):
            return False
        if rule.groups_by_currency and any(
            self.taint(group) & currencies for group in self.ast.find_all(exp.Group)
        ):
            return False
        if rule.filters_currency_literal and self._filters_currency_literal(currencies):
            return False
        currency_joined = any(
            (self.direct(a) == rate_currency and self.taint(b) & currencies)
            or (self.direct(b) == rate_currency and self.taint(a) & currencies)
            for node in self._condition_nodes(exp.EQ)
            for a, b in [(node.this, node.expression)]
        )
        date_bounded = (
            any(
                self.direct(_uncast_temporal(low)) == rate_date
                and self.taint(high) & dates
                for node in self._condition_nodes(exp.LTE)
                for low, high in [(node.this, node.expression)]
            )
            or any(
                self.direct(_uncast_temporal(low)) == rate_date
                and self.taint(high) & dates
                for node in self._condition_nodes(exp.GTE)
                for high, low in [(node.this, node.expression)]
            )
            or any(
                self.direct(_uncast_temporal(node.this)) == rate_date
                and self.taint(node.args["high"]) & dates
                for node in self._condition_nodes(exp.Between)
                if node.args.get("high") is not None
            )
        )
        return not (currency_joined and date_bounded)

    def _filters_currency_literal(self, currencies: set[Pair]) -> bool:
        for conjunct in self.conjuncts:
            if isinstance(conjunct, exp.EQ):
                for side, other in (
                    (conjunct.this, conjunct.expression),
                    (conjunct.expression, conjunct.this),
                ):
                    if self.direct(side) in currencies and _is_string(other):
                        return True
            elif isinstance(conjunct, exp.In) and conjunct.args.get("expressions"):
                if self.direct(conjunct.this) in currencies and all(
                    _is_string(value) for value in conjunct.expressions
                ):
                    return True
        return False


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
        from wren.declared_default_status import StatusUndetermined, judge  # noqa: PLC0415

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
