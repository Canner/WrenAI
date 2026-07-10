"""Shared query test suite for WrenEngine connector tests.

How to add tests for a new data source
=======================================

Step 1 — Create the test file
------------------------------
Add ``tests/connectors/test_<name>.py``.  Copy the skeleton below and fill in
the three required parts: pytest mark, manifest, and engine fixture.

    # tests/connectors/test_clickhouse.py
    import base64
    import orjson
    import pytest
    from testcontainers.clickhouse import ClickHouseContainer

    from wren import WrenEngine
    from wren.model.data_source import DataSource
    from tests.suite.manifests import make_tpch_manifest
    from tests.suite.query import WrenQueryTestSuite

    pytestmark = pytest.mark.clickhouse          # (1) marker for `just test-connector clickhouse`

    class TestClickHouse(WrenQueryTestSuite):
        manifest = make_tpch_manifest(           # (2) manifest — adjust catalog/schema
            table_catalog=None,                  #     to match where TPCH data lands
            table_schema="default",
        )
        order_id_dtype = "int64"                 # (3) override any differing expectations

        @pytest.fixture(scope="class")
        def engine(self):                        # (4) engine fixture — class-scoped
            with ClickHouseContainer() as ch:
                _load_tpch(ch.get_connection_url())
                conn_info = { ... }
                manifest_str = base64.b64encode(orjson.dumps(self.manifest)).decode()
                with WrenEngine(manifest_str, DataSource.clickhouse, conn_info, fallback=False) as e:
                    yield e

Step 2 — Register the pytest marker
-------------------------------------
Add one line to ``tests/conftest.py``::

    config.addinivalue_line("markers", "clickhouse: ClickHouse connector tests — requires Docker")

Step 3 — Run the new tests
----------------------------
Install the connector extra if needed::

    just install-extra clickhouse

Then run::

    just test-connector clickhouse

All ``WrenQueryTestSuite`` tests run automatically.  Any ``test_*`` methods you
add directly to ``TestClickHouse`` run alongside them.

Overridable class variables
----------------------------
Override these in the subclass to match what the connector actually returns:

    order_count    int   Total rows in TPCH orders table (default 15000, sf=0.01)
    customer_count int   Total rows in TPCH customer table (default 1500, sf=0.01)
    order_id_dtype str   Arrow dtype string for o_orderkey (default "int32")

Example::

    class TestClickHouse(WrenQueryTestSuite):
        order_id_dtype = "int64"   # ClickHouse INT32 → Arrow int64

Adding connector-specific tests
---------------------------------
Add ``test_*`` methods directly to the subclass — pytest discovers them
alongside all inherited tests::

    class TestClickHouse(WrenQueryTestSuite):
        ...

        def test_array_column(self, engine):
            result = engine.query('SELECT array_col FROM "orders" LIMIT 1')
            assert result.num_rows == 1

Sharing tests across a subset of connectors (mix-ins)
-------------------------------------------------------
For capabilities shared by *some* connectors (e.g. timezone, window functions),
define a separate mix-in class and include it only where relevant::

    # tests/suite/timezone.py
    class TimezoneTestSuite:
        def test_timestamptz(self, engine): ...

    # tests/connectors/test_postgres.py
    class TestPostgres(WrenQueryTestSuite, TimezoneTestSuite):
        ...   # gets core tests + timezone tests

    # tests/connectors/test_duckdb.py
    class TestDuckDB(WrenQueryTestSuite):
        ...   # gets only core tests
"""

from __future__ import annotations

import base64
from typing import ClassVar

import orjson
import pyarrow as pa
import pytest

from wren import WrenEngine
from wren.model.error import WrenError


class WrenQueryTestSuite:
    """Abstract base class providing shared query tests for all connectors.

    Each subclass must:
    - Set ``manifest`` to a connector-appropriate MDL dict.
    - Provide a class-scoped ``engine`` fixture returning a ``WrenEngine``.
    """

    # Subclass must set this
    manifest: ClassVar[dict]

    # Overridable expectations — connectors may differ on counts or dtypes
    order_count: ClassVar[int] = 15000  # TPCH sf=0.01
    customer_count: ClassVar[int] = 1500  # TPCH sf=0.01
    order_id_dtype: ClassVar[str] = "int32"  # Postgres INTEGER → Arrow int32

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @pytest.fixture(scope="class")
    def manifest_str(self) -> str:
        return base64.b64encode(orjson.dumps(self.manifest)).decode()

    # ------------------------------------------------------------------
    # Query execution tests
    # ------------------------------------------------------------------

    def test_basic_select(self, engine: WrenEngine) -> None:
        result = engine.query(
            'SELECT o_orderkey, o_custkey, o_orderstatus FROM "orders" ORDER BY o_orderkey LIMIT 1'
        )
        assert isinstance(result, pa.Table)
        assert result.num_rows == 1
        assert result.column_names == ["o_orderkey", "o_custkey", "o_orderstatus"]
        # TPCH sf=0.01: first order row (orderkey=1)
        assert result["o_orderkey"][0].as_py() == 1

    def test_count(self, engine: WrenEngine) -> None:
        result = engine.query('SELECT COUNT(*) AS cnt FROM "orders"')
        assert result["cnt"][0].as_py() == self.order_count

    def test_query_with_limit(self, engine: WrenEngine) -> None:
        # engine.query limit= parameter truncates the result
        result = engine.query(
            'SELECT o_orderkey FROM "orders" ORDER BY o_orderkey', limit=3
        )
        assert result.num_rows == 3

    def test_calculated_field(self, engine: WrenEngine) -> None:
        result = engine.query(
            'SELECT o_orderkey, o_custkey, order_cust_key FROM "orders" ORDER BY o_orderkey LIMIT 1'
        )
        assert result.num_rows == 1
        orderkey = result["o_orderkey"][0].as_py()
        custkey = result["o_custkey"][0].as_py()
        calc = result["order_cust_key"][0].as_py()
        assert calc == f"{orderkey}_{custkey}"

    def test_explicit_join(self, engine: WrenEngine) -> None:
        result = engine.query(
            """
            SELECT o.o_orderkey, c.c_name
            FROM "orders" o
            JOIN "customer" c ON o.o_custkey = c.c_custkey
            ORDER BY o.o_orderkey
            LIMIT 5
            """
        )
        assert result.num_rows == 5
        assert "o_orderkey" in result.column_names
        assert "c_name" in result.column_names

    def test_order_id_dtype(self, engine: WrenEngine) -> None:
        result = engine.query('SELECT o_orderkey FROM "orders" LIMIT 1')
        field = result.schema.field("o_orderkey")
        assert str(field.type) == self.order_id_dtype

    # ------------------------------------------------------------------
    # Dry run tests
    # ------------------------------------------------------------------

    def test_dry_run_valid(self, engine: WrenEngine) -> None:
        # Should not raise
        engine.dry_run('SELECT * FROM "orders" LIMIT 1')

    def test_dry_run_invalid_table(self, engine: WrenEngine) -> None:
        with pytest.raises(WrenError):
            engine.dry_run('SELECT * FROM "NotFound"')

    # ------------------------------------------------------------------
    # dry-plan tests (no DB access)
    # ------------------------------------------------------------------

    def test_dry_plan_returns_sql(self, engine: WrenEngine) -> None:
        planned = engine.dry_plan('SELECT o_orderkey FROM "orders" LIMIT 1')
        assert isinstance(planned, str)
        assert len(planned) > 0
        assert "orders" in planned.lower()
