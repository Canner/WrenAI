"""Real child processes and DuckDB queries; no model or cancellation boundary mocks."""

import base64
import json
import os
import threading
import time
from types import SimpleNamespace

import duckdb
import pytest

import wren.governed_query as workers
from tests.unit.test_agent_ipc import FAKE_RUNTIME
from wren.agent_ipc import RuntimeIPC, TaskAborted
from wren.engine import WrenEngine
from wren.governed_query import QueryCancelled, QueryLifetime
from wren.model.error import DatabaseTimeoutError


def test_unsupported_platform_fails_before_starting_a_worker(monkeypatch):
    monkeypatch.setattr(workers, "os", SimpleNamespace(name="nt"))
    with pytest.raises(RuntimeError, match="unsupported_platform"):
        QueryLifetime()


@pytest.fixture
def engine(tmp_path):
    with duckdb.connect(str(tmp_path / "fixture.duckdb")) as db:
        db.execute("CREATE TABLE marker(n INTEGER)")
    manifest = {
        "catalog": "test",
        "schema": "public",
        "relationships": [],
        "models": [
            {
                "name": "numbers",
                "refSql": "SELECT i AS value FROM range(1000000000000) t(i)",
                "columns": [{"name": "value", "type": "bigint"}],
            }
        ],
    }
    value = WrenEngine(
        base64.b64encode(json.dumps(manifest).encode()).decode(),
        "local_file",
        {"url": str(tmp_path), "format": "duckdb"},
    )
    yield value
    value.close()


HEAVY = "SELECT SUM(value) FROM numbers"
QUICK = "SELECT value FROM numbers LIMIT 1"


def start_query(lifetime, engine):
    result = []

    def work():
        try:
            result.append(lifetime.query(engine, HEAVY, 1))
        except Exception as error:
            result.append(error)

    thread = threading.Thread(target=work)
    thread.start()
    deadline = time.monotonic() + 5
    while not lifetime.children and time.monotonic() < deadline:
        time.sleep(0.01)
    assert lifetime.children
    return thread, result, list(lifetime.children)


def reaped(children):
    for child in children:
        assert child.poll() is not None
        with pytest.raises(ProcessLookupError):
            os.kill(child.pid, 0)


def test_a_real_query_deadline_reaps_the_worker_and_the_next_query_runs(engine):
    lifetime = QueryLifetime(1.5)
    thread, result, children = start_query(lifetime, engine)
    thread.join(5)
    assert not thread.is_alive()
    assert len(result) == 1 and isinstance(result[0], DatabaseTimeoutError)
    assert not lifetime.children
    reaped(children)
    assert QueryLifetime(10).query(engine, QUICK, 1).num_rows == 1


def test_cancel_is_idempotent_and_races_safely_with_query_registration(engine):
    for delay in (0, 0.01, 0.1):
        lifetime = QueryLifetime(30)
        thread, result, children = start_query(lifetime, engine)
        time.sleep(delay)
        lifetime.cancel()
        lifetime.cancel()
        thread.join(5)
        assert not thread.is_alive()
        assert isinstance(result[0], QueryCancelled)
        assert not lifetime.children
        reaped(children)
        with pytest.raises(QueryCancelled):
            lifetime.query(engine, QUICK, 1)


@pytest.mark.parametrize("action", ["timeout", "abort", "close"])
def test_ipc_end_reaps_an_inflight_sql_worker_and_suppresses_late_values(
    engine, action
):
    runtime = RuntimeIPC(
        FAKE_RUNTIME, {}, call_timeout_s=1.5 if action == "timeout" else 10
    )
    lifetime = QueryLifetime(30)
    result = []

    def callback(name, args):
        return lifetime.query(engine, HEAVY, 1)

    def invoke():
        try:
            result.append(
                runtime.call(
                    "invoke",
                    invocation_id="query",
                    on_cancel=lifetime.cancel,
                    callback=callback,
                    request=json.dumps(
                        {"behavior": "script", "steps": [{"tool": "run_sql"}]}
                    ),
                )
            )
        except Exception as error:
            result.append(error)

    thread = threading.Thread(target=invoke)
    try:
        thread.start()
        deadline = time.monotonic() + 5
        while not lifetime.children and time.monotonic() < deadline:
            time.sleep(0.01)
        children = list(lifetime.children)
        assert children
        if action == "abort":
            runtime.abort("query")
        elif action == "close":
            runtime.close()
        thread.join(5)
        assert not thread.is_alive()
        assert len(result) == 1 and isinstance(result[0], (RuntimeError, TaskAborted))
        assert not lifetime.children
        reaped(children)
        if action != "close":
            assert runtime.call("authorize", request={}) is True
    finally:
        lifetime.cancel()
        runtime.close()
        thread.join(5)


