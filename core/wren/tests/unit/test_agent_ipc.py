"""Host-side IPC behaviour against a scripted runtime (no model, no Warble)."""

import json
import shutil
import time
from pathlib import Path

import pytest

from wren.agent_ipc import PROTOCOL, RuntimeIPC

FAKE_RUNTIME = Path(__file__).parent / "fixtures/fake_runtime.js"

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="needs node")


@pytest.fixture
def ipc(monkeypatch):
    monkeypatch.delenv("WREN_IPC_CALL_TIMEOUT_S", raising=False)
    made = []

    def make(init=None, **kwargs):
        call_timeout_s = kwargs.pop("call_timeout_s", None)
        runtime = RuntimeIPC(
            FAKE_RUNTIME, init or {"model": {"apiKey": "secret"}}, **kwargs
        )
        if call_timeout_s is not None:
            runtime.call_timeout_s = call_timeout_s
        made.append(runtime)
        return runtime

    yield make
    for runtime in made:
        runtime.close()


def invoke(ipc, behavior, ident, **extra):
    return ipc.call(
        "invoke",
        request=json.dumps({"behavior": behavior, **extra}),
        invocation_id=ident,
        callback=lambda name, args: "ok",
    )


def ops(ipc):
    return ipc.call("ops")


@pytest.mark.parametrize(
    "ending", ["deadline", "abort", "close", "queued_call", "queued_cancel"]
)
def test_a_real_stalled_pipe_cannot_retain_a_call_or_its_write_lock(
    ipc, monkeypatch, ending
):
    import os  # noqa: PLC0415
    import threading  # noqa: PLC0415

    runtime = ipc()
    assert runtime.call("stop_reading") is True
    outcome = []
    stalled = threading.Event()
    original_write = os.write
    target_fd = runtime.process.stdin.fileno()

    def write(fd, data):
        try:
            return original_write(fd, data)
        except BlockingIOError:
            if fd == target_fd:
                stalled.set()
            raise

    monkeypatch.setattr(os, "write", write)

    def send():
        try:
            runtime.call(
                "huge",
                invocation_id="blocked",
                payload="x" * 524288,
                timeout_s=0.2 if ending == "deadline" else 5,
            )
        except Exception as error:
            outcome.append(error)

    thread = threading.Thread(target=send)
    thread.start()
    try:
        assert stalled.wait(1), "the fixture never filled the actual kernel pipe"
        if ending in ("queued_call", "queued_cancel"):
            started = time.monotonic()
            with pytest.raises(RuntimeError):
                runtime.call(
                    "cancel" if ending == "queued_cancel" else "queued",
                    timeout_s=5 if ending == "queued_cancel" else 0.1,
                )
            assert time.monotonic() - started < 0.5
        else:
            started = time.monotonic()
            if ending == "abort":
                runtime.abort("blocked")
            elif ending == "close":
                runtime.close()
            thread.join(0.7)
            assert not thread.is_alive()
            assert time.monotonic() - started < 0.8
            assert outcome and isinstance(outcome[0], RuntimeError)
    finally:
        if runtime.process.poll() is None:
            runtime.process.kill()
        thread.join(3)
        runtime.close()
    assert not thread.is_alive() and not runtime._wire_deadlines


@pytest.mark.parametrize("reuse_request_id", [False, True])
def test_a_control_frame_has_its_own_bounded_pipe_write(ipc, reuse_request_id):
    import threading  # noqa: PLC0415

    runtime = ipc()
    task = None
    ident = "tool"
    if reuse_request_id:

        def pending():
            try:
                runtime.call("hang", invocation_id="pending", timeout_s=2)
            except RuntimeError:
                pass

        task = threading.Thread(target=pending)
        task.start()
        deadline = time.monotonic() + 1
        while "pending" not in runtime.wire_ids and time.monotonic() < deadline:
            time.sleep(0.005)
        ident = runtime.wire_ids["pending"]
    try:
        assert runtime.call("stop_reading") is True
        started = time.monotonic()
        with pytest.raises(TimeoutError):
            runtime._send({"type": "tool_result", "id": ident, "value": "x" * 524288})
        assert time.monotonic() - started < 0.5
        runtime.reader.join(2)
        assert runtime.closed
    finally:
        if runtime.process.poll() is None:
            runtime.process.kill()
        if task:
            task.join(3)
            assert not task.is_alive()


