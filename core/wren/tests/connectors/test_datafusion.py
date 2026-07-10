"""DataFusion connector tests.

Uses DuckDB's TPCH extension to generate Parquet test data, then queries
via DataFusion — no Docker, no external server needed.
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

pytestmark = pytest.mark.datafusion

# DataFusion registers Parquet files in the default catalog/schema.
_CATALOG = "datafusion"
_SCHEMA = "public"


class TestDataFusion(WrenQueryTestSuite):
    manifest = make_tpch_manifest(table_catalog=_CATALOG, table_schema=_SCHEMA)
    # DuckDB TPCH dbgen writes INTEGER as int64 in Parquet
    order_id_dtype = "int64"

    @pytest.fixture(scope="class")
    def engine(self, tmp_path_factory) -> WrenEngine:  # type: ignore[override]
        data_dir = tmp_path_factory.mktemp("datafusion")

        # Generate TPCH sf=0.01 and export as Parquet files.
        con = duckdb.connect()
        con.execute("INSTALL tpch; LOAD tpch; CALL dbgen(sf=0.01)")
        con.execute(
            f"COPY (SELECT * FROM orders) TO '{data_dir}/orders.parquet' (FORMAT PARQUET)"
        )
        con.execute(
            f"COPY (SELECT * FROM customer) TO '{data_dir}/customer.parquet' (FORMAT PARQUET)"
        )
        con.close()

        manifest_str = base64.b64encode(orjson.dumps(self.manifest)).decode()
        conn_info = {"source": str(data_dir), "format": "parquet"}
        with WrenEngine(
            manifest_str, DataSource.datafusion, conn_info, fallback=False
        ) as e:
            yield e
