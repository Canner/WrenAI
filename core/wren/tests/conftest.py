"""Root pytest configuration for the wren package test suite."""

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