@pytest.mark.parametrize("raw", ["inf", "nan"])
def test_nonfinite_operator_timeout_cannot_disable_the_io_deadline(
    ipc, monkeypatch, raw
):
    runtime = ipc()
    monkeypatch.setenv("WREN_IPC_CALL_TIMEOUT_S", raw)
    with pytest.raises(ValueError, match="invalid_ipc_timeout"):
        runtime.call("authorize", request={})
    assert not runtime.pending and not runtime._wire_deadlines


def test_reader_exit_closes_the_pool_and_joins_active_callback_workers(ipc):
    import threading  # noqa: PLC0415

    runtime = ipc()
    entered, release = threading.Event(), threading.Event()
    outcome = []

    def callback(*_):
        entered.set()
        assert release.wait(5)
        return "late"

    def invoke():
        try:
            runtime.call(
                "invoke",
                request=json.dumps(
                    {"behavior": "script", "steps": [{"tool": "run_sql"}]}
                ),
                callback=callback,
                on_cancel=release.set,
            )
        except RuntimeError as error:
            outcome.append(error)

    task = threading.Thread(target=invoke)
    task.start()
    try:
        assert entered.wait(5)
        # Occupy every pool slot, then leave a real queued job behind it.
        for _ in range(7):
            runtime.pool.submit(release.wait, 5)
        queued = runtime.pool.submit(lambda: pytest.fail("queued work ran after EOF"))
        runtime.process.kill()
        runtime.reader.join(3)
        task.join(3)
        assert not runtime.reader.is_alive() and not task.is_alive()
        assert outcome and runtime.closed
        assert queued.cancelled()
        assert all(not thread.is_alive() for thread in runtime.pool._threads)
        with pytest.raises(RuntimeError, match="runtime_unavailable"):
            runtime.call("authorize", request={})
    finally:
        release.set()
        runtime.close()
        task.join(5)


def test_a_callback_can_close_the_runtime_without_joining_itself(ipc):
    import threading  # noqa: PLC0415

    runtime = ipc()
    closed = threading.Event()

    def callback(*_):
        runtime.close()
        closed.set()

    with pytest.raises(RuntimeError, match="runtime_unavailable"):
        runtime.call(
            "invoke",
            request=json.dumps({"behavior": "script", "steps": [{"tool": "run_sql"}]}),
            callback=callback,
        )
    assert closed.wait(3)
    runtime.reader.join(3)
    assert not runtime.reader.is_alive()
    assert all(not thread.is_alive() for thread in runtime.pool._threads)


@pytest.mark.parametrize("error", [None, ""])
def test_malformed_reply_fails_the_waiting_call_without_waiting_for_timeout(ipc, error):
    runtime = ipc(call_timeout_s=2)
    started = time.monotonic()
    with pytest.raises(RuntimeError, match="runtime_unavailable") as raised:
        invoke(runtime, "malformed_reply", "malformed", error=error)
    assert time.monotonic() - started < 1
    assert getattr(raised.value, "detail", None) != "ipc_timeout:host"
    runtime.process.wait(timeout=2)
    assert not runtime.pending


def test_the_handshake_passes_the_init_payload_through_and_redacts_the_key(ipc):
    limits = {"deadlineMs": 120000, "maxTurns": 6}
    runtime = ipc({"model": {"apiKey": "secret", "id": "m"}, "limits": limits})
    echoed = runtime.call("echo_init")
    assert echoed["protocol"] == PROTOCOL
    assert echoed["limits"] == limits
    assert echoed["model"] == {"apiKey": "<redacted>", "id": "m"}


def test_the_call_cap_is_the_given_default_unless_the_environment_overrides_it(
    ipc, monkeypatch
):
    runtime = ipc(call_timeout_s=160)
    assert runtime._timeout() == 160
    assert ipc().call_timeout_s == 100
    monkeypatch.setenv("WREN_IPC_CALL_TIMEOUT_S", "7")
    assert runtime._timeout() == 7


def test_a_host_timeout_sends_cancel_clears_pending_and_keeps_the_runtime(
    ipc, monkeypatch
):
    monkeypatch.setenv("WREN_IPC_CALL_TIMEOUT_S", "0.4")
    runtime = ipc()
    with pytest.raises(RuntimeError, match="runtime_unavailable") as raised:
        invoke(runtime, "hang", "inv-1")
    assert raised.value.detail == "ipc_timeout:host"
    assert "inv-1" not in runtime.pending
    seen = ops(runtime)
    assert {
        "op": "cancel",
        "owner": next(o["id"] for o in seen if o.get("op") == "invoke"),
    } in [{"op": o.get("op"), "owner": o.get("owner")} for o in seen]
    assert runtime.process.poll() is None
    assert runtime.call("authorize", request={}) is True


