"""Unit tests for the wren.memory module."""

from __future__ import annotations

import pytest

from wren.memory.schema_indexer import (
    describe_schema,
    extract_schema_items,
    manifest_hash,
)

# ── Fixtures ──────────────────────────────────────────────────────────────

_MANIFEST = {
    "catalog": "test",
    "schema": "public",
    "models": [
        {
            "name": "orders",
            "tableReference": "test.public.orders",
            "primaryKey": "o_orderkey",
            "properties": {
                "description": "Order facts ready for analysis",
                "dbtLayer": "mart",
                "dataScope": "status != 'cancelled'",
            },
            "columns": [
                {
                    "name": "o_orderkey",
                    "type": "varchar",
                    "isCalculated": False,
                    "isPrimaryKey": True,
                    "notNull": True,
                    "properties": {
                        "dbtTests": "not_null,unique",
                        "dbtTestStatus": "verified",
                    },
                },
                {"name": "o_custkey", "type": "varchar", "isCalculated": False},
                {
                    "name": "o_status",
                    "type": "varchar",
                    "isCalculated": False,
                    "properties": {
                        "acceptedValues": "placed,shipped,completed",
                        "dbtTests": "accepted_values",
                        "dbtTestStatus": "verified",
                    },
                },
                {
                    "name": "o_totalprice",
                    "type": "double",
                    "isCalculated": True,
                    "expression": "sum(l_extendedprice)",
                },
                {
                    "name": "customer",
                    "type": "varchar",
                    "isCalculated": False,
                    "relationship": "orders_customer",
                },
            ],
        },
        {
            "name": "customer",
            "tableReference": "test.public.customer",
            "primaryKey": "c_custkey",
            "columns": [
                {"name": "c_custkey", "type": "varchar", "isCalculated": False},
                {"name": "c_name", "type": "varchar", "isCalculated": False},
            ],
            "properties": {
                "description": "Customer master data",
                "dbtLayer": "mart",
            },
        },
    ],
    "relationships": [
        {
            "name": "orders_customer",
            "models": ["orders", "customer"],
            "joinType": "many_to_one",
            "condition": "orders.o_custkey = customer.c_custkey",
        }
    ],
    "views": [
        {
            "name": "top_customers",
            "statement": "SELECT c_name, sum(o_totalprice) FROM orders JOIN customer LIMIT 10",
        }
    ],
}


# ── manifest_hash tests ───────────────────────────────────────────────────


@pytest.mark.unit
class TestManifestHash:
    def test_deterministic(self):
        h1 = manifest_hash(_MANIFEST)
        h2 = manifest_hash(_MANIFEST)
        assert h1 == h2
        assert len(h1) == 16

    def test_changes_on_modification(self):
        modified = {**_MANIFEST, "catalog": "other"}
        assert manifest_hash(_MANIFEST) != manifest_hash(modified)


# ── extract_schema_items tests ────────────────────────────────────────────


