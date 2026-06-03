"""Behavior tests for the app index — `wren genbi register/list/remove`."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from typer.testing import CliRunner

from wren.cli import app

runner = CliRunner()

pytestmark = pytest.mark.unit


def _make_project(tmp_path: Path, *, with_app: str | None = None) -> Path:
    (tmp_path / "wren_project.yml").write_text(
        'schema_version: 2\nname: test_proj\nversion: "1.0"\n'
        "catalog: wren\nschema: public\ndata_source: duckdb\n"
    )
    if with_app:
        app_dir = tmp_path / "apps" / with_app
        app_dir.mkdir(parents=True)
        (app_dir / "index.html").write_text("<html></html>")
    return tmp_path


# ── Tracer bullet ──────────────────────────────────────────────────────────


def test_register_writes_index_entry(tmp_path: Path) -> None:
    project = _make_project(tmp_path, with_app="myapp")

    result = runner.invoke(
        app,
        ["genbi", "register", "myapp", "--data-mode", "snapshot", "-p", str(project)],
    )

    assert result.exit_code == 0, result.output
    index = yaml.safe_load((project / ".wren" / "apps.yml").read_text())
    entry = index["apps"]["myapp"]
    assert entry["source"] == "apps/myapp"
    assert entry["data_mode"] == "snapshot"
    assert entry["status"] == "scaffolded"


def test_register_requires_app_dir_on_disk(tmp_path: Path) -> None:
    project = _make_project(tmp_path)  # no app written

    result = runner.invoke(app, ["genbi", "register", "ghost", "-p", str(project)])

    assert result.exit_code != 0
    assert "no app found" in result.output.lower()
    assert not (project / ".wren" / "apps.yml").exists()


def test_register_is_idempotent_update(tmp_path: Path) -> None:
    project = _make_project(tmp_path, with_app="myapp")

    r1 = runner.invoke(app, ["genbi", "register", "myapp", "-p", str(project)])
    r2 = runner.invoke(
        app,
        ["genbi", "register", "myapp", "--data-mode", "live", "-p", str(project)],
    )

    assert r1.exit_code == 0 and r2.exit_code == 0
    index = yaml.safe_load((project / ".wren" / "apps.yml").read_text())
    assert list(index["apps"].keys()) == ["myapp"]  # no duplicate
    assert index["apps"]["myapp"]["data_mode"] == "live"  # updated


def test_list_shows_registered_apps(tmp_path: Path) -> None:
    project = _make_project(tmp_path, with_app="myapp")
    app2 = project / "apps" / "other"
    app2.mkdir()
    (app2 / "index.html").write_text("<html></html>")
    runner.invoke(app, ["genbi", "register", "myapp", "-p", str(project)])
    runner.invoke(
        app, ["genbi", "register", "other", "--data-mode", "live", "-p", str(project)]
    )

    result = runner.invoke(app, ["genbi", "list", "-p", str(project)])

    assert result.exit_code == 0, result.output
    assert "myapp" in result.output and "other" in result.output
    assert "snapshot" in result.output and "live" in result.output
    assert "scaffolded" in result.output


def test_list_with_no_index_reports_no_apps(tmp_path: Path) -> None:
    project = _make_project(tmp_path)

    result = runner.invoke(app, ["genbi", "list", "-p", str(project)])

    assert result.exit_code == 0, result.output
    assert "no apps" in result.output.lower()


def test_remove_deletes_index_entry(tmp_path: Path) -> None:
    project = _make_project(tmp_path, with_app="myapp")
    runner.invoke(app, ["genbi", "register", "myapp", "-p", str(project)])

    result = runner.invoke(app, ["genbi", "remove", "myapp", "-p", str(project)])

    assert result.exit_code == 0, result.output
    index = yaml.safe_load((project / ".wren" / "apps.yml").read_text())
    assert "myapp" not in index["apps"]
    # listing afterwards shows nothing
    listed = runner.invoke(app, ["genbi", "list", "-p", str(project)])
    assert "no apps" in listed.output.lower()


def test_remove_unknown_app_errors(tmp_path: Path) -> None:
    project = _make_project(tmp_path)

    result = runner.invoke(app, ["genbi", "remove", "ghost", "-p", str(project)])

    assert result.exit_code != 0
    assert "not registered" in result.output.lower()
