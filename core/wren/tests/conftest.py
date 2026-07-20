"""Root pytest configuration for the wren package test suite."""

import sys
from unittest.mock import MagicMock

# wren_core (wren-core-py) requires a Rust compilation and is not
# available in CI or bare test environments.  Provide a module-level
# mock so the import chain
#   wren.__init__ → wren.engine → wren.mdl → wren_core
# succeeds without a compiled native binary.
if "wren_core" not in sys.modules:
    sys.modules["wren_core"] = MagicMock()

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