@pytest.mark.unit
class TestExtractSchemaItems:
    def test_total_count(self):
        items = extract_schema_items(_MANIFEST)
        # 2 models + 7 columns + 1 relationship + 1 view = 11
        assert len(items) == 11

    def test_item_types(self):
        items = extract_schema_items(_MANIFEST)
        types = {item["item_type"] for item in items}
        assert types == {"model", "column", "relationship", "view"}

    def test_model_record(self):
        items = extract_schema_items(_MANIFEST)
        models = [i for i in items if i["item_type"] == "model"]
        assert len(models) == 2
        orders = next(m for m in models if m["item_name"] == "orders")
        assert "o_orderkey" in orders["text"]
        assert orders["model_name"] == "orders"
        assert "mart layer" in orders["text"]
        assert "status != 'cancelled'" in orders["text"]

    def test_model_with_description(self):
        items = extract_schema_items(_MANIFEST)
        models = [i for i in items if i["item_type"] == "model"]
        customer = next(m for m in models if m["item_name"] == "customer")
        assert "Customer master data" in customer["text"]

    def test_column_calculated(self):
        items = extract_schema_items(_MANIFEST)
        cols = [i for i in items if i["item_type"] == "column"]
        calc = next(c for c in cols if c["item_name"] == "o_totalprice")
        assert calc["is_calculated"] is True
        assert "sum(l_extendedprice)" in calc["text"]
        assert calc["expression"] == "sum(l_extendedprice)"

    def test_column_relationship(self):
        items = extract_schema_items(_MANIFEST)
        cols = [i for i in items if i["item_type"] == "column"]
        rel_col = next(c for c in cols if c["item_name"] == "customer")
        assert "orders_customer" in rel_col["text"]

    def test_column_includes_dbt_metadata(self):
        items = extract_schema_items(_MANIFEST)
        cols = [i for i in items if i["item_type"] == "column"]
        status_col = next(c for c in cols if c["item_name"] == "o_status")
        assert "Accepted values: placed, shipped, completed" in status_col["text"]
        assert "accepted_values" in status_col["text"]
        assert "Test status: verified" in status_col["text"]

    def test_relationship_record(self):
        items = extract_schema_items(_MANIFEST)
        rels = [i for i in items if i["item_type"] == "relationship"]
        assert len(rels) == 1
        r = rels[0]
        assert r["item_name"] == "orders_customer"
        assert "many_to_one" in r["text"]

    def test_view_record(self):
        items = extract_schema_items(_MANIFEST)
        views = [i for i in items if i["item_type"] == "view"]
        assert len(views) == 1
        assert "top_customers" in views[0]["text"]

    def test_all_items_have_required_keys(self):
        items = extract_schema_items(_MANIFEST)
        required = {
            "text",
            "item_type",
            "model_name",
            "item_name",
            "mdl_hash",
            "indexed_at",
        }
        for item in items:
            assert required.issubset(item.keys()), f"Missing keys in {item}"

    def test_empty_manifest(self):
        items = extract_schema_items({})
        assert items == []

    def test_manifest_without_optional_sections(self):
        minimal = {"models": [{"name": "t1", "columns": []}]}
        items = extract_schema_items(minimal)
        assert len(items) == 1
        assert items[0]["item_type"] == "model"


# ── describe_schema tests ─────────────────────────────────────────────────


@pytest.mark.unit
class TestDescribeSchema:
    def test_contains_model_names(self):
        text = describe_schema(_MANIFEST)
        assert "### Model: orders [mart layer]" in text
        assert "### Model: customer [mart layer]" in text

    def test_contains_columns(self):
        text = describe_schema(_MANIFEST)
        assert "o_orderkey (varchar)" in text
        assert "o_totalprice (double)" in text
        assert "o_status (varchar)" in text

    def test_contains_calculated_expression(self):
        text = describe_schema(_MANIFEST)
        assert "[calculated: sum(l_extendedprice)]" in text

    def test_contains_relationship_column(self):
        text = describe_schema(_MANIFEST)
        assert "[relationship: orders_customer]" in text

    def test_contains_relationship_section(self):
        text = describe_schema(_MANIFEST)
        assert "### Relationship: orders_customer" in text
        assert "many_to_one" in text

    def test_contains_view(self):
        text = describe_schema(_MANIFEST)
        assert "### View: top_customers" in text

    def test_contains_description(self):
        text = describe_schema(_MANIFEST)
        assert "Customer master data" in text

    def test_contains_primary_key(self):
        text = describe_schema(_MANIFEST)
        assert "Primary key: o_orderkey" in text
        assert "PRIMARY KEY" in text

    def test_contains_data_scope_and_accepted_values(self):
        text = describe_schema(_MANIFEST)
        assert "Data scope: status != 'cancelled'" in text
        assert "[accepted values: placed, shipped, completed]" in text
        assert "[test status: verified]" in text

    def test_contains_list_accepted_values(self):
        manifest = {
            "models": [
                {
                    "name": "customers",
                    "columns": [
                        {
                            "name": "name",
                            "type": "VARCHAR",
                            "properties": {"acceptedValues": ["Smith, John", "Ada"]},
                        }
                    ],
                }
            ]
        }
        text = describe_schema(manifest)
        assert "[accepted values: Smith, John, Ada]" in text

    def test_excludes_table_reference(self):
        text = describe_schema(_MANIFEST)
        assert "tableReference" not in text
        assert "test.public.orders" not in text
        assert "test.public.customer" not in text

    def test_empty_manifest(self):
        text = describe_schema({})
        assert text == ""

    def test_return_type_is_string(self):
        text = describe_schema(_MANIFEST)
        assert isinstance(text, str)
        assert len(text) > 0


