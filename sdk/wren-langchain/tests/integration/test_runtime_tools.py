"""End-to-end integration: WrenToolkit running real queries against DuckDB."""

from __future__ import annotations

import json

import duckdb

from wren_langchain import WrenToolkit


def test_query_executes_against_duckdb_returns_arrow_table(duckdb_project):
    """toolkit.query against a real DuckDB-backed project returns rows."""
    toolkit = WrenToolkit.from_project(duckdb_project)

    table = toolkit.query("SELECT id, name FROM customers ORDER BY id")

    assert table.column_names == ["id", "name"]
    assert table.to_pylist() == [
        {"id": 1, "name": "Acme"},
        {"id": 2, "name": "Globex"},
    ]


def test_wren_query_tool_returns_envelope_with_real_rows(duckdb_project):
    """The LangChain wren_query tool returns a full envelope from a real query."""
    toolkit = WrenToolkit.from_project(duckdb_project)
    wren_query = next(t for t in toolkit.get_tools() if t.name == "wren_query")

    envelope = wren_query.invoke({"sql": "SELECT id, name FROM customers ORDER BY id"})

    assert envelope["ok"] is True
    assert envelope["data"]["row_count"] == 2
    assert envelope["data"]["rows"][0]["name"] == "Acme"


def test_wren_query_tool_call_returns_json_for_date_and_decimal_rows(duckdb_project):
    """An agent's tool call gets JSON content even when rows hold dates/decimals.

    LangChain builds the ToolMessage content with ``json.dumps`` and falls back
    to ``str()`` on failure, so a raw ``date`` in ``data.rows`` used to hand the
    model a Python repr instead of JSON.
    """
    con = duckdb.connect(str(duckdb_project / "db" / "sample.duckdb"))
    con.execute(
        "CREATE TABLE orders(id INTEGER, order_date DATE, amount DECIMAL(10,2))"
    )
    con.execute("INSERT INTO orders VALUES (1, DATE '2026-05-06', 19.99)")
    con.close()
    manifest_path = duckdb_project / "target" / "mdl.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["models"].append(
        {
            "name": "orders",
            "tableReference": {
                "catalog": "sample",
                "schema": "main",
                "table": "orders",
            },
            "columns": [
                {"name": "id", "type": "integer"},
                {"name": "order_date", "type": "date"},
                {"name": "amount", "type": "decimal(10,2)"},
            ],
            "primaryKey": "id",
        }
    )
    manifest_path.write_text(json.dumps(manifest))

    toolkit = WrenToolkit.from_project(duckdb_project)
    wren_query = next(t for t in toolkit.get_tools() if t.name == "wren_query")

    message = wren_query.invoke(
        {
            "type": "tool_call",
            "id": "call_1",
            "name": "wren_query",
            "args": {"sql": "SELECT id, order_date, amount FROM orders"},
        }
    )

    envelope = json.loads(message.content)
    assert envelope["ok"] is True
    assert envelope["data"]["rows"] == [
        {"id": 1, "order_date": "2026-05-06", "amount": "19.99"}
    ]


def test_wren_list_models_tool_renders_manifest(duckdb_project):
    toolkit = WrenToolkit.from_project(duckdb_project)
    list_models = next(t for t in toolkit.get_tools() if t.name == "wren_list_models")

    envelope = list_models.invoke({})

    assert envelope["ok"] is True
    assert "customers" in envelope["content"]
    assert envelope["data"]["models"][0]["name"] == "customers"


def test_connector_reused_across_queries(duckdb_project):
    """After the first query, ``_connector_cache`` is populated and reused."""
    toolkit = WrenToolkit.from_project(duckdb_project)

    toolkit.query("SELECT 1")
    first_connector = toolkit._connector_cache
    assert first_connector is not None

    toolkit.query("SELECT 2")
    assert toolkit._connector_cache is first_connector
