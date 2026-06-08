"""Integration tests for GenBI cube panels against a real DuckDB cube.

Uses DuckDB's built-in TPCH extension (no Docker) to back a cube, then proves
the substance of interactive data apps:

* switching a dimension produces *different governed SQL and different results*
  (S6) — without any raw SQL string interpolation;
* a filter value narrows the governed result (S6);
* the raw-SQL escape hatch is dry-plan validated before it runs (S8);
* a Streamlit app whose selectbox drives the cube spec re-queries on change,
  exercised headlessly via ``streamlit.testing`` (S6).
"""

from __future__ import annotations

import base64

import duckdb
import orjson
import pytest

from wren import WrenEngine
from wren.genbi import panel
from wren.model.data_source import DataSource

pytestmark = pytest.mark.duckdb

_CATALOG = "tpch"
_SCHEMA = "main"


def _cube_manifest() -> dict:
    return {
        "catalog": "wren",
        "schema": "public",
        "models": [
            {
                "name": "orders",
                "tableReference": {
                    "catalog": _CATALOG,
                    "schema": _SCHEMA,
                    "table": "orders",
                },
                "columns": [
                    {"name": "o_orderkey", "type": "integer"},
                    {"name": "o_orderstatus", "type": "varchar"},
                    {"name": "o_orderpriority", "type": "varchar"},
                    {"name": "o_totalprice", "type": "double"},
                    {"name": "o_orderdate", "type": "date"},
                ],
                "primaryKey": "o_orderkey",
            }
        ],
        "cubes": [
            {
                "name": "order_metrics",
                "baseObject": "orders",
                "measures": [
                    {
                        "name": "revenue",
                        "expression": "SUM(o_totalprice)",
                        "type": "DOUBLE",
                    },
                    {"name": "order_count", "expression": "COUNT(*)", "type": "BIGINT"},
                ],
                "dimensions": [
                    {
                        "name": "status",
                        "expression": "o_orderstatus",
                        "type": "VARCHAR",
                    },
                    {
                        "name": "priority",
                        "expression": "o_orderpriority",
                        "type": "VARCHAR",
                    },
                ],
                "timeDimensions": [
                    {"name": "created_at", "expression": "o_orderdate", "type": "DATE"}
                ],
            }
        ],
    }


@pytest.fixture(scope="module")
def db_dir(tmp_path_factory):
    d = tmp_path_factory.mktemp("genbi_duckdb")
    con = duckdb.connect(str(d / "tpch.duckdb"))
    con.execute("INSTALL tpch; LOAD tpch; CALL dbgen(sf=0.01)")
    con.close()
    return d


@pytest.fixture(scope="module")
def manifest_json() -> str:
    return orjson.dumps(_cube_manifest()).decode()


def _engine(db_dir) -> WrenEngine:
    manifest_b64 = base64.b64encode(orjson.dumps(_cube_manifest())).decode()
    return WrenEngine(
        manifest_b64,
        DataSource.duckdb,
        {"url": str(db_dir), "format": "duckdb"},
        fallback=False,
    )


@pytest.fixture
def engine(db_dir):
    with _engine(db_dir) as e:
        yield e


def test_switching_dimension_changes_governed_results(engine, manifest_json):
    q_status = panel.build_cube_query(
        cube="order_metrics", measures=["revenue"], dimensions=["status"]
    )
    q_priority = panel.build_cube_query(
        cube="order_metrics", measures=["revenue"], dimensions=["priority"]
    )
    sql_status = panel.spec_to_sql(q_status, manifest_json)
    sql_priority = panel.spec_to_sql(q_priority, manifest_json)
    assert sql_status != sql_priority

    df_status = engine.query(sql_status).to_pandas()
    df_priority = engine.query(sql_priority).to_pandas()

    assert "status" in df_status.columns
    assert "priority" in df_priority.columns
    # Different grouping → different result shape (TPCH: 3 statuses, 5 priorities)
    assert set(df_status.columns) != set(df_priority.columns)
    assert len(df_status) != len(df_priority)


def test_filter_value_narrows_results(engine, manifest_json):
    q_all = panel.build_cube_query(
        cube="order_metrics", measures=["order_count"], dimensions=["status"]
    )
    q_filtered = panel.build_cube_query(
        cube="order_metrics",
        measures=["order_count"],
        dimensions=["status"],
        filters=[{"dimension": "status", "operator": "eq", "value": "O"}],
    )
    df_all = engine.query(panel.spec_to_sql(q_all, manifest_json)).to_pandas()
    df_filtered = engine.query(panel.spec_to_sql(q_filtered, manifest_json)).to_pandas()

    # Unfiltered sees every status; filtered sees only 'O'.
    assert len(df_all) > len(df_filtered)
    assert set(df_filtered["status"]) == {"O"}


def test_raw_sql_escape_hatch_validates(engine):
    # Valid SQL over a model dry-plans and runs.
    panel.validate_raw_sql(engine, "SELECT o_orderstatus FROM orders LIMIT 1")
    df = engine.query("SELECT o_orderstatus FROM orders LIMIT 1").to_pandas()
    assert "o_orderstatus" in df.columns


def test_raw_sql_escape_hatch_rejects_bad_sql(engine):
    with pytest.raises(Exception):
        panel.validate_raw_sql(engine, "SELECT * FROM table_that_does_not_exist")


@pytest.mark.genbi
def test_apptest_selectbox_drives_cube_spec(db_dir, manifest_json, monkeypatch):
    """A selectbox bound to the cube's dimension re-queries on change."""
    AppTest = pytest.importorskip("streamlit.testing.v1").AppTest

    # cube_panel resolves the engine/manifest via app_runtime; point both at the
    # fixture. A fresh engine per call keeps the DuckDB connection in-thread.
    monkeypatch.setattr("wren.genbi.app_runtime.get_engine", lambda: _engine(db_dir))
    monkeypatch.setattr(
        "wren.genbi.app_runtime.get_manifest_json", lambda: manifest_json
    )

    script = (
        "import streamlit as st\n"
        "from wren.genbi.panel import cube_panel\n"
        "dim = st.selectbox('Group by', ['status', 'priority'])\n"
        "cube_panel(cube='order_metrics', measures=['revenue'],\n"
        "           dimensions=[dim], chart='table', title='Revenue')\n"
    )

    at = AppTest.from_string(script).run(timeout=30)
    assert not at.exception
    assert len(at.dataframe) == 1
    rows_status = at.dataframe[0].value.shape[0]

    at.selectbox[0].set_value("priority").run(timeout=30)
    assert not at.exception
    rows_priority = at.dataframe[0].value.shape[0]
    # TPCH has 3 statuses vs 5 priorities → the rendered table changed.
    assert rows_status != rows_priority
