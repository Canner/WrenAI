"""Tests for ConnectionProvider implementations."""

import pytest

from wren_pydantic._providers.connection import ProfileConnectionProvider
from wren_pydantic.exceptions import WrenToolkitInitError


def test_explicit_profile_kwarg_resolves_first(monkeypatch, tmp_path):
    """Layer 1: explicit profile= kwarg wins over project config and active."""
    fake_profiles = {
        "prod": {"datasource": "postgres", "host": "prod.db", "port": 5432},
        "dev": {"datasource": "duckdb", "path": ":memory:"},
    }
    monkeypatch.setattr(
        "wren_pydantic._providers.connection.list_profiles",
        lambda: fake_profiles,
    )
    monkeypatch.setattr(
        "wren_pydantic._providers.connection.get_active_profile",
        lambda: ("dev", fake_profiles["dev"]),
    )

    provider = ProfileConnectionProvider(
        project_path=tmp_path,
        explicit_profile="prod",
    )

    assert provider.datasource() == "postgres"
    assert provider.connection_info() == {"host": "prod.db", "port": 5432}


def test_project_config_profile_field_resolves_second(monkeypatch, tmp_path):
    """Layer 2: wren_project.yml's `profile:` field used when no explicit kwarg."""
    fake_profiles = {
        "from_project": {"datasource": "mysql", "host": "from-project.db"},
        "active": {"datasource": "duckdb", "path": ":memory:"},
    }
    monkeypatch.setattr(
        "wren_pydantic._providers.connection.list_profiles",
        lambda: fake_profiles,
    )
    monkeypatch.setattr(
        "wren_pydantic._providers.connection.get_active_profile",
        lambda: ("active", fake_profiles["active"]),
    )
    (tmp_path / "wren_project.yml").write_text("profile: from_project\n")

    provider = ProfileConnectionProvider(project_path=tmp_path)

    assert provider.datasource() == "mysql"
    assert provider.connection_info() == {"host": "from-project.db"}


def test_active_profile_resolves_third_when_no_explicit_or_project(
    monkeypatch, tmp_path
):
    """Layer 3: globally active profile is used when no explicit and no project config."""
    monkeypatch.setattr(
        "wren_pydantic._providers.connection.list_profiles",
        lambda: {"only": {"datasource": "snowflake"}},
    )
    monkeypatch.setattr(
        "wren_pydantic._providers.connection.get_active_profile",
        lambda: ("only", {"datasource": "snowflake", "account": "abc"}),
    )

    provider = ProfileConnectionProvider(project_path=tmp_path)

    assert provider.datasource() == "snowflake"
    assert provider.connection_info() == {"account": "abc"}


def test_unknown_profile_name_raises(monkeypatch, tmp_path):
    monkeypatch.setattr(
        "wren_pydantic._providers.connection.list_profiles",
        lambda: {"prod": {"datasource": "postgres", "host": "x"}},
    )

    with pytest.raises(WrenToolkitInitError, match="profile.*not found"):
        ProfileConnectionProvider(
            project_path=tmp_path,
            explicit_profile="nonexistent",
        )
