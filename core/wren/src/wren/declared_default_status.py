"""Judge what a statement's filters actually keep of a status column.

A ``sale_statuses`` rule is not met by writing a status filter; it is met when the set of status
values the statement can still return equals the declared set. This module computes that set
from the qualified syntax tree alone (no prose, aliases or column names as strings), over the
full value ``domain`` of the column, so ``NOT IN ('cancelled')`` keeps whatever else the domain
lists.

Each read of the status model is judged on its own, through derived tables, CTEs and set
operations, so two branches of a ``UNION`` may keep different statuses without one hiding the
other. A filter is evaluated as a pair of sets over the domain: the values for which it holds for
every row (``must``) and the values for which it can hold for some row (``may``). A predicate
that does not mention the status column is "any value may pass"; ``AND`` intersects, ``OR`` unites,
``NOT`` swaps and complements. What a read retains is its ``may`` set, so a filter on another
column (``AND amount > 5``) narrows nothing and an ``OR`` with one widens to the whole domain.

A row whose status is NULL is not in the domain and is tracked apart, as the truth values the
filter can take for it under SQL's three-valued logic. Only ``IS NULL`` makes it true; ``=``,
``IN``, ``NOT IN`` and ``<>`` are unknown for it and ``NOT`` leaves unknown unknown. A read whose
filters can all be true for a NULL status retains rows outside the declared set, whatever else it
keeps.

Recognised atoms are ``=``, ``<>``/``!=``, ``IN``, ``NOT IN`` and ``IS [NOT] NULL`` between the
status column (optionally wrapped in ``LOWER``, ``UPPER`` or ``TRIM``) and string or numeric
literals. Anything else that touches the column (another column, a function, a subquery, ``LIKE``,
a ``CASE``) has no verdict: ``StatusUndetermined`` is raised, never a guess. Bare-column
comparison retains declaration case folding; explicit LOWER/UPPER operations and literals
are evaluated before comparing, so an explicit case contradiction cannot disappear.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator

from sqlglot import exp
from sqlglot.optimizer.scope import Scope

from wren.declared_default_check import DefaultsChecker, _Statement, _unparen
from wren.declared_defaults import SaleStatuses, fold

MISSING = "missing"
SUBSET = "subset"
SUPERSET = "superset"
SATISFIED = "satisfied"
NOT_APPLICABLE = "not_applicable"
VIOLATIONS = (MISSING, SUPERSET, SUBSET)

_EMPTY: frozenset[str] = frozenset()
_TRUE, _FALSE, _UNKNOWN = "true", "false", "unknown"
_ANY_TRUTH = frozenset({_TRUE, _FALSE, _UNKNOWN})
_Verdict = tuple[frozenset[str], frozenset[str], frozenset[str]]
_UNKNOWN_ONLY = frozenset({_UNKNOWN})
_TRUE_ONLY = frozenset({_TRUE})
_WRAPPERS = (exp.Lower, exp.Upper, exp.Trim)


class StatusUndetermined(Exception):
    """The statement filters the status column in a way this module does not evaluate."""


class _Tainted:
    """A column whose value depends on the status column through more than a pass-through."""


_TAINTED = _Tainted()


@dataclass(frozen=True)
class StatusJudgment:
    """``outcome`` is one of the module constants."""

    outcome: str


def fold_all(values) -> frozenset[str]:
    return frozenset(fold(v) for v in values)


def _and_truth(left: frozenset[str], right: frozenset[str]) -> frozenset[str]:
    out = set()
    for a in left:
        for b in right:
            if _FALSE in (a, b):
                out.add(_FALSE)
            elif _UNKNOWN in (a, b):
                out.add(_UNKNOWN)
            else:
                out.add(_TRUE)
    return frozenset(out)


def _or_truth(left: frozenset[str], right: frozenset[str]) -> frozenset[str]:
    out = set()
    for a in left:
        for b in right:
            if _TRUE in (a, b):
                out.add(_TRUE)
            elif _UNKNOWN in (a, b):
                out.add(_UNKNOWN)
            else:
                out.add(_FALSE)
    return frozenset(out)


_NOT_TRUTH = {_TRUE: _FALSE, _FALSE: _TRUE, _UNKNOWN: _UNKNOWN}


def display(rule: SaleStatuses, folded: frozenset[str]) -> list[str]:
    """``folded`` in the declared case, in the domain's order."""
    return [v for v in rule.domain if fold(v) in folded]


def _own_columns(node: exp.Expression) -> Iterator[exp.Column]:
    """The columns of ``node`` itself: a nested query's columns belong to its own filters."""
    stack = [node]
    while stack:
        current = stack.pop()
        if isinstance(current, exp.Column):
            yield current
            continue
        for child in current.iter_expressions():
            if not isinstance(child, exp.Query):
                stack.append(child)


