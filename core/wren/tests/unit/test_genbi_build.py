"""Behavior tests for `wren genbi build` — the instruction composer."""

from __future__ import annotations

from pathlib import Path

import pytest
from typer.testing import CliRunner

from wren.cli import app

runner = CliRunner()

pytestmark = pytest.mark.unit


# ── Helpers ────────────────────────────────────────────────────────────────


def _make_project(tmp_path: Path) -> Path:
    """Minimal valid v2 project with one model and a compiled mdl.json."""
    (tmp_path / "wren_project.yml").write_text(
        'schema_version: 2\nname: test_proj\nversion: "1.0"\n'
        "catalog: wren\nschema: public\ndata_source: duckdb\n"
    )
    model_dir = tmp_path / "models" / "orders"
    model_dir.mkdir(parents=True)
    (model_dir / "metadata.yml").write_text(
        "name: orders\n"
        'table_reference:\n  catalog: ""\n  schema: public\n  table: orders\n'
        "columns:\n"
        "  - name: id\n    type: INTEGER\n    is_calculated: false\n"
        "    not_null: true\n    properties: {}\n"
        "  - name: total\n    type: DECIMAL\n    is_calculated: false\n"
        "    not_null: false\n    properties: {}\n"
        "primary_key: id\ncached: false\nproperties:\n  description: Orders table\n"
    )
    (tmp_path / "relationships.yml").write_text("relationships: []\n")
    target = tmp_path / "target"
    target.mkdir()
    (target / "mdl.json").write_text(
        '{"catalog": "wren", "schema": "public", "models": []}'
    )
    return tmp_path


def _snapshot_tree(root: Path) -> set[str]:
    return {str(p.relative_to(root)) for p in root.rglob("*")}


# ── Tracer bullet ──────────────────────────────────────────────────────────


def test_build_prints_instruction_and_writes_nothing(tmp_path: Path) -> None:
    project = _make_project(tmp_path)
    before = _snapshot_tree(project)

    result = runner.invoke(
        app,
        [
            "genbi",
            "build",
            "myapp",
            "--prompt",
            "show revenue by month",
            "-p",
            str(project),
        ],
    )

    assert result.exit_code == 0, result.output
    # Live project context: MDL path + target folder
    assert str(project / "target" / "mdl.json") in result.output
    assert "apps/myapp" in result.output
    # User prompt verbatim
    assert "show revenue by month" in result.output
    # Pure composer: nothing on disk changed
    assert _snapshot_tree(project) == before


def test_build_includes_model_inventory(tmp_path: Path) -> None:
    project = _make_project(tmp_path)

    result = runner.invoke(
        app, ["genbi", "build", "myapp", "--prompt", "x", "-p", str(project)]
    )

    assert result.exit_code == 0, result.output
    # Model and its columns from the YAML project
    assert "orders" in result.output
    assert "id" in result.output
    assert "total" in result.output
    # Data source type from wren_project.yml
    assert "duckdb" in result.output


def test_build_includes_wasm_wiring_and_final_steps(tmp_path: Path) -> None:
    project = _make_project(tmp_path)

    result = runner.invoke(
        app, ["genbi", "build", "myapp", "--prompt", "x", "-p", str(project)]
    )

    assert result.exit_code == 0, result.output
    # wasm wiring: pinned version + CDN directive (don't bundle ~68MB)
    assert "wren-core-wasm" in result.output
    assert "0.4.1" in result.output
    assert "CDN" in result.output
    # load sequence
    assert "loadMDL" in result.output
    # final steps: register then verify, with the app name filled in
    assert "wren genbi register myapp --data-mode snapshot" in result.output
    assert "wren genbi verify myapp" in result.output


def test_build_snapshot_mode_gives_data_bundling_guidance(tmp_path: Path) -> None:
    project = _make_project(tmp_path)

    result = runner.invoke(
        app,
        [
            "genbi",
            "build",
            "myapp",
            "--prompt",
            "x",
            "--data-mode",
            "snapshot",
            "-p",
            str(project),
        ],
    )

    assert result.exit_code == 0, result.output
    # snapshot: convert data to parquet/duckdb, ship as static asset, query client-side
    assert "parquet" in result.output.lower()
    assert "static" in result.output.lower()


def test_build_rejects_unknown_data_mode(tmp_path: Path) -> None:
    project = _make_project(tmp_path)

    result = runner.invoke(
        app,
        [
            "genbi",
            "build",
            "myapp",
            "--prompt",
            "x",
            "--data-mode",
            "bogus",
            "-p",
            str(project),
        ],
    )

    assert result.exit_code != 0
    assert "data-mode" in result.output or "data_mode" in result.output


def test_build_accepts_prompt_file(tmp_path: Path) -> None:
    project = _make_project(tmp_path)
    prompt_file = tmp_path / "req.txt"
    prompt_file.write_text("multi line\nrequest with 'quotes' and $vars\n")

    result = runner.invoke(
        app,
        [
            "genbi",
            "build",
            "myapp",
            "--prompt-file",
            str(prompt_file),
            "-p",
            str(project),
        ],
    )

    assert result.exit_code == 0, result.output
    assert "multi line" in result.output
    assert "request with 'quotes' and $vars" in result.output


def test_build_reads_prompt_from_stdin(tmp_path: Path) -> None:
    project = _make_project(tmp_path)

    result = runner.invoke(
        app,
        ["genbi", "build", "myapp", "--prompt", "-", "-p", str(project)],
        input="stdin request body\n",
    )

    assert result.exit_code == 0, result.output
    assert "stdin request body" in result.output


def test_build_requires_a_prompt(tmp_path: Path) -> None:
    project = _make_project(tmp_path)

    result = runner.invoke(app, ["genbi", "build", "myapp", "-p", str(project)])

    assert result.exit_code != 0
    assert "prompt" in result.output.lower()


def test_build_compiles_mdl_when_missing(tmp_path: Path) -> None:
    project = _make_project(tmp_path)
    (project / "target" / "mdl.json").unlink()
    (project / "target").rmdir()

    result = runner.invoke(
        app, ["genbi", "build", "myapp", "--prompt", "x", "-p", str(project)]
    )

    assert result.exit_code == 0, result.output
    # mdl was compiled implicitly and the instruction still points at it
    assert (project / "target" / "mdl.json").exists()
    assert str(project / "target" / "mdl.json") in result.output


def test_build_live_mode_gives_connection_guidance_and_hard_rule(
    tmp_path: Path,
) -> None:
    project = _make_project(tmp_path)

    result = runner.invoke(
        app,
        [
            "genbi",
            "build",
            "myapp",
            "--prompt",
            "x",
            "--data-mode",
            "live",
            "-p",
            str(project),
        ],
    )

    assert result.exit_code == 0, result.output
    out = result.output
    # live: connect back to the user's warehouse/API + CORS requirement
    assert "CORS" in out
    assert "connection" in out.lower()
    # hard rule: never inline warehouse credentials into the public app
    assert "credentials" in out.lower()
    assert "never" in out.lower() or "must not" in out.lower()
