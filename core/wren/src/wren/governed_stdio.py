"""Host-owned, bounded query transport. No command, path or credential arguments."""

import base64
import json
import os
import sys
from pathlib import Path

from sqlglot import exp, parse_one

from wren.agent_project import require_profile_pin
from wren.config import load_config
from wren.context import build_json
from wren.declared_default_check import DefaultsChecker
from wren.declared_defaults import read_declared_defaults
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
    "policy_rejected": (
        "The read-only analytical policy rejected the query: use one SELECT over "
        "the bound models with standard analytical functions only."
    ),
    "invalid_sql": "The SQL could not be parsed or planned against the semantic context.",
    "execution_failed": (
        "The data source rejected the query at execution time, for example an "
        "unknown column or a type mismatch."
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


class _DeclaredDefaultMissing(ValueError):
    """The query breaks declared rules; ``rule_ids`` are project-authored, validated ids."""

    def __init__(self, rule_ids: list[str]) -> None:
        super().__init__("declared default rule not applied")
        self.rule_ids = rule_ids


def classify_error(error: BaseException) -> str:
    """Map an exception to one key of ``ERROR_MESSAGES``; never reads its text."""
    if isinstance(error, _RequestError):
        return "invalid_request"
    if isinstance(error, _ResultTooLarge):
        return "result_too_large"
    if isinstance(error, _DeclaredDefaultMissing):
        return "declared_default_missing"
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


def serve(project: Path) -> None:
    """Capture one project's manifest, policy and credentials before accepting work."""
    project = project.resolve(strict=True)
    if not (project / "wren_project.yml").is_file():
        raise ValueError("A bound project is required")
    require_profile_pin(project)
    _, profile = resolve_profile_for_project(project)
    profile = expand_profile_secrets(profile, project_path=project)
    datasource = profile.pop("datasource")
    manifest = build_json(project)
    dialect = get_sqlglot_dialect(DataSource(datasource))
    declarations = read_declared_defaults(project, manifest)
    checker = DefaultsChecker(declarations, manifest, dialect) if declarations else None
    encoded = base64.b64encode(json.dumps(manifest).encode()).decode()
    home = Path(os.environ.get("WREN_HOME", Path.home() / ".wren"))
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
                    if checker is not None and (fired := checker.check(ast)):
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
                    value = {
                        "columns": result.column_names,
                        "rows": result.to_pylist(),
                        "definition": definition,
                    }
                    semantics = query_semantics(ast, request["sql"], manifest)
                    if semantics is not None:
                        value["semantics"] = semantics
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
    output = json.dumps(value, default=str, allow_nan=False, separators=(",", ":"))
    if len(output.encode()) > MAX_RESULT:
        raise _ResultTooLarge("Result exceeds byte limit")
    print(output, flush=True)