def test_cancelled_invocations_do_not_exhaust_the_tool_pool(engine):
    runtime = RuntimeIPC(FAKE_RUNTIME, {})
    runtime.call_timeout_s = 0.25
    try:
        for i in range(10):
            lifetime = QueryLifetime(30)
            entered = threading.Event()

            def run_tool(name, args, lifetime=lifetime, entered=entered):
                entered.set()
                return lifetime.query(engine, HEAVY, 1)

            with pytest.raises(RuntimeError):
                runtime.call(
                    "invoke",
                    invocation_id=str(i),
                    on_cancel=lifetime.cancel,
                    callback=run_tool,
                    request=json.dumps(
                        {"behavior": "script", "steps": [{"tool": "run_sql"}]}
                    ),
                )
            assert entered.wait(5), f"tool callback {i} never ran"
            assert not lifetime.children
        assert runtime.call("authorize", request={}) is True
        assert QueryLifetime(10).query(engine, QUICK, 1).num_rows == 1
    finally:
        runtime.close()


def test_an_ordinary_engine_query_keeps_its_existing_in_process_connection(engine):
    assert engine.query(QUICK, 1).num_rows == 1
    connector = engine._connector
    assert connector is not None
    assert engine.query(QUICK, 1).num_rows == 1 and engine._connector is connector


def test_cancel_escalates_to_kill_for_a_child_that_ignores_term():
    import signal  # noqa: PLC0415
    import subprocess  # noqa: PLC0415
    import sys  # noqa: PLC0415

    child = subprocess.Popen(
        [
            sys.executable,
            "-c",
            "import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); print('ready', flush=True); time.sleep(60)",
        ],
        stdout=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    lifetime = QueryLifetime(30)
    try:
        assert child.stdout.readline().strip() == "ready"
        lifetime.children.add(child)
        lifetime.cancel()
        assert child.returncode == -signal.SIGKILL
        assert not lifetime.children
        reaped([child])
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=5)
        child.stdout.close()


def test_cancel_races_with_starting_queries_without_leaving_a_worker(engine):
    for _ in range(4):
        lifetime = QueryLifetime(30)
        barrier = threading.Barrier(2)
        outcome = []

        def query():
            barrier.wait()
            try:
                outcome.append(lifetime.query(engine, HEAVY, 1))
            except Exception as error:
                outcome.append(error)

        thread = threading.Thread(target=query)
        thread.start()
        barrier.wait()
        lifetime.cancel()
        thread.join(5)
        assert not thread.is_alive()
        assert len(outcome) == 1 and isinstance(outcome[0], QueryCancelled)
        assert not lifetime.children


def text_engine(engine, tmp_path, value):
    with duckdb.connect(str(tmp_path / "fixture.duckdb")) as db:
        db.execute("CREATE TABLE raw_text(value VARCHAR)")
        db.execute("INSERT INTO raw_text VALUES (?)", [value])
    manifest = json.loads(base64.b64decode(engine.manifest_str))
    manifest["models"].append(
        {
            "name": "payloads",
            "refSql": "SELECT value FROM fixture.main.raw_text",
            "columns": [{"name": "value", "type": "VARCHAR"}],
        }
    )
    engine.manifest_str = base64.b64encode(json.dumps(manifest).encode()).decode()
    return engine


