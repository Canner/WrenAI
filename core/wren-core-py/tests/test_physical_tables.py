"""Physical-table visibility through the execution context.

These tests pin the consumer-facing contract of ``register_parquet`` /
``register_csv``: tables land in the pre-existing default catalog
(``datafusion``.``public``), whose internals are live-shared with derived
execution contexts, so registration is visible through ``query`` /
``dry_run`` / ``list_tables`` regardless of whether it happened before or
after the derived execution context was created.

Deliberately NOT tested: creating a brand-new *top-level* catalog after a
derived context exists. Top-level catalog membership is snapshotted when a
derived context is created and later additions are outside the visibility
contract (see ``clone_catalog_list`` in wren-core's ``mdl::context``).
"""

import base64
import io
import json

import pyarrow as pa
import pyarrow.parquet as pq
from pyarrow import ipc
from wren_core import SessionContext

# int32 keys so the fixture's Arrow types agree with the MDL-declared
# `integer` columns on the semantic query path.
CUSTOMER_KEYS = [1, 2, 3]
CUSTOMER_TABLE = pa.table(
    {
        "c_custkey": pa.array(CUSTOMER_KEYS, type=pa.int32()),
        "c_name": ["a", "b", "c"],
    }
)


def _ipc_to_pydict(ipc_bytes):
    return ipc.open_stream(io.BytesIO(bytes(ipc_bytes))).read_all().to_pydict()


def _customer_manifest_b64():
    # The three-part tableReference must match the default catalog/schema the
    # register APIs write into, so load_mdl's provider extraction
    # ("{catalog}.{schema}.{table}") resolves the model to the physical file.
    manifest = {
        "catalog": "my_catalog",
        "schema": "my_schema",
        "dataSource": "datafusion",
        "models": [
            {
                "name": "customer",
                "tableReference": {
                    "catalog": "datafusion",
                    "schema": "public",
                    "table": "customer",
                },
                "columns": [
                    {"name": "c_custkey", "type": "integer"},
                    {"name": "c_name", "type": "varchar"},
                ],
                "primaryKey": "c_custkey",
            }
        ],
    }
    return base64.b64encode(json.dumps(manifest).encode("utf-8")).decode("utf-8")


def _write_customer_parquet(tmp_path):
    path = tmp_path / "customer.parquet"
    pq.write_table(CUSTOMER_TABLE, path)
    return str(path)


def test_register_before_load_mdl_queryable_via_semantic_layer(tmp_path):
    """Two-phase init: register the file, then load MDL to resolve the model.

    The DataFusionConnector consumer never calls load_mdl; the
    register-then-query path it relies on is pinned by
    test_register_after_exec_ctx_visible_without_reload.
    """
    path = _write_customer_parquet(tmp_path)

    ctx = SessionContext()
    ctx.register_parquet("customer", path)
    ctx.load_mdl(_customer_manifest_b64())

    assert "customer" in ctx.list_tables()

    sql = "SELECT c_custkey FROM my_catalog.my_schema.customer ORDER BY c_custkey"
    assert _ipc_to_pydict(ctx.query(sql)) == {"c_custkey": CUSTOMER_KEYS}
    assert ctx.dry_run(sql)


def test_register_after_exec_ctx_visible_without_reload(tmp_path):
    """Registration after context creation is visible without any reload.

    The default catalog pre-exists, and pre-existing catalog internals are
    live-shared with the derived execution context. Python twin of the Rust
    test
    table_added_to_pre_existing_catalog_after_apply_is_visible_from_derived_ctx.
    """
    # Constructing WITH an MDL is what forces real derived contexts (a bare
    # SessionContext aliases base/exec to one context and would test
    # nothing); the customer model itself is unused here.
    ctx = SessionContext(_customer_manifest_b64(), None)

    path = tmp_path / "late_orders.csv"
    path.write_text("o_orderkey\n10\n20\n")
    ctx.register_csv("late_orders", str(path))

    assert "late_orders" in ctx.list_tables()

    sql = "SELECT o_orderkey FROM datafusion.public.late_orders ORDER BY o_orderkey"
    assert _ipc_to_pydict(ctx.query(sql)) == {"o_orderkey": [10, 20]}
    assert ctx.dry_run(sql)


def test_register_after_exec_ctx_then_load_mdl_resolves_model(tmp_path):
    """A late-registered table still backs a model loaded afterwards.

    load_mdl's provider extraction walks the base context at call time, so
    it picks up tables registered after the context was constructed.
    """
    ctx = SessionContext(_customer_manifest_b64(), None)

    path = _write_customer_parquet(tmp_path)
    ctx.register_parquet("customer", path)
    ctx.load_mdl(_customer_manifest_b64())

    sql = "SELECT c_custkey FROM my_catalog.my_schema.customer ORDER BY c_custkey"
    assert _ipc_to_pydict(ctx.query(sql)) == {"c_custkey": CUSTOMER_KEYS}
    assert (
        ctx.transform_sql("SELECT c_custkey FROM my_catalog.my_schema.customer")
        is not None
    )
