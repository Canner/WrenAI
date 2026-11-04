"""Host-owned, bounded query transport. No command, path or credential arguments."""

import base64
import json
import math
import os
import sys
from pathlib import Path

import pyarrow as pa
import yaml
from sqlglot import exp, parse_one

from wren.agent_project import require_profile_pin
from wren.config import load_config
from wren.context import build_json
from wren.context_adapter import _mentions_denied_key
from wren.declared_default_check import DefaultsChecker
from wren.declared_defaults import (
    _rules_files,
    read_declared_defaults,
    split_front_matter,
)
from wren.engine import WrenEngine
from wren.mdl.cte_rewriter import get_sqlglot_dialect
from wren.model.data_source import DataSource
from wren.model.error import ErrorCode, ErrorPhase, WrenError
from wren.profile import expand_profile_secrets, resolve_profile_for_project
from wren.query_semantics import cubes_read_as_tables, query_semantics
from wren.read_only import NoSourceTablesError, require_source_tables

MAX_REQUEST = 65_536
MAX_RESULT = 1_048_576
PROTOCOL = "wren-governed/2"
# Only a project that declares default rules speaks this protocol; every other
# project keeps the two-key ``wren-governed/2`` hello byte for byte.
DECLARED_PROTOCOL = "wren-governed/3"

# The closed error vocabulary a host may show a model. Each class carries one
# fixed sentence; nothing from the underlying exception (its text, the SQL, a
# path, a credential, a stack frame) is ever copied into a frame.
ERROR_MESSAGES: dict[str, str] = {
    "invalid_request": "The request did not match the governed operation contract.",
    "model_not_found": (
        "The query references a table that is not a model in the bound semantic "
        "context; query only the models it defines."
    ),
    "cube_not_queryable": (
        "The query reads a cube as if it were a table. A cube is a semantic "
        "definition (a base model plus measure and dimension expressions), not "
        "a SQL table; query the cube's base model instead and compute the "
        "measure from the cube definition's expression over the base model's "
        "columns."
    ),
    "ungrounded_literal": (
        "The query reads no bound model, so the values it returns are literals "
        "typed into the query, not data. A value must come from an executed query "
        "over the bound models: cite the earlier query that already produced it by "
        "its query_id, or compute it in one SELECT over the models."
    ),
    "declared_default_missing": (
        "The query does not apply a default rule that the bound project declares "
        "for the models it reads, so it was not executed. Apply the rule named "
        "below (its wording is in the project's knowledge rules), then run the "
        "query again."
    ),
    "declared_default_undetermined": (
        "The query was not executed because the host could not check it against "
        "the project's declared default rules. Rewrite the SQL using plain "
        "references to bound models and columns."
    ),
    "policy_rejected": (
        "The read-only analytical policy rejected the query: use one SELECT over "
        "the bound models with standard analytical functions only."
    ),
    "invalid_sql": "The SQL could not be parsed or planned against the semantic context.",
    "execution_failed": (
        "The query could not produce a supported result, for example a data-source "
        "execution error or a non-finite numeric value."
    ),
    "timeout": "The query exceeded the statement time limit.",
    "datasource_unavailable": "The bound data source could not be reached.",
    "result_too_large": "The result exceeded the governed byte limit; narrow the query.",
    "internal": "The governed operation failed for an unclassified reason.",
}

_INVALID_SQL_CODES = frozenset({ErrorCode.INVALID_SQL, ErrorCode.SQLGLOT_ERROR})
_INVALID_SQL_PHASES = frozenset(
    {
        ErrorPhase.SQL_PARSING,
        ErrorPhase.SQL_PLANNING,
        ErrorPhase.SQL_TRANSPILE,
        ErrorPhase.SQL_SUBSTITUTE,
        ErrorPhase.MDL_EXTRACTION,
    }
)
_DATASOURCE_CODES = frozenset(
    {
        ErrorCode.GET_CONNECTION_ERROR,
        ErrorCode.INVALID_CONNECTION_INFO,
        ErrorCode.DUCKDB_FILE_NOT_FOUND,
        ErrorCode.ATTACH_DUCKDB_ERROR,
    }
)


class _RequestError(ValueError):
    """The frame itself violates the contract; the engine was never consulted."""


class _ResultTooLarge(ValueError):
    """A well-formed result that does not fit the byte limit."""


class _UnsupportedResult(ValueError):
    """The query produced a value that the governed transport cannot represent."""


def _json_text(value):
    return json.dumps(value, default=str, allow_nan=False, separators=(",", ":"))


