"""Root pytest configuration for the wren package test suite."""

from pathlib import Path

import pytest


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "unit: unit tests — no database required")
    config.addinivalue_line(
        "markers",
        "datafusion: DataFusion connector tests — no Docker required",
    )
    config.addinivalue_line(
        "markers", "duckdb: DuckDB connector tests — no Docker required"
    )
    config.addinivalue_line(
        "markers", "postgres: PostgreSQL connector tests — requires Docker"
    )
    config.addinivalue_line("markers", "mysql: MySQL connector tests — requires Docker")
    config.addinivalue_line(
        "markers", "snowflake: Snowflake connector tests — mocked, no Docker required"
    )
    config.addinivalue_line(
        "markers", "canner: Canner connector tests — requires Docker"
    )
    config.addinivalue_line(
        "markers", "clickhouse: ClickHouse connector tests — requires Docker"
    )
    config.addinivalue_line("markers", "mssql: MSSQL connector tests — requires Docker")
    config.addinivalue_line("markers", "trino: Trino connector tests — requires Docker")
    config.addinivalue_line(
        "markers",
        "slow: slow tests that load a real model / hit real LanceDB "
        "(e.g. cross-model vector-compatibility checks)",
    )


@pytest.fixture()
def cp1252_default_encoding(monkeypatch):
    """Make Path.read_text/write_text default to cp1252, like Windows does.

    Without an explicit ``encoding=``, pathlib uses the locale encoding, which is
    a legacy code page on most Windows installs rather than UTF-8.
    """
    real_read, real_write = Path.read_text, Path.write_text

    # Path.read_text only takes ``newline`` from Python 3.13 on, so don't pass it.
    def read_text(self, encoding=None, errors=None):
        return real_read(self, encoding or "cp1252", errors)

    def write_text(self, data, encoding=None, errors=None, newline=None):
        return real_write(self, data, encoding or "cp1252", errors, newline)

    monkeypatch.setattr(Path, "read_text", read_text)
    monkeypatch.setattr(Path, "write_text", write_text)
