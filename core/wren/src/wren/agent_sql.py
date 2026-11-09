"""Opt-in private SQL execution over configured semantic models.

The model supplies SQL, never policy resources or public labels. Parse and qualify
before authorization; scope every physical relation, including CTEs/self joins.
Only host-produced tables/evidence may leave the private loop.

Every SQL statement, whoever wrote it, goes through ``AdHocSQL.prepare``: read-only,
bounded, denylist, declared default rules. Its failures are of three kinds, each with its
own exception family:

* rejected before execution and rewritable (``QueryFormError``, ``QueryShapeError``,
  ``DeclaredDefaultMissing``, ``DeclaredDefaultUndetermined``): all carry ``error``, ``code``
  and ``rules`` for the worker-visible answer;
* refused by authorization (``QueryDenied``, a ``PermissionError`` named
  ``query_denied:<sub>``, only ``not_read_only``, ``denied_column``, ``external_source`` or
  ``unknown_model``): the task ends, a rewrite cannot help. A function outside the allowlist
  (``unsupported_function``) and an unexpected planner error (``unsupported``) are form
  errors, not authorization failures;
* failed in the engine (raised by ``execute``): the service counts it separately.

Views are expanded in place before anything else looks at the statement: a view the statement
reads becomes a marked subquery over the models behind it, so the denylist, source tracking
(and with it authorization) and the declared rules see the models the view reads, and the view
itself is exempt only from the rules its definition guarantees.
"""

from __future__ import annotations

import json
import math
import re
from collections import Counter
from datetime import date, datetime, time
from decimal import Decimal
from typing import NamedTuple

import sqlglot
from pydantic import BaseModel, ConfigDict, Field
from sqlglot import exp
from sqlglot.optimizer.qualify import qualify
from sqlglot.optimizer.scope import Scope, ScopeType, traverse_scope

from wren.declared_default_check import DefaultsChecker
from wren.declared_default_fx import VIEW_MARK, evaluate
from wren.governed_query import query as governed_query
from wren.read_only import (
    UnsupportedFunctionError,
    check_read_only_query,
    consumed_scopes,
    cte_reference_ids,
)


class QueryShapeError(PermissionError):
    """Rejected output shape; the private worker may try a different safe query."""

    error = "unsupported_result_shape"
    rules: tuple = ()

    @property
    def code(self) -> str:
        return str(self)


class QueryFormError(ValueError):
    """SQL that cannot be planned against the bound models (unknown alias, too many
    joins, correlated reference, parse error); the private worker may rewrite it.
    Authorization failures never take this path."""

    error = "unsupported_query"

    def __init__(self, code: str, rules: tuple = ()):
        super().__init__(code)
        self.code = code
        self.rules = tuple(rules)


class DeclaredDefaultMissing(QueryFormError):
    """The statement breaks declared default rules; ``rules`` names them."""

    error = "declared_default_missing"


class DeclaredDefaultUndetermined(QueryFormError):
    """The checker has no verdict for the statement, so it is not run."""

    error = "declared_default_undetermined"


class QueryDenied(PermissionError):
    """Authorization failure, ``query_denied:<sub>``: the task ends, nothing is rewritten."""


def denied(sub: str) -> QueryDenied:
    return QueryDenied(f"query_denied:{sub}")


FORM_CODES = frozenset(
    {
        "complexity_limit",
        "recursive_query",
        "join_limit",
        "unsupported_source",
        "unresolved_column",
        "no_source",
        "column_limit",
        "column_list_alias",
        "natural_join",
        "positional_reference",
        "unsupported_function",
        "unsupported",
        "cube_not_a_table",
    }
)
MAX_JOINS = 4
DUPLICATE_AGGREGATION = "duplicate_aggregation"
DATE_WINDOW_UNVERIFIED = "date_window_unverified"
RULE_VIOLATION = "rule_violation"
NO_VERDICT = "no_verdict"
OPERATORS = {
    exp.EQ: "=",
    exp.NEQ: "<>",
    exp.GT: ">",
    exp.GTE: ">=",
    exp.LT: "<",
    exp.LTE: "<=",
    exp.In: "in",
    exp.Between: "between",
    exp.Like: "like",
    exp.ILike: "ilike",
    exp.Is: "is",
    exp.NullSafeEQ: "is not distinct from",
    exp.NullSafeNEQ: "is distinct from",
}
DATE_TYPE = re.compile(r"\s*(date|datetime|timestamp\w*)\b", re.IGNORECASE)
DATE_LITERAL = re.compile(
    r"(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?))?"
)
TEMPORAL_CASTS = {
    exp.DataType.Type.DATE,
    exp.DataType.Type.DATETIME,
    exp.DataType.Type.TIMESTAMP,
    exp.DataType.Type.TIMESTAMPNTZ,
}
BOUNDS = {
    exp.GT: ("lower", False),
    exp.GTE: ("lower", True),
    exp.LT: ("upper", False),
    exp.LTE: ("upper", True),
}
FLIPPED = {"lower": "upper", "upper": "lower"}
NEGATED = {"=": "<>", "<>": "=", "<": ">=", ">=": "<", ">": "<=", "<=": ">"}


class Prepared(NamedTuple):
    """A planned statement: what to run and what the host learned about it."""

    sql: str
    sources: dict
    conditions: dict
    labels: list
    checks: dict
    observed: dict
    unverified: list