# ── MemoryStore integration tests ─────────────────────────────────────────
# These require lancedb + sentence-transformers (wren[memory] extra).


@pytest.fixture
def memory_store(tmp_path):
    """Create a MemoryStore backed by a temp directory."""
    pytest.importorskip("lancedb", reason="wren[memory] extras not installed")
    pytest.importorskip(
        "sentence_transformers", reason="wren[memory] extras not installed"
    )

    from wren.memory.store import MemoryStore  # noqa: PLC0415

    return MemoryStore(path=tmp_path)


@pytest.mark.unit
class TestMemoryStore:
    def test_index_and_context(self, memory_store):
        result = memory_store.index_schema(_MANIFEST)
        assert result["schema_items"] == 11

        # Small schema → full strategy
        ctx = memory_store.get_context(_MANIFEST, "customer order price")
        assert ctx["strategy"] == "full"
        assert "### Model: orders" in ctx["schema"]

    def test_context_search_strategy(self, memory_store):
        memory_store.index_schema(_MANIFEST)
        result = memory_store.get_context(_MANIFEST, "customer orders", threshold=10)
        assert result["strategy"] == "search"
        assert "results" in result
        assert len(result["results"]) > 0
        assert "text" in result["results"][0]

    def test_context_search_with_type_filter(self, memory_store):
        memory_store.index_schema(_MANIFEST)
        result = memory_store.get_context(
            _MANIFEST, "order", item_type="model", threshold=10
        )
        assert result["strategy"] == "search"
        assert all(r["item_type"] == "model" for r in result["results"])

    def test_context_search_with_model_filter(self, memory_store):
        memory_store.index_schema(_MANIFEST)
        result = memory_store.get_context(
            _MANIFEST, "price", model_name="orders", threshold=10
        )
        assert result["strategy"] == "search"
        assert all(r["model_name"] == "orders" for r in result["results"])

    def test_context_empty_store(self, memory_store):
        result = memory_store.get_context(_MANIFEST, "anything", threshold=10)
        assert result["strategy"] == "search"
        assert result["results"] == []

    def test_schema_is_current(self, memory_store):
        memory_store.index_schema(_MANIFEST)
        assert memory_store.schema_is_current(_MANIFEST) is True

        modified = {**_MANIFEST, "catalog": "changed"}
        assert memory_store.schema_is_current(modified) is False

    def test_store_and_recall_query(self, memory_store):
        memory_store.store_query(
            nl_query="show top customers by revenue",
            sql_query="SELECT c_name, sum(o_totalprice) FROM orders GROUP BY 1 ORDER BY 2 DESC",
            datasource="postgres",
        )
        results = memory_store.recall_queries("best customers", limit=1)
        assert len(results) == 1
        assert "top customers" in results[0]["nl_query"]
        assert "SELECT" in results[0]["sql_query"]

    def test_recall_empty_store(self, memory_store):
        results = memory_store.recall_queries("anything")
        assert results == []

    def test_status(self, memory_store):
        info = memory_store.status()
        assert "path" in info
        assert "tables" in info

        memory_store.index_schema(_MANIFEST)
        info = memory_store.status()
        assert info["tables"]["schema_items"] == 11

    def test_reset(self, memory_store):
        memory_store.index_schema(_MANIFEST)
        memory_store.reset()
        info = memory_store.status()
        assert info["tables"] == {}

    def test_describe_schema_static(self, memory_store):
        text = memory_store.describe_schema(_MANIFEST)
        assert "### Model: orders" in text

    def test_index_replace(self, memory_store):
        memory_store.index_schema(_MANIFEST)
        result = memory_store.index_schema(_MANIFEST, replace=True)
        assert result["schema_items"] == 11
        info = memory_store.status()
        assert info["tables"]["schema_items"] == 11


# ── WrenMemory public API tests ───────────────────────────────────────────


