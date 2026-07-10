"""Unit tests for wren.profile — profile CRUD and resolution logic."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

import wren.profile as profile_mod


@pytest.fixture(autouse=True)
def isolated_profiles(tmp_path, monkeypatch):
    """Redirect all profile I/O to a temp directory."""
    profiles_file = tmp_path / "profiles.yml"
    monkeypatch.setattr(profile_mod, "_WREN_HOME", tmp_path)
    monkeypatch.setattr(profile_mod, "_PROFILES_FILE", profiles_file)
    return profiles_file


# ── CRUD ──────────────────────────────────────────────────────────────────────


def test_add_and_list():
    profile_mod.add_profile("pg", {"datasource": "postgres", "host": "localhost"})
    profiles = profile_mod.list_profiles()
    assert "pg" in profiles
    assert profiles["pg"]["host"] == "localhost"


def test_add_activates_first():
    profile_mod.add_profile("first", {"datasource": "duckdb"})
    assert profile_mod.get_active_name() == "first"


def test_add_second_does_not_change_active():
    profile_mod.add_profile("first", {"datasource": "duckdb"})
    profile_mod.add_profile("second", {"datasource": "postgres"})
    assert profile_mod.get_active_name() == "first"


def test_add_with_activate_overrides():
    profile_mod.add_profile("first", {"datasource": "duckdb"})
    profile_mod.add_profile("second", {"datasource": "postgres"}, activate=True)
    assert profile_mod.get_active_name() == "second"


def test_switch():
    profile_mod.add_profile("a", {"datasource": "duckdb"})
    profile_mod.add_profile("b", {"datasource": "postgres"})
    result = profile_mod.switch_profile("b")
    assert result is True
    assert profile_mod.get_active_name() == "b"


def test_switch_not_found():
    result = profile_mod.switch_profile("nonexistent")
    assert result is False


def test_remove():
    profile_mod.add_profile("pg", {"datasource": "postgres"})
    profile_mod.add_profile("duck", {"datasource": "duckdb"})
    profile_mod.switch_profile("pg")
    result = profile_mod.remove_profile("pg")
    assert result is True
    assert "pg" not in profile_mod.list_profiles()
    # active should fall back to remaining profile
    assert profile_mod.get_active_name() == "duck"


def test_remove_not_found():
    result = profile_mod.remove_profile("ghost")
    assert result is False


def test_remove_last_profile_clears_active():
    profile_mod.add_profile("only", {"datasource": "duckdb"})
    profile_mod.remove_profile("only")
    assert profile_mod.get_active_name() is None


# ── Sensitive field masking ───────────────────────────────────────────────────


def test_debug_masks_sensitive():
    profile_mod.add_profile(
        "pg",
        {
            "datasource": "postgres",
            "host": "db.example.com",
            "password": "supersecret",
            "token": "abc123",
            "credentials": "/path/to/sa.json",
            "private_key": "key_data",
        },
    )
    info = profile_mod.debug_profile("pg")
    assert info["config"]["host"] == "db.example.com"
    assert info["config"]["password"] == "***"
    assert info["config"]["token"] == "***"
    assert info["config"]["credentials"] == "***"
    assert info["config"]["private_key"] == "***"


def test_debug_no_active_profile():
    info = profile_mod.debug_profile()
    assert "error" in info


def test_debug_unknown_profile():
    info = profile_mod.debug_profile("missing")
    assert "error" in info


# ── resolve_connection ────────────────────────────────────────────────────────


def test_resolve_explicit_wins():
    profile_mod.add_profile("pg", {"datasource": "postgres", "host": "ignored"})
    ds, conn = profile_mod.resolve_connection("duckdb", None, None)
    assert ds == "duckdb"
    assert conn == {}


def test_resolve_explicit_conn_info_wins():
    profile_mod.add_profile("pg", {"datasource": "postgres", "host": "ignored"})
    ds, conn = profile_mod.resolve_connection(None, '{"datasource":"mysql"}', None)
    assert ds is None  # caller handles the conn_info string
    assert conn == {}


def test_resolve_profile_fallback():
    profile_mod.add_profile("duck", {"datasource": "duckdb", "path": "./warehouse.db"})
    ds, conn = profile_mod.resolve_connection(None, None, None)
    assert ds == "duckdb"
    assert conn == {"path": "./warehouse.db"}


def test_resolve_no_profile():
    ds, conn = profile_mod.resolve_connection(None, None, None)
    assert ds is None
    assert conn == {}


# ── resolve_profile_for_project ───────────────────────────────────────────────


def _write_project(project_path: Path, **fields) -> None:
    """Write a minimal wren_project.yml with the given fields."""
    project_path.mkdir(parents=True, exist_ok=True)
    config = {
        "schema_version": 3,
        "name": "test_proj",
        "version": "1.0",
        "catalog": "wren",
        "schema": "public",
        "data_source": "duckdb",
    }
    config.update(fields)
    (project_path / "wren_project.yml").write_text(yaml.safe_dump(config))


def test_resolve_profile_for_project_uses_pinned_profile(tmp_path: Path):
    profile_mod.add_profile("project_a", {"datasource": "duckdb", "path": "/a"})
    profile_mod.add_profile("project_b", {"datasource": "postgres", "host": "x"})
    profile_mod.switch_profile("project_a")  # active != pinned

    proj = tmp_path / "myproj"
    _write_project(proj, profile="project_b")

    name, prof = profile_mod.resolve_profile_for_project(proj)
    assert name == "project_b"
    assert prof["datasource"] == "postgres"
    assert prof["host"] == "x"


def test_resolve_profile_for_project_falls_back_to_active(tmp_path: Path):
    profile_mod.add_profile("active_one", {"datasource": "duckdb", "path": "/x"})
    proj = tmp_path / "myproj"
    _write_project(proj)  # no `profile:` field

    name, prof = profile_mod.resolve_profile_for_project(proj)
    assert name == "active_one"
    assert prof["datasource"] == "duckdb"


def test_resolve_profile_for_project_raises_when_pinned_missing(tmp_path: Path):
    profile_mod.add_profile("real", {"datasource": "duckdb"})
    proj = tmp_path / "myproj"
    _write_project(proj, profile="ghost")  # ghost doesn't exist

    with pytest.raises(SystemExit) as exc:
        profile_mod.resolve_profile_for_project(proj)
    assert "ghost" in str(exc.value)
    assert "real" in str(exc.value)  # available profiles listed


def test_resolve_profile_for_project_returns_empty_when_no_pin_no_active(
    tmp_path: Path,
):
    proj = tmp_path / "myproj"
    _write_project(proj)  # no profile field, no profiles.yml setup
    name, prof = profile_mod.resolve_profile_for_project(proj)
    assert name is None
    assert prof == {}


def test_resolve_profile_for_project_raises_on_malformed_yaml(tmp_path: Path):
    """A broken wren_project.yml should fail loudly, not silently fall back to
    the global active profile — the latter risks targeting the wrong DB."""
    proj = tmp_path / "myproj"
    proj.mkdir()
    (proj / "wren_project.yml").write_text("schema_version: 3\nname: [unclosed\n")

    with pytest.raises(SystemExit) as exc:
        profile_mod.resolve_profile_for_project(proj)
    msg = str(exc.value).lower()
    assert "wren_project.yml" in msg or "yaml" in msg


def test_resolve_profile_for_project_treats_empty_profile_field_as_unset(
    tmp_path: Path,
):
    profile_mod.add_profile("active_one", {"datasource": "duckdb"})
    proj = tmp_path / "myproj"
    _write_project(proj, profile="")  # explicitly empty

    name, prof = profile_mod.resolve_profile_for_project(proj)
    # Should fall back to active, not error on empty pin
    assert name == "active_one"


# ── Round-trip persistence ────────────────────────────────────────────────────


def test_profiles_yml_round_trip(isolated_profiles: Path):
    profile_mod.add_profile(
        "bq",
        {"datasource": "bigquery", "project_id": "my-project", "dataset_id": "prod"},
    )
    profile_mod.add_profile("duck", {"datasource": "duckdb", "path": ":memory:"})
    profile_mod.switch_profile("duck")

    raw = yaml.safe_load(isolated_profiles.read_text())
    assert raw["active"] == "duck"
    assert raw["profiles"]["bq"]["project_id"] == "my-project"
    assert raw["profiles"]["duck"]["path"] == ":memory:"


def test_profiles_yml_file_permissions(isolated_profiles: Path):
    profile_mod.add_profile("pg", {"datasource": "postgres", "password": "s3cr3t"})
    mode = isolated_profiles.stat().st_mode & 0o777
    assert mode == 0o600, f"Expected 0600 but got {oct(mode)}"


def test_load_raw_invalid_yaml(isolated_profiles: Path):
    isolated_profiles.write_text(": invalid: yaml: {{{")
    with pytest.raises(ValueError, match="not valid YAML"):
        profile_mod._load_raw()


def test_load_raw_non_mapping(isolated_profiles: Path):
    isolated_profiles.write_text("- item1\n- item2\n")
    with pytest.raises(ValueError, match="must contain a YAML mapping"):
        profile_mod._load_raw()


def test_load_raw_profiles_not_mapping(isolated_profiles: Path):
    isolated_profiles.write_text("active: null\nprofiles: not_a_dict\n")
    with pytest.raises(ValueError, match="'profiles' must be a mapping"):
        profile_mod._load_raw()


# ── from-file import helpers (used by CLI) ────────────────────────────────────


def test_from_file_json(tmp_path):
    conn_file = tmp_path / "conn.json"
    conn_file.write_text(
        json.dumps({"datasource": "postgres", "host": "db.local", "port": 5432})
    )
    import json as _json  # re-use stdlib for the load

    data = _json.loads(conn_file.read_text())
    profile_mod.add_profile("from-json", data)
    profiles = profile_mod.list_profiles()
    assert profiles["from-json"]["host"] == "db.local"


def test_from_file_yaml(tmp_path):
    conn_file = tmp_path / "conn.yml"
    conn_file.write_text("datasource: mysql\nhost: mysql.local\nport: 3306\n")
    data = yaml.safe_load(conn_file.read_text())
    profile_mod.add_profile("from-yaml", data)
    profiles = profile_mod.list_profiles()
    assert profiles["from-yaml"]["datasource"] == "mysql"
    assert profiles["from-yaml"]["host"] == "mysql.local"