def test_a_late_tool_call_and_reply_after_the_timeout_do_not_kill_the_runtime(
    ipc, monkeypatch
):
    monkeypatch.setenv("WREN_IPC_CALL_TIMEOUT_S", "0.4")
    runtime = ipc()
    with pytest.raises(RuntimeError):
        invoke(runtime, "late_tool_call", "inv-2")
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        denied = [o for o in ops(runtime) if o.get("type") == "tool_result"]
        if denied:
            break
        time.sleep(0.05)
    assert denied == [
        {
            "type": "tool_result",
            "owner": next(o["id"] for o in ops(runtime) if o.get("op") == "invoke"),
            "error": "tool_denied",
        }
    ]
    time.sleep(0.2)
    assert runtime.process.poll() is None
    assert runtime.call("authorize", request={}) is True


def test_a_non_invoke_timeout_clears_pending_without_a_cancel(ipc, monkeypatch):
    runtime = ipc()
    monkeypatch.setenv("WREN_IPC_CALL_TIMEOUT_S", "0.3")
    with pytest.raises(RuntimeError) as raised:
        runtime.call("hang", invocation_id="x-1")
    assert raised.value.detail == "ipc_timeout:host"
    assert "x-1" not in runtime.pending
    assert not any(o.get("op") == "cancel" for o in ops(runtime))
    assert runtime.process.poll() is None


def test_an_invocation_id_still_pending_or_abandoned_cannot_be_reused(ipc, monkeypatch):
    monkeypatch.setenv("WREN_IPC_CALL_TIMEOUT_S", "0.3")
    runtime = ipc()
    with pytest.raises(RuntimeError):
        invoke(runtime, "hang", "inv-9")
    assert "inv-9" in runtime.abandoned
    with pytest.raises(ValueError, match="invalid_invocation_id"):
        invoke(runtime, "hang", "inv-9")
    assert "inv-9" not in runtime.pending
    runtime.pending["inv-10"] = object()
    with pytest.raises(ValueError, match="invalid_invocation_id"):
        invoke(runtime, "hang", "inv-10")
    runtime.pending.pop("inv-10")
    assert runtime.process.poll() is None
    assert runtime.call("authorize", request={}) is True


def test_a_reply_for_an_id_the_host_never_sent_is_still_a_protocol_violation(ipc):
    runtime = ipc()
    runtime._send({"id": "s-1", "op": "stray"})
    assert runtime.process.wait(timeout=5) != 0


def test_the_usage_of_a_limits_aware_runtime_is_kept_apart_from_the_returned_value(ipc):
    runtime = ipc()
    assert invoke(runtime, "with_calls", "inv-3") == {"evidence": "fake-token"}
    usage = {}
    value = runtime.call(
        "invoke",
        request=json.dumps({"behavior": "with_calls"}),
        invocation_id="inv-3b",
        callback=lambda name, args: "ok",
        usage=usage,
    )
    assert value == {"evidence": "fake-token"}
    assert [c["status"] for c in usage["calls"]] == ["ok"]
    assert "calls" not in value


def test_a_reply_without_usage_leaves_the_usage_out_parameter_empty(ipc):
    runtime = ipc()
    usage = {}
    runtime.call(
        "invoke",
        request=json.dumps({"behavior": "evidence"}),
        invocation_id="inv-3c",
        callback=lambda name, args: "ok",
        usage=usage,
    )
    assert usage == {}


def test_a_failure_carries_the_runtime_usage_and_counters_on_the_exception(ipc):
    runtime = ipc()
    calls = [{"turn": 1, "status": "ok"}]
    with pytest.raises(RuntimeError, match="runtime_unavailable") as raised:
        invoke(
            runtime,
            "fail_with_calls",
            "inv-4",
            diagnostic="turn_limit",
            calls=calls,
            turns=12,
            toolCalls=7,
        )
    failure = raised.value
    assert failure.detail == "service_unavailable:turn_limit"
    assert (failure.calls, failure.turns, failure.tool_calls) == (calls, 12, 7)
    assert runtime.process.poll() is None


