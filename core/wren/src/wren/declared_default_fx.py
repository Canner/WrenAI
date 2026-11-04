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
from sqlglot.optimizer.scope import Scope

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
                required_join_missing = seen.fires_rate(rule)
                # A malformed rate predicate has no established attachment, so retain the
                # ordinary rule id. If one attachment is complete but a sibling amount path
                # is missing, retain the more specific base/single-match diagnosis when it
                # independently applies to that complete attachment.
                extended_evidence = (
                    not required_join_missing or rule.id in seen._complete_rate_rules
                )
                if applicable and extended_evidence and not fx.excused():
                    found, rule_handling = fx.judge()
                    broken = [f"{rule.id}:{sub}" for sub in found]
                    if not broken:
                        handling = handling or rule_handling
                        if fx.shape_unverified():
                            unverified.append(FX_DEFAULT_SHAPE_UNVERIFIED)
                if not broken and required_join_missing:
                    broken = [rule.id]
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
    if confirmed is None and reads and not outside and aggregated_ok:
        return (
            SATISFIED,
            True,
            {"applicable": True, "result": "satisfied_by_definition"},
        )
    # A caller-confirmed scope is a runtime constraint, so it must be checked against
    # a guaranteed view's actual filter rather than excusing that view by declaration.
    outcome = judge(
        statement,
        checker,
        rule,
        target,
        frozenset() if confirmed is not None else inside,
    ).outcome
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

    # -- applicability --------------------------------------------------

    def applicable(self) -> bool:
        if self.rule.aggregated_only and not self.st.aggregated:
            return False
        return any(self.st.taint(a) & self.amounts for a in self.st.aggregates)

    def excused(self) -> bool:
        """The rule's own ``unless`` flags already excuse the statement."""
        for group in self.rule.amounts:
            amounts = {self.st.checker.norm_pair(ref) for ref in group.columns}
            if not any(self.st.taint(a) & amounts for a in self.st.aggregates):
                continue
            currencies = {self.st.checker.norm_pair(group.currency)}
            if self.rule.groups_by_currency and self.st._groups_by_currency(
                currencies, amounts
            ):
                continue
            if self.rule.filters_currency_literal and self.st._filters_currency_literal(
                currencies, amounts
            ):
                continue
            return False
        return True

    # -- where the rate comes from ---------------------------------------

    def _reads(self, node: exp.Expression, seen: frozenset = frozenset()) -> bool:
        for table in node.find_all(exp.Table):
            owner = self.st._scope_for(table)
            source = (
                owner.sources.get(table.alias_or_name) if owner is not None else table
            )
            if isinstance(source, Scope):
                key = id(source.expression)
                if key not in seen and self._reads(source.expression, seen | {key}):
                    return True
            elif isinstance(source, exp.Table) and source.name == self.model:
                return True
        return False

    def _direct(self, node: exp.Expression) -> bool:
        return isinstance(node, exp.Table) and node.name == self.model

    def _attachments(self) -> Iterator[tuple[str, exp.Select, exp.Join | None]]:
        """Each place a select takes the rate model (or a source built on it) into its FROM tree."""
        for select in self.st.ast.find_all(exp.Select):
            if id(select) not in self.st._live_scopes:
                continue
            source = select.args.get("from_") or select.args.get("from")
            if source is not None and self._reads(source.this):
                yield "from", select, None
            for join in select.args.get("joins") or []:
                if self._reads(join.this):
                    yield "join", select, join

    def _belongs_to(self, column: exp.Column, scope: Scope, source) -> bool:
        """``column`` is a reference to this exact source in this consuming scope."""
        return (
            self.st._scope_for(column) is scope
            and scope.sources.get(column.table) is source
        )

    def _base_guard(self, node: exp.Expression, scope: Scope, source) -> bool:
        """``node`` guards an aggregate that consumes this exact rate attachment."""
        return any(
            self._base_test(node, aggregate) == "eq"
            for aggregate in self.st.aggregates
            if self.st.taint(aggregate) & self.amounts
            and any(
                self._belongs_to(column, scope, source)
                for column in aggregate.find_all(exp.Column)
            )
        )

    def _coalesce_keeps_null(self, node: exp.Expression, scope: Scope, source) -> bool:
        """A simple numeric ``COALESCE(rate, literal)`` comparison is true for NULL rate."""
        if not isinstance(node, (exp.EQ, exp.NEQ, exp.GT, exp.GTE, exp.LT, exp.LTE)):
            return False
        for left, right, reverse in (
            (node.this, node.expression, False),
            (node.expression, node.this, True),
        ):
            coalesce, other = _unparen(left), _unparen(right)
            if (
                not isinstance(coalesce, exp.Coalesce)
                or len(coalesce.expressions) != 1
                or not isinstance(_unparen(coalesce.this), exp.Column)
                or not self._belongs_to(_unparen(coalesce.this), scope, source)
                or not isinstance(other, exp.Literal)
                or other.is_string
            ):
                continue
            fallback = _unparen(coalesce.expressions[0])
            if not isinstance(fallback, exp.Literal) or fallback.is_string:
                continue
            try:
                first, second = float(fallback.this), float(other.this)
            except ValueError:
                continue
            if reverse:
                first, second = second, first
            return {
                exp.EQ: first == second,
                exp.NEQ: first != second,
                exp.GT: first > second,
                exp.GTE: first >= second,
                exp.LT: first < second,
                exp.LTE: first <= second,
            }[type(node)]
        return False

    def _proves_null_safe(self, node: exp.Expression, scope: Scope, source) -> bool:
        """Whether one boolean branch is known TRUE for this attachment's NULL extension."""
        node = _unparen(node)
        if isinstance(node, exp.And):
            return self._proves_null_safe(
                node.this, scope, source
            ) and self._proves_null_safe(node.expression, scope, source)
        if isinstance(node, exp.Or):
            return self._proves_null_safe(
                node.this, scope, source
            ) or self._proves_null_safe(node.expression, scope, source)
        if self._base_guard(node, scope, source):
            return True
        columns = list(node.find_all(exp.Column))
        if not any(self._belongs_to(column, scope, source) for column in columns):
            return False
        if isinstance(node, exp.Is):
            return isinstance(node.expression, exp.Null)
        return self._coalesce_keeps_null(node, scope, source)

    def _rejects_null_rate(self, node: exp.Expression, scope: Scope, source) -> bool:
        """Whether a supported predicate is false/unknown for this source's NULL extension.

        This intentionally proves only direct ``IS NOT NULL`` and ordinary comparisons.  An
        ``OR`` rejects the NULL extension only when every branch does, so a base-currency guard
        or a NULL-safe expression in either branch remains preserving.  Unknown functions are
        not treated as NULL-safe guarantees.
        """
        node = _unparen(node)
        if isinstance(node, exp.And):
            return self._rejects_null_rate(
                node.this, scope, source
            ) or self._rejects_null_rate(node.expression, scope, source)
        if isinstance(node, exp.Or):
            # A rate-free branch is not a preservation proof.  Only the declared base guard
            # or a rate expression proved TRUE for NULL establishes that every unmatched base
            # currency amount reaches this OR.
            if self._proves_null_safe(
                node.this, scope, source
            ) or self._proves_null_safe(node.expression, scope, source):
                return False
            return self._rejects_null_rate(
                node.this, scope, source
            ) or self._rejects_null_rate(node.expression, scope, source)

        columns = list(node.find_all(exp.Column))
        if not any(self._belongs_to(column, scope, source) for column in columns):
            return False

        if isinstance(node, exp.Not):
            # ``NOT (rate IS NULL)`` is the qualified form of ``rate IS NOT NULL``.
            return True
        if isinstance(node, exp.Is):
            # Only ``rate IS NULL`` retains a NULL-extended row.
            return not isinstance(node.expression, exp.Null)
        if isinstance(node, (exp.EQ, exp.NEQ, exp.GT, exp.GTE, exp.LT, exp.LTE)):
            return not self._coalesce_keeps_null(node, scope, source)
        # Do not assume an unrecognised predicate returns TRUE for NULL.
        return True

    def _preserved(self, kind: str, select: exp.Select, join: exp.Join | None) -> bool:
        """Whether rows of the other side survive when the rate has no match."""
        if kind == "join":
            if join is None or join.side not in _PRESERVING_SIDES:
                return False
            attachment = join.this
        else:
            if not any(
                item.side in ("RIGHT", "FULL")
                for item in select.args.get("joins") or []
            ):
                return False
            attachment = (select.args.get("from_") or select.args.get("from")).this
        scope = self.st._scope_for(select)
        if scope is None:
            return False
        # ``scope.sources`` holds the resolved Table/Scope object.  Keep that identity rather
        # than the syntactic table reference so a projected CTE/derived rate alias is matched in
        # its consuming outer SELECT, not only at the inner physical rate read.
        source = scope.sources.get(attachment.alias_or_name)
        if source is None:
            return False
        return not any(
            self._rejects_null_rate(clause.this, scope, source)
            for key in ("where", "having")
            if (clause := select.args.get(key)) is not None
        )

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

    def _origin(self, node, visiting=frozenset()):
        """Exact AST origin, preserving table instances and window identities."""
        node = _unparen(node.unalias())
        if isinstance(node, exp.Window):
            return (id(node), "window")
        if not isinstance(node, exp.Column):
            return None
        scope = self.st._scope_for(node)
        if scope is None:
            return None
        source = scope.sources.get(node.table)
        if isinstance(source, exp.Table):
            return (id(source), node.name)
        if isinstance(source, Scope) and isinstance(source.expression, exp.Select):
            key = (id(source), node.name)
            if key in visiting:
                return None
            matches = [
                p for p in source.expression.selects if p.alias_or_name == node.name
            ]
            if len(matches) == 1:
                return self._origin(matches[0], visiting | {key})
        return None

    @staticmethod
    def _one_bound(node):
        """Return only the operand bounded above by one, never a lower bound."""
        if isinstance(node, (exp.EQ, exp.LTE)):
            other = _unparen(node.expression)
            if (
                isinstance(other, exp.Literal)
                and not other.is_string
                and other.this == "1"
            ):
                yield _unparen(node.this)
        if isinstance(node, (exp.EQ, exp.GTE)):
            other = _unparen(node.this)
            if (
                isinstance(other, exp.Literal)
                and not other.is_string
                and other.this == "1"
            ):
                yield _unparen(node.expression)

    def _limited_to_one(self, select, window, clauses, alias=None):
        for clause in clauses:
            for node in _conjuncts(clause):
                for side in self._one_bound(node):
                    if alias is not None and (
                        not isinstance(side, exp.Column) or side.table != alias
                    ):
                        continue
                    if side is window or self._origin(side) == (id(window), "window"):
                        return True
                    # A QUALIFY may refer to a SELECT alias without a table qualifier.
                    if (
                        alias is None
                        and isinstance(side, exp.Column)
                        and not side.table
                    ):
                        if (
                            side.find_ancestor(exp.Select) is select
                            and isinstance(window.parent, exp.Alias)
                            and side.name == window.parent.alias
                        ):
                            return True
        return False

    def _latest_one(self, select, clauses, alias=None, fixed=None):
        # QUALIFY runs after aggregation: a rank cannot undo duplicate rates
        # already consumed by SUM (including duplicates in the same group).
        if select.args.get("group") is not None or any(
            aggregate.find_ancestor(exp.Select) is select
            for aggregate in select.find_all(exp.AggFunc)
        ):
            return False
        for window in select.find_all(exp.Window):
            if (
                not isinstance(window.this, exp.RowNumber)
                or window.find_ancestor(exp.Select) is not select
            ):
                continue
            order = window.args.get("order")
            newest = (
                order is not None
                and bool(order.expressions)
                and (
                    order.expressions[0].args.get("desc")
                    and self.st.direct(order.expressions[0].this) == self.rate_date
                )
            )
            keys = [self._origin(key) for key in window.args.get("partition_by") or []]
            if any(key is None for key in keys):
                continue
            if fixed is not None:
                if not set(keys) <= fixed:
                    continue
            elif keys:
                # A local QUALIFY must bound the amount instance itself. Keys
                # from another joined source can vary many times per amount.
                amount_sources = {
                    origin[0]
                    for projection in select.selects
                    for column in projection.find_all(exp.Column)
                    if column.find_ancestor(exp.Select) is select
                    and self.st.direct(column) in self.amounts
                    and (origin := self._origin(column)) is not None
                }
                if len(amount_sources) != 1 or any(
                    key[0] not in amount_sources for key in keys
                ):
                    continue
            local = select.args.get("qualify")
            limited = local is not None and self._limited_to_one(
                select, window, [local.this]
            )
            limited = limited or self._limited_to_one(select, window, clauses, alias)
            if newest and limited:
                return True
        return False

    def _single(self, kind: str, select: exp.Select, join: exp.Join | None) -> bool:
        if join is not None and join.args.get("method") == "ASOF":
            return True
        # A window in this SELECT applies after its joins. Only its own QUALIFY
        # can limit it here; filters in another scope must prove the derived join.
        if self._latest_one(select, []):
            return True
        # The enclosing attachment separately proves every consumer's join keys.
        # Here an exact reference to this window may limit the intermediate rows.
        own_scope = self.st._scope_for(select)
        consumers = any(
            own_scope is src
            for parent in self.st.scopes
            for src in parent.sources.values()
        )
        if consumers:
            if not select.args.get("joins") and all(
                isinstance(_unparen(p.unalias()), exp.Column) for p in select.selects
            ):
                # This wrapper adds no rows; the consuming attachment must prove
                # the underlying rank and its partition keys through the wrapper.
                return True
            keys = {
                self._origin(key)
                for window in select.find_all(exp.Window)
                for key in window.args.get("partition_by") or []
            }
            if self._latest_one(select, self.st.roots, fixed=keys):
                return True
        source = (
            join.this
            if join is not None
            else (select.args.get("from_") or select.args.get("from")).this
        )
        if self._direct(source):
            return False
        scope = self.st._scope_for(select)
        derived = scope.sources.get(source.alias_or_name) if scope is not None else None
        if not isinstance(derived, Scope) or not isinstance(
            derived.expression, exp.Select
        ):
            return False
        clauses = []
        if join is not None and join.args.get("on") is not None:
            clauses.append(join.args["on"])
        if select.args.get("where") is not None:
            clauses.append(select.args["where"].this)
        fixed = set()
        for clause in clauses:
            for atom in _conjuncts(clause):
                if not isinstance(atom, exp.EQ):
                    continue
                for side, other in (
                    (atom.this, atom.expression),
                    (atom.expression, atom.this),
                ):
                    side, other = _unparen(side), _unparen(other)
                    if (
                        not isinstance(side, exp.Column)
                        or side.table != source.alias_or_name
                    ):
                        continue
                    # Equality must fix the partition key from outside this source.
                    if isinstance(other, exp.Literal) or (
                        isinstance(other, exp.Column)
                        and other.table != side.table
                        and self.st._scope_for(other) is scope
                        and self.st.direct(other) is not None
                        and self.st.direct(other)[0] in {m for m, _ in self.amounts}
                        and not self._reads(
                            scope.sources[other.table].expression
                            if isinstance(scope.sources.get(other.table), Scope)
                            else scope.sources[other.table]
                        )
                    ):
                        origin = self._origin(side)
                        if origin is not None:
                            fixed.add(origin)
        return self._derived_single(derived, clauses, source.alias_or_name, fixed)

    def _derived_single(self, scope, clauses, alias, fixed):
        select = scope.expression
        if self._latest_one(select, clauses, alias, fixed):
            return True
        # Pass-through wrappers may preserve a proof, but a further join or set
        # operation can multiply it and needs its own cardinality analysis.
        if select.args.get("joins"):
            return False
        source = select.args.get("from_") or select.args.get("from")
        inner = (
            scope.sources.get(source.this.alias_or_name) if source is not None else None
        )
        if isinstance(inner, Scope) and isinstance(inner.expression, exp.Select):
            return self._derived_single(inner, clauses, alias, fixed)
        return False

    # -- base currency ------------------------------------------------------

    def _base_test(
        self, condition: exp.Expression, value: exp.Expression
    ) -> str | None:
        """``eq`` / ``neq`` for ``<currency column> = / <> '<base>'`` among the conjuncts."""
        known = self.currencies
        owner = value
        while owner.parent is not None and not self.st.taint(owner) & self.amounts:
            owner = owner.parent
        reads = self.st._amount_reads(self.amounts, owner)
        terms = [
            term for scope in self.st.scopes for term in self.st._top_conjuncts(scope)
        ]
        for conjunct in _conjuncts(condition):
            if not isinstance(conjunct, (exp.EQ, exp.NEQ)):
                continue
            # A false conjunction need not falsify its currency test.
            if isinstance(conjunct, exp.NEQ) and conjunct is not _unparen(condition):
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
                    and reads
                    and all(
                        self.st._currency_reaches(side, table, path, terms)
                        for table, path in reads
                    )
                ):
                    return "eq" if isinstance(conjunct, exp.EQ) else "neq"
        return None

    def _has_base_guard(self) -> bool:
        """Every rate value consumed by an amount aggregate excludes that amount's base rows."""
        seen_rate = False

        def excludes_base(condition, taken, reads):
            condition = _unparen(condition)
            if isinstance(condition, exp.Not):
                return excludes_base(condition.this, not taken, reads)
            if isinstance(condition, (exp.And, exp.Or)):
                sides = [
                    excludes_base(c, taken, reads)
                    for c in (condition.this, condition.expression)
                ]
                return (
                    any(sides)
                    if (isinstance(condition, exp.And) == taken)
                    else all(sides)
                )
            if not isinstance(condition, (exp.EQ, exp.NEQ)):
                return False
            if taken == isinstance(condition, exp.EQ):
                return False
            for column, literal in (
                (condition.this, condition.expression),
                (condition.expression, condition.this),
            ):
                literal = _unparen(literal)
                if (
                    self.st.direct(column) in self.currencies
                    and isinstance(literal, exp.Literal)
                    and literal.is_string
                    and literal.this.casefold() == self.base
                ):
                    terms = [
                        term
                        for scope in self.st.scopes
                        for term in self.st._top_conjuncts(scope)
                    ]
                    return bool(reads) and all(
                        self.st._currency_reaches(column, table, path, terms)
                        for table, path in reads
                    )
            return False

        def uses(node, guards, reads, visiting=frozenset()):
            node = _unparen(node.unalias())
            if isinstance(node, exp.Column):
                scope = self.st._scope_for(node)
                source = scope.sources.get(node.table) if scope is not None else None
                if isinstance(source, Scope):
                    key = (id(source), node.name)
                    names = list(source.expression.named_selects)
                    if key in visiting or node.name not in names:
                        return
                    for projection, _ in self.st._nth(source, names.index(node.name)):
                        yield from uses(projection, guards, reads, visiting | {key})
                elif self.st.direct(node) in self.rate_values:
                    yield any(
                        excludes_base(condition, taken, reads)
                        for condition, taken in guards
                    )
                return
            if isinstance(node, exp.Case):
                # Simple CASE is not a currency predicate proof.
                previous = guards
                for branch in node.args.get("ifs") or []:
                    yield from uses(
                        branch.args["true"],
                        [*previous, (branch.this, True)],
                        reads,
                        visiting,
                    )
                    previous = [*previous, (branch.this, False)]
                if node.args.get("default") is not None:
                    yield from uses(node.args["default"], previous, reads, visiting)
                return
            if isinstance(node, exp.If):
                for key, taken in (("true", True), ("false", False)):
                    if node.args.get(key) is not None:
                        yield from uses(
                            node.args[key],
                            [*guards, (node.this, taken)],
                            reads,
                            visiting,
                        )
                return
            for child in node.iter_expressions():
                yield from uses(child, guards, reads, visiting)

        for aggregate in self.st.aggregates:
            if not self.st.taint(aggregate) & self.amounts:
                continue
            reads = self.st._amount_reads(self.amounts, aggregate)
            for guarded in uses(aggregate, [], reads):
                seen_rate = True
                if not guarded:
                    return False
        return seen_rate

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
                    and self._base_test(parent.this, node) == "eq"
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
