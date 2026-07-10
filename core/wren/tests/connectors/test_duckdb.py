"""DuckDB connector tests.

Uses DuckDB's built-in TPCH extension to generate test data — no Docker needed.
The data is written to a temp file so ``DuckDBConnector`` can attach it.
"""

from __future__ import annotations

import base64

import duckdb
import orjson
import pytest

from tests.suite.manifests import make_tpch_manifest
from tests.suite.query import WrenQueryTestSuite
from wren import WrenEngine
from wren.model.data_source import DataSource

pytestmark = pytest.mark.duckdb

# DuckDB TPCH tables live in the "main" schema of the attached file.
# The DuckDBConnector attaches the file as catalog = stem of the filename,
# so "tpch.duckdb" → catalog "tpch".
_CATALOG = "tpch"
_SCHEMA = "main"


class TestDuckDB(WrenQueryTestSuite):
    manifest = make_tpch_manifest(table_catalog=_CATALOG, table_schema=_SCHEMA)
    # DuckDB TPCH dbgen produces INTEGER as int64 in Arrow
    order_id_dtype = "int64"

    @pytest.fixture(scope="class")
    def engine(self, tmp_path_factory) -> WrenEngine:  # type: ignore[override]
        db_dir = tmp_path_factory.mktemp("duckdb")
        db_path = db_dir / "tpch.duckdb"

        # Generate TPCH sf=0.01 (1500 orders, 150 customers) into the file.
        con = duckdb.connect(str(db_path))
        con.execute("INSTALL tpch; LOAD tpch; CALL dbgen(sf=0.01)")
        con.close()

        manifest_str = base64.b64encode(orjson.dumps(self.manifest)).decode()
        conn_info = {"url": str(db_dir), "format": "duckdb"}
        with WrenEngine(
            manifest_str, DataSource.duckdb, conn_info, fallback=False
        ) as e:
            yield e