def _copy_remaining(value, budget):
    """Check logical Arrow values before constructing a Python row.

    Buffers remain Arrow views here. In particular, a large string or a list of
    nulls cannot trigger an oversized ``as_py``/``to_pylist`` allocation. This
    does not constrain allocations already made inside the connector.
    """
    kind = value.type
    if not value.is_valid:
        budget -= 4
    elif pa.types.is_dictionary(kind) or pa.types.is_union(kind):
        return _copy_remaining(value.value, budget)
    elif pa.types.is_struct(kind):
        budget -= 2
        for index, field in enumerate(kind):
            budget -= len(field.name.encode()) + 3 + bool(index)
            budget = _copy_remaining(value[index], budget)
    elif pa.types.is_map(kind):
        pairs = value.values
        if len(pairs) > budget:
            raise _ResultTooLarge
        budget -= 2
        for index, pair in enumerate(pairs):
            budget = _copy_remaining(pair[0], budget - 3 - bool(index))
            budget = _copy_remaining(pair[1], budget)
    elif any(
        check(kind)
        for check in (
            pa.types.is_list,
            pa.types.is_large_list,
            pa.types.is_fixed_size_list,
            getattr(pa.types, "is_list_view", lambda _: False),
            getattr(pa.types, "is_large_list_view", lambda _: False),
        )
    ):
        values = value.values
        if len(values) > budget:
            raise _ResultTooLarge
        budget -= 2
        for index, item in enumerate(values):
            budget = _copy_remaining(item, budget - bool(index))
    elif hasattr(value, "as_buffer"):
        budget -= value.as_buffer().size + 2
    elif pa.types.is_floating(kind):
        if not math.isfinite(value.as_py()):
            raise _UnsupportedResult
        budget -= 1
    else:
        budget -= 1
    if budget < 0:
        raise _ResultTooLarge
    return budget


def _query_result(table, definition, semantics, ident):
    columns, names_size = [], 0
    for field in table.schema:
        names_size += len(field.name.encode()) + 3
        if names_size > MAX_RESULT:
            raise _ResultTooLarge
        columns.append(field.name)
    value = {"columns": columns, "rows": [], "definition": definition}
    if semantics is not None:
        value["semantics"] = semantics
    used = len(_json_text({"id": ident, "result": value}).encode())
    if used > MAX_RESULT:
        raise _ResultTooLarge
    copy_budget = MAX_RESULT - used
    row_keys = (
        sum(len(name.encode()) + 3 for name in columns) + max(0, len(columns) - 1) + 2
    )
    for batch in table.to_batches(max_chunksize=1):
        if not batch.num_rows:
            continue
        copy_budget -= row_keys + bool(value["rows"])
        for column in batch.columns:
            copy_budget = _copy_remaining(column[0], copy_budget)
        row = batch.to_pylist()[0]
        used += len(_json_text(row).encode()) + bool(value["rows"])
        if used > MAX_RESULT:
            raise _ResultTooLarge
        value["rows"].append(row)
    return value


class _DeclaredDefaultMissing(ValueError):
    """The query breaks declared rules; ``rule_ids`` are project-authored, validated ids."""

    def __init__(self, rule_ids: list[str]) -> None:
        super().__init__("declared default rule not applied")
        self.rule_ids = rule_ids


class _DeclaredDefaultUndetermined(ValueError):
    """The checker could not determine whether the SQL satisfies declared rules."""


def classify_error(error: BaseException) -> str:
    """Map an exception to one key of ``ERROR_MESSAGES``; never reads its text."""
    if isinstance(error, _RequestError):
        return "invalid_request"
    if isinstance(error, _ResultTooLarge):
        return "result_too_large"
    if isinstance(error, _UnsupportedResult):
        return "execution_failed"
    if isinstance(error, _DeclaredDefaultMissing):
        return "declared_default_missing"
    if isinstance(error, _DeclaredDefaultUndetermined):
        return "declared_default_undetermined"
    if isinstance(error, NoSourceTablesError):
        return "ungrounded_literal"
    if isinstance(error, WrenError):
        code, phase = error.error_code, error.phase
        if code is ErrorCode.MODEL_NOT_FOUND:
            return "model_not_found"
        if code is ErrorCode.DATABASE_TIMEOUT:
            return "timeout"
        if code is ErrorCode.BLOCKED_FUNCTION or phase is ErrorPhase.SQL_POLICY_CHECK:
            return "policy_rejected"
        if code in _DATASOURCE_CODES:
            return "datasource_unavailable"
        if code in _INVALID_SQL_CODES or phase in _INVALID_SQL_PHASES:
            return "invalid_sql"
        if phase in (ErrorPhase.SQL_EXECUTION, ErrorPhase.SQL_DRY_RUN):
            return "execution_failed"
        return "internal"
    # sqlglot raises its own ParseError from the definition/semantics parse.
    if type(error).__module__.startswith("sqlglot"):
        return "invalid_sql"
    return "internal"


