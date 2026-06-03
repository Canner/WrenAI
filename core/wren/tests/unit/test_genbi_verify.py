"""Behavior tests for `wren genbi verify` and `wren genbi open`."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml
from typer.testing import CliRunner

from wren.cli import app

runner = CliRunner()

pytestmark = pytest.mark.unit


def _make_project_with_app(
    tmp_path: Path,
    *,
    register: bool = True,
    data_mode: str = "snapshot",
    index_html: bool = True,
    mdl_json: bool = True,
    data_asset: bool = True,
) -> Path:
    (tmp_path / "wren_project.yml").write_text(
        'schema_version: 2\nname: test_proj\nversion: "1.0"\n'
        "catalog: wren\nschema: public\ndata_source: duckdb\n"
    )
    app_dir = tmp_path / "apps" / "myapp"
    app_dir.mkdir(parents=True)
    if index_html:
        (app_dir / "index.html").write_text("<html><body>GenBI</body></html>")
    if mdl_json:
        (app_dir / "mdl.json").write_text(
            json.dumps({"catalog": "wren", "schema": "public", "models": [{}]})
        )
    if data_asset:
        (app_dir / "data").mkdir()
        (app_dir / "data" / "orders.parquet").write_bytes(b"PAR1fake")
    if register:
        result = runner.invoke(
            app,
            [
                "genbi",
                "register",
                "myapp",
                "--data-mode",
                data_mode,
                "-p",
                str(tmp_path),
            ],
        )
        assert result.exit_code == 0, result.output
    return tmp_path


def _status(project: Path) -> str:
    index = yaml.safe_load((project / ".wren" / "apps.yml").read_text())
    return index["apps"]["myapp"]["status"]


# ── Tracer bullet ──────────────────────────────────────────────────────────


def test_verify_passes_and_flips_status_to_built(tmp_path: Path) -> None:
    project = _make_project_with_app(tmp_path)

    result = runner.invoke(app, ["genbi", "verify", "myapp", "-p", str(project)])

    assert result.exit_code == 0, result.output
    assert _status(project) == "built"


def test_verify_fails_on_missing_index_html(tmp_path: Path) -> None:
    project = _make_project_with_app(tmp_path, index_html=False)

    result = runner.invoke(app, ["genbi", "verify", "myapp", "-p", str(project)])

    assert result.exit_code != 0
    assert "index.html" in result.output
    assert _status(project) == "scaffolded"  # not flipped


def test_verify_fails_on_invalid_mdl_json(tmp_path: Path) -> None:
    project = _make_project_with_app(tmp_path, mdl_json=False)
    (project / "apps" / "myapp" / "mdl.json").write_text("{not json")

    result = runner.invoke(app, ["genbi", "verify", "myapp", "-p", str(project)])

    assert result.exit_code != 0
    assert "mdl.json" in result.output
    assert _status(project) == "scaffolded"


def test_verify_snapshot_requires_data_asset(tmp_path: Path) -> None:
    project = _make_project_with_app(tmp_path, data_asset=False)

    result = runner.invoke(app, ["genbi", "verify", "myapp", "-p", str(project)])

    assert result.exit_code != 0
    assert "data asset" in result.output
    assert _status(project) == "scaffolded"


def test_verify_unregistered_app_errors(tmp_path: Path) -> None:
    project = _make_project_with_app(tmp_path, register=False)

    result = runner.invoke(app, ["genbi", "verify", "myapp", "-p", str(project)])

    assert result.exit_code != 0
    assert "not registered" in result.output


def test_open_unregistered_app_errors(tmp_path: Path) -> None:
    project = _make_project_with_app(tmp_path, register=False)

    result = runner.invoke(app, ["genbi", "open", "myapp", "-p", str(project)])

    assert result.exit_code != 0
    assert "not registered" in result.output