@pytest.fixture
def wren_memory(tmp_path):
    """Create a WrenMemory instance backed by a temp directory."""
    pytest.importorskip("lancedb", reason="wren[memory] extras not installed")
    pytest.importorskip(
        "sentence_transformers", reason="wren[memory] extras not installed"
    )

    from wren.memory import WrenMemory  # noqa: PLC0415

    return WrenMemory(path=tmp_path)


@pytest.mark.unit
class TestWrenMemory:
    def test_full_lifecycle(self, wren_memory):
        result = wren_memory.index_manifest(_MANIFEST)
        assert result["schema_items"] == 11

        ctx = wren_memory.get_context(_MANIFEST, "customer")
        assert ctx["strategy"] == "full"
        assert "### Model: customer" in ctx["schema"]

        wren_memory.store_query(
            nl_query="find expensive orders",
            sql_query="SELECT * FROM orders WHERE o_totalprice > 1000",
        )
        recalled = wren_memory.recall_queries("costly orders")
        assert len(recalled) >= 1
        assert any(r["nl_query"] == "find expensive orders" for r in recalled)

        assert wren_memory.schema_is_current(_MANIFEST)

        status = wren_memory.status()
        assert status["tables"]["schema_items"] == 11
        # query_history has 1 user query + seed queries
        assert status["tables"]["query_history"] >= 1

        wren_memory.reset()
        assert wren_memory.status()["tables"] == {}


# ── MemoryStore seed lifecycle tests ─────────────────────────────────────


@pytest.mark.unit
class TestMemoryStoreSeedLifecycle:
    def test_index_schema_seeds_query_history(self, memory_store):
        from wren.memory.seed_queries import SEED_TAG  # noqa: PLC0415

        result = memory_store.index_schema(_MANIFEST, seed_queries=True)
        assert result["seed_queries"] > 0

        table = memory_store._db.open_table("query_history")
        df = table.to_pandas()
        seeds = df[df["tags"] == SEED_TAG]
        assert len(seeds) == result["seed_queries"]

    def test_index_schema_no_seed_flag(self, memory_store):
        result = memory_store.index_schema(_MANIFEST, seed_queries=False)
        assert result["seed_queries"] == 0
        from wren.memory.store import _table_names  # noqa: PLC0415

        assert "query_history" not in _table_names(memory_store._db)

    def test_reindex_replaces_seeds_preserves_user_queries(self, memory_store):
        from wren.memory.seed_queries import SEED_TAG  # noqa: PLC0415

        # Index once to create seeds
        first = memory_store.index_schema(_MANIFEST, seed_queries=True)
        seed_count = first["seed_queries"]
        assert seed_count > 0

        # Store a user-confirmed query (no seed tag)
        memory_store.store_query(
            nl_query="show me the most expensive orders",
            sql_query="SELECT * FROM orders ORDER BY o_totalprice DESC LIMIT 10",
        )

        table = memory_store._db.open_table("query_history")
        total_before = table.count_rows()
        assert total_before == seed_count + 1

        # Re-index — seeds should be replaced, user entry preserved
        second = memory_store.index_schema(_MANIFEST, seed_queries=True)
        assert second["seed_queries"] == seed_count

        table = memory_store._db.open_table("query_history")
        df = table.to_pandas()
        seeds = df[df["tags"] == SEED_TAG]
        user_rows = df[df["tags"] != SEED_TAG]
        assert len(seeds) == seed_count
        assert len(user_rows) == 1
        assert "expensive orders" in user_rows.iloc[0]["nl_query"]

    def test_recall_returns_seed_entries(self, memory_store):
        from wren.memory.seed_queries import SEED_TAG  # noqa: PLC0415

        memory_store.index_schema(_MANIFEST, seed_queries=True)
        results = memory_store.recall_queries("list all orders", limit=5)
        assert len(results) > 0
        # At least one result should be a seed entry
        tags = [r.get("tags", "") for r in results]
        assert any(t == SEED_TAG for t in tags)

    def test_index_schema_returns_dict(self, memory_store):
        result = memory_store.index_schema(_MANIFEST)
        assert isinstance(result, dict)
        assert "schema_items" in result
        assert "seed_queries" in result
        assert result["schema_items"] == 11