def test_large_cells_are_rejected_before_parent_deserialization(
    engine, tmp_path, monkeypatch
):
    import pickle  # noqa: PLC0415

    original = pickle.loads
    received = []

    def bounded_loads(data):
        received.append(len(data))
        assert len(data) <= 131072, "oversized table crossed the host transfer boundary"
        return original(data)

    monkeypatch.setattr(pickle, "loads", bounded_loads)
    with pytest.raises(ValueError, match="result_limit"):
        QueryLifetime(10).query(
            text_engine(engine, tmp_path, "x" * 2097152),
            "SELECT value FROM payloads",
            101,
        )
    assert received and max(received) <= 131072


def test_maximum_unicode_cell_stays_legal(engine, tmp_path):
    value = "漢" * 256
    result = QueryLifetime(10).query(
        text_engine(engine, tmp_path, value), "SELECT value FROM payloads", 101
    )
    assert result.to_pylist() == [{"value": value}]


def test_fingerprint_read_has_a_cancellable_process_and_no_late_hash(tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    (root / "wren_project.yml").write_text("name: test\n")
    fifo = root / "manifest.fifo"
    os.mkfifo(fifo)
    lifetime = QueryLifetime(10)
    outcome = []

    def read():
        try:
            outcome.append(lifetime.fingerprint(root, [fifo]))
        except Exception as error:
            outcome.append(error)

    thread = threading.Thread(target=read)
    thread.start()
    deadline = time.monotonic() + 5
    while not lifetime.children and time.monotonic() < deadline:
        time.sleep(0.01)
    children = list(lifetime.children)
    try:
        assert children
        time.sleep(0.05)
        lifetime.cancel()
        thread.join(5)
        assert not thread.is_alive()
        assert len(outcome) == 1 and isinstance(outcome[0], QueryCancelled)
        reaped(children)
    finally:
        lifetime.cancel()
        thread.join(5)


def test_parent_rejects_an_oversized_frame_before_deserialization(tmp_path):
    import subprocess  # noqa: PLC0415
    import sys  # noqa: PLC0415

    child = subprocess.Popen(
        [
            sys.executable,
            "-c",
            "import sys,time; sys.stdout.buffer.write((999999999).to_bytes(8,'big')); sys.stdout.buffer.flush(); time.sleep(10)",
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        start_new_session=True,
    )
    lifetime = QueryLifetime(5)
    lifetime.children.add(child)
    try:
        with pytest.raises(ValueError, match="result_limit"):
            lifetime._exchange(child, b"small request")
    finally:
        lifetime.cancel()
        child.stdin.close()
        child.stdout.close()
    reaped([child])


def test_transfer_compaction_preserves_supported_value_types():
    from datetime import date, datetime  # noqa: PLC0415
    from decimal import Decimal  # noqa: PLC0415

    import pyarrow as pa  # noqa: PLC0415

    from wren.governed_query import _bounded_table  # noqa: PLC0415

    columns = [
        pa.array([date(2026, 1, 2)]),
        pa.array([datetime(2026, 1, 2, 3, 4)]),
        pa.array([Decimal("12.34")]),
        pa.array([True]),
        pa.array([42]),
        pa.array([3.5]),
        pa.array([None]),
        pa.array(["漢" * 256]),
    ]
    table = pa.Table.from_arrays(columns, names=[f"c{i}" for i in range(len(columns))])
    assert _bounded_table(table).to_pylist() == table.to_pylist()


def test_transfer_compacts_unused_arrow_buffers_and_rejects_binary():
    import pickle  # noqa: PLC0415

    import pyarrow as pa  # noqa: PLC0415

    from wren.governed_query import _bounded_table  # noqa: PLC0415

    table = pa.table({"value": ["x" * 2097152, "ok"]}).slice(1, 1)
    compact = _bounded_table(table)
    assert compact.to_pylist() == [{"value": "ok"}]
    assert len(pickle.dumps(compact)) < 131072
    with pytest.raises(ValueError, match="unsupported_result"):
        _bounded_table(pa.table({"value": [b"binary"]}))
