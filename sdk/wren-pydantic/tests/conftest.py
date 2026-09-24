"""Shared pytest fixtures for wren-pydantic tests."""

import json
from pathlib import Path

import pytest


@pytest.fixture
def tmp_project(tmp_path):
    """A minimal valid Wren project directory.

    Layout:
      <tmp_path>/
        wren_project.yml
        target/mdl.json
    """
    (tmp_path / "wren_project.yml").write_text("schema_version: 1\n")
    target = tmp_path / "target"
    target.mkdir()
    (target / "mdl.json").write_text(json.dumps({"models": []}))
    return tmp_path


@pytest.fixture
def fake_active_profile(monkeypatch):
    """Patch profile resolution to return a duckdb in-memory active profile."""
    monkeypatch.setattr(
        "wren_pydantic._providers.connection.list_profiles",
        lambda: {"test": {"datasource": "duckdb", "path": ":memory:"}},
    )
    monkeypatch.setattr(
        "wren_pydantic._providers.connection.get_active_profile",
        lambda: ("test", {"datasource": "duckdb", "path": ":memory:"}),
    )


@pytest.fixture
def simulate_cp936_default_encoding(monkeypatch):
    """Make text reads without an encoding behave like a Windows CP936 locale."""
    original_open = Path.open

    def apply():
        def open_with_cp936_default(
            path, mode="r", buffering=-1, encoding=None, errors=None, newline=None
        ):
            if "b" not in mode and encoding is None:
                encoding = "cp936"
            return original_open(
                path,
                mode=mode,
                buffering=buffering,
                encoding=encoding,
                errors=errors,
                newline=newline,
            )

        monkeypatch.setattr(Path, "open", open_with_cp936_default)

    return apply