# ── list_queries / forget / dump / load tests ────────────────────────────


def _seed_pairs(memory_store, n=3):
    """Insert N user query pairs and return them."""
    pairs = []
    for i in range(n):
        nl = f"query number {i}"
        sql = f"SELECT {i} FROM t"
        memory_store.store_query(nl_query=nl, sql_query=sql, tags="source:user")
        pairs.append({"nl": nl, "sql": sql, "source": "user"})
    return pairs


@pytest.mark.unit
class TestMemoryStoreList:
    def test_list_empty(self, memory_store):
        rows, total = memory_store.list_queries()
        assert rows == []
        assert total == 0

    def test_list_returns_rows(self, memory_store):
        _seed_pairs(memory_store, 3)
        rows, total = memory_store.list_queries()
        assert total == 3
        assert len(rows) == 3
        assert "nl_query" in rows[0]
        assert "sql_query" in rows[0]
        assert "_row_id" in rows[0]
        assert "vector" not in rows[0]

    def test_list_pagination(self, memory_store):
        _seed_pairs(memory_store, 5)
        rows, total = memory_store.list_queries(limit=2, offset=0)
        assert total == 5
        assert len(rows) == 2

        rows2, _ = memory_store.list_queries(limit=2, offset=2)
        assert len(rows2) == 2

        rows3, _ = memory_store.list_queries(limit=2, offset=4)
        assert len(rows3) == 1

    def test_list_source_filter(self, memory_store):
        memory_store.store_query(
            nl_query="seed q", sql_query="SELECT 1", tags="source:seed"
        )
        memory_store.store_query(
            nl_query="user q", sql_query="SELECT 2", tags="source:user"
        )
        rows, total = memory_store.list_queries(source="seed")
        assert total == 1
        assert "seed q" in rows[0]["nl_query"]


@pytest.mark.unit
class TestMemoryStoreForget:
    def test_forget_by_ids(self, memory_store):
        _seed_pairs(memory_store, 3)
        deleted = memory_store.forget_queries_by_ids([0])
        assert deleted == 1
        _, total = memory_store.list_queries()
        assert total == 2

    def test_forget_by_ids_multiple(self, memory_store):
        _seed_pairs(memory_store, 5)
        deleted = memory_store.forget_queries_by_ids([0, 2, 4])
        assert deleted == 3
        _, total = memory_store.list_queries()
        assert total == 2

    def test_forget_by_ids_invalid(self, memory_store):
        _seed_pairs(memory_store, 2)
        deleted = memory_store.forget_queries_by_ids([99])
        assert deleted == 0
        _, total = memory_store.list_queries()
        assert total == 2

    def test_forget_by_source(self, memory_store):
        memory_store.store_query(
            nl_query="seed q", sql_query="SELECT 1", tags="source:seed"
        )
        memory_store.store_query(
            nl_query="user q", sql_query="SELECT 2", tags="source:user"
        )
        deleted = memory_store.forget_queries_by_source("seed")
        assert deleted == 1
        _, total = memory_store.list_queries()
        assert total == 1

    def test_count_by_source(self, memory_store):
        memory_store.store_query(nl_query="a", sql_query="SELECT 1", tags="source:seed")
        memory_store.store_query(nl_query="b", sql_query="SELECT 2", tags="source:seed")
        memory_store.store_query(nl_query="c", sql_query="SELECT 3", tags="source:user")
        assert memory_store.count_queries_by_source("seed") == 2
        assert memory_store.count_queries_by_source("user") == 1
        assert memory_store.count_queries_by_source("view") == 0

    def test_forget_empty_store(self, memory_store):
        assert memory_store.forget_queries_by_ids([0]) == 0
        assert memory_store.forget_queries_by_source("seed") == 0


