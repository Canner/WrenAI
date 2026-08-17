"""Same-context concurrency: mixed engine calls on one shared SessionContext.

One context, eight barrier-started threads first contend on one RLAC-protected
semantic query, exercising the execution context's long-lived
``ModelAnalyzeRule`` and its nested cycle-detection path. They then cycle
through a named operation schedule — ``transform_sql``, semantic and physical
``query``, ``dry_run``, singular function lookup, and ``list_tables`` — while
two threads also register Parquet/CSV files under distinct late-table names.
Every thread asserts content, so a race that corrupts catalog state or
analyzer state fails loudly rather than silently.

The hammer runs in a spawned child process because a native deadlock inside
a GIL-released ``block_on`` section cannot be interrupted from Python: the
parent enforces a wall-clock deadline and terminates the child on breach,
so a deadlock regression fails the suite instead of hanging it. Barrier
timeouts remain as a secondary guard for start-line stragglers.

Deliberately NOT tested: registering the same table name concurrently
(documented-unsupported) and creating brand-new top-level catalogs after
context derivation (outside the snapshot visibility contract).
"""

import base64
import faulthandler
import io
import json
import signal
import subprocess
import sys
import threading
import traceback
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
from pyarrow import ipc
from wren_core import SessionContext

N_THREADS = 8
RLAC_ITERS = 20
ITERS = 30
BARRIER_TIMEOUT = 30
CHILD_DEADLINE = 300

CUSTOMER_KEYS = [1, 2, 3]


def _ipc_to_pydict(ipc_bytes):
    return ipc.open_stream(io.BytesIO(bytes(ipc_bytes))).read_all().to_pydict()


def _customer_manifest_b64():
    # Same shape as test_physical_tables: the three-part tableReference must
    # match the default catalog/schema the register APIs write into.
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
                "rowLevelAccessControls": [
                    {
                        "name": "by_allowed",
                        "requiredProperties": [
                            {"name": "session_user", "required": True}
                        ],
                        "condition": (
                            "c_custkey IN (SELECT allowed_id FROM allowed "
                            "WHERE allowed_user = @session_user)"
                        ),
                    }
                ],
                "primaryKey": "c_custkey",
            },
            {
                "name": "allowed",
                "tableReference": {
                    "catalog": "datafusion",
                    "schema": "public",
                    "table": "allowed",
                },
                "columns": [
                    {"name": "allowed_id", "type": "integer"},
                    {"name": "allowed_user", "type": "varchar"},
                ],
                "primaryKey": "allowed_id",
            },
        ],
    }
    return base64.b64encode(json.dumps(manifest).encode("utf-8")).decode("utf-8")


