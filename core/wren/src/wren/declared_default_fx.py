"""Single-match and base-currency judgments for ``require_rate_join``, plus rule applicability.

``declared_default_check`` decides whether a statement *joins* a rate on currency and date; it
cannot tell that the rate source yields one row per amount row, nor that rows in the base
currency survive the join. This module adds those two judgments (they only run for a rule that
declares ``match: single`` or ``base_currency``) and reports, per declared rule, whether it
applied and whether the statement satisfied it. The existing decisions are reused as they are,
so a rule without the new keys gets exactly the verdict ``DefaultsChecker.check`` gives.

Violations come back as ``<rule id>`` (an existing decision) or ``<rule id>:<sub>``:

``rate_multi_match``
    ``match: single`` and the rate source is an ordinary join: several rate rows can match one
    amount row. An ``ASOF JOIN``, or a derived source that keeps the latest row per ``ROW_NUMBER()``,
    is single.
``base_currency_dropped``
    the rate model is inner-joined, so amounts in the base currency (which have no rate row)
    vanish from the result.
``rate_default_literal``
    a rate column is defaulted to a literal (``COALESCE(rate, 1)``, ``CASE WHEN rate IS NULL
    THEN 1``, ``CASE WHEN rate IS NOT NULL THEN rate ELSE 1 END``, also under a cast) outside a branch that is known to be the base currency, which would turn a
    missing foreign rate into 1.

Like the rest of the checker this reads only the qualified syntax tree: no prose, aliases or
column names as strings.

Beyond fx the module is where a statement meets *every* declared rule. A ``sale_statuses`` rule is
judged by ``declared_default_status``; a rule the definition of a view the statement reads
guarantees is ``satisfied_by_definition`` when every read of the models it concerns lies inside
such a view (the view's body is the marked subquery ``expand_views`` substituted); a rule whose
status set the caller confirmed is judged against that set and, when met, is
``satisfied_by_caller_scope``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator

from sqlglot import exp
from sqlglot.optimizer.qualify import qualify

from wren.declared_default_check import (
    DefaultsChecker,
    _conjuncts,
    _Statement,
    _unparen,
)
from wren.declared_default_status import (
    NOT_APPLICABLE,
    SATISFIED,
    VIOLATIONS,
    StatusUndetermined,
    display,
    fold_all,
    judge,
)
from wren.declared_defaults import ExcludeRows, RequireRateJoin, SaleStatuses

VIEW_MARK = "wren_view"

RATE_MULTI_MATCH = "rate_multi_match"
BASE_CURRENCY_DROPPED = "base_currency_dropped"
RATE_DEFAULT_LITERAL = "rate_default_literal"
FX_DEFAULT_SHAPE_UNVERIFIED = "fx_default_shape_unverified"
FX_MISSING_RATE_HANDLING = "fx_missing_rate_handling"
UNGUARDED_LEFT_JOIN = "unguarded_left_join"
GUARDED_BY_BASE_CURRENCY = "guarded_by_base_currency"

_PRESERVING_SIDES = ("LEFT", "FULL")


@dataclass(frozen=True)
class Evaluation:
    """What the declared rules say about one statement.

    ``violations`` are rule ids (``<id>`` or ``<id>:<sub>``); ``undetermined`` are ids of rules
    the checker cannot judge for this statement. ``checks`` maps every declared rule to
    ``{"applicable": bool, "result": <result>}`` with ``satisfied``, ``not_applicable``,
    ``satisfied_by_definition`` or ``satisfied_by_caller_scope`` (which also carries ``scope``,
    the confirmed values), or ``violated`` / ``undetermined`` for a rule that failed; it is only
    meant to be kept for a statement that passed. ``fx_missing_rate_handling`` records how a
    passing statement treats a missing non-base rate when the rate model is LEFT-joined, and
    ``unverified`` the host-detected shapes the checks above could not vouch for.
    """

    violations: tuple[str, ...]
    checks: dict
    fx_missing_rate_handling: str | None = None
    undetermined: tuple[str, ...] = ()
    unverified: tuple[str, ...] = ()


def evaluate(
    checker: DefaultsChecker,
    ast: exp.Expression,
    scopes: dict[str, frozenset[str]] | None = None,
) -> Evaluation | None:
    """Evaluate every declared rule on ``ast``; ``None`` means no verdict (as ``check``).

    ``scopes`` maps a ``sale_statuses`` rule id to the folded status set the caller confirmed
    for it; such a rule is judged against that set instead of its declared values.
    """
    if not checker.rules:
        return Evaluation((), {})
    if not isinstance(ast, exp.Query):
        return None
    try:
        qualified = qualify(
            ast.copy(),
            dialect=checker.dialect,
            schema=checker.schema,
            validate_qualify_columns=True,
            identify=False,
        )
        statement = _Statement(qualified, checker)
    except Exception:  # noqa: BLE001 - any parse/qualify failure is "no verdict"
        return None
    try:
        return _evaluate(checker, statement, scopes or {})
    except Exception:  # noqa: BLE001 - a checker fault is "no verdict", never a refusal
        return None


def _inside_view(node: exp.Expression, guaranteed: frozenset[str]) -> bool:
    """The node sits in the body of a view whose name is in ``guaranteed``."""
    current = node.parent
    while current is not None:
        if current.meta.get(VIEW_MARK) in guaranteed:
            return True
        current = current.parent
    return False


def _without_views(
    statement: _Statement, checker: DefaultsChecker, views: frozenset[str]
) -> _Statement:
    """The statement with the body of every ``views`` subquery replaced by a stub that has the
    view's columns and reads nothing.

    A rule is judged this way when the view's guarantee covers only some of the reads it
    concerns: what is inside the view must not count towards the reads outside it (its rate
    join, its test-row filter), and a value read from the view must not count as an amount.
    """
    tree = statement.ast.copy()
    for subquery in list(tree.find_all(exp.Subquery)):
        if subquery.meta.get(VIEW_MARK) in views:
            columns = list(subquery.this.named_selects)
            subquery.set(
                "this",
                exp.select(*(exp.alias_(exp.Null(), name) for name in columns)),
            )
    return _Statement(tree, checker)


def _guaranteed_by(checker: DefaultsChecker, rule_id: str) -> frozenset[str]:
    return frozenset(view for view, ids in checker.guarantees.items() if rule_id in ids)


def _evaluate(
    checker: DefaultsChecker,
    statement: _Statement,
    scopes: dict[str, frozenset[str]],
) -> Evaluation:
    violations: list[str] = []
    undetermined: list[str] = []
    unverified: list[str] = []
    checks: dict = {}
    handling: str | None = None
    for rule in checker.rules:
        relevant = checker.relevant_models(rule)
        reads = {
            id(source): source
            for scope in statement.scopes
            for source in scope.sources.values()
            if isinstance(source, exp.Table) and source.name in relevant
        }
        guaranteed = _guaranteed_by(checker, rule.id)
        inside = (
            {key for key, read in reads.items() if _inside_view(read, guaranteed)}
            if guaranteed
            else set()
        )
        entry: dict | None = None
        broken: list[str] = []
        whole = bool(inside) and len(inside) == len(reads)
        # A guarantee that covers only some of the reads leaves the rest to the plain check,
        # on a statement that no longer shows the view's own body.
        seen = (
            _without_views(statement, checker, guaranteed)
            if inside and not whole and not isinstance(rule, SaleStatuses)
            else statement
        )
        if isinstance(rule, ExcludeRows):
            applicable = bool(checker.covered_of(rule) & seen.tables_read) and (
                not rule.aggregated_only or seen.aggregated
            )
            if applicable and whole:
                entry = {"applicable": True, "result": "satisfied_by_definition"}
            elif seen.fires_exclude(rule):
                broken = [rule.id]
        elif isinstance(rule, SaleStatuses):
            try:
                outcome, applicable, entry = _status(
                    checker, statement, rule, scopes, frozenset(inside), reads
                )
            except StatusUndetermined:
                undetermined.append(rule.id)
                checks[rule.id] = {"applicable": True, "result": "undetermined"}
                continue
            if outcome in VIOLATIONS:
                broken = [f"{rule.id}:{outcome}"]
        else:
            fx = _Rate(seen, checker, rule)
            applicable = fx.applicable()
            if applicable and whole:
                entry = {"applicable": True, "result": "satisfied_by_definition"}
            else:
                broken = [rule.id] if seen.fires_rate(rule) else []
                if applicable and not broken and not fx.excused():
                    found, rule_handling = fx.judge()
                    broken = [f"{rule.id}:{sub}" for sub in found]
                    if not broken:
                        handling = handling or rule_handling
                        if fx.shape_unverified():
                            unverified.append(FX_DEFAULT_SHAPE_UNVERIFIED)
        violations += broken
        if entry is None:
            entry = {
                "applicable": applicable,
                "result": "violated"
                if broken
                else "satisfied"
                if applicable
                else "not_applicable",
            }
        checks[rule.id] = entry
    if handling == UNGUARDED_LEFT_JOIN:
        unverified.append(FX_MISSING_RATE_HANDLING)
    return Evaluation(
        tuple(violations),
        checks,
        handling,
        tuple(undetermined),
        tuple(dict.fromkeys(unverified)),
    )


def _status(
    checker: DefaultsChecker,
    statement: _Statement,
    rule: SaleStatuses,
    scopes: dict[str, frozenset[str]],
    inside: frozenset[int],
    reads: dict,
) -> tuple[str, bool, dict | None]:
    """``(outcome, applicable, check entry)`` of a ``sale_statuses`` rule; the entry is only
    given when it is not the plain ``satisfied`` / ``not_applicable`` / ``violated`` one."""
    confirmed = scopes.get(rule.id)
    target = confirmed if confirmed is not None else fold_all(rule.values)
    outside = [read for key, read in reads.items() if key not in inside]
    aggregated_ok = not rule.aggregated_only or statement.aggregated
    if reads and not outside and aggregated_ok:
        return (
            SATISFIED,
            True,
            {"applicable": True, "result": "satisfied_by_definition"},
        )
    outcome = judge(statement, checker, rule, target, inside).outcome
    if outcome == NOT_APPLICABLE:
        return outcome, False, None
    if outcome == SATISFIED and confirmed is not None:
        return (
            outcome,
            True,
            {
                "applicable": True,
                "result": "satisfied_by_caller_scope",
                "scope": display(rule, confirmed),
            },
        )
    return outcome, True, None


def _numeric_literal(node: exp.Expression) -> bool:
    """A bare number, or one under a cast (``CAST(1 AS DOUBLE)``, ``1::DOUBLE``)."""
    node, cast = _unparen(node), False
    while isinstance(node, (exp.Cast, exp.TryCast)):
        node, cast = _unparen(node.this), True
    if isinstance(node, exp.Neg):
        node = _unparen(node.this)
    return isinstance(node, exp.Literal) and (cast or not node.is_string)


class _Rate:
    """The new judgments for one ``require_rate_join`` rule on one qualified statement."""

    def __init__(
        self, statement: _Statement, checker: DefaultsChecker, rule: RequireRateJoin
    ) -> None:
        self.st = statement
        self.rule = rule
        norm = checker.norm_pair
        self.model = checker.norm(rule.rate_model)
        self.amounts = {norm(ref) for group in rule.amounts for ref in group.columns}
        self.currencies = {norm(group.currency) for group in rule.amounts}
        self.rate_currency = norm(rule.rate_currency)
        self.rate_date = norm(rule.rate_date)
        keys = {rule.rate_currency.column, rule.rate_date.column}
        self.rate_values = {
            (self.model, checker.norm(column))
            for column in checker.schema.get(rule.rate_model, ())
            if column not in keys
        }
        self.base = rule.base_currency.casefold() if rule.base_currency else None
        self.ctes = {cte.alias: cte.this for cte in statement.ast.find_all(exp.CTE)}

    # -- applicability --------------------------------------------------

    def applicable(self) -> bool:
        if self.rule.aggregated_only and not self.st.aggregated:
            return False
        return any(self.st.taint(a) & self.amounts for a in self.st.aggregates)

    def excused(self) -> bool:
        """The rule's own ``unless`` flags already excuse the statement."""
        if self.rule.groups_by_currency and any(
            self.st.taint(group) & self.currencies
            for group in self.st.ast.find_all(exp.Group)
        ):
            return True
        return bool(
            self.rule.filters_currency_literal
            and self.st._filters_currency_literal(self.currencies)
        )

    # -- where the rate comes from ---------------------------------------

    def _reads(self, node: exp.Expression, seen: frozenset = frozenset()) -> bool:
        for table in node.find_all(exp.Table):
            if table.name == self.model:
                return True
            body = self.ctes.get(table.name)
            if body is not None and table.name not in seen:
                if self._reads(body, seen | {table.name}):
                    return True
        return False

    def _direct(self, node: exp.Expression) -> bool:
        return isinstance(node, exp.Table) and node.name == self.model

    def _attachments(self) -> Iterator[tuple[str, exp.Select, exp.Join | None]]:
        """Each place a select takes the rate model (or a source built on it) into its FROM tree."""
        for select in self.st.ast.find_all(exp.Select):
            source = select.args.get("from_") or select.args.get("from")
            if source is not None and self._reads(source.this):
                yield "from", select, None
            for join in select.args.get("joins") or []:
                if self._reads(join.this):
                    yield "join", select, join

    @staticmethod
    def _preserved(kind: str, select: exp.Select, join: exp.Join | None) -> bool:
        """Whether rows of the other side survive when the rate has no match."""
        if kind == "join":
            return join is not None and join.side in _PRESERVING_SIDES
        return any(j.side in ("RIGHT", "FULL") for j in select.args.get("joins") or [])

    def _kept_by_outer(self, select: exp.Select) -> bool:
        """The select is the body of a derived source that an outer LEFT/FULL join keeps."""
        node: exp.Expression | None = select
        while node is not None:
            if isinstance(node, exp.CTE):
                return any(
                    isinstance(join.this, exp.Table)
                    and join.this.name == node.alias
                    and join.side in _PRESERVING_SIDES
                    for join in self.st.ast.find_all(exp.Join)
                )
            if isinstance(node, exp.Subquery) and isinstance(node.parent, exp.Join):
                return node.parent.side in _PRESERVING_SIDES
            node = node.parent
        return False

    # -- single match -----------------------------------------------------

    def _latest_one(self, select: exp.Select) -> bool:
        """The select keeps only the newest rate row: ``ROW_NUMBER() ... ORDER BY date DESC`` = 1."""
        for window in select.find_all(exp.Window):
            if not isinstance(window.this, exp.RowNumber):
                continue
            if window.find_ancestor(exp.Select) is not select:
                continue
            order = window.args.get("order")
            newest_first = order is not None and any(
                isinstance(item, exp.Ordered)
                and item.args.get("desc")
                and self.st.direct(item.this) == self.rate_date
                for item in order.expressions
            )
            if newest_first and self._limited_to_one(select, window):
                return True
        return False

    def _limited_to_one(self, select: exp.Select, window: exp.Window) -> bool:
        alias = window.parent.alias if isinstance(window.parent, exp.Alias) else None
        clauses = [q.this for q in select.find_all(exp.Qualify)]
        if alias:
            clauses += self.st.roots
        for clause in clauses:
            for node in _conjuncts(clause):
                if not isinstance(node, (exp.EQ, exp.LTE)):
                    continue
                for side, other in (
                    (node.this, node.expression),
                    (node.expression, node.this),
                ):
                    one = (
                        isinstance(other, exp.Literal)
                        and not other.is_string
                        and other.this == "1"
                    )
                    names_it = side == window or (
                        alias is not None
                        and isinstance(side, exp.Column)
                        and side.name == alias
                    )
                    if one and names_it:
                        return True
        return False

    def _single(self, kind: str, select: exp.Select, join: exp.Join | None) -> bool:
        if join is not None and join.args.get("method") == "ASOF":
            return True
        if self._latest_one(select):
            return True
        if join is not None:
            source = join.this
        else:
            source = (select.args.get("from_") or select.args.get("from")).this
        return not self._direct(source) and self._derived_single(source)

    def _derived_single(
        self, node: exp.Expression, seen: frozenset = frozenset()
    ) -> bool:
        for select in node.find_all(exp.Select):
            if self._takes_rate_directly(select) and self._latest_one(select):
                return True
        for table in node.find_all(exp.Table):
            body = self.ctes.get(table.name)
            if body is not None and table.name not in seen:
                if self._derived_single(body, seen | {table.name}):
                    return True
        return False

    def _takes_rate_directly(self, select: exp.Select) -> bool:
        source = select.args.get("from_") or select.args.get("from")
        sources = [source.this] if source is not None else []
        sources += [join.this for join in select.args.get("joins") or []]
        return any(self._direct(s) for s in sources)

    # -- base currency ------------------------------------------------------

    def _base_test(self, condition: exp.Expression) -> str | None:
        """``eq`` / ``neq`` for ``<currency column> = / <> '<base>'`` among the conjuncts."""
        known = self.currencies | {self.rate_currency}
        for conjunct in _conjuncts(condition):
            if not isinstance(conjunct, (exp.EQ, exp.NEQ)):
                continue
            for side, other in (
                (conjunct.this, conjunct.expression),
                (conjunct.expression, conjunct.this),
            ):
                literal = _unparen(other)
                if (
                    self.st.direct(side) in known
                    and isinstance(literal, exp.Literal)
                    and literal.is_string
                    and literal.this.casefold() == self.base
                ):
                    return "eq" if isinstance(conjunct, exp.EQ) else "neq"
        return None

    def _has_base_guard(self) -> bool:
        return any(
            self._base_test(branch.this) is not None
            for branch in self.st.ast.find_all(exp.If)
        )

    def _is_rate(self, node: exp.Expression) -> bool:
        return bool(self.st.taint(node) & self.rate_values)

    def _defaults(self) -> Iterator[exp.Expression]:
        """Nodes that replace a missing rate value with a literal."""
        for node in self.st.ast.find_all(exp.Coalesce, exp.If):
            if isinstance(node, exp.Coalesce):
                args = [node.this, *node.expressions]
                if any(self._is_rate(a) for a in args) and any(
                    _numeric_literal(a) for a in args
                ):
                    yield node
                continue
            condition, taken = _unparen(node.this), node.args.get("true")
            if (
                isinstance(condition, exp.Is)
                and isinstance(condition.expression, exp.Null)
                and self._is_rate(condition.this)
                and taken is not None
                and _numeric_literal(taken)
            ):
                yield node
                continue
            # The inverse spelling: ``CASE WHEN rate IS NOT NULL THEN rate ELSE 1 END``.
            if isinstance(condition, exp.Not):
                present = _unparen(condition.this)
                if (
                    isinstance(present, exp.Is)
                    and isinstance(present.expression, exp.Null)
                    and self._is_rate(present.this)
                ):
                    owner = node.parent
                    branch = isinstance(owner, exp.Case) and any(
                        node is i for i in owner.args.get("ifs") or []
                    )
                    other = (
                        owner.args.get("default") if branch else node.args.get("false")
                    )
                    if other is not None and _numeric_literal(other):
                        yield other

    def _guarded(self, node: exp.Expression) -> bool:
        """The node sits in a branch that only the base currency can reach."""
        child, parent = node, node.parent
        while parent is not None:
            if isinstance(parent, exp.If):
                if (
                    child is parent.args.get("true")
                    and self._base_test(parent.this) == "eq"
                ):
                    return True
            elif isinstance(parent, exp.Case) and child is parent.args.get("default"):
                if any(
                    self._base_test(branch.this) == "neq"
                    for branch in parent.args.get("ifs") or []
                ):
                    return True
            child, parent = parent, parent.parent
        return False

    def _safe_default(self, node: exp.Expression | None) -> bool:
        """Nothing, NULL or a plain number: a default that cannot quietly stand in for a rate."""
        if node is None:
            return True
        node = _unparen(node)
        return isinstance(node, exp.Null) or _numeric_literal(node)

    def shape_unverified(self) -> bool:
        """A conditional over a rate whose default or test is not one the checks above read.

        ``COALESCE`` / ``IF`` / ``CASE`` over a rate-tainted expression is read only in its plain
        forms: a numeric (or NULL) default, and a ``IS [NOT] NULL`` test. A non-literal or nested
        default (``COALESCE(rate, 2 - 1)``, a ``CASE`` inside a ``CASE``) and a ``CASE`` on the
        rate that is not such a test (``CASE WHEN rate > 0 ...``) are not judged, so they are
        reported rather than passed on trust. So is ``GREATEST`` / ``LEAST`` of a rate and any other
        non-NULL value (a number or an expression) outside a base-currency branch: DuckDB ignores
        NULL there, so a missing rate becomes that value, a default in disguise.
        """
        for node in self.st.ast.find_all(exp.Greatest, exp.Least):
            args = [node.this, *node.expressions]
            if (
                any(self._is_rate(a) for a in args)
                and any(
                    not self._is_rate(a) and not isinstance(_unparen(a), exp.Null)
                    for a in args
                )
                and not self._guarded(node)
            ):
                return True
        for node in self.st.ast.find_all(exp.Coalesce, exp.If):
            if isinstance(node, exp.Coalesce):
                args = [node.this, *node.expressions]
                if any(self._is_rate(a) for a in args) and any(
                    not self._is_rate(a) and not self._safe_default(a) for a in args
                ):
                    return True
                continue
            condition = _unparen(node.this)
            if not self._is_rate(condition):
                continue
            absent = condition
            inverse = isinstance(condition, exp.Not)
            if inverse:
                absent = _unparen(condition.this)
            if not (
                isinstance(absent, exp.Is)
                and isinstance(absent.expression, exp.Null)
                and self._is_rate(absent.this)
            ):
                return True
            if inverse:
                owner = node.parent
                branch = isinstance(owner, exp.Case) and any(
                    node is i for i in owner.args.get("ifs") or []
                )
                other = owner.args.get("default") if branch else node.args.get("false")
            else:
                other = node.args.get("true")
            if not self._safe_default(other):
                return True
        return False

    # -- verdict --------------------------------------------------------

    def judge(self) -> tuple[list[str], str | None]:
        found: list[str] = []
        attachments = list(self._attachments())
        if self.rule.match == "single" and any(
            not self._single(*a) for a in attachments
        ):
            found.append(RATE_MULTI_MATCH)
        handling = None
        if self.base is not None:
            kept = False
            for kind, select, join in attachments:
                if self._preserved(kind, select, join):
                    kept = True
                elif not self._kept_by_outer(select):
                    if BASE_CURRENCY_DROPPED not in found:
                        found.append(BASE_CURRENCY_DROPPED)
            if any(not self._guarded(node) for node in self._defaults()):
                found.append(RATE_DEFAULT_LITERAL)
            if kept and not found:
                handling = (
                    GUARDED_BY_BASE_CURRENCY
                    if self._has_base_guard()
                    else UNGUARDED_LEFT_JOIN
                )
        return found, handling
