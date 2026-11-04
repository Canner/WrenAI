"""Declared default rules: YAML front-matter in ``knowledge/rules/*.md``.

A rules file may open with a ``---`` fenced YAML block whose ``defaults:`` list
declares rules a host can enforce deterministically. Declarations are typed and
closed: nothing is inferred from the rule prose, and an invalid declaration is
an error, never a silent skip. The front-matter itself stays in the rule text a
model reads; this module only reads it.

Three kinds exist:

``exclude_rows``
    Statements that read a covered model must exclude rows where
    ``column = exclude``. Covered models are the anchor model plus every model
    with a chain of MANY_TO_ONE relationships to it.
``require_rate_join``
    Statements that aggregate a listed amount column must read the rate model
    joined on the amount's currency and on-or-before a transaction date. Two optional
    keys tighten it (both checked by ``declared_default_fx``): ``match: single``
    requires the rate source to yield one row per amount row, and ``base_currency``
    names the currency whose amounts need no rate and must survive the join.
``sale_statuses``
    Statements that read the status column's model must keep exactly the declared set of
    status values (``values``) out of the column's full ``domain`` (or, when the declaration
    gives none, the ``enum_values`` the project lists for the column). What counts is the set
    the filter actually retains, computed by ``declared_default_status``; the caller may confirm
    a different set only when ``overridable_by_caller`` is true.

This module parses and validates declarations; ``declared_default_check`` applies
them to a parsed query.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import yaml
from sqlglot import exp, parse_one
from sqlglot.errors import SqlglotError

RULES_DIR = Path("knowledge") / "rules"
LEGACY_RULES_FILE = "instructions.md"
ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
CURRENCY_PATTERN = re.compile(r"^[A-Za-z0-9]{1,16}$")
MAX_DECLARATIONS = 8
KINDS = ("exclude_rows", "require_rate_join", "sale_statuses")
MAX_STATUS_VALUES = 64
_FENCE = "---"


def _declaration_shaped(value):
    return isinstance(value, dict) and "id" in value and "kind" in value


def _duplicate_mapping_key(node, visited=None):
    """Check declaration mappings before YAML construction discards repeated keys."""
    visited = set() if visited is None else visited
    if id(node) in visited:
        return None
    visited.add(id(node))
    if isinstance(node, yaml.MappingNode):
        seen = set()
        for key, value in node.value:
            if isinstance(key, yaml.ScalarNode):
                identity = (key.tag, key.value)
                if identity in seen:
                    return key.value
                seen.add(identity)
            if duplicate := _duplicate_mapping_key(value, visited):
                return duplicate
    elif isinstance(node, yaml.SequenceNode):
        for item in node.value:
            if duplicate := _duplicate_mapping_key(item, visited):
                return duplicate
    return None


class DeclarationError(ValueError):
    """Declared default rules are invalid; ``errors`` holds ``(path, message)`` pairs."""

    def __init__(self, errors: list[tuple[str, str]]) -> None:
        super().__init__(f"{len(errors)} invalid declared default rule(s)")
        self.errors = errors


@dataclass(frozen=True)
class ColumnRef:
    model: str
    column: str


@dataclass(frozen=True)
class ExcludeRows:
    id: str
    column: ColumnRef
    exclude: bool
    anchor: str
    covered: frozenset[str]
    aggregated_only: bool
    addresses_column: bool
    filtered_by: tuple[str, ...]


@dataclass(frozen=True)
class AmountGroup:
    columns: tuple[ColumnRef, ...]
    currency: ColumnRef
    dates: tuple[ColumnRef, ...]


@dataclass(frozen=True)
class RequireRateJoin:
    id: str
    amounts: tuple[AmountGroup, ...]
    rate_model: str
    rate_currency: ColumnRef
    rate_date: ColumnRef
    aggregated_only: bool
    groups_by_currency: bool
    filters_currency_literal: bool
    base_currency: str | None = None
    match: Literal["single"] | None = None


@dataclass(frozen=True)
class SaleStatuses:
    """Status values a statement must keep. ``values`` and ``domain`` keep the declared case;
    comparisons fold it (``fold``)."""

    id: str
    column: ColumnRef
    values: tuple[str, ...]
    domain: tuple[str, ...]
    overridable_by_caller: bool
    aggregated_only: bool


Declaration = ExcludeRows | RequireRateJoin | SaleStatuses


def fold(value: str) -> str:
    """The comparison form of a status value."""
    return value.casefold()


def split_front_matter(text: str) -> tuple[str | None, str]:
    """Split a leading ``---`` fenced block from ``text``.

    Returns ``(yaml_text, body)``; ``yaml_text`` is None when the file does not
    open with a fence. A fence that never closes is reported by the caller as an
    error because silently ignoring it would disable enforcement.
    """
    lines = text.lstrip("﻿").lstrip().splitlines()
    if not lines or lines[0].rstrip() != _FENCE:
        return None, text
    for index in range(1, len(lines)):
        if lines[index].rstrip() == _FENCE:
            return "\n".join(lines[1:index]), "\n".join(lines[index + 1 :])
    raise ValueError("front-matter is not closed by a '---' line")


def _rules_files(project_path: Path) -> list[Path]:
    """The files ``load_rules`` reads, in the same order."""
    files: list[Path] = []
    rules_dir = project_path / RULES_DIR
    if rules_dir.is_dir():
        files.extend(
            sorted(
                path for path in rules_dir.glob("*.md") if not path.name.startswith(".")
            )
        )
    legacy = project_path / LEGACY_RULES_FILE
    if legacy.is_file():
        files.append(legacy)
    return files


def models_of(manifest: dict) -> dict[str, set[str]]:
    models: dict[str, set[str]] = {}
    for item in manifest.get("models") or []:
        if isinstance(item, dict) and isinstance(item.get("name"), str):
            columns = item.get("columns")
            models[item["name"]] = {
                column["name"]
                for column in (columns if isinstance(columns, list) else [])
                if isinstance(column, dict) and isinstance(column.get("name"), str)
            }
    return models


def enums_of(manifest: dict) -> dict[tuple[str, str], tuple[str, ...]]:
    """``(model, column) -> values`` for every column that lists ``enum_values``.

    Reads the column ``properties`` of a manifest in either key spelling; a mapping lists its
    keys, a list lists each item's ``value``. Values are text.
    """
    found: dict[tuple[str, str], tuple[str, ...]] = {}
    for item in manifest.get("models") or []:
        if not (isinstance(item, dict) and isinstance(item.get("name"), str)):
            continue
        for column in item.get("columns") or []:
            if not (isinstance(column, dict) and isinstance(column.get("name"), str)):
                continue
            properties = column.get("properties")
            if not isinstance(properties, dict):
                continue
            raw = properties.get("enum_values", properties.get("enumValues"))
            values: list[str] = []
            if isinstance(raw, dict):
                values = [str(key) for key in raw]
            elif isinstance(raw, list):
                for entry in raw:
                    value = entry.get("value") if isinstance(entry, dict) else entry
                    if value is not None and not isinstance(value, (dict, list)):
                        values.append(str(value))
            if values:
                found[(item["name"], column["name"])] = tuple(values)
    return found


def many_to_one_edges(manifest: dict) -> list[tuple[str, str]]:
    """``(many, one)`` model pairs of every MANY_TO_ONE relationship."""
    edges: list[tuple[str, str]] = []
    for item in manifest.get("relationships") or []:
        if not isinstance(item, dict):
            continue
        join_type = item.get("joinType", item.get("join_type"))
        pair = item.get("models")
        if (
            isinstance(join_type, str)
            and join_type.casefold() == "many_to_one"
            and isinstance(pair, list)
            and len(pair) == 2
            and all(isinstance(name, str) for name in pair)
        ):
            edges.append((pair[0], pair[1]))
    return edges


def covered_models(
    anchor: str,
    edges: list[tuple[str, str]],
    except_models: frozenset[str] = frozenset(),
) -> frozenset[str]:
    """The anchor plus every model reaching it through MANY_TO_ONE chains.

    An excepted model is neither covered nor traversed, so a model reachable
    only through it is not covered either.
    """
    covered = {anchor}
    changed = True
    while changed:
        changed = False
        for many, one in edges:
            if one in covered and many not in covered and many not in except_models:
                covered.add(many)
                changed = True
    return frozenset(covered)


class _Parser:
    def __init__(
        self,
        manifest: dict,
        enums: dict[tuple[str, str], tuple[str, ...]] | None = None,
    ) -> None:
        self.models = models_of(manifest)
        self.enums = {**enums_of(manifest), **(enums or {})}
        self.edges = many_to_one_edges(manifest)
        self.errors: list[tuple[str, str]] = []
        self.ids: set[str] = set()
        self.declarations: list[Declaration] = []

    def error(self, path: str, message: str) -> None:
        self.errors.append((path, message))

    def column(self, path: str, value: object, label: str) -> ColumnRef | None:
        if not isinstance(value, str) or value.count(".") != 1:
            self.error(path, f"{label} must be '<model>.<column>'")
            return None
        model, column = value.split(".")
        if model not in self.models:
            self.error(path, f"{label} references unknown model '{model}'")
            return None
        if column not in self.models[model]:
            self.error(path, f"{label} references unknown column '{value}'")
            return None
        return ColumnRef(model, column)

    def columns(self, path: str, value: object, label: str) -> tuple[ColumnRef, ...]:
        if not isinstance(value, list) or not value:
            self.error(path, f"{label} must be a non-empty list of '<model>.<column>'")
            return ()
        refs = [self.column(path, item, label) for item in value]
        return tuple(ref for ref in refs if ref is not None)

    def check_keys(self, path: str, item: dict, allowed: set[str]) -> None:
        for key in item:
            if key not in allowed:
                self.error(path, f"unknown field '{key}'")

    def when(self, path: str, item: dict) -> bool:
        value = item.get("when")
        if value is None:
            return False
        if value != "aggregated":
            self.error(path, "'when' must be 'aggregated' when present")
        return value == "aggregated"

    def unless(
        self, path: str, item: dict, flags: set[str], allow_filtered_by: bool
    ) -> tuple[set[str], list[str]]:
        used: set[str] = set()
        atoms: list[str] = []
        entries = item.get("unless")
        if entries is None:
            return used, atoms
        if not isinstance(entries, list):
            self.error(path, "'unless' must be a list")
            return used, atoms
        for entry in entries:
            if isinstance(entry, str) and entry in flags:
                used.add(entry)
            elif (
                allow_filtered_by
                and isinstance(entry, dict)
                and set(entry) == {"filtered_by"}
                and isinstance(entry["filtered_by"], str)
            ):
                if self.atom_is_valid(path, entry["filtered_by"]):
                    atoms.append(entry["filtered_by"])
            else:
                self.error(path, f"unsupported 'unless' entry {entry!r} for this kind")
        return used, atoms

    def atom_is_valid(self, path: str, atom: str) -> bool:
        try:
            node = parse_one(atom)
        except SqlglotError:
            self.error(path, f"filtered_by atom {atom!r} is not valid SQL")
            return False
        columns = list(node.find_all(exp.Column))
        if not columns:
            self.error(path, f"filtered_by atom {atom!r} references no column")
            return False
        for column in columns:
            if not column.table or column.table not in self.models:
                self.error(
                    path,
                    f"filtered_by atom {atom!r} must qualify every column "
                    "with a model name",
                )
                return False
            if column.name not in self.models[column.table]:
                self.error(
                    path,
                    f"filtered_by atom {atom!r} references unknown column "
                    f"'{column.table}.{column.name}'",
                )
                return False
        return True

    def exclude_rows(self, path: str, item: dict, rule_id: str) -> None:
        self.check_keys(
            path,
            item,
            {"id", "kind", "column", "exclude", "covers", "when", "unless"},
        )
        column = self.column(path, item.get("column"), "column")
        exclude = item.get("exclude")
        if type(exclude) is not bool:
            self.error(path, "'exclude' must be true or false")
        covers = item.get("covers")
        anchor = None
        except_models: frozenset[str] = frozenset()
        if not isinstance(covers, dict):
            self.error(path, "'covers' must be a mapping")
        else:
            self.check_keys(
                f"{path} > covers", covers, {"reaching", "via", "except_models"}
            )
            anchor = covers.get("reaching")
            if not isinstance(anchor, str) or anchor not in self.models:
                self.error(path, "covers.reaching must name a model")
                anchor = None
            if covers.get("via") != "many_to_one":
                self.error(path, "covers.via must be 'many_to_one'")
            excepted = covers.get("except_models", [])
            if not isinstance(excepted, list) or any(
                not isinstance(name, str) or name not in self.models
                for name in excepted
            ):
                self.error(path, "covers.except_models must list model names")
            else:
                except_models = frozenset(excepted)
            if anchor in except_models:
                self.error(path, "covers.except_models must not list the anchor")
        used, atoms = self.unless(
            path, item, {"addresses_column"}, allow_filtered_by=True
        )
        aggregated_only = self.when(path, item)
        if column is None or type(exclude) is not bool or anchor is None:
            return
        covered = covered_models(anchor, self.edges, except_models)
        if column.model not in covered:
            self.error(path, f"column '{column.model}.{column.column}' is not covered")
            return
        self.declarations.append(
            ExcludeRows(
                id=rule_id,
                column=column,
                exclude=exclude,
                anchor=anchor,
                covered=covered,
                aggregated_only=aggregated_only,
                addresses_column="addresses_column" in used,
                filtered_by=tuple(atoms),
            )
        )

    def require_rate_join(self, path: str, item: dict, rule_id: str) -> None:
        self.check_keys(
            path,
            item,
            {
                "id",
                "kind",
                "amounts",
                "rate",
                "when",
                "unless",
                "base_currency",
                "match",
            },
        )
        base_currency = item.get("base_currency")
        if base_currency is not None and not (
            isinstance(base_currency, str) and CURRENCY_PATTERN.fullmatch(base_currency)
        ):
            self.error(path, f"'base_currency' must match {CURRENCY_PATTERN.pattern}")
            base_currency = None
        match = item.get("match")
        if match is not None and match != "single":
            self.error(path, "'match' must be 'single' when present")
            match = None
        groups: list[AmountGroup] = []
        amounts = item.get("amounts")
        if not isinstance(amounts, list) or not amounts:
            self.error(path, "'amounts' must be a non-empty list")
            amounts = []
        for position, amount in enumerate(amounts):
            where = f"{path} > amounts[{position}]"
            if not isinstance(amount, dict):
                self.error(where, "amount entry must be a mapping")
                continue
            self.check_keys(where, amount, {"columns", "currency", "dates"})
            columns = self.columns(where, amount.get("columns"), "columns")
            currency = self.column(where, amount.get("currency"), "currency")
            dates = self.columns(where, amount.get("dates"), "dates")
            if columns and currency is not None and dates:
                groups.append(AmountGroup(columns, currency, dates))
        rate = item.get("rate")
        rate_currency = rate_date = None
        rate_model = None
        if not isinstance(rate, dict):
            self.error(path, "'rate' must be a mapping")
        else:
            self.check_keys(
                f"{path} > rate", rate, {"model", "currency", "date", "match"}
            )
            rate_model = rate.get("model")
            if not isinstance(rate_model, str) or rate_model not in self.models:
                self.error(path, "rate.model must name a model")
                rate_model = None
            rate_currency = self.column(path, rate.get("currency"), "rate.currency")
            rate_date = self.column(path, rate.get("date"), "rate.date")
            if rate_currency is not None and rate_currency.model != rate_model:
                self.error(path, "rate.currency must belong to the rate model")
                rate_currency = None
            if rate_date is not None and rate_date.model != rate_model:
                self.error(path, "rate.date must belong to the rate model")
                rate_date = None
            if rate.get("match") != "on_or_before":
                self.error(path, "rate.match must be 'on_or_before'")
        used, _ = self.unless(
            path,
            item,
            {"groups_by_currency", "filters_currency_literal"},
            allow_filtered_by=False,
        )
        aggregated_only = self.when(path, item)
        if (
            len(groups) != len(amounts)
            or not groups
            or rate_model is None
            or rate_currency is None
            or rate_date is None
        ):
            return
        self.declarations.append(
            RequireRateJoin(
                id=rule_id,
                amounts=tuple(groups),
                rate_model=rate_model,
                rate_currency=rate_currency,
                rate_date=rate_date,
                aggregated_only=aggregated_only,
                groups_by_currency="groups_by_currency" in used,
                filters_currency_literal="filters_currency_literal" in used,
                base_currency=base_currency,
                match=match,
            )
        )

    def status_values(self, path: str, value: object, label: str) -> tuple[str, ...]:
        if (
            not isinstance(value, list)
            or not value
            or len(value) > MAX_STATUS_VALUES
            or not all(isinstance(v, str) and v.strip() and len(v) <= 64 for v in value)
        ):
            self.error(
                path,
                f"{label} must be a non-empty list of at most {MAX_STATUS_VALUES} "
                "non-empty strings",
            )
            return ()
        if len({fold(v) for v in value}) != len(value):
            self.error(path, f"{label} lists a value twice (case is ignored)")
            return ()
        return tuple(value)

    def sale_statuses(self, path: str, item: dict, rule_id: str) -> None:
        self.check_keys(
            path,
            item,
            {
                "id",
                "kind",
                "column",
                "values",
                "domain",
                "overridable_by_caller",
                "when",
            },
        )
        column = self.column(path, item.get("column"), "column")
        values = self.status_values(path, item.get("values"), "values")
        overridable = item.get("overridable_by_caller", False)
        if type(overridable) is not bool:
            self.error(path, "'overridable_by_caller' must be true or false")
            overridable = False
        aggregated_only = self.when(path, item)
        domain: tuple[str, ...] = ()
        if column is not None:
            if item.get("domain") is not None:
                domain = self.status_values(path, item.get("domain"), "domain")
            else:
                listed = self.enums.get((column.model, column.column), ())
                domain = tuple(listed)
                if not domain:
                    self.error(
                        path,
                        "no 'domain' and the column lists no enum_values: the full "
                        "value domain is unknown",
                    )
                elif len({fold(v) for v in domain}) != len(domain):
                    self.error(path, "enum_values list a value twice (case is ignored)")
                    domain = ()
        if column is None or not values or not domain:
            return
        if not {fold(v) for v in values} <= {fold(v) for v in domain}:
            self.error(path, "values must all belong to the domain")
            return
        self.declarations.append(
            SaleStatuses(
                id=rule_id,
                column=column,
                values=values,
                domain=domain,
                overridable_by_caller=overridable,
                aggregated_only=aggregated_only,
            )
        )

    def file(self, project_path: Path, file: Path) -> None:
        label = file.relative_to(project_path).as_posix()
        text = file.read_text(encoding="utf-8")
        try:
            front, _ = split_front_matter(text)
        except ValueError as error:
            self.error(label, str(error))
            return
        if front is None:
            return
        try:
            loader = yaml.SafeLoader(front)
            try:
                node = loader.get_single_node()
                if isinstance(node, yaml.MappingNode):
                    seen_defaults = False
                    for key, _ in node.value:
                        if (
                            key.tag != "tag:yaml.org,2002:str"
                            or key.value != "defaults"
                        ):
                            continue
                        if seen_defaults:
                            self.error(label, "duplicate top-level key 'defaults'")
                            return
                        seen_defaults = True
                    # Preserve YAML merge overrides, then inspect only the
                    # effective declaration envelope, including inherited ones.
                    loader.flatten_mapping(node)
                    for key, value in reversed(node.value):
                        if (
                            key.tag == "tag:yaml.org,2002:str"
                            and key.value == "defaults"
                        ):
                            if duplicate := _duplicate_mapping_key(value):
                                self.error(
                                    label, f"duplicate key '{duplicate}' in defaults"
                                )
                                return
                            break
                data = loader.construct_document(node) if node is not None else None
            finally:
                loader.dispose()
        except yaml.YAMLError:
            self.error(label, "front-matter is not valid YAML")
            return
        if isinstance(data, list) and any(_declaration_shaped(item) for item in data):
            self.error(label, "declarations require a mapping with a 'defaults' list")
            return
        if (
            isinstance(data, dict)
            and "defaults" not in data
            and any(
                isinstance(value, list)
                and any(_declaration_shaped(item) for item in value)
                for value in data.values()
            )
        ):
            self.error(label, "declarations must be under the 'defaults' key")
            return
        if not isinstance(data, dict) or "defaults" not in data:
            return
        entries = data["defaults"]
        if not isinstance(entries, list):
            self.error(label, "'defaults' must be a list")
            return
        for position, item in enumerate(entries):
            path = f"{label} > defaults[{position}]"
            if not isinstance(item, dict):
                self.error(path, "declaration must be a mapping")
                continue
            rule_id = item.get("id")
            if not isinstance(rule_id, str) or not ID_PATTERN.fullmatch(rule_id):
                self.error(path, f"'id' must match {ID_PATTERN.pattern}")
                continue
            if rule_id in self.ids:
                self.error(path, f"duplicate id '{rule_id}'")
                continue
            self.ids.add(rule_id)
            kind = item.get("kind")
            if kind == "exclude_rows":
                self.exclude_rows(path, item, rule_id)
            elif kind == "require_rate_join":
                self.require_rate_join(path, item, rule_id)
            elif kind == "sale_statuses":
                self.sale_statuses(path, item, rule_id)
            else:
                self.error(path, f"unknown kind; expected one of {', '.join(KINDS)}")


def load_declarations(
    project_path: Path,
    manifest: dict,
    enums: dict[tuple[str, str], tuple[str, ...]] | None = None,
) -> tuple[list[Declaration], list[tuple[str, str]]]:
    """Parse and validate every declaration against the manifest.

    Returns the declarations and the ``(path, message)`` errors; any error voids
    the declarations (a partial rule set must never be enforced), and a project
    with no front-matter yields ``([], [])``. ``enums`` overrides what the manifest lists
    for a column's values (the catalog's ``enum_values``, when the caller has the catalog).
    """
    parser = _Parser(manifest, enums)
    for file in _rules_files(project_path):
        parser.file(project_path, file)
    if len(parser.ids) > MAX_DECLARATIONS:
        parser.error(
            "knowledge/rules",
            f"at most {MAX_DECLARATIONS} declared default rules are supported",
        )
    return ([] if parser.errors else parser.declarations), parser.errors


def read_declared_defaults(
    project_path: Path,
    manifest: dict,
    enums: dict[tuple[str, str], tuple[str, ...]] | None = None,
) -> list[Declaration]:
    """The project's declarations; any invalid one raises ``DeclarationError``."""
    declarations, errors = load_declarations(project_path, manifest, enums)
    if errors:
        raise DeclarationError(errors)
    return declarations
