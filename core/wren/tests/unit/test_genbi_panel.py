"""Unit tests for wren.genbi.panel — the cube-spec data path of cube_panel.

Only the deterministic SQL-building surface is tested here (spec assembly +
governed transpile via the real ``cube_query_to_sql`` binding). The Streamlit
rendering / caching side is not unit-tested. Mirrors the prior art in
``wren-core-py/tests/test_cube.py``.
"""

from __future__ import annotations

import json

import pytest

from wren.genbi import panel

pytestmark = pytest.mark.unit


MANIFEST = json.dumps(
    {
        "catalog": "test",
        "schema": "public",
        "models": [
            {
                "name": "orders",
                "tableReference": {"schema": "main", "table": "orders"},
                "columns": [
                    {"name": "o_totalprice", "type": "double"},
                    {"name": "o_orderstatus", "type": "varchar"},
                    {"name": "o_orderdate", "type": "date"},
                ],
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
                    }
                ],
                "dimensions": [
                    {"name": "status", "expression": "o_orderstatus", "type": "VARCHAR"}
                ],
                "timeDimensions": [
                    {"name": "created_at", "expression": "o_orderdate", "type": "DATE"}
                ],
            }
        ],
    }
)


def test_build_cube_query_basic():
    q = panel.build_cube_query(
        cube="order_metrics", measures=["revenue"], dimensions=["status"]
    )
    assert q["cube"] == "order_metrics"
    assert q["measures"] == ["revenue"]
    assert q["dimensions"] == ["status"]
    # No empty keys leak through.
    assert "timeDimensions" not in q
    assert "filters" not in q


def test_build_cube_query_with_time_dimension_and_filter():
    q = panel.build_cube_query(
        cube="order_metrics",
        measures=["revenue"],
        time_dimension={
            "dimension": "created_at",
            "granularity": "month",
            "dateRange": ["2026-01-01", "2026-03-31"],
        },
        filters=[{"dimension": "status", "operator": "eq", "value": "completed"}],
    )
    assert q["timeDimensions"][0]["dimension"] == "created_at"
    assert q["timeDimensions"][0]["granularity"] == "month"
    assert q["filters"][0]["value"] == "completed"


def test_spec_to_sql_produces_governed_sql():
    q = panel.build_cube_query(
        cube="order_metrics", measures=["revenue"], dimensions=["status"]
    )
    sql = panel.spec_to_sql(q, MANIFEST)
    assert "SUM(o_totalprice) AS revenue" in sql
    assert "o_orderstatus AS status" in sql


def test_spec_to_sql_rejects_unknown_measure():
    # Closed vocabulary: a measure not defined on the cube must be rejected by
    # the engine, never silently passed through to the database.
    q = panel.build_cube_query(cube="order_metrics", measures=["not_a_measure"])
    with pytest.raises(Exception):
        panel.spec_to_sql(q, MANIFEST)
