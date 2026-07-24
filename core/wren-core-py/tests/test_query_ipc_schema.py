"""query()'s Arrow IPC stream carries the execution schema.

The IPC stream is written with the schema of the executed batches. The
logical plan's declared MDL types can differ from the physical batch types
(``integer`` declared over an int64 Parquet column, ``varchar`` over
DataFusion's Utf8View Parquet reads), and the stream must stay decodable and
value-correct in those cases — for empty results too.
"""

import base64
import io
import json

import pyarrow as pa
import pyarrow.parquet as pq
from pyarrow import ipc
from wren_core import SessionContext

CUSTOMER_ROWS = {"c_custkey": [1, 2, 3], "c_name": ["a", "b", "c"]}


def _ipc_to_table(ipc_bytes):
    return ipc.open_stream(io.BytesIO(bytes(ipc_bytes))).read_all()


def _manifest_b64():
    # Declares `integer`/`varchar` over a Parquet file whose physical types
    # are int64/Utf8View — the type-mismatch scenario this module pins.
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


def _make_ctx(tmp_path):
    path = tmp_path / "customer.parquet"
    pq.write_table(pa.table(CUSTOMER_ROWS), path)
    ctx = SessionContext()
    ctx.register_parquet("customer", str(path))
    ctx.load_mdl(_manifest_b64())
    return ctx


def test_query_returns_correct_rows_when_mdl_types_differ_from_physical(tmp_path):
    """Type-mismatched columns decode to the exact source values.

    int64 data declared as `integer` and Utf8View data declared as
    `varchar` round-trip through the IPC stream unchanged.
    """
    ctx = _make_ctx(tmp_path)

    sql = (
        "SELECT c_custkey, c_name FROM my_catalog.my_schema.customer ORDER BY c_custkey"
    )
    assert _ipc_to_table(ctx.query(sql)).to_pydict() == CUSTOMER_ROWS


def test_empty_result_schema_matches_nonempty_result_schema(tmp_path):
    """Result schema does not depend on whether the query returned rows."""
    ctx = _make_ctx(tmp_path)

    base = "SELECT c_custkey, c_name FROM my_catalog.my_schema.customer"
    with_data = _ipc_to_table(ctx.query(base))
    empty = _ipc_to_table(ctx.query(base + " WHERE false"))

    assert empty.num_rows == 0
    assert empty.schema.types == with_data.schema.types