def _hammer(tmp_dir):
    """Child-process body. Raises on any correctness violation."""
    tmp = Path(tmp_dir)
    customer_path = tmp / "customer.parquet"
    pq.write_table(
        pa.table(
            {
                "c_custkey": pa.array(CUSTOMER_KEYS, type=pa.int32()),
                "c_name": ["a", "b", "c"],
            }
        ),
        customer_path,
    )
    allowed_path = tmp / "allowed.parquet"
    pq.write_table(
        pa.table(
            {
                "allowed_id": pa.array([1, 3, 2], type=pa.int32()),
                "allowed_user": ["alice", "alice", "bob"],
            }
        ),
        allowed_path,
    )
    # Shared files registered under many distinct late-table names; both
    # formats carry the same rows for post-join content checks.
    late_parquet = tmp / "late.parquet"
    pq.write_table(pa.table({"v": pa.array([10, 20], type=pa.int64())}), late_parquet)
    late_csv = tmp / "late.csv"
    late_csv.write_text("v\n10\n20\n")

    manifest = _customer_manifest_b64()
    properties = frozenset({("session_user", "'alice'")})
    ctx = SessionContext(manifest, None, properties)
    ctx.register_parquet("customer", str(customer_path))
    ctx.register_parquet("allowed", str(allowed_path))
    # Physical-only sentinel, deliberately absent from the MDL: its name
    # can only come from the physical catalog, so asserting it mid-race
    # pins physical enumeration ("customer" would be satisfied by the MDL
    # model alone — list_tables flattens names across catalogs).
    ctx.register_parquet("physical_sentinel", str(late_parquet))
    ctx.load_mdl(manifest)

    semantic_sql = (
        "SELECT c_custkey FROM my_catalog.my_schema.customer ORDER BY c_custkey"
    )
    physical_sql = "SELECT c_custkey FROM datafusion.public.customer ORDER BY c_custkey"
    expected_semantic_rows = {"c_custkey": [1, 3]}
    expected_physical_rows = {"c_custkey": CUSTOMER_KEYS}
    expected_transform = ctx.transform_sql(semantic_sql)
    expected_dry = ctx.dry_run(semantic_sql)
    fn_name = ctx.get_available_functions()[0].name
    assert _ipc_to_pydict(ctx.query(semantic_sql)) == expected_semantic_rows
    assert _ipc_to_pydict(ctx.query(physical_sql)) == expected_physical_rows

    def op_transform():
        assert ctx.transform_sql(semantic_sql) == expected_transform

    def op_semantic_query():
        # The customer -> allowed RLAC subquery keeps the cycle stack live
        # across nested analysis on exec_ctx's shared ModelAnalyzeRule.
        assert _ipc_to_pydict(ctx.query(semantic_sql)) == expected_semantic_rows

    def op_physical_query():
        assert _ipc_to_pydict(ctx.query(physical_sql)) == expected_physical_rows

    def op_dry_run():
        assert ctx.dry_run(semantic_sql) == expected_dry

    def op_function_lookup():
        functions = ctx.get_available_function(fn_name)
        assert functions
        assert all(function.name == fn_name for function in functions)

    def op_list_tables():
        # Best-effort enumeration for late registrations, but a physical
        # table that existed before the race must stay visible in every
        # snapshot; late-table content is asserted post-join.
        assert "physical_sentinel" in ctx.list_tables()

    # Every thread cycles through the full schedule from a tid-dependent
    # offset, so each operation runs concurrently with every other.
    schedule = (
        op_transform,
        op_semantic_query,
        op_physical_query,
        op_dry_run,
        op_function_lookup,
        op_list_tables,
    )

    rlac_barrier = threading.Barrier(N_THREADS)
    errors = []

    def worker(tid):
        try:
            # Reuse one barrier per iteration so all threads contend on the
            # same exec_ctx/model key while nested RLAC analysis is active.
            for _ in range(RLAC_ITERS):
                rlac_barrier.wait(timeout=BARRIER_TIMEOUT)
                op_semantic_query()
            for i in range(ITERS):
                schedule[(tid + i) % len(schedule)]()
                if tid < 2:
                    # Late registration under distinct names, alternating
                    # file formats; same-name concurrent registration is
                    # documented-unsupported and deliberately not exercised.
                    if i % 2 == 0:
                        ctx.register_parquet(f"late_{tid}_{i}", str(late_parquet))
                    else:
                        ctx.register_csv(f"late_{tid}_{i}", str(late_csv))
        except BaseException:
            rlac_barrier.abort()
            errors.append(f"thread {tid}:\n{traceback.format_exc()}")

    threads = [threading.Thread(target=worker, args=(tid,)) for tid in range(N_THREADS)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    if errors:
        raise AssertionError("\n".join(errors))

    # Every distinct-name registration must land. One table per format and
    # registering thread also proves that each provider returns the fixture.
    tables = ctx.list_tables()
    for tid in range(2):
        for i in range(ITERS):
            name = f"late_{tid}_{i}"
            assert name in tables
        for i in (0, 1):
            name = f"late_{tid}_{i}"
            got = _ipc_to_pydict(
                ctx.query(f'SELECT v FROM datafusion.public."{name}" ORDER BY v')
            )
            assert got == {"v": [10, 20]}


def _hammer_child(tmp_dir):
    faulthandler.enable()
    try:
        _hammer(tmp_dir)
    except BaseException:
        traceback.print_exc()
        sys.exit(1)
    sys.exit(0)


def test_same_context_concurrent_engine_calls(tmp_path):
    child = subprocess.Popen(
        [sys.executable, __file__, "--hammer-child", str(tmp_path)]
    )
    try:
        child.wait(timeout=CHILD_DEADLINE)
    except subprocess.TimeoutExpired:
        child.terminate()
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
        raise AssertionError(
            f"hammer exceeded {CHILD_DEADLINE}s deadline — possible native deadlock"
        )
    if child.returncode < 0:
        signum = -child.returncode
        try:
            signal_name = signal.Signals(signum).name
        except ValueError:
            signal_name = f"signal {signum}"
        raise AssertionError(
            f"hammer child terminated by {signal_name} (exit code {child.returncode})"
        )
    assert child.returncode == 0, (
        f"hammer child failed with exit code {child.returncode}"
    )


if __name__ == "__main__" and sys.argv[1:2] == ["--hammer-child"]:
    _hammer_child(sys.argv[2])
