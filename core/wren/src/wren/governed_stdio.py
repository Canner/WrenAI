"""Host-owned, bounded query transport. No command, path or credential arguments."""

import base64
import json
import os
import sys
from pathlib import Path

from sqlglot import exp, parse_one

from wren.config import load_config
from wren.context import build_json
from wren.engine import WrenEngine
from wren.mdl.cte_rewriter import get_sqlglot_dialect
from wren.model.data_source import DataSource
from wren.profile import expand_profile_secrets, resolve_profile_for_project
from wren.query_semantics import query_semantics

MAX_REQUEST = 65_536
MAX_RESULT = 1_048_576


def serve(project: Path) -> None:
    """Capture one project's manifest, policy and credentials before accepting work."""
    project = project.resolve(strict=True)
    if not (project / "wren_project.yml").is_file():
        raise ValueError("A bound project is required")
    _, profile = resolve_profile_for_project(project, strict=True)
    profile = expand_profile_secrets(profile)
    datasource = profile.pop("datasource")
    manifest = build_json(project)
    encoded = base64.b64encode(json.dumps(manifest).encode()).decode()
    home = Path(os.environ.get("WREN_HOME", Path.home() / ".wren"))
    with WrenEngine(encoded, datasource, profile, config=load_config(home)) as engine:
        _write({"id": 0, "protocol": "wren-governed/1"})
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
                        raise ValueError("Invalid query")
                    result = engine.query(
                        request["sql"], limit=request["limit"], read_only=True
                    )
                    ast = parse_one(
                        request["sql"],
                        dialect=get_sqlglot_dialect(DataSource(datasource)),
                    )
                    aliases = {cte.alias_or_name for cte in ast.find_all(exp.CTE)}
                    definition = {
                        "sql": request["sql"],
                        "source_tables": sorted(
                            {
                                table.name
                                for table in ast.find_all(exp.Table)
                                if table.name not in aliases
                            }
                        ),
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
                    raise ValueError("Unsupported operation")
                _write({"id": request["id"], "result": value})
            except Exception:
                _write({"id": request["id"], "error": "Governed operation failed"})


def _write(value: dict) -> None:
    output = json.dumps(value, default=str, allow_nan=False, separators=(",", ":"))
    if len(output.encode()) > MAX_RESULT:
        raise ValueError("Result exceeds byte limit")
    print(output, flush=True)
