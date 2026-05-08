"""Unit tests for cli._resolve_engine_profile — the project-aware profile lookup
used by dry-plan and dry-run. Behavior is backward-compatible when a project
has no `profile:` field (falls back to global active)."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

import wren.profile as profile_mod
from wren.cli import _resolve_engine_profile


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


def test_resolve_engine_profile_falls_back_to_active_when_no_pin(
    tmp_path, monkeypatch
):
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