def _require_legacy_policy_support(project: Path) -> None:
    """Refuse declarations this legacy transport cannot enforce, without a loader."""
    message = (
        "Legacy governed-stdio cannot enforce project denied-column policy. "
        "Use 'wren serve mcp --service-config <config>' instead."
    )
    for path in _rules_files(project):
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            raise ValueError(message) from None
        try:
            front, _ = split_front_matter(text)
        except ValueError:
            # Leave unrelated malformed default rules to their existing diagnostic.
            if _mentions_denied_key(text):
                raise ValueError(message) from None
            continue
        candidate = text if front is None else front
        if _mentions_denied_key(candidate):
            raise ValueError(message)
        if front is not None:
            try:
                data = yaml.safe_load(front)
            except yaml.YAMLError:
                continue
            # YAML escapes and aliases must not hide a declaration from the guard.
            if _mentions_denied_key(yaml.safe_dump(data, allow_unicode=True)):
                raise ValueError(message)


def serve(project: Path) -> None:
    """Capture one project's manifest, policy and credentials before accepting work."""
    project = project.resolve(strict=True)
    if not (project / "wren_project.yml").is_file():
        raise ValueError("A bound project is required")
    _require_legacy_policy_support(project)
    require_profile_pin(project)
    _, profile = resolve_profile_for_project(project)
    profile = expand_profile_secrets(profile, project_path=project)
    datasource = profile.pop("datasource")
    manifest = build_json(project)
    dialect = get_sqlglot_dialect(DataSource(datasource))
    declarations = read_declared_defaults(project, manifest)
    checker = DefaultsChecker(declarations, manifest, dialect) if declarations else None
    encoded = base64.b64encode(json.dumps(manifest).encode()).decode()
    home = Path(os.environ.get("WREN_HOME", Path.home() / ".wren")).expanduser()
    with WrenEngine(encoded, datasource, profile, config=load_config(home)) as engine:
        if checker is None:
            _write({"id": 0, "protocol": PROTOCOL})
        else:
            _write(
                {
                    "id": 0,
                    "protocol": DECLARED_PROTOCOL,
                    "declared_defaults": checker.ids,
                }
            )
        expected_id = 1
        while True:
            line = sys.stdin.buffer.readline(MAX_REQUEST + 1)
            if not line:
                return
            if len(line) > MAX_REQUEST or not line.endswith(b"\n"):
                return
            request = json.loads(line)
            if not isinstance(request, dict) or request.get("id") != expected_id:
                return
            expected_id += 1
            source_tables: list[str] = []
            try:
                if request.get("operation") == "inspect" and set(request) == {
                    "id",
                    "operation",
                }:
                    value = manifest
                elif request.get("operation") == "query" and set(request) == {
                    "id",
                    "operation",
                    "sql",
                    "limit",
                }:
                    if (
                        not isinstance(request["sql"], str)
                        or type(request["limit"]) is not int
                        or not 1 <= request["limit"] <= 10_000
                    ):
                        raise _RequestError("Invalid query")
                    ast = parse_one(request["sql"], dialect=dialect)
                    if any(
                        table.db or table.catalog for table in ast.find_all(exp.Table)
                    ):
                        raise WrenError(
                            ErrorCode.MODEL_NOT_FOUND,
                            "Query only unqualified bound models.",
                            phase=ErrorPhase.SQL_POLICY_CHECK,
                        )
                    source_tables = require_source_tables(ast)
                    if checker is not None:
                        fired = checker.check(ast)
                        if fired is None:
                            raise _DeclaredDefaultUndetermined
                        if fired:
                            raise _DeclaredDefaultMissing(fired)
                    result = engine.query(
                        request["sql"], limit=request["limit"], read_only=True
                    )
                    definition = {
                        "sql": request["sql"],
                        "source_tables": source_tables,
                        "filters": [
                            clause.this.sql() for clause in ast.find_all(exp.Where)
                        ],
                    }
                    semantics = query_semantics(ast, request["sql"], manifest)
                    value = _query_result(result, definition, semantics, request["id"])
                else:
                    raise _RequestError("Unsupported operation")
                _write({"id": request["id"], "result": value})
            except Exception as error:
                kind = classify_error(error)
                if kind == "model_not_found" and cubes_read_as_tables(
                    source_tables, manifest
                ):
                    kind = "cube_not_queryable"
                detail = {"class": kind, "message": ERROR_MESSAGES[kind]}
                if isinstance(error, _DeclaredDefaultMissing):
                    detail["rule_ids"] = error.rule_ids
                _write({"id": request["id"], "error": detail})


def _write(value: dict) -> None:
    output = _json_text(value)
    if len(output.encode()) > MAX_RESULT:
        raise _ResultTooLarge("Result exceeds byte limit")
    print(output, flush=True)
