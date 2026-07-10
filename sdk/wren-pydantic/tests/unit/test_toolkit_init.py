"""Tests for WrenToolkit construction (from_project)."""

import pytest
from wren.profile import _reset_env_loaded_for_tests

from wren_pydantic import WrenToolkit
from wren_pydantic._providers.memory import (
    NoopMemoryProvider,
    QdrantMemoryProvider,
)
from wren_pydantic.exceptions import WrenToolkitInitError


def test_from_project_raises_when_project_yml_missing(tmp_path, fake_active_profile):
    """A directory without wren_project.yml is not a Wren project."""
    with pytest.raises(WrenToolkitInitError, match="wren_project.yml"):
        WrenToolkit.from_project(tmp_path)


def test_from_project_raises_when_target_mdl_missing(tmp_path, fake_active_profile):
    """A project without target/mdl.json hasn't been built."""
    (tmp_path / "wren_project.yml").write_text("schema_version: 1\n")
    with pytest.raises(WrenToolkitInitError, match="target/mdl.json"):
        WrenToolkit.from_project(tmp_path)


def test_from_project_returns_toolkit_when_prereqs_met(
    tmp_project, fake_active_profile
):
    """from_project returns a WrenToolkit when all prerequisites exist."""
    toolkit = WrenToolkit.from_project(tmp_project)
    assert isinstance(toolkit, WrenToolkit)


def test_from_project_relative_path_resolves(
    tmp_project, fake_active_profile, monkeypatch
):
    """from_project accepts relative paths and resolves them."""
    monkeypatch.chdir(tmp_project.parent)
    toolkit = WrenToolkit.from_project(tmp_project.name)
    assert isinstance(toolkit, WrenToolkit)


def test_memory_auto_detect_disabled_when_qdrant_url_unset(tmp_project, fake_active_profile, monkeypatch):
    """Without QDRANT_URL, memory auto-detects as Noop."""
    monkeypatch.delenv("QDRANT_URL", raising=False)
    toolkit = WrenToolkit.from_project(tmp_project)
    assert isinstance(toolkit._memory, NoopMemoryProvider)


def test_memory_auto_detect_enabled_when_qdrant_url_set(tmp_project, fake_active_profile, monkeypatch):
    """With QDRANT_URL set, memory auto-detects as Qdrant."""
    monkeypatch.setenv("QDRANT_URL", "http://localhost:6333")
    toolkit = WrenToolkit.from_project(tmp_project)
    assert isinstance(toolkit._memory, QdrantMemoryProvider)


def test_from_project_loads_dotenv_from_project_path(tmp_project, monkeypatch):
    """from_project loads <path>/.env so ${VAR} secrets resolve regardless of CWD.

    Regression: previously the SDK relied on Core's CWD-relative .env discovery,
    which fails when the user runs Python from anywhere other than the project
    directory.
    """
    # Stage 1: a profile that references an env var the caller's shell does NOT have.
    sentinel_var = "WREN_LANGCHAIN_TEST_HOST_DOES_NOT_EXIST_IN_SHELL"
    monkeypatch.delenv(sentinel_var, raising=False)
    monkeypatch.setattr(
        "wren_pydantic._providers.connection.list_profiles",
        lambda: {
            "test": {
                "datasource": "duckdb",
                "host": f"${{{sentinel_var}}}",
                "format": "duckdb",
            }
        },
    )
    monkeypatch.setattr(
        "wren_pydantic._providers.connection.get_active_profile",
        lambda: (
            "test",
            {
                "datasource": "duckdb",
                "host": f"${{{sentinel_var}}}",
                "format": "duckdb",
            },
        ),
    )

    # Stage 2: place the var only inside the project's .env.
    (tmp_project / ".env").write_text(f"{sentinel_var}=resolved-from-project-env\n")

    # Stage 3: run from a different CWD so Core's CWD-walk would NOT find the file.
    monkeypatch.chdir(tmp_project.parent)
    _reset_env_loaded_for_tests()

    try:
        toolkit = WrenToolkit.from_project(tmp_project)
        assert (
            toolkit._connection.connection_info()["host"] == "resolved-from-project-env"
        )
    finally:
        # Reset the global loader flag again so this test cannot leak its
        # half-loaded state into whatever runs next in the session.
        _reset_env_loaded_for_tests()