def test_a_failure_without_usage_has_no_calls_and_a_killed_runtime_none_either(ipc):
    runtime = ipc()
    with pytest.raises(RuntimeError) as raised:
        invoke(runtime, "fail_with_calls", "inv-5", diagnostic="invalid_json")
    assert raised.value.detail == "service_unavailable:invalid_json"
    assert raised.value.calls is None
    stray = ipc()
    stray._send({"id": "s-2", "op": "stray"})
    assert stray.process.wait(timeout=5) != 0


def test_an_abort_ends_the_wait_now_and_drops_whatever_the_runtime_sends_later(ipc):
    import threading  # noqa: PLC0415

    from wren.agent_ipc import TaskAborted  # noqa: PLC0415

    runtime = ipc()
    outcome = []

    def waiting():
        try:
            outcome.append(invoke(runtime, "late_tool_call", "inv-abort"))
        except Exception as exc:  # noqa: BLE001
            outcome.append(exc)

    thread = threading.Thread(target=waiting)
    thread.start()
    deadline = time.monotonic() + 5
    while "inv-abort" not in runtime.pending and time.monotonic() < deadline:
        time.sleep(0.02)
    runtime.abort("inv-abort")
    thread.join(timeout=5)
    assert not thread.is_alive()
    assert len(outcome) == 1 and isinstance(outcome[0], TaskAborted)
    assert "inv-abort" not in runtime.pending and "inv-abort" in runtime.abandoned
    # The fake answers the cancel with a late tool call and a late reply for the same task:
    # the first is refused, the second is dropped, and the runtime keeps running.
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        seen = ops(runtime)
        if any(o.get("type") == "tool_result" for o in seen):
            break
        time.sleep(0.05)
    assert {
        "op": "cancel",
        "owner": next(o["id"] for o in seen if o.get("op") == "invoke"),
    } in [{"op": o.get("op"), "owner": o.get("owner")} for o in seen]
    assert [o["error"] for o in seen if o.get("type") == "tool_result"] == [
        "tool_denied"
    ]
    time.sleep(0.2)
    assert runtime.process.poll() is None
    assert runtime.call("authorize", request={}) is True


@pytest.mark.parametrize("frame", ["reply", "tool_owner"])
def test_an_evicted_abandoned_call_is_still_recognised_without_unbounded_state(
    ipc, frame, monkeypatch
):
    from wren.agent_ipc import ABANDONED_LIMIT  # noqa: PLC0415

    runtime = ipc(call_timeout_s=0.05)
    sent = []
    original = runtime._send

    def capture(frame):
        sent.append(frame)
        return original(frame)

    monkeypatch.setattr(runtime, "_send", capture)
    with pytest.raises(RuntimeError):
        runtime.call("hang", invocation_id="oldest")
    old = sent[0]["id"]
    for i in range(ABANDONED_LIMIT + 1):
        runtime._remember(f"expired-{i}")
    assert "oldest" not in runtime.abandoned
    assert len(runtime.abandoned) <= ABANDONED_LIMIT
    assert runtime.call("late_frames", **{frame: old}) is True
    assert runtime.call("authorize", request={}) is True
    assert (
        not runtime.pending and not runtime.callbacks and not runtime.cancel_callbacks
    )
    assert len(getattr(runtime, "wire_ids", {})) == 0


def test_a_reachable_send_size_failure_leaves_no_pending_call(ipc):
    runtime = ipc()
    for _ in range(3):
        with pytest.raises(ValueError, match="ipc_size"):
            runtime.call("authorize", invocation_id="too-large", request="x" * 1048576)
        assert (
            not runtime.pending
            and not runtime.callbacks
            and not runtime.cancel_callbacks
        )
    assert runtime.call("authorize", request={}) is True


@pytest.mark.parametrize("suffix", ["0", "99999999999999999999", "01", "1:extra"])
def test_an_unknown_wire_id_is_rejected_even_with_the_instance_prefix(ipc, suffix):
    runtime = ipc()
    with pytest.raises(RuntimeError):
        runtime.call("late_frames", reply=f"{runtime._wire_prefix}:{suffix}")
    assert runtime.process.wait(timeout=5) != 0


