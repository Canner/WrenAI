"""Unit tests for cli._resolve_engine_profile — the project-aware profile lookup
used by dry-plan and dry-run. Behavior is backward-compatible when a project
has no `profile:` field (falls back to global active)."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import duckdb
import pytest
import yaml
from typer.testing import CliRunner

import wren.cli as cli_mod
import wren.profile as profile_mod
from wren.cli import _resolve_engine_profile


@pytest.mark.parametrize("working_directory", ["other_project", "selected", "outside"])
@pytest.mark.parametrize("command", ["query", "serve"])
def test_query_uses_selected_projects_dotenv(
    tmp_path, monkeypatch, working_directory, command
):
    """An external --mdl must not combine its profile with another project's DB."""
    monkeypatch.setattr(cli_mod, "_WREN_HOME", tmp_path)
    monkeypatch.delenv("AUDIT_DB_ROOT", raising=False)
    profile_mod._reset_env_loaded_for_tests()
    profile_mod.add_profile(
        "selected_profile",
        {"datasource": "duckdb", "url": "${AUDIT_DB_ROOT}", "format": "duckdb"},
    )
    for name, amount in (("other_project", 111), ("selected", 999)):
        project = tmp_path / name
        mdl = _write_project(project, profile="selected_profile")
        data_dir = project / "data"
        data_dir.mkdir()
        with duckdb.connect(str(data_dir / "warehouse.duckdb")) as connection:
            connection.execute("CREATE TABLE orders(amount BIGINT)")
            connection.execute("INSERT INTO orders VALUES (?)", [amount])
        (project / ".env").write_text(
            f"AUDIT_DB_ROOT={data_dir.as_posix()}\n", encoding="utf-8"
        )
        mdl.write_text(
            json.dumps(
                {
                    "catalog": "wren",
                    "schema": "public",
                    "dataSource": "duckdb",
                    "models": [
                        {
                            "name": "orders",
                            "tableReference": {
                                "catalog": "warehouse",
                                "schema": "main",
                                "table": "orders",
                            },
                            "columns": [{"name": "amount", "type": "BIGINT"}],
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
    (tmp_path / "outside").mkdir()
    monkeypatch.chdir(tmp_path / working_directory)

    if command == "query":
        args = [
            "query",
            "--sql",
            "SELECT SUM(amount) AS total FROM orders",
            "--mdl",
            str(tmp_path / "selected" / "target" / "mdl.json"),
            "--output",
            "json",
            "--quiet",
        ]
    else:
        # Replace only the optional transport. Startup and DB execution are real.
        server = ModuleType("wren.mcp_server")
        server.ServeContext = SimpleNamespace
        totals = []

        def run_server(ctx, **kwargs):
            try:
                rows = ctx.engine.query("SELECT SUM(amount) AS total FROM orders")
                totals.append(str(rows.to_pylist()[0]["total"]))
            finally:
                ctx.engine.close()

        server.run_server = run_server
        monkeypatch.setitem(sys.modules, "mcp", ModuleType("mcp"))
        monkeypatch.setitem(sys.modules, "wren.mcp_server", server)
        args = [
            "serve",
            "mcp",
            "--project",
            str(tmp_path / "selected"),
            "--profile",
            "selected_profile",
            "--quiet",
        ]

    result = CliRunner().invoke(cli_mod.app, args)

    assert result.exit_code == 0, result.output
    if command == "query":
        assert json.loads(result.output) == {"total": "999"}
    else:
        assert totals == ["999"]


@pytest.fixture(autouse=True)
def isolated_profiles(tmp_path, monkeypatch):
    """Redirect all profile I/O to a temp directory."""
    profiles_file = tmp_path / "profiles.yml"
    monkeypatch.setattr(profile_mod, "_WREN_HOME", tmp_path)
    monkeypatch.setattr(profile_mod, "_PROFILES_FILE", profiles_file)
    return profiles_file


def _write_project(project_dir: Path, **fields) -> Path:
    project_dir.mkdir(parents=True, exist_ok=True)
    config = {
        "schema_version": 3,
        "name": "test_proj",
        "version": "1.0",
        "catalog": "wren",
        "schema": "public",
        "data_source": "duckdb",
    }
    config.update(fields)
    (project_dir / "wren_project.yml").write_text(yaml.safe_dump(config))
    target = project_dir / "target"
    target.mkdir(exist_ok=True)
    mdl = target / "mdl.json"
    mdl.write_text("{}")
    return mdl


def test_resolve_engine_profile_prefers_project_pin_when_mdl_given(
    tmp_path, monkeypatch
):
    """--mdl <project>/target/mdl.json + project pins profile B → returns B."""
    profile_mod.add_profile("active_a", {"datasource": "duckdb", "path": "/a"})
    profile_mod.add_profile("pinned_b", {"datasource": "postgres", "host": "b"})
    # active is A but project pins B
    profile_mod.switch_profile("active_a")

    mdl = _write_project(tmp_path / "myproj", profile="pinned_b")

    name, prof = _resolve_engine_profile(str(mdl))
    assert name == "pinned_b"
    assert prof["datasource"] == "postgres"


def test_resolve_engine_profile_falls_back_to_active_when_no_pin(tmp_path, monkeypatch):
    """No `profile:` field → falls back to global active."""
    profile_mod.add_profile("active_only", {"datasource": "duckdb"})
    mdl = _write_project(tmp_path / "myproj")  # no profile field

    name, prof = _resolve_engine_profile(str(mdl))
    assert name == "active_only"
    assert prof["datasource"] == "duckdb"


def test_resolve_engine_profile_uses_cwd_when_mdl_none(tmp_path, monkeypatch):
    """No --mdl → discover from cwd."""
    profile_mod.add_profile("via_cwd", {"datasource": "mysql", "host": "y"})
    profile_mod.add_profile("global_active", {"datasource": "postgres"})
    profile_mod.switch_profile("global_active")

    proj = tmp_path / "myproj"
    _write_project(proj, profile="via_cwd")
    monkeypatch.chdir(proj)

    name, prof = _resolve_engine_profile(None)
    assert name == "via_cwd"
    assert prof["datasource"] == "mysql"


def test_resolve_engine_profile_falls_back_when_no_project_at_cwd(
    tmp_path, monkeypatch
):
    """No --mdl and cwd not in any project → global active."""
    profile_mod.add_profile("only", {"datasource": "duckdb"})
    monkeypatch.chdir(tmp_path)  # tmp_path has no wren_project.yml

    name, prof = _resolve_engine_profile(None)
    assert name == "only"


def test_resolve_engine_profile_falls_back_when_mdl_not_a_file(tmp_path):
    """--mdl is a base64 string (not a file path) → cannot resolve project,
    falls back to global active without crashing."""
    profile_mod.add_profile("only", {"datasource": "duckdb"})

    name, prof = _resolve_engine_profile("base64stringthatisnotapath==")
    assert name == "only"


def test_resolve_engine_profile_raises_when_pinned_profile_missing(
    tmp_path, monkeypatch
):
    """Project pins a profile that doesn't exist → SystemExit (loud failure)."""
    profile_mod.add_profile("real", {"datasource": "duckdb"})
    mdl = _write_project(tmp_path / "myproj", profile="ghost")

    with pytest.raises(SystemExit):
        _resolve_engine_profile(str(mdl))


def test_resolve_engine_profile_uses_cwd_pin_when_mdl_is_base64(tmp_path, monkeypatch):
    """--mdl as a base64 string must NOT silently bypass cwd's project pin —
    that would re-introduce the silent-mismatch problem this PR is closing."""
    profile_mod.add_profile("active_one", {"datasource": "postgres"})
    profile_mod.add_profile("cwd_pin", {"datasource": "duckdb"})
    profile_mod.switch_profile("active_one")

    proj = tmp_path / "myproj"
    _write_project(proj, profile="cwd_pin")
    monkeypatch.chdir(proj)

    name, prof = _resolve_engine_profile("base64stringthatisnotapath==")
    assert name == "cwd_pin"
    assert prof["datasource"] == "duckdb"


def test_resolve_engine_profile_uses_cwd_pin_when_mdl_outside_project(
    tmp_path, monkeypatch
):
    """--mdl pointing to a file outside any project must still let cwd's
    pin win, so users can test external MDL artifacts against the bound DB."""
    profile_mod.add_profile("active_one", {"datasource": "postgres"})
    profile_mod.add_profile("cwd_pin", {"datasource": "duckdb"})
    profile_mod.switch_profile("active_one")

    proj = tmp_path / "myproj"
    _write_project(proj, profile="cwd_pin")
    monkeypatch.chdir(proj)

    external = tmp_path / "external.json"
    external.write_text("{}")

    name, prof = _resolve_engine_profile(str(external))
    assert name == "cwd_pin"


def test_resolve_engine_profile_walks_up_from_nonstandard_mdl_layout(
    tmp_path, monkeypatch
):
    """--mdl doesn't have to sit at <project>/target/mdl.json. Anywhere
    inside the project tree should resolve via walk-up — the current
    parent.parent shortcut hard-codes a layout that's just a build default."""
    # Use distinct active vs pinned profiles so the test actually exercises
    # walk-up rather than vacuously matching whatever active happens to be.
    profile_mod.add_profile("not_this_one", {"datasource": "postgres"})
    profile_mod.add_profile("via_walk_up", {"datasource": "duckdb"})
    profile_mod.switch_profile("not_this_one")

    proj = tmp_path / "myproj"
    proj.mkdir()
    import yaml as _yaml  # noqa: PLC0415

    (proj / "wren_project.yml").write_text(
        _yaml.safe_dump(
            {
                "schema_version": 3,
                "name": "test_proj",
                "version": "1.0",
                "catalog": "wren",
                "schema": "public",
                "data_source": "duckdb",
                "profile": "via_walk_up",
            }
        )
    )

    # MDL several levels deep, not at <proj>/target/mdl.json
    deep = proj / "build" / "dist" / "artifacts"
    deep.mkdir(parents=True)
    mdl = deep / "manifest.json"
    mdl.write_text("{}")

    name, prof = _resolve_engine_profile(str(mdl))
    assert name == "via_walk_up", (
        "Walk-up didn't find wren_project.yml; resolver still relies on the "
        "parent.parent shortcut."
    )
