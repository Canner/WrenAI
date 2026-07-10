"""Unit tests for the store-tip behavior in the CLI.

Uses typer's CliRunner with a mocked WrenEngine so no real database is needed.
"""

from __future__ import annotations

from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pyarrow as pa
import pytest
from typer.testing import CliRunner

from wren.cli import app

pytestmark = pytest.mark.unit

runner = CliRunner()

# Minimal pyarrow table for mock query results
_MOCK_TABLE = pa.table({"id": [1, 2, 3]})

_CONN_FILE_ARGS = ["--connection-file", "/dev/null"]
_MDL_ARGS = ["--mdl", "/dev/null"]


@contextmanager
def _mock_engine(result=None):
    """Context manager that patches _build_engine to return a fake engine."""
    mock_engine = MagicMock()
    mock_engine.__enter__ = MagicMock(return_value=mock_engine)
    mock_engine.__exit__ = MagicMock(return_value=False)
    mock_engine.query.return_value = _MOCK_TABLE if result is None else result

    with patch("wren.cli._build_engine", return_value=mock_engine):
        yield mock_engine


# ── main() (default callback) ──────────────────────────────────────────────


def test_main_tip_appears_on_stderr_for_analytical_query():
    sql = "SELECT status, COUNT(*) FROM orders GROUP BY 1"
    with _mock_engine():
        result = runner.invoke(app, ["--sql", sql] + _MDL_ARGS + _CONN_FILE_ARGS)
    assert result.exit_code == 0
    assert "wren memory store" in result.stderr
    assert "wren memory store" not in result.stdout


def test_main_tip_suppressed_with_quiet_flag():
    sql = "SELECT status, COUNT(*) FROM orders GROUP BY 1"
    with _mock_engine():
        result = runner.invoke(
            app, ["--sql", sql, "--quiet"] + _MDL_ARGS + _CONN_FILE_ARGS
        )
    assert result.exit_code == 0
    assert "wren memory store" not in result.stderr


def test_main_tip_suppressed_for_exploratory_query():
    sql = "SELECT * FROM orders LIMIT 5"
    with _mock_engine():
        result = runner.invoke(app, ["--sql", sql] + _MDL_ARGS + _CONN_FILE_ARGS)
    assert result.exit_code == 0
    assert "wren memory store" not in result.stderr


def test_main_stdout_clean_of_tip():
    sql = "SELECT status, COUNT(*) FROM orders GROUP BY 1"
    with _mock_engine():
        result = runner.invoke(app, ["--sql", sql] + _MDL_ARGS + _CONN_FILE_ARGS)
    assert result.exit_code == 0
    assert "wren memory store" not in result.stdout


# ── query subcommand ───────────────────────────────────────────────────────


def test_query_tip_appears_for_analytical_query():
    sql = "SELECT * FROM orders WHERE total > 100"
    with _mock_engine():
        result = runner.invoke(
            app, ["query", "--sql", sql] + _MDL_ARGS + _CONN_FILE_ARGS
        )
    assert result.exit_code == 0
    assert "wren memory store" in result.stderr


def test_query_tip_suppressed_with_quiet_flag():
    sql = "SELECT * FROM orders WHERE total > 100"
    with _mock_engine():
        result = runner.invoke(
            app,
            ["query", "--sql", sql, "--quiet"] + _MDL_ARGS + _CONN_FILE_ARGS,
        )
    assert result.exit_code == 0
    assert "wren memory store" not in result.stderr


def test_query_tip_suppressed_for_exploratory_query():
    sql = "SELECT * FROM orders"
    with _mock_engine():
        result = runner.invoke(
            app, ["query", "--sql", sql] + _MDL_ARGS + _CONN_FILE_ARGS
        )
    assert result.exit_code == 0
    assert "wren memory store" not in result.stderr


def test_tip_includes_sql_in_suggested_command():
    sql = "SELECT COUNT(*) FROM orders"
    with _mock_engine():
        result = runner.invoke(app, ["--sql", sql] + _MDL_ARGS + _CONN_FILE_ARGS)
    assert result.exit_code == 0
    assert sql in result.stderr


def test_tip_escapes_single_quotes_in_sql():
    sql = "SELECT * FROM orders WHERE status = 'open'"
    with _mock_engine():
        result = runner.invoke(app, ["--sql", sql] + _MDL_ARGS + _CONN_FILE_ARGS)
    assert result.exit_code == 0
    assert "wren memory store" in result.stderr
    # Correctly escaped form for POSIX shell single-quote wrapping
    expected = "--sql 'SELECT * FROM orders WHERE status = '\\''open'\\'''"
    assert expected in result.stderr
    # Unescaped form would break shell — must not appear
    assert "--sql 'SELECT * FROM orders WHERE status = 'open''" not in result.stderr