def test_wire_history_survives_real_timeouts_and_caller_label_reuse(ipc, monkeypatch):
    from wren.agent_ipc import ABANDONED_LIMIT  # noqa: PLC0415

    runtime = ipc()
    oldest = []
    original = runtime._send

    def capture(frame):
        if frame.get("op") == "hang" and not oldest:
            oldest.append(frame["id"])
        return original(frame)

    monkeypatch.setattr(runtime, "_send", capture)
    runtime.call_timeout_s = 0.001
    for index in range(ABANDONED_LIMIT + 4):
        with pytest.raises(RuntimeError):
            runtime.call("hang", invocation_id=f"call-{index}")
    assert "call-0" not in runtime.abandoned
    runtime.call_timeout_s = 5
    called = []
    assert (
        runtime.call(
            "late_frames",
            invocation_id="call-0",
            reply=oldest[0],
            tool_owner=oldest[0],
            callback=lambda *_: called.append(True),
        )
        is True
    )
    assert runtime.call("authorize", request={}) is True
    assert not called
    assert len(runtime.abandoned) <= ABANDONED_LIMIT
    assert not runtime.pending and not runtime.callbacks
    assert not runtime.wire_ids and not runtime._wire_owners


def test_an_old_queued_tool_cannot_use_a_reused_callers_callback(ipc, monkeypatch):
    import threading  # noqa: PLC0415

    from wren.agent_ipc import ABANDONED_LIMIT  # noqa: PLC0415

    runtime = ipc(call_timeout_s=0.05)
    queued = []
    monkeypatch.setattr(
        runtime.pool,
        "submit",
        lambda function, message: queued.append((function, message)),
    )
    request = json.dumps({"behavior": "script", "steps": [{"tool": "run_sql"}]})
    with pytest.raises(RuntimeError):
        runtime.call(
            "invoke", invocation_id="shared", request=request, callback=lambda *_: "old"
        )
    assert len(queued) == 1
    for index in range(ABANDONED_LIMIT + 1):
        runtime._remember(f"expired-{index}")
    runtime.call_timeout_s = 5
    called, errors = [], []

    def waiting():
        try:
            runtime.call(
                "invoke",
                invocation_id="shared",
                request=request,
                callback=lambda *_: called.append(True),
            )
        except RuntimeError as error:
            errors.append(error)

    thread = threading.Thread(target=waiting)
    thread.start()
    try:
        deadline = time.monotonic() + 3
        while len(queued) < 2 and time.monotonic() < deadline:
            time.sleep(0.01)
        assert len(queued) == 2
        function, old_message = queued[0]
        function(old_message)
        assert not called
    finally:
        runtime.abort("shared")
        thread.join(5)
    assert not thread.is_alive() and len(errors) == 1


def test_a_dead_runtime_fails_before_registering_new_entries(ipc):
    runtime = ipc()
    runtime.process.kill()
    runtime.process.wait(timeout=5)
    runtime.reader.join(timeout=5)
    assert not runtime.reader.is_alive()
    for _ in range(3):
        with pytest.raises(RuntimeError, match="runtime_unavailable"):
            runtime.call("authorize", invocation_id="broken-pipe", request={})
        assert (
            not runtime.pending
            and not runtime.callbacks
            and not runtime.cancel_callbacks
        )
        assert not runtime.wire_ids and not runtime._wire_owners


def test_a_broken_pipe_during_send_clears_registered_entries(ipc, monkeypatch):
    import os  # noqa: PLC0415

    runtime = ipc()
    original = os.write
    target_fd = runtime.process.stdin.fileno()

    def break_pipe(fd, data):
        if fd == target_fd:
            runtime.process.kill()
            runtime.process.wait(timeout=5)
        return original(fd, data)

    monkeypatch.setattr(os, "write", break_pipe)
    with pytest.raises(BrokenPipeError):
        runtime.call("authorize", invocation_id="broken-pipe", request={})
    runtime.reader.join(3)
    assert not runtime.pending and not runtime.wire_ids and not runtime._wire_owners


def test_reader_cleanup_isolates_a_failing_cancel_callback(ipc):
    import threading  # noqa: PLC0415

    runtime = ipc()
    completed = threading.Event()

    def fail():
        raise RuntimeError("cancel failed")

    runtime.cancel_callbacks["first"] = fail
    runtime.cancel_callbacks["second"] = completed.set
    future = __import__("concurrent.futures").futures.Future()
    runtime.pending["pending"] = future
    runtime.process.kill()
    runtime.process.wait(timeout=5)
    runtime.reader.join(timeout=5)
    try:
        assert completed.is_set()
        assert future.done() and isinstance(future.exception(), RuntimeError)
    finally:
        runtime.cancel_callbacks.clear()
