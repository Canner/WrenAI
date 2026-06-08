"""CLI-level tests for `wren genbi`.

The catalog-only commands run as plain unit tests. The end-to-end serve test is
marked ``genbi`` because it launches a real Streamlit subprocess.
"""

from __future__ import annotations

import json
import urllib.request

import pytest
from typer.testing import CliRunner

from wren.context_cli import _warn_genbi_drift
from wren.genbi import catalog, runtime
from wren.genbi.cli import genbi_app

runner = CliRunner()


@pytest.fixture
def project(tmp_path, monkeypatch):
    """A minimal wren project rooted at tmp_path, discoverable via env."""
    (tmp_path / "wren_project.yml").write_text("name: test\n")
    monkeypatch.setenv("WREN_PROJECT_HOME", str(tmp_path))
    return tmp_path


@pytest.mark.unit
def test_create_scaffolds_and_registers(project):
    result = runner.invoke(genbi_app, ["create", "revenue", "-d", "Monthly revenue"])
    assert result.exit_code == 0, result.output
    assert (project / "apps" / "revenue" / "app.py").exists()
    # registered in the catalog index
    entries = catalog.read_index(project)
    assert [e.name for e in entries] == ["revenue"]
    assert entries[0].description == "Monthly revenue"


@pytest.mark.unit
def test_create_refuses_overwrite_without_force(project):
    runner.invoke(genbi_app, ["create", "revenue"])
    result = runner.invoke(genbi_app, ["create", "revenue"])
    assert result.exit_code == 1
    assert "already exists" in result.output


@pytest.mark.unit
def test_list_empty(project):
    result = runner.invoke(genbi_app, ["list"])
    assert result.exit_code == 0
    assert "No apps" in result.output


@pytest.mark.unit
def test_create_with_unknown_cube_guides_to_enrich_context(project):
    (project / "target").mkdir()
    (project / "target" / "mdl.json").write_text(
        json.dumps({"cubes": [{"name": "sales"}]})
    )
    result = runner.invoke(genbi_app, ["create", "churn", "--cube", "ghost"])
    assert result.exit_code == 1
    assert "ghost" in result.output
    assert "enrich-context" in result.output
    # nothing scaffolded on failure
    assert not (project / "apps" / "churn").exists()


@pytest.mark.unit
def test_create_known_cube_succeeds(project):
    (project / "target").mkdir()
    (project / "target" / "mdl.json").write_text(
        json.dumps({"cubes": [{"name": "sales"}]})
    )
    result = runner.invoke(genbi_app, ["create", "rev", "--cube", "sales"])
    assert result.exit_code == 0
    assert (project / "apps" / "rev" / "app.py").exists()


@pytest.mark.unit
def test_create_without_cubes_notes_static_only(project):
    (project / "target").mkdir()
    (project / "target" / "mdl.json").write_text(json.dumps({"cubes": []}))
    result = runner.invoke(genbi_app, ["create", "plain"])
    assert result.exit_code == 0
    assert "static" in result.output.lower()


@pytest.mark.unit
def test_serve_refuses_on_mdl_drift(project):
    # A cube_panel in app.py references a cube the (empty) MDL doesn't provide.
    runner.invoke(genbi_app, ["create", "sales"])
    (project / "target").mkdir()
    (project / "target" / "mdl.json").write_text(json.dumps({"cubes": []}))
    (project / "apps" / "sales" / "app.py").write_text(
        "from wren.genbi.panel import cube_panel\n"
        "cube_panel(cube='ghost', measures=['revenue'])\n"
    )
    result = runner.invoke(genbi_app, ["serve", "sales"])
    assert result.exit_code == 1
    assert "out of sync" in result.output
    assert "ghost" in result.output


@pytest.mark.unit
def test_context_build_warns_about_drifted_apps(project, capsys):

    runner.invoke(genbi_app, ["create", "sales"])
    (project / "apps" / "sales" / "app.py").write_text(
        "from wren.genbi.panel import cube_panel\n"
        "cube_panel(cube='ghost', measures=['revenue'])\n"
    )
    # New manifest no longer has the 'ghost' cube the app references.
    _warn_genbi_drift(project, {"cubes": []})
    out = capsys.readouterr().out
    assert "may be affected" in out
    assert "sales" in out
    assert "wren genbi check --all" in out


@pytest.mark.unit
def test_context_build_no_warning_when_clean(project, capsys):

    runner.invoke(genbi_app, ["create", "sales"])
    (project / "apps" / "sales" / "app.py").write_text(
        "from wren.genbi.panel import cube_panel\n"
        "cube_panel(cube='sales', measures=['revenue'])\n"
    )
    _warn_genbi_drift(
        project, {"cubes": [{"name": "sales", "measures": [{"name": "revenue"}]}]}
    )
    assert "may be affected" not in capsys.readouterr().out


@pytest.mark.genbi
def test_serve_then_stop_end_to_end(project):
    pytest.importorskip("streamlit")
    runner.invoke(genbi_app, ["create", "demo"])

    result = runner.invoke(genbi_app, ["serve", "demo", "--json"])
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output.strip().splitlines()[-1])
    port = payload["port"]

    # The served app answers Streamlit's health endpoint.
    with urllib.request.urlopen(
        f"http://127.0.0.1:{port}/_stcore/health", timeout=5
    ) as resp:
        assert resp.status == 200

    # status reports it running with the URL (and survives the PID-reuse guard).
    status_result = runner.invoke(genbi_app, ["status", "demo", "--json"])
    status = json.loads(status_result.output.strip().splitlines()[-1])
    assert status["running"] is True
    assert status["url"] == f"http://localhost:{port}"

    stop_result = runner.invoke(genbi_app, ["stop", "demo"])
    assert stop_result.exit_code == 0
    assert "Stopped 'demo'" in stop_result.output

    # After stop, health no longer answers.
    assert runtime.wait_healthy(port, timeout=3, interval=0.2) is False