class PrivateSQL(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    sql: str = Field(min_length=1, max_length=16384)


def model_schema(models) -> dict:
    """``model -> {column: type}`` over the non-hidden columns of the catalog's models."""
    return {
        m["name"]: {
            c["name"]: c["type"]
            for c in m.get("columns") or []
            if not c.get("is_hidden")
        }
        for m in models
    }


def read_view_bodies(schema: dict, catalog: dict, manifest: dict | None):
    """The views the catalog lists, as parsed bodies over models: ``(usable, broken)``.

    A body that does not parse as one query, or that reads anything but a bound model, is
    broken: a statement that reads it is refused as ``unsupported_source`` rather than run
    through a definition the host could not check.
    """
    statements = {
        v["name"].lower(): v.get("statement")
        for v in ((manifest or {}).get("views") or [])
        if isinstance(v, dict) and isinstance(v.get("name"), str)
    }
    usable, broken = {}, set()
    # The engine resolves names case-sensitively, so ``Clean`` and ``clean`` are two
    # views; read by folded name they would expand to each other. Neither is read.
    folded = Counter(
        v["name"].lower()
        for v in ((manifest or {}).get("views") or [])
        if isinstance(v, dict) and isinstance(v.get("name"), str)
    ) | Counter(view["name"].lower() for view in catalog.get("views") or [])
    for view in catalog.get("views") or []:
        name = view["name"].lower()
        statement = statements.get(name)
        try:
            if folded[name] > 1:
                raise ValueError("case-distinct views share a folded name")
            if not isinstance(statement, str):
                raise ValueError("no statement")
            body = sqlglot.parse_one(statement, read="duckdb")
            if not isinstance(body, exp.Query):
                raise ValueError("not a query")
            qualified = qualify(
                body.copy(),
                dialect="duckdb",
                schema=schema,
                validate_qualify_columns=True,
                identify=False,
            )
            from_ctes = cte_reference_ids(qualified)
            models = {model.lower() for model in schema}
            if any(
                t.db
                or t.catalog
                or (t.name.lower() not in models and id(t) not in from_ctes)
                for t in qualified.find_all(exp.Table)
            ):
                raise ValueError("reads more than models")
        except Exception:  # noqa: BLE001 - any unreadable view is unusable, never trusted
            broken.add(name)
            continue
        usable[name] = body
    return usable, broken


_GENERATED_ALIAS = re.compile(r"_col_\d+")


def view_output_columns(body, schema: dict) -> list[str] | None:
    """The output column names of a view body, or ``None`` when they are not stable names.

    ``*`` and ``t.*`` (also with ``EXCLUDE`` / ``REPLACE``) expand over the bound models'
    columns. Only an aliased projection, a bare column and a star count as named, in every
    ``SELECT`` of the statement (a derived table's unnamed cast reaches the output through an
    outer ``*``): any other unaliased projection (``SUM(x)``, ``id::BIGINT``, ``CAST(...)``, a literal,
    ``COLUMNS(...)``) is named by DuckDB in a way sqlglot does not reproduce, and a name that
    appears twice cannot be declared. The answer is ``None``, never a guess from the text.
    """
    if any(
        not isinstance(item, exp.Alias | exp.Column | exp.Star)
        for select in body.find_all(exp.Select)
        for item in select.expressions
    ):
        return None
    try:
        qualified = qualify(
            body.copy(),
            dialect="duckdb",
            schema=schema,
            validate_qualify_columns=True,
            identify=False,
        )
        names = list(qualified.named_selects)
    except Exception:  # noqa: BLE001 - an unresolvable body has no known output
        return None
    if (
        not names
        or any(not n or _GENERATED_ALIAS.fullmatch(n) for n in names)
        or len(set(names)) != len(names)
        or any(
            isinstance(inner := select.unalias(), exp.Star | exp.Columns)
            or (isinstance(inner, exp.Column) and isinstance(inner.this, exp.Star))
            for select in qualified.selects
        )
    ):
        return None
    return names


class AdHocSQL:
    """Plans and runs private SQL over the models of the bound Wren project.

    The schema is the loader catalog's (non-hidden columns of every model); the project's
    denied columns resolve like any other column and are refused after qualification, so
    a CTE, a subquery or a ``SELECT *`` expansion cannot carry one through. The project's
    declared default rules are applied to every statement before it can run.
    """

    def __init__(self, project):
        self.project = project
        snapshot = project.snapshot
        models = snapshot.catalog.get("models") or []
        self.schema = model_schema(models)
        if not self.schema:
            raise ValueError("invalid_sql_models")
        self.denied = frozenset((m.lower(), c.lower()) for m, c in snapshot.denied)
        catalog = snapshot.catalog
        self.primary_keys = {
            m["name"]: frozenset(
                [m.get("primary_key")]
                if isinstance(m.get("primary_key"), str)
                else m.get("primary_key") or []
            )
            for m in models
        }
        self.cube_names = {c["name"].lower() for c in catalog.get("cubes") or []}
        self.cube_measures = {
            member["name"].lower()
            for cube in catalog.get("cubes") or []
            for member in cube.get("measures") or []
        }
        self.model_columns = {
            c.lower() for columns in self.schema.values() for c in columns
        }
        self.semantics = list(catalog.get("semantics") or [])
        self.declared_defaults = bool(snapshot.declarations)
        self.date_columns = frozenset(
            (model.lower(), column.lower())
            for model, columns in self.schema.items()
            for column, kind in columns.items()
            if DATE_TYPE.match(str(kind))
        )
        self.views, self.broken_views = self._read_views(snapshot, catalog)
        self.checker = DefaultsChecker(
            snapshot.declarations,
            {**getattr(snapshot, "manifest", {}), "models": models},
            "duckdb",
            guarantees={
                v["name"].lower(): v.get("guarantees") or []
                for v in catalog.get("views") or []
                if v.get("guarantees")
            },
        )
        # Literals worth recording are the ones the project itself declares for a column.
        self.enums = {
            (m["name"].lower(), c["name"].lower()): {
                str(v["value"]) for v in c["enum_values"]
            }
            for m in models
            for c in m.get("columns") or []
            if c.get("enum_values")
        }

    def _read_views(self, snapshot, catalog):
        """The views the catalog lists, as parsed bodies over models: ``(usable, broken)``."""
        return read_view_bodies(
            self.schema, catalog, getattr(snapshot, "manifest", None)
        )

    def _expand_views(self, tree):
        """Replace every reference to a view by its marked body; return the names read."""
        shadowed = cte_reference_ids(tree)
        read = []
        for table in list(tree.find_all(exp.Table)):
            name = table.name.lower()
            if (
                table.db
                or table.catalog
                or not isinstance(table.this, exp.Identifier)
                or table.name in self.schema
                or id(table) in shadowed
                or (name not in self.views and name not in self.broken_views)
            ):
                continue
            if name in self.broken_views or any(
                table.args.get(k) for k in ("pivots", "sample", "version", "hints")
            ):
                raise QueryFormError("unsupported_source")
            alias = table.alias or table.name
            body = exp.Subquery(
                this=self.views[name].copy(),
                alias=exp.TableAlias(this=exp.to_identifier(alias)),
            )
            body.meta[VIEW_MARK] = name
            table.replace(body)
            if name not in read:
                read.append(name)
        return tree, read

    def _reject_cubes(self, tree):
        """A cube is not a table and a measure is not a column: neither can be read by name.

        Cubes answer through the engine's cube query, not through ``FROM <cube>`` or a measure
        summed as if some model held it.
        """
        shadowed = cte_reference_ids(tree)
        for table in tree.find_all(exp.Table):
            name = table.name.lower()
            if (
                name in self.cube_names
                and table.name not in self.schema
                and id(table) not in shadowed
            ):
                raise QueryFormError("cube_not_a_table")
        if not self.cube_measures:
            return
        defined = {a.alias.lower() for a in tree.find_all(exp.Alias)}
        for aggregate in tree.find_all(exp.AggFunc):
            for column in aggregate.find_all(exp.Column):
                name = column.name.lower()
                if (
                    name in self.cube_measures
                    and name not in self.model_columns
                    and name not in defined
                ):
                    raise QueryFormError("cube_not_a_table")

    @staticmethod
    def _view_of(expression):
        """The view whose body ``expression`` is (or sits inside), by name."""
        node = expression
        while node is not None:
            name = node.meta.get(VIEW_MARK)
            if name:
                return name
            node = node.parent
        return None

    def _duplicate_aggregation(self, scopes):
        """An aggregate over a view's value in a select that also reads a model not bounded to
        one row per view row: each view row can repeat once per matching model row (a cross
        join, ``ON TRUE``, a non-key or ``OR``-ed key match), and the aggregate counts it every
        time. A model is bounded when its whole primary key is equated, in top-level ``AND``s
        of the join conditions and ``WHERE``, to columns of sources already bounded, starting
        from the views; so two models keyed only to each other still multiply the view. A
        ``SEMI``/``ANTI`` join target never repeats a row, but it proves nothing about another
        source's cardinality, and neither does a CTE or derived table (its rows are not known
        to be unique on anything); those sources themselves are not checked here. Key names
        compare case-insensitively, as qualification folds them."""
        for scope in scopes:
            select = scope.expression
            if not isinstance(select, exp.Select):
                continue
            views = {
                alias
                for alias, source in scope.sources.items()
                if isinstance(source, Scope)
                and isinstance(source.expression.parent, exp.Subquery)
                and source.expression.parent.meta.get(VIEW_MARK)
            }
            if not views:
                continue
            aggregated = {
                column.table
                for aggregate in select.find_all(exp.AggFunc)
                if aggregate.find_ancestor(exp.Select) is select
                for column in aggregate.find_all(exp.Column)
                if column.table in views
            }
            if not aggregated:
                continue
            joins = select.args.get("joins") or []
            never_repeat = {
                j.this.alias_or_name
                for j in joins
                if j.args.get("kind") in ("SEMI", "ANTI")
            }
            conditions = [j.args.get("on") for j in joins] + [
                w.this for w in [select.args.get("where")] if w is not None
            ]
            edges = []
            for condition in conditions:
                for term in self._conjuncts(condition) if condition is not None else ():
                    while isinstance(term, exp.Paren):
                        term = term.this
                    if not isinstance(term, exp.EQ):
                        continue
                    a, b = term.this, term.expression
                    if not (
                        isinstance(a, exp.Column) and isinstance(b, exp.Column)
                    ) or (a.table == b.table):
                        continue
                    edges += [
                        (a.table, a.name.lower(), b.table),
                        (b.table, b.name.lower(), a.table),
                    ]
            keys_of = {
                model.lower(): frozenset(k.lower() for k in keys)
                for model, keys in self.primary_keys.items()
            }
            models = {
                alias: keys_of.get(source.name.lower(), frozenset())
                for alias, source in scope.sources.items()
                if isinstance(source, exp.Table) and alias not in never_repeat
            }
            bounded = set(views)
            grew = True
            while grew:
                grew = False
                for alias, keys in models.items():
                    if alias in bounded or not keys:
                        continue
                    reached = {
                        c for a, c, other in edges if a == alias and other in bounded
                    }
                    if keys <= reached:
                        bounded.add(alias)
                        grew = True
            if any(alias not in bounded for alias in models):
                return True
        return False

    @staticmethod
    def _reject_unsupported_forms(tree):
        """Forms that reach a column without naming it; refused before resolution.

        A column-list alias on a table renames its columns by position, ``NATURAL JOIN``
        equates every common column, and ``#N`` is a positional reference: none of them
        can be checked against the denylist the way a named column can.
        """
        for table in tree.find_all(exp.Table):
            alias = table.args.get("alias")
            if alias is not None and alias.args.get("columns"):
                raise QueryFormError("column_list_alias")
        if any(j.args.get("method") == "NATURAL" for j in tree.find_all(exp.Join)):
            raise QueryFormError("natural_join")
        if tree.find(exp.PositionalColumn) is not None:
            raise QueryFormError("positional_reference")

    def prepare(self, sql, status_scopes=None):
        """Plan ``sql``. ``status_scopes`` maps a ``sale_statuses`` rule id to the folded status
        set the caller confirmed for it."""
        try:
            tree = sqlglot.parse_one(sql, read="duckdb")
        except sqlglot.errors.SqlglotError:
            raise QueryFormError("invalid_sql") from None
        pending = None
        try:
            check_read_only_query(sql, "duckdb")
        except UnsupportedFunctionError:
            # A form limit, not an authorization failure; but a denied column or an
            # external source in the same statement still ends the task, so planning
            # goes on and this is raised once the denylist has been applied.
            pending = QueryFormError("unsupported_function")
        except Exception:
            raise denied("not_read_only") from None
        try:
            if sum(1 for _ in tree.walk()) > 1000:
                raise ValueError("complexity_limit")
            if any(w.args.get("recursive") for w in tree.find_all(exp.With)):
                raise ValueError("recursive_query")
            if len(list(tree.find_all(exp.Join))) > MAX_JOINS:
                raise ValueError("join_limit")
            for t in tree.find_all(exp.Table):
                if t.db or t.catalog or not isinstance(t.this, exp.Identifier):
                    raise ValueError("external_source")
            self._reject_unsupported_forms(tree)
            tree, views_read = self._expand_views(tree)
            self._reject_cubes(tree)
            if sum(1 for _ in tree.walk()) > 1000:
                raise ValueError("complexity_limit")
            if len(list(tree.find_all(exp.Join))) > MAX_JOINS:
                raise ValueError("join_limit")
            shadowed = cte_reference_ids(tree)
            known = {name.lower() for name in self.schema}
            if any(
                id(table) not in shadowed and table.name.lower() not in known
                for table in tree.find_all(exp.Table)
            ):
                raise ValueError("unknown_model")
            unqualified = tree.copy()
            tree = qualify(
                tree,
                dialect="duckdb",
                schema=self.schema,
                validate_qualify_columns=True,
                identify=True,
            )
            scopes = list(traverse_scope(tree))
            # Denial outranks every planning failure: a query that names a denied column is
            # an authorization failure even when it is also malformed.
            for scope in scopes:
                for col in scope.columns:
                    src = scope.sources.get(col.table)
                    if (
                        isinstance(src, exp.Table)
                        and (
                            src.name.lower(),
                            col.name.lower(),
                        )
                        in self.denied
                    ):
                        raise denied("denied_column")
            if pending is not None:
                # A model the project does not have ends the task as well; only a statement
                # whose every source is known gets the rewritable form error.
                for scope in scopes:
                    for src in scope.sources.values():
                        if isinstance(src, exp.Table) and src.name.lower() not in known:
                            raise ValueError("unknown_model")
                raise pending
            scopes = consumed_scopes(scopes)
            views_read = {
                name for scope in scopes if (name := self._view_of(scope.expression))
            }
            sources, physical = {}, []
            for scope in scopes:
                if not isinstance(
                    scope.expression, (exp.Select, exp.Union, exp.Intersect, exp.Except)
                ):
                    raise ValueError("unsupported_source")
                # ``scope.sources``, not ``selected_sources``: a SEMI/ANTI join target that no
                # column references is still a model the statement reads.
                for src in scope.sources.values():
                    if isinstance(src, exp.Table):
                        if src.name.lower() not in known:
                            raise ValueError("unknown_model")
                        sources.setdefault(src.name.lower(), set())
                        physical.append(src)
                for col in scope.columns:
                    src = scope.sources.get(col.table)
                    if isinstance(src, exp.Table):
                        sources[src.name.lower()].add(col.name)
                    elif not isinstance(src, Scope):
                        # Correlated references and ambiguous scope are not inferred.
                        raise ValueError("unresolved_column")
                if self._view_of(scope.expression) is None:
                    for projection in scope.expression.selects:
                        self._projection(projection)
            if not physical:
                raise ValueError("no_source")
            verdict = evaluate(self.checker, unqualified, status_scopes)
            if verdict is None:
                raise DeclaredDefaultUndetermined(NO_VERDICT)
            if verdict.violations:
                raise DeclaredDefaultMissing(RULE_VIOLATION, verdict.violations)
            if verdict.undetermined:
                raise DeclaredDefaultUndetermined(NO_VERDICT, verdict.undetermined)
            # COUNT(*) has no Column nodes; its table still receives authorization. The scope
            # names what the host enforces on every statement; it carries no rule text, and
            # no rule or model name.
            conditions = {
                "kind": "project_defaults",
                "declared_defaults_enforced": self.declared_defaults,
            }
            leaves = self._leaves(scopes[-1])
            labels = [self._label(x, leaves[0]) for x in leaves[0].expression.selects]
            if not labels or len(labels) > 20:
                raise ValueError("column_limit")
            # Uniqueness is per select: the branches of a set operation are separate
            # selects, and a column both of them project is not a duplicate.
            for leaf in leaves:
                names = [self._label(x, leaf) for x in leaf.expression.selects]
                if len(set(names)) != len(names):
                    raise QueryShapeError("duplicate_label")
            observed = self._observed(tree, scopes, sources)
            if verdict.fx_missing_rate_handling:
                observed["fx_missing_rate_handling"] = verdict.fx_missing_rate_handling
            unverified = list(verdict.unverified)
            if self._duplicate_aggregation(scopes):
                observed["duplicate_aggregation"] = True
                unverified.append(DUPLICATE_AGGREGATION)
            observed["date_windows"], windows_pinned = self._date_windows(scopes)
            if not windows_pinned:
                unverified.append(DATE_WINDOW_UNVERIFIED)
            touched = {name.lower() for name in sources} | set(views_read)
            unverified += [
                entry["id"]
                for entry in self.semantics
                if touched & {m.lower() for m in entry["models"]}
            ]
            # Strip every user/model alias from the public schema. Even a quoted
            # alias containing a private SQL statement must not leave this host.
            return Prepared(
                tree.sql(dialect="duckdb"),
                {k: sorted(v) for k, v in sources.items()},
                conditions,
                labels,
                {rule: dict(c) for rule, c in verdict.checks.items()},
                observed,
                list(dict.fromkeys(unverified)),
            )
        except (QueryFormError, PermissionError):
            # Rewritable rejections, shape errors and denials keep their own class.
            raise
        except ValueError as exc:
            if str(exc) in FORM_CODES:
                raise QueryFormError(str(exc)) from None
            if str(exc) in ("unknown_model", "external_source"):
                raise denied(str(exc)) from None
            raise QueryFormError("unsupported") from None
        except sqlglot.errors.OptimizeError:
            raise QueryFormError("unresolved_column") from None
        except sqlglot.errors.SqlglotError:
            raise QueryFormError("invalid_sql") from None
        except Exception:
            raise QueryFormError("unsupported") from None

    def _observed(self, tree, scopes, sources):
        """Facts read from the qualified statement: what it touched, never what it says."""
        joins, filters, literals = [], [], {}
        for scope in scopes:
            select = scope.expression
            if not isinstance(select, exp.Select):
                continue
            first = select.args.get("from_") or select.args.get("from")
            anchor = self._model_of(scope, first.this) if first is not None else None
            for join in select.args.get("joins") or []:
                right = self._model_of(scope, join.this)
                if right is None:
                    continue
                on = join.args.get("on")
                others = {
                    src.name
                    for col in (on.find_all(exp.Column) if on is not None else ())
                    if isinstance(src := scope.sources.get(col.table), exp.Table)
                } - {right}
                for other in sorted(others) or ([anchor] if anchor else [right]):
                    pair = sorted([right, other])
                    if pair not in joins:
                        joins.append(pair)
            for clause in (
                select.args.get("where"),
                select.args.get("having"),
                select.args.get("qualify"),
            ):
                if clause is not None:
                    self._filters(scope, clause.this, False, filters, literals)
        return {
            "models": sorted(sources),
            "columns": {m: sorted(c) for m, c in sorted(sources.items())},
            "joins": joins,
            "aggregated": any(
                scope.expression.args.get("group") is not None
                or any(
                    aggregate.find_ancestor(exp.Select) is scope.expression
                    for aggregate in scope.expression.find_all(exp.AggFunc)
                )
                for scope in scopes
            ),
            "filters": filters,
            "status_literals": {k: sorted(v) for k, v in sorted(literals.items())},
        }

    def _date_windows(self, scopes):
        """The date ranges the statement itself puts on a date column, read from the AST.

        Returns ``(windows, pinned)``. A window is listed per select and column from the
        comparisons of that column with a date or timestamp literal (``>=``, ``>``, ``<``,
        ``<=``, ``=``, ``BETWEEN``) in its ``WHERE``, ``HAVING``, ``QUALIFY`` and join
        conditions. A ``QUALIFY`` filters after the select's window functions read their rows:
        a date term there bounds nothing, and leaves the column unpinned, unless every window
        is partitioned by that column or its table's primary key (each window then reads only
        rows of one date); the same holds for a filter on a date passed out of a derived
        table, CTE or view that computes a window. A date column that is also filtered any
        other way anywhere in the
        statement (``DATE_TRUNC``, ``EXTRACT``, arithmetic, a non-literal operand, an ``OR``,
        a ``CASE``/``FILTER`` condition, a derived value) is not listed and ``pinned`` is
        false: the host cannot say which dates the statement keeps. So is a select that
        reads a model whose date column is windowed in another select (a UNION branch, a CTE,
        a subquery) without a window of its own on that model: the figure mixes a bounded read
        with an unbounded one; coverage is judged per consuming edge (see
        ``_every_read_bounded``), so one consumer's filter on a shared CTE does not bound
        another consumer of it. The windows found stay listed either way. ``IS [NOT] NULL``
        and a comparison of two columns in a join condition are not date filters and count for
        nothing either way. Nothing here reads what the worker wrote about its question.
        """
        scopes = consumed_scopes(scopes)
        windows, unpinned = [], set()
        nullable_on = False
        marked = {}
        selects = []
        for scope in scopes:
            select = scope.expression
            if not isinstance(select, exp.Select):
                continue
            selects.append(scope)
            bounds = {}
            qualify = select.args.get("qualify")
            for condition, join in self._conditions(select):
                joined = join is not None
                for term in self._conjuncts(condition):
                    if (
                        qualify is not None
                        and condition is qualify.this
                        and not all(
                            self._windows_keep_rows_of(scope, column)
                            for column in term.find_all(exp.Column)
                        )
                    ):
                        if not self._is_null_check(term):
                            unpinned |= self._date_refs(scope, term)
                        continue
                    taken = self._bounds_of(scope, term)
                    if taken is not None and self._unfiltered_by(join, term):
                        continue
                    if taken is not None:
                        for column, side, value, inclusive, edge in taken:
                            self._tighten(
                                bounds.setdefault((column, edge), {}),
                                side,
                                value,
                                inclusive,
                            )
                            if join is not None and join.side in ("LEFT", "RIGHT"):
                                nullable_on = True
                            marked.setdefault((id(scope), edge), set()).add(
                                self._key(column)[0]
                            )
                    elif not (
                        self._is_null_check(term)
                        or (joined and self._is_join_key(term))
                    ):
                        unpinned |= self._date_refs(scope, term)
            for node in select.find_all(exp.If, exp.Filter):
                if node.find_ancestor(exp.Select) is select:
                    condition = (
                        node.this if isinstance(node, exp.If) else node.expression.this
                    )
                    for term in self._conjuncts(condition):
                        if not self._is_null_check(term):
                            unpinned |= self._date_refs(scope, term)
            windows += [
                self._window(column, sides) for (column, _edge), sides in bounds.items()
            ]
        listed = {}
        for window in windows:
            if self._key(window["column"]) not in unpinned:
                listed.setdefault(json.dumps(window, sort_keys=True), window)
        pinned = (
            not unpinned
            and not nullable_on
            and self._every_read_bounded(
                scopes,
                selects,
                marked,
                {self._key(w["column"])[0] for w in listed.values()},
            )
        )
        return list(listed.values()), pinned

    @staticmethod
    def _every_read_bounded(scopes, selects, marked, windowed):
        """Whether every select that reads a windowed model is bounded by a window for it.

        Coverage is per consuming edge. A filter marks only the first hop it reads through:
        the consumer's own source, a table (judged per alias, so each side of a self-join
        needs a window of its own) or a CTE, derived table or view body. A select is *bounded* for a model when each
        source of it that leads there is marked by its own filter or is itself bounded; it is
        *fine* when it is bounded, or when it has consumers and each of them marks the edge to it
        or is fine. A CTE two selects read is therefore bounded only for the consumer that
        filters it, and the other consumer fails the statement.
        """
        if not windowed:
            return True

        def used(scope):
            """The sources a select actually reads (FROM and JOIN), not the CTEs merely in
            scope."""
            aliases = {alias for alias, _ in scope.references}
            return [(a, s) for a, s in scope.sources.items() if a in aliases]

        parents = {}
        for scope in scopes:
            for alias, source in used(scope):
                if isinstance(source, Scope):
                    parents.setdefault(id(source), []).append(
                        (scope, ("s", id(source), alias))
                    )
            for branch in scope.union_scopes:
                parents.setdefault(id(branch), []).append((scope, ("u", id(branch))))
        reach_cache, bounded_cache, fine_cache = {}, {}, {}

        def reach(scope):
            if id(scope) not in reach_cache:
                found = set()
                for _, source in used(scope):
                    if isinstance(source, Scope):
                        found |= reach(source)
                    elif isinstance(source, exp.Table):
                        found.add(source.name.lower())
                for branch in scope.union_scopes:
                    found |= reach(branch)
                reach_cache[id(scope)] = found & windowed
            return reach_cache[id(scope)]

        def bounded(scope, model):
            slot = (id(scope), model)
            if slot not in bounded_cache:
                if scope.union_scopes:
                    ok = all(
                        bounded(b, model)
                        for b in scope.union_scopes
                        if model in reach(b)
                    )
                else:
                    ok = True
                    seen = set()
                    for alias, source in used(scope):
                        if isinstance(source, Scope):
                            edge = ("s", id(source), alias)
                            leads = model in reach(source)
                        else:
                            edge = ("t", alias)
                            leads = source.name.lower() == model
                        if not leads or edge in seen:
                            continue
                        seen.add(edge)
                        if model not in marked.get((id(scope), edge), ()) and not (
                            isinstance(source, Scope) and bounded(source, model)
                        ):
                            ok = False
                bounded_cache[slot] = ok
            return bounded_cache[slot]

        def fine(scope, model):
            slot = (id(scope), model)
            if slot not in fine_cache:
                fine_cache[slot] = False  # a scope is never its own consumer
                owners = parents.get(id(scope), [])
                fine_cache[slot] = bounded(scope, model) or (
                    bool(owners)
                    and all(
                        fine(owner, model)
                        if scope in owner.union_scopes
                        else model in marked.get((id(owner), edge), ())
                        or fine(owner, model)
                        for owner, edge in owners
                    )
                )
            return fine_cache[slot]

        def read(scope):
            """A CTE nothing reads has no effect on the figure."""
            unused = scope.scope_type in (ScopeType.CTE, ScopeType.DERIVED_TABLE)
            return not unused or id(scope) in parents

        return all(
            fine(scope, model)
            for scope in selects
            if read(scope)
            for model in reach(scope)
        )

    @staticmethod
    def _key(qualified):
        model, _, column = qualified.partition(".")
        return model.lower(), column.lower()

    def _windows_keep_rows_of(self, scope, column):
        """Whether every window function ``scope``'s select itself computes reads only rows that
        share ``column``'s value: each is partitioned by ``column`` or by every primary key
        column of ``column``'s table. A filter on ``column`` applied after such windows drops
        whole partitions, so it bounds what they read; after any other window it does not."""
        select = scope.expression
        if not isinstance(select, exp.Select):
            return True
        source = scope.sources.get(column.table)
        keys = frozenset()
        if isinstance(source, exp.Table):
            keys = next(
                (
                    frozenset(k.lower() for k in pk)
                    for model, pk in self.primary_keys.items()
                    if model.lower() == source.name.lower()
                ),
                frozenset(),
            )
        named = {
            definition.this.name.lower(): definition
            for definition in select.args.get("windows") or []
            if isinstance(definition.this, exp.Identifier)
        }
        for window in select.find_all(exp.Window):
            if (
                window.find_ancestor(exp.Select) is not select
                or window.arg_key == "windows"
            ):
                continue
            partition = {
                part.name.lower()
                for part in self._effective_partition(window, named)
                if isinstance(part, exp.Column) and part.table == column.table
            }
            if column.name.lower() not in partition and not (
                keys and keys <= partition
            ):
                return False
        return True

    @staticmethod
    def _effective_partition(window, named):
        """``window``'s ``PARTITION BY``, or the one it inherits through ``OVER w`` /
        ``OVER (w ...)`` from the select's ``WINDOW`` definitions (a chain of at most 8)."""
        for _ in range(8):
            if window.args.get("partition_by"):
                return window.args["partition_by"]
            base = window.args.get("alias")
            if not isinstance(base, exp.Identifier) or base.name.lower() not in named:
                return []
            window = named[base.name.lower()]
        return []

    @staticmethod
    def _conditions(select):
        """``(condition, join)`` for every filter position of a select: the join whose ``ON``
        it is, or ``None`` for ``WHERE``, ``HAVING`` and ``QUALIFY``."""
        for key in ("where", "having", "qualify"):
            clause = select.args.get(key)
            if clause is not None:
                yield clause.this, None
        for join in select.args.get("joins") or []:
            if join.args.get("on") is not None:
                yield join.args["on"], join

    @staticmethod
    def _unfiltered_by(join, term):
        """Whether ``term``, a condition in ``join``'s ``ON``, leaves every row of the side it
        names in the result: a literal on the preserved side of an outer join only decides
        which rows match, not which rows are kept, and the same holds on either side of an
        ``ANTI`` join. It is no date filter."""
        if join is None:
            return False
        if join.args.get("kind") == "ANTI":
            return True
        side = join.args.get("side")
        if side not in ("LEFT", "RIGHT", "FULL"):
            return False
        if side == "FULL":
            return True
        target = join.this.alias_or_name
        on_target = {c.table for c in term.find_all(exp.Column)} == {target}
        return on_target if side == "RIGHT" else not on_target

    @staticmethod
    def _conjuncts(node):
        while isinstance(node, exp.Paren):
            node = node.this
        if isinstance(node, exp.And):
            yield from AdHocSQL._conjuncts(node.this)
            yield from AdHocSQL._conjuncts(node.expression)
        else:
            yield node

    @staticmethod
    def _is_null_check(term):
        """``col IS NULL`` / ``col IS NOT NULL``: a state test (a soft-delete or cancellation
        timestamp), which cannot move the range of dates a statement keeps."""
        while isinstance(term, (exp.Paren, exp.Not)):
            term = term.this
        return (
            isinstance(term, exp.Is)
            and isinstance(term.expression, exp.Null)
            and isinstance(term.this, exp.Column)
        )

    @staticmethod
    def _is_join_key(term):
        """A comparison of two columns in a join condition: the join, not a date filter."""
        while isinstance(term, exp.Paren):
            term = term.this
        return isinstance(term, exp.Binary) and all(
            isinstance(side, exp.Column) for side in (term.this, term.expression)
        )

    def _date_column(self, scope, node):
        """``(model.column, edge)`` when ``node`` is a plain reference to a date or timestamp
        column: the base column it reads through derived tables, and the first hop it reads
        through (a table, or the CTE, derived table or view body the select consumes)."""
        if not isinstance(node, exp.Column):
            return None
        first, depth = None, 0
        while depth < 8:
            source = scope.sources.get(node.table)
            if isinstance(source, exp.Table):
                key = (source.name.lower(), node.name.lower())
                if key not in self.date_columns:
                    return None
                return f"{source.name}.{node.name}", first or ("t", node.table)
            if not isinstance(source, Scope):
                return None
            first = first or ("s", id(source), node.table)
            inner = next(
                (
                    child.unalias()
                    for child in source.expression.selects
                    if child.alias_or_name == node.name
                ),
                None,
            )
            if not isinstance(inner, exp.Column) or not self._windows_keep_rows_of(
                source, inner
            ):
                return None
            scope, node, depth = source, inner, depth + 1
        return None

    def _date_refs(self, scope, node, depth=0):
        """The date columns ``node`` reads, followed through derived tables and CTEs."""
        found = set()
        for column in self._columns_read(node):
            source = scope.sources.get(column.table)
            if isinstance(source, exp.Table):
                if (source.name.lower(), column.name.lower()) in self.date_columns:
                    found.add((source.name.lower(), column.name.lower()))
            elif isinstance(source, Scope) and depth < 8:
                for child in source.expression.selects:
                    if child.alias_or_name == column.name:
                        found |= self._date_refs(source, child.unalias(), depth + 1)
        return found

    @staticmethod
    def _columns_read(node):
        """The columns whose values ``node`` computes from. A window function's ``PARTITION BY``
        and ``ORDER BY`` pick rows (a ranking over a date is not a date filter) and are skipped."""
        stack = [node]
        while stack:
            current = stack.pop()
            if isinstance(current, exp.Column):
                yield current
                continue
            for key, child in current.args.items():
                if isinstance(current, exp.Window) and key in ("partition_by", "order"):
                    continue
                children = child if isinstance(child, list) else [child]
                stack.extend(c for c in children if isinstance(c, exp.Expression))

    def _bounds_of(self, scope, term):
        """``[(column, "lower"|"upper", value, inclusive, edge), ...]`` when ``term`` compares a date
        column with a date literal and does nothing else, otherwise ``None``."""
        while isinstance(term, exp.Paren):
            term = term.this
        if isinstance(term, exp.Between):
            found = self._date_column(scope, term.this)
            low = self._literal(term.args.get("low"))
            high = self._literal(term.args.get("high"))
            if found and low and high:
                column, through = found
                return [
                    (column, "lower", low, True, through),
                    (column, "upper", high, True, through),
                ]
            return None
        if not isinstance(term, (exp.EQ, exp.GT, exp.GTE, exp.LT, exp.LTE)):
            return None
        for mine, other, mirrored in (
            (term.this, term.expression, False),
            (term.expression, term.this, True),
        ):
            found = self._date_column(scope, mine)
            value = self._literal(other)
            if not found or not value:
                continue
            column, through = found
            if isinstance(term, exp.EQ):
                return [
                    (column, "lower", value, True, through),
                    (column, "upper", value, True, through),
                ]
            side, inclusive = BOUNDS[type(term)]
            return [
                (
                    column,
                    FLIPPED[side] if mirrored else side,
                    value,
                    inclusive,
                    through,
                )
            ]
        return None

    @staticmethod
    def _literal(node):
        """``(sort_key, iso_text)`` of a date or timestamp literal, otherwise ``None``.

        The forms are ``DATE '…'`` / ``CAST('…' AS DATE|TIMESTAMP)`` and a bare ISO string a
        date column is compared with. Anything computed (an interval, a function, a column)
        is not a literal."""
        while isinstance(node, exp.Paren):
            node = node.this
        only_date = False
        if isinstance(node, exp.Cast) and node.to.this in TEMPORAL_CASTS:
            only_date = node.to.this == exp.DataType.Type.DATE
            node = node.this
        if not (isinstance(node, exp.Literal) and node.is_string):
            return None
        found = DATE_LITERAL.fullmatch(node.this.strip())
        if found is None or (only_date and found.group(2)):
            return None
        try:
            day = date.fromisoformat(found.group(1))
            clock = time.fromisoformat(found.group(2)) if found.group(2) else None
        except ValueError:
            return None
        if clock is None:
            return datetime.combine(day, time.min), day.isoformat()
        stamp = datetime.combine(day, clock)
        return stamp, stamp.isoformat()

    @staticmethod
    def _tighten(sides, side, value, inclusive):
        """Keep the narrower of two bounds on the same side; at a tie the exclusive one wins."""
        kept = sides.get(side)
        if kept is not None:
            if kept[0][0] == value[0]:
                inclusive = kept[1] and inclusive
            elif (value[0] < kept[0][0]) == (side == "lower"):
                return
        sides[side] = (value, inclusive)

    @staticmethod
    def _window(column, sides):
        window = {"column": column}
        for side in ("lower", "upper"):
            bound = sides.get(side)
            window[side] = bound[0][1] if bound else None
        for side in ("lower", "upper"):
            bound = sides.get(side)
            window[f"{side}_inclusive"] = bool(bound and bound[1])
        return window

    @staticmethod
    def _model_of(scope, node):
        if isinstance(node, exp.Table):
            source = scope.sources.get(node.alias_or_name)
            return source.name if isinstance(source, exp.Table) else None
        return None

    def _filters(self, scope, node, negated, filters, literals):
        while isinstance(node, exp.Paren):
            node = node.this
        if isinstance(node, (exp.And, exp.Or)):
            for side in (node.this, node.expression):
                self._filters(scope, side, negated, filters, literals)
            return
        if isinstance(node, exp.Not):
            self._filters(scope, node.this, not negated, filters, literals)
            return
        if isinstance(node, exp.Column):
            # A bare boolean column: ``WHERE flag`` / ``WHERE NOT flag``.
            operator, operands = ("is false" if negated else "is true"), (node,)
        else:
            operator = OPERATORS.get(type(node))
            if operator is None:
                return
            if negated:
                operator = NEGATED.get(operator) or f"not {operator}"
            operands = (node.this, node.args.get("expression"))
        for side in operands:
            if not isinstance(side, exp.Column):
                continue
            base = self._base_column(scope, side)
            if base is None:
                continue
            entry = {"column": f"{base[0]}.{base[1]}", "operator": operator}
            if entry not in filters:
                filters.append(entry)
            allowed = self.enums.get((base[0].lower(), base[1].lower()))
            if allowed and isinstance(node, (exp.EQ, exp.NEQ, exp.In)):
                values = [
                    node.args.get("expression"),
                    *(node.args.get("expressions") or []),
                ]
                found = {
                    v.this
                    for v in values
                    if isinstance(v, exp.Literal) and v.is_string and v.this in allowed
                }
                if found:
                    literals.setdefault(entry["column"], set()).update(found)

    def _base_column(self, scope, column, depth=0):
        """The ``(model, column)`` a reference reads, followed through derived tables."""
        source = scope.sources.get(column.table)
        if isinstance(source, exp.Table):
            return source.name, column.name
        if isinstance(source, Scope) and depth < 8:
            for child in source.expression.selects:
                if child.alias_or_name == column.name:
                    inner = child.unalias()
                    if isinstance(inner, exp.Column):
                        return self._base_column(source, inner, depth + 1)
        return None

    @staticmethod
    def _projection(expr):
        # Arbitrary strings from instructions/metadata cannot be echoed as cells.
        # Predicates can contain string filters; date units are a closed vocabulary.
        for lit in expr.find_all(exp.Literal):
            if not lit.is_string:
                continue
            parent = lit.parent
            permitted = False
            while parent is not None and parent is not expr:
                if isinstance(parent, (exp.Predicate, exp.Where)):
                    permitted = True
                    break
                if isinstance(parent, (exp.DateTrunc, exp.TimestampTrunc)):
                    permitted = lit.this.lower() in {
                        "day",
                        "week",
                        "month",
                        "quarter",
                        "year",
                        "hour",
                    }
                    break
                parent = parent.parent
            if not permitted:
                raise QueryShapeError("literal_disclosure")
        value = expr.unalias()
        if not list(value.find_all(exp.Column)) and not list(
            value.find_all(exp.AggFunc)
        ):
            raise QueryShapeError("unbacked_result")

        # A null-normalized aggregate multiplied by zero cannot on its own back a
        # source-derived worker result. Keep this deliberately narrow: SQL NULL
        # and non-finite arithmetic mean that not every zero multiplication is a
        # constant-output proof.
        def zero(node):
            return (
                isinstance(node, exp.Literal)
                and not node.is_string
                and Decimal(node.this) == 0
            )

        def normalized_aggregate(node):
            return (
                isinstance(node, exp.Coalesce)
                and isinstance(node.this, exp.AggFunc)
                and len(node.expressions) == 1
                and zero(node.expressions[0])
            )

        neutralized = [
            mul
            for mul in value.find_all(exp.Mul)
            if (
                (zero(mul.this) and normalized_aggregate(mul.expression))
                or (zero(mul.expression) and normalized_aggregate(mul.this))
            )
        ]

        def inside_neutralized(node):
            parent = node
            while parent is not None:
                if any(parent is subtree for subtree in neutralized):
                    return True
                parent = parent.parent
            return False

        if neutralized and not any(
            not inside_neutralized(source)
            for source in [*value.find_all(exp.Column), *value.find_all(exp.AggFunc)]
        ):
            raise QueryShapeError("unbacked_result")
        # Text-producing transforms can synthesize instruction/SQL strings from
        # numeric constants or fragments. Keep textual outputs as source columns.
        blocked = {
            "concat",
            "concatws",
            "replace",
            "substring",
            "timetostr",
            "strtodate",
            "strtotime",
        }
        if any(n.key in blocked for n in value.walk()):
            raise QueryShapeError("text_synthesis")
        for cast in value.find_all(exp.Cast):
            if cast.to.this in {
                exp.DataType.Type.TEXT,
                exp.DataType.Type.VARCHAR,
                exp.DataType.Type.CHAR,
            }:
                raise QueryShapeError("text_cast")

    @staticmethod
    def _leaves(scope):
        """The plain selects behind a statement, first branch first."""
        if scope.union_scopes:
            return [leaf for u in scope.union_scopes for leaf in AdHocSQL._leaves(u)]
        return [scope]

    def _label(self, expr, scope, depth=0):
        if depth > 8:
            return "value"
        expr = expr.unalias()
        if isinstance(expr, exp.Column):
            source = scope.sources.get(expr.table)
            if isinstance(source, exp.Table):
                # Comes from validated, operator-configured model column names.
                return expr.name
            if isinstance(source, Scope):
                for child in source.expression.selects:
                    if child.alias_or_name == expr.name:
                        return self._label(child, source, depth + 1)
            return "value"
        if isinstance(expr, exp.Star):
            return "rows"
        cols = [self._label(c, scope, depth + 1) for c in expr.find_all(exp.Column)]
        operation = {
            "timestamptrunc": "period",
            "datetrunc": "period",
            "count": "count",
        }.get(expr.key, expr.key)
        # Expression class names are parser constants; aliases/literals are omitted.
        return "_".join([operation, *dict.fromkeys(cols)])[:96]

    def execute(self, prepared):
        sql, sources, conditions, labels, checks, observed, unverified = prepared
        table = governed_query(self.project.engine, sql, 101)
        self.project.current()
        if table.num_rows > 100 or len(table.columns) != len(labels):
            raise ValueError("result_limit")
        rows = []
        for raw in zip(*(c.to_pylist() for c in table.columns)):
            row = {}
            for i, v in enumerate(raw):
                if isinstance(v, (date, datetime)):
                    v = v.isoformat()
                elif isinstance(v, Decimal):
                    if not v.is_finite():
                        raise ValueError("unsupported_result")
                    # The runtime also parses JSON in JavaScript. Larger integers
                    # and fractional decimals must cross that wire as exact text.
                    v = (
                        int(v)
                        if v == v.to_integral_value() and abs(v) <= 2**53 - 1
                        else str(v)
                    )
                elif type(v) is int and abs(v) > 2**53 - 1:
                    v = str(v)
                if v is not None and not isinstance(v, (str, int, float, bool)):
                    raise ValueError("unsupported_result")
                if isinstance(v, str) and len(v) > 256:
                    raise ValueError("result_limit")
                if isinstance(v, float) and not math.isfinite(v):
                    raise ValueError("unsupported_result")
                row[f"c{i + 1}"] = v
            rows.append(row)
        result = {
            "kind": "table",
            "columns": [
                {"key": f"c{i + 1}", "label": label} for i, label in enumerate(labels)
            ],
            "rows": rows,
            "mandatory_scope": conditions,
            "timezone": "UTC",
        }
        if len(json.dumps(result).encode()) > 32768:
            raise ValueError("result_limit")
        return result, {
            "sql": sql,
            "sources": sources,
            "checks": checks,
            "observed": observed,
            "unverified": unverified,
        }
