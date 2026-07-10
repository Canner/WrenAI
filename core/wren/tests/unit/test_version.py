"""Smoke tests for `wren version` and `wren --version`."""

from __future__ import annotations

import pytest
from typer.testing import CliRunner

from wren import __version__
from wren.cli import app

pytestmark = pytest.mark.unit

runner = CliRunner()


def test_version_subcommand():
    result = runner.invoke(app, ["version"])
    assert result.exit_code == 0
    assert __version__ in result.output


def test_version_long_flag():
    result = runner.invoke(app, ["--version"])
    assert result.exit_code == 0
    assert __version__ in result.output


def test_version_short_flag():
    result = runner.invoke(app, ["-V"])
    assert result.exit_code == 0
    assert __version__ in result.output


def test_version_matches_package_metadata():
    """Guard against drift: __version__ must come from installed metadata
    (pyproject.toml), not a hardcoded string that release-please forgets."""
    from importlib.metadata import PackageNotFoundError, version  # noqa: PLC0415

    try:
        meta_version = version("wrenai")
    except PackageNotFoundError:
        pytest.skip("wrenai not installed as a distribution")
    assert __version__ == meta_version