class _Status:
    def __init__(
        self,
        statement: _Statement,
        checker: DefaultsChecker,
        rule: SaleStatuses,
        excused: frozenset[int],
    ) -> None:
        self.st = statement
        self.rule = rule
        self.flag = checker.norm_pair(rule.column)
        self.domain = fold_all(rule.domain)
        seen: dict[int, exp.Table] = {}
        for scope in statement.scopes:
            for source in scope.sources.values():
                if (
                    isinstance(source, exp.Table)
                    and source.name == self.flag[0]
                    and id(source) not in excused
                ):
                    seen[id(source)] = source
        self.instances = list(seen.values())
        self.instance_ids = frozenset(seen)
        self.paths = [
            (id(source), path)
            for scope in statement.scopes
            for alias, source in scope.sources.items()
            if isinstance(source, exp.Table) and id(source) in self.instance_ids
            for path in statement._read_paths(scope, alias, source)
        ]
        self._traced: dict[int, frozenset[int] | _Tainted] = {}

    def applicable(self) -> bool:
        return bool(self.instances) and (
            not self.rule.aggregated_only or self.st.aggregated
        )

    # -- where a status reference comes from -----------------------------------------------

    def _unrelated(self, column: exp.Column) -> frozenset[int] | _Tainted:
        tainted = self.flag in self.st.origin(column).taint
        return _TAINTED if tainted else frozenset()

    def _trace(
        self, column: exp.Column, visiting: frozenset = frozenset()
    ) -> frozenset[int] | _Tainted:
        """The reads whose status column ``column`` passes through; ``_TAINTED`` when it only
        derives from it; empty when it is unrelated."""
        cached = self._traced.get(id(column))
        if cached is not None:
            return cached
        result = self._trace_uncached(column, visiting)
        self._traced[id(column)] = result
        return result

    def _trace_uncached(
        self, column: exp.Column, visiting: frozenset
    ) -> frozenset[int] | _Tainted:
        scope = self.st._scope_for(column)
        if scope is None or not column.table:
            return self._unrelated(column)
        source = None
        while scope is not None:
            if column.table in scope.sources:
                source = scope.sources[column.table]
                break
            scope = scope.parent
        if isinstance(source, exp.Table):
            if (source.name, column.name) == self.flag and id(
                source
            ) in self.instance_ids:
                return frozenset({id(source)})
            return frozenset()
        if not isinstance(source, Scope):
            return self._unrelated(column)
        key = (id(source.expression), column.name)
        names = list(source.expression.named_selects)
        if key in visiting or column.name not in names:
            return self._unrelated(column)
        found = self.st._nth(source, names.index(column.name))
        if not found:
            return self._unrelated(column)
        reads: frozenset[int] = frozenset()
        for projection, _owner in found:
            inner = _unparen(projection.unalias())
            if isinstance(inner, exp.Column):
                traced = self._trace(inner, visiting | {key})
            elif self.flag in self.st.taint(inner):
                traced = _TAINTED
            else:
                traced = frozenset()
            if isinstance(traced, _Tainted):
                return _TAINTED
            reads |= traced
        return reads

    def _reads_of(self, node: exp.Expression) -> frozenset[int]:
        """The reads whose status ``node`` mentions; a mention it cannot attribute is undetermined."""
        groups: set[frozenset[int]] = set()
        for column in _own_columns(node):
            traced = self._trace(column)
            if isinstance(traced, _Tainted):
                raise StatusUndetermined("derived_status")
            if traced:
                groups.add(traced)
        if len(groups) > 1:
            raise StatusUndetermined("several_reads")
        return next(iter(groups), frozenset())

    # -- predicates ---------------------------------------------------------------------------

    def _status_expr(self, node: exp.Expression) -> bool:
        node = _unparen(node)
        while isinstance(node, _WRAPPERS):
            if isinstance(node, exp.Trim) and (
                node.args.get("expression") is not None
                or node.args.get("position") is not None
            ):
                return False
            node = _unparen(node.this)
        if not isinstance(node, exp.Column):
            return False
        traced = self._trace(node)
        return isinstance(traced, frozenset) and bool(traced)

    def _text(self, node: exp.Expression) -> str | None:
        node = _unparen(node)
        if isinstance(node, exp.Literal):
            return str(node.this)
        if isinstance(node, (exp.Lower, exp.Upper)):
            inner = self._text(node.this)
            if inner is None:
                return None
            if not inner.isascii():
                raise StatusUndetermined("case_mapping")
            return inner.lower() if isinstance(node, exp.Lower) else inner.upper()
        if isinstance(node, exp.Trim) and node.args.get("expression") is None:
            inner = self._text(node.this)
            return None if inner is None else inner.strip(" ")
        return None

    def _hit(self, side, texts):
        """Evaluate explicit ASCII case functions without guessing DB collation.

        Bare comparisons keep the declaration's existing case-insensitive contract.
        Unicode case mappings vary by database/locale and have no verdict here.
        """

        def transform(node, value):
            node = _unparen(node)
            if isinstance(node, exp.Lower):
                return transform(node.this, value).lower()
            if isinstance(node, exp.Upper):
                return transform(node.this, value).upper()
            if isinstance(node, exp.Trim):
                return transform(node.this, value).strip(" ")
            return value

        if not any(isinstance(n, (exp.Lower, exp.Upper)) for n in side.walk()):
            wanted = fold_all(texts)
            return frozenset(
                value for value in self.domain if fold(transform(side, value)) in wanted
            )
        if any(not value.isascii() for value in (*self.rule.domain, *texts)):
            raise StatusUndetermined("case_mapping")
        return frozenset(
            value for value in self.domain if transform(side, value) in texts
        )

    def _atom(self, node: exp.Expression) -> _Verdict:
        if isinstance(node, (exp.EQ, exp.NEQ)):
            for side, other in (
                (node.this, node.expression),
                (node.expression, node.this),
            ):
                if self._status_expr(side):
                    text = self._text(other)
                    if text is None:
                        raise StatusUndetermined("non_literal")
                    hit = self._hit(side, [text])
                    kept = hit if isinstance(node, exp.EQ) else self.domain - hit
                    return kept, kept, _UNKNOWN_ONLY
            raise StatusUndetermined("unsupported_predicate")
        if isinstance(node, exp.In):
            if (
                node.args.get("query") is not None
                or node.args.get("unnest") is not None
                or node.args.get("field") is not None
                or not self._status_expr(node.this)
            ):
                raise StatusUndetermined("non_literal")
            texts = [self._text(item) for item in node.expressions]
            if not texts or any(text is None for text in texts):
                raise StatusUndetermined("non_literal")
            hit = self._hit(node.this, [t for t in texts if t is not None])
            return hit, hit, _UNKNOWN_ONLY
        if (
            isinstance(node, exp.Is)
            and isinstance(node.expression, exp.Null)
            and self._status_expr(node.this)
        ):
            return _EMPTY, _EMPTY, _TRUE_ONLY
        raise StatusUndetermined("unsupported_predicate")

    def _eval(self, node: exp.Expression) -> _Verdict:
        """``(must, may, nulls)`` for a boolean ``node``: the domain values it holds for in every
        row and in some row, and the truth values it can take for a row whose status is NULL."""
        node = _unparen(node)
        if not self._reads_of(node):
            return _EMPTY, self.domain, _ANY_TRUTH
        if isinstance(node, exp.And):
            left, right = self._eval(node.this), self._eval(node.expression)
            return (
                left[0] & right[0],
                left[1] & right[1],
                _and_truth(left[2], right[2]),
            )
        if isinstance(node, exp.Or):
            left, right = self._eval(node.this), self._eval(node.expression)
            return (
                left[0] | right[0],
                left[1] | right[1],
                _or_truth(left[2], right[2]),
            )
        if isinstance(node, exp.Not):
            must, may, nulls = self._eval(node.this)
            return (
                self.domain - may,
                self.domain - must,
                frozenset(_NOT_TRUTH[value] for value in nulls),
            )
        return self._atom(node)

    def retained(self) -> dict[int, tuple[frozenset[str], bool]]:
        """Per read that some filter mentions, the statuses it can still return and whether a
        row with a NULL status can still pass every filter."""
        retained: dict[int, tuple[frozenset[str], bool]] = {}
        for conjunct in self.st.conjuncts:
            qualify = conjunct.find_ancestor(exp.Qualify)
            if qualify is not None and not self.st._qualify_restricts_value_rows(
                qualify
            ):
                continue
            reads = self._reads_of(conjunct)
            if not reads:
                continue
            _, may, nulls = self._eval(conjunct)
            scope = self.st._scope_for(conjunct)
            routes = [
                (table, route)
                for column in _own_columns(conjunct)
                if self._trace(column)
                for table, route in self.st._column_routes(column)
            ]
            for index, (read, path) in enumerate(self.paths):
                own_routes = [route for table, route in routes if table == read]
                if (
                    read not in reads
                    or not any(owner is scope for owner, _, _ in path)
                    or not own_routes
                    or not all(self.st._route_fits(route, path) for route in own_routes)
                ):
                    continue
                kept, null_kept = retained.get(index, (self.domain, True))
                retained[index] = (kept & may, null_kept and _TRUE in nulls)
        return retained

    def judge(self, target: frozenset[str]) -> str:
        if not self.applicable():
            return NOT_APPLICABLE
        retained = self.retained()
        found = set()
        for index, _read in enumerate(self.paths):
            entry = retained.get(index)
            if entry is None:
                found.add(MISSING)
                continue
            kept, null_kept = entry
            if null_kept:
                found.add(SUPERSET)
            elif kept == target:
                continue
            elif kept < target:
                found.add(SUBSET)
            else:
                found.add(SUPERSET)
        for outcome in VIOLATIONS:
            if outcome in found:
                return outcome
        return SATISFIED


def judge(
    statement: _Statement,
    checker: DefaultsChecker,
    rule: SaleStatuses,
    target: frozenset[str] | None = None,
    excused: frozenset[int] = frozenset(),
) -> StatusJudgment:
    """What ``statement`` keeps of ``rule``'s status column, against ``target`` (folded; the
    declared values when omitted). Raises ``StatusUndetermined`` when no verdict can be given."""
    status = _Status(statement, checker, rule, excused)
    return StatusJudgment(
        status.judge(fold_all(rule.values) if target is None else target)
    )