@pytest.mark.unit
class TestMemoryStoreDump:
    def test_dump_empty(self, memory_store):
        rows = memory_store.dump_queries()
        assert rows == []

    def test_dump_returns_all(self, memory_store):
        _seed_pairs(memory_store, 3)
        rows = memory_store.dump_queries()
        assert len(rows) == 3
        assert "nl_query" in rows[0]
        assert "vector" not in rows[0]

    def test_dump_source_filter(self, memory_store):
        memory_store.store_query(nl_query="a", sql_query="SELECT 1", tags="source:seed")
        memory_store.store_query(nl_query="b", sql_query="SELECT 2", tags="source:user")
        rows = memory_store.dump_queries(source="user")
        assert len(rows) == 1
        assert rows[0]["nl_query"] == "b"


@pytest.mark.unit
class TestMemoryStoreLoad:
    def test_load_skip_duplicates(self, memory_store):
        pairs = [
            {"nl": "q1", "sql": "SELECT 1", "source": "user"},
            {"nl": "q2", "sql": "SELECT 2", "source": "user"},
        ]
        r1 = memory_store.load_queries(pairs)
        assert r1 == {"loaded": 2, "skipped": 0, "updated": 0}

        # Load again — should skip all
        r2 = memory_store.load_queries(pairs)
        assert r2 == {"loaded": 0, "skipped": 2, "updated": 0}

    def test_load_upsert(self, memory_store):
        pairs_v1 = [{"nl": "revenue", "sql": "SELECT old", "source": "user"}]
        memory_store.load_queries(pairs_v1)

        pairs_v2 = [{"nl": "revenue", "sql": "SELECT new", "source": "user"}]
        r = memory_store.load_queries(pairs_v2, upsert=True)
        assert r == {"loaded": 0, "skipped": 0, "updated": 1}

        # Verify the updated value
        rows = memory_store.dump_queries()
        sqls = {row["nl_query"]: row["sql_query"] for row in rows}
        assert sqls["revenue"] == "SELECT new"

    def test_load_overwrite(self, memory_store):
        memory_store.store_query(
            nl_query="old", sql_query="SELECT old", tags="source:user"
        )
        pairs = [{"nl": "new", "sql": "SELECT new", "source": "user"}]
        r = memory_store.load_queries(pairs, overwrite=True)
        assert r == {"loaded": 1, "skipped": 0, "updated": 0}

        rows = memory_store.dump_queries()
        assert len(rows) == 1
        assert rows[0]["nl_query"] == "new"

    def test_load_with_datasource(self, memory_store):
        pairs = [
            {"nl": "q1", "sql": "SELECT 1", "source": "user", "datasource": "pg"},
        ]
        memory_store.load_queries(pairs)
        rows = memory_store.dump_queries()
        assert rows[0]["datasource"] == "pg"

    def test_existing_pairs_index(self, memory_store):
        memory_store.store_query(nl_query="a", sql_query="SELECT 1")
        memory_store.store_query(nl_query="b", sql_query="SELECT 2")
        exact_set, nl_map = memory_store._existing_pairs_index()
        assert ("a", "SELECT 1") in exact_set
        assert ("b", "SELECT 2") in exact_set
        assert "a" in nl_map
        assert "b" in nl_map


# ── CLI dump/load YAML round-trip tests ──────────────────────────────────


@pytest.mark.unit
class TestYamlRoundTrip:
    def test_pairs_to_yaml_and_back(self, memory_store):
        from wren.memory.cli import _pairs_to_yaml  # noqa: PLC0415

        memory_store.store_query(
            nl_query="revenue by month",
            sql_query="SELECT month, SUM(revenue) FROM orders GROUP BY month",
            datasource="pg",
            tags="source:user",
        )
        memory_store.store_query(
            nl_query="all orders",
            sql_query="SELECT * FROM orders",
            tags="source:seed",
        )

        rows = memory_store.dump_queries()
        yaml_str = _pairs_to_yaml(rows)

        import yaml  # noqa: PLC0415

        doc = yaml.safe_load(yaml_str)
        assert doc["version"] == 1
        assert "exported_at" in doc
        assert len(doc["pairs"]) == 2

        # Verify source extraction
        sources = {p["source"] for p in doc["pairs"]}
        assert sources == {"user", "seed"}

        # Load back
        result = memory_store.load_queries(doc["pairs"])
        # All should be skipped as duplicates
        assert result["skipped"] == 2
        assert result["loaded"] == 0
