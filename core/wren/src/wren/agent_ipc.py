"""Versioned private host IPC; no model-controlled executable or environment."""

from __future__ import annotations

import concurrent.futures
import json
import math
import os
import selectors
import subprocess
import threading
import time
import uuid
from pathlib import Path

PROTOCOL = "warble-private-service/1"


DEFAULT_CALL_TIMEOUT_S = 100.0
ABANDONED_LIMIT = 1024
CONTROL_WRITE_TIMEOUT_S = 0.1
TOOL_SHUTDOWN_TIMEOUT_S = 1.0
TOOL_CALL_CAPACITY = 128


class TaskAborted(RuntimeError):
    """The host ended the task and stopped waiting for the runtime."""


class RuntimeIPC:
    def __init__(self, runtime: Path, init: dict, call_timeout_s: float | None = None):
        if os.name != "posix":
            raise RuntimeError("unsupported_platform: private IPC requires POSIX")
        self.pending = {}
        self.callbacks = {}
        self.cancel_callbacks = {}
        self.closed = False
        # Runtime IDs are opaque host-issued sequence numbers, independent of
        # caller task labels. A fixed prefix/range recognises every retired ID
        # exactly without retaining an ever-growing set of tombstones.
        self._wire_prefix = uuid.uuid4().hex
        self._wire_sequence = 0
        self.wire_ids = {}
        self._wire_owners = {}
        self._wire_deadlines = {}
        # Ids the host gave up waiting for. A late reply or tool call for one of them is
        # answered or dropped; it is not a protocol violation and must not kill the runtime.
        self.abandoned = {}
        self.call_timeout_s = (
            DEFAULT_CALL_TIMEOUT_S if call_timeout_s is None else call_timeout_s
        )
        self.lock = threading.Lock()
        self.state_lock = threading.RLock()
        self._tool_thread = threading.local()
        self._tool_futures = set()
        self.pool = concurrent.futures.ThreadPoolExecutor(max_workers=8)
        self.process = subprocess.Popen(
            ["node", str(runtime)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            start_new_session=True,
            env={
                "PATH": os.environ.get("PATH", ""),
                "PI_OFFLINE": "1",
                "PI_TELEMETRY": "0",
            },
        )
        os.set_blocking(self.process.stdin.fileno(), False)
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()
        try:
            hello = self.call("init", protocol=PROTOCOL, **init)
            if hello != {"protocol": PROTOCOL, "ir": "0.9", "schema": "1"}:
                raise ValueError("incompatible_runtime")
        except BaseException:
            self.close()
            raise

    def _send(self, value):
        raw = (json.dumps(value, ensure_ascii=False) + "\n").encode()
        if len(raw) > 1048577:
            raise ValueError("ipc_size")
        with self.state_lock:
            wire = value.get("id")
            deadline = (
                None
                if value.get("type") == "tool_result"
                else self._wire_deadlines.get(wire)
            )
            owner = self._wire_owners.get(wire) if deadline is not None else None
        deadline = (
            deadline
            if deadline is not None
            else time.monotonic() + CONTROL_WRITE_TIMEOUT_S
        )
        if value.get("op") == "cancel":
            deadline = min(deadline, time.monotonic() + CONTROL_WRITE_TIMEOUT_S)

        def check():
            if self.closed:
                raise RuntimeError("runtime_unavailable")
            if owner is not None and owner not in self.pending:
                raise TaskAborted()
            if time.monotonic() >= deadline:
                raise concurrent.futures.TimeoutError()

        acquired, sent = False, 0
        try:
            while not acquired:
                check()
                acquired = self.lock.acquire(
                    timeout=min(0.01, max(0, deadline - time.monotonic()))
                )
            check()
            with selectors.DefaultSelector() as selector:
                selector.register(self.process.stdin, selectors.EVENT_WRITE)
                while sent < len(raw):
                    check()
                    try:
                        sent += os.write(
                            self.process.stdin.fileno(), raw[sent : sent + 65536]
                        )
                    except BlockingIOError:
                        selector.select(min(0.01, max(0, deadline - time.monotonic())))
        except BaseException:
            # A partial JSON frame cannot be abandoned and followed by another
            # frame. End this stalled transport rather than corrupting its stream.
            if sent:
                try:
                    self.process.kill()
                except OSError:
                    pass
            raise
        finally:
            if acquired:
                self.lock.release()

    def _tool(self, message):
        self._tool_thread.active = True
        try:
            self._handle_tool(message)
        finally:
            self._tool_thread.active = False

    def _tool_finished(self, future):
        with self.state_lock:
            self._tool_futures.discard(future)

    def _shutdown_pool(self, *, wait):
        self.pool.shutdown(wait=False, cancel_futures=True)
        if wait:
            with self.state_lock:
                active = tuple(self._tool_futures)
            # Non-cancellable Python callbacks can outlive teardown. Stop waiting
            # after this bound; this does not terminate their external work.
            if active:
                concurrent.futures.wait(active, timeout=TOOL_SHUTDOWN_TIMEOUT_S)

    def _handle_tool(self, message):
        response = {
            "type": "tool_result",
            "id": message["id"],
            "owner": message["owner"],
        }
        try:
            owner = message["_owner"]
            with self.state_lock:
                if (
                    self.closed
                    or self.wire_ids.get(owner) != message["owner"]
                    or owner not in self.pending
                ):
                    raise PermissionError("task_ended")
                callback = self.callbacks[owner]
            response["value"] = callback(message["name"], message["args"])
            if (
                owner not in self.pending
                or self.wire_ids.get(owner) != message["owner"]
                or self.closed
            ):
                return
        except Exception:
            response["error"] = "tool_denied"
        try:
            self._send(response)
        except Exception:
            pass

    def _read(self):
        try:
            while True:
                line = self.process.stdout.readline(1048577)
                if not line:
                    break
                if len(line.encode()) > 1048576 or not line.endswith("\n"):
                    raise ValueError("ipc_size")
                m = json.loads(line)
                if m.get("type") == "tool_call":
                    with self.state_lock:
                        wire = m.get("owner")
                        owner = self._wire_owners.get(wire)
                        if owner not in self.callbacks or owner not in self.pending:
                            if not self._issued(wire):
                                raise ValueError("ipc_order")
                            future = None
                        else:
                            # Finished calls release capacity even if their done
                            # callback is still waiting for this state lock.
                            self._tool_futures = {
                                f for f in self._tool_futures if not f.done()
                            }
                            if len(self._tool_futures) >= TOOL_CALL_CAPACITY:
                                raise ValueError("ipc_tool_capacity")
                            m["_owner"] = owner
                            future = self.pool.submit(self._tool, m)
                            self._tool_futures.add(future)
                    if future is None:
                        # Retired owners keep the late-call refusal contract but
                        # cannot consume executor or admission capacity.
                        self._send(
                            {
                                "type": "tool_result",
                                "id": m["id"],
                                "owner": wire,
                                "error": "tool_denied",
                            }
                        )
                    else:
                        future.add_done_callback(self._tool_finished)
                else:
                    with self.state_lock:
                        owner = self._wire_owners.get(m["id"])
                        future = self.pending.get(owner)
                        if future is None:
                            if self._issued(m["id"]):
                                continue
                            raise ValueError("ipc_order")
                        # Retain the waiter until the complete reply can be read.
                        # Protocol failure below must still fail it in finally.
                        if not m.get("error") and "value" not in m:
                            raise ValueError("ipc_reply")
                        self._wire_owners.pop(m["id"])
                        self.pending.pop(owner)
                    if m.get("error"):
                        failure = RuntimeError("runtime_unavailable")
                        # Operator diagnostics only: never forwarded to a caller.
                        # The runtime sends a generic error plus its failure code.
                        failure.detail = ":".join(
                            str(x)[:80] for x in (m["error"], m.get("diagnostic")) if x
                        )
                        # The per-attempt usage and counters are audit-only and arrive
                        # unvalidated; the service checks every field before it records one.
                        failure.calls = m.get("calls")
                        failure.turns = m.get("turns")
                        failure.tool_calls = m.get("toolCalls")
                        future.set_exception(failure)
                    else:
                        future.set_result((m["value"], m.get("calls")))
        except Exception:
            self.process.kill()
        finally:
            with self.state_lock:
                self.closed = True
                cancels = list(self.cancel_callbacks.values())
                futures = list(self.pending.values())
                self.pending.clear()
                self.callbacks.clear()
                self.cancel_callbacks.clear()
                self.wire_ids.clear()
                self._wire_owners.clear()
                self._wire_deadlines.clear()
            # Stop queued callbacks before releasing any active callback. The
            # bounded wait below lets cancellable work finish after owners are cancelled.
            self.pool.shutdown(wait=False, cancel_futures=True)
            for future in futures:
                if not future.done():
                    future.set_exception(RuntimeError("runtime_unavailable"))
            for cancel in cancels:
                self._cancel_callback(cancel)
            try:
                if self.process.poll() is None:
                    self.process.kill()
                self.process.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                pass
            self._shutdown_pool(wait=True)

    def call(
        self,
        op,
        *,
        callback=None,
        invocation_id=None,
        on_cancel=None,
        usage=None,
        timeout_s=None,
        **values,
    ):
        """Send one op and wait for its reply.

        ``on_cancel`` releases host-owned work when this call fails, is abandoned,
        or the IPC closes. A successful reply leaves the owner's lifetime intact.
        ``usage``, when given, receives the runtime's per-attempt ``calls`` of a successful
        reply (a failed one carries them on the exception). They are audit-only and never part
        of the returned value.
        """
        if self.closed:
            raise RuntimeError("runtime_unavailable")
        timeout = self._timeout()
        if not math.isfinite(timeout) or (
            timeout_s is not None and not math.isfinite(timeout_s)
        ):
            raise ValueError("invalid_ipc_timeout")
        if timeout_s is not None:
            timeout = min(timeout, max(0, timeout_s))
        deadline = time.monotonic() + timeout
        ident = invocation_id or str(uuid.uuid4())
        future = concurrent.futures.Future()
        with self.state_lock:
            if self.closed:
                raise RuntimeError("runtime_unavailable")
            if (
                ident in self.pending
                or ident in self.abandoned
                or ident in self.wire_ids
            ):
                raise ValueError("invalid_invocation_id")
            wire = self._new_wire_id()
            self.pending[ident] = future
            self.wire_ids[ident] = wire
            self._wire_owners[wire] = ident
            self._wire_deadlines[wire] = deadline
            if callback:
                self.callbacks[ident] = callback
            if on_cancel:
                self.cancel_callbacks[ident] = on_cancel
        completed = False
        try:
            self._send({"id": wire, "op": op, **values})
            # The runtime's own deadlines sit below this cap. The operator can override it.
            value, calls = future.result(timeout=max(0, deadline - time.monotonic()))
            completed = True
            if usage is not None and calls is not None:
                usage["calls"] = calls
            return value
        except concurrent.futures.TimeoutError:
            self._abandon(ident, cancel=op == "invoke")
            failure = RuntimeError("runtime_unavailable")
            failure.detail = "ipc_timeout:host"
            raise failure from None
        finally:
            with self.state_lock:
                self.pending.pop(ident, None)
                self.wire_ids.pop(ident, None)
                self._wire_owners.pop(wire, None)
                self._wire_deadlines.pop(wire, None)
            cancel = self.cancel_callbacks.pop(ident, None)
            if cancel is not None and not completed:
                self._cancel_callback(cancel)
            self.callbacks.pop(ident, None)

    @staticmethod
    def _cancel_callback(cancel):
        # One failed cleanup must not strand other invocations or their waiters.
        try:
            cancel()
        except Exception:
            pass

    def _timeout(self) -> float:
        raw = os.environ.get("WREN_IPC_CALL_TIMEOUT_S")
        return float(raw) if raw else self.call_timeout_s

    def _abandon(self, ident, *, cancel: bool):
        """Stop waiting for ``ident``: clear it and ask the runtime to cancel its work."""
        with self.state_lock:
            self._remember(ident)
            self.pending.pop(ident, None)
        cancel_callback = self.cancel_callbacks.get(ident)
        if cancel_callback is not None:
            self._cancel_callback(cancel_callback)
        if not cancel:
            return
        with self.state_lock:
            wire = self.wire_ids.get(ident)
            if wire is None:
                return
            cancel_id = self._new_wire_id()
        try:
            self._send({"id": cancel_id, "op": "cancel", "owner": wire})
        except Exception:
            pass

    def _new_wire_id(self):
        # Called with state_lock held. Fixed-width bounded range: exhausted
        # transports must be restarted rather than reusing a historical ID.
        if self._wire_sequence >= 2**64 - 1:
            raise RuntimeError("ipc_id_exhausted")
        self._wire_sequence += 1
        return f"{self._wire_prefix}:{self._wire_sequence}"

    def _issued(self, wire):
        if not isinstance(wire, str):
            return False
        prefix, separator, sequence = wire.partition(":")
        if (
            prefix != self._wire_prefix
            or separator != ":"
            or not sequence.isascii()
            or not sequence.isdecimal()
        ):
            return False
        # Reject alternative spellings and future/unallocated IDs as protocol errors.
        if len(sequence) > 20:
            return False
        number = int(sequence)
        return str(number) == sequence and 0 < number <= self._wire_sequence

    def _remember(self, ident):
        self.abandoned[ident] = True
        while len(self.abandoned) > ABANDONED_LIMIT:
            del self.abandoned[next(iter(self.abandoned))]

    def cancel(self, owner):
        cancel = self.cancel_callbacks.get(owner)
        if cancel is not None:
            self._cancel_callback(cancel)
        with self.state_lock:
            wire = self.wire_ids.get(owner)
        return self.call("cancel", **{"owner": wire or owner})

    def abort(self, owner):
        """End a task now: ask the runtime to cancel it and stop waiting for its answer.

        The call that waits for ``owner`` fails with ``TaskAborted``; whatever the runtime
        still sends for it (a tool call, a final value) is refused or dropped.
        """
        with self.state_lock:
            future = self.pending.pop(owner, None)
            self._remember(owner)
        self._abandon(owner, cancel=True)
        if future is not None and not future.done():
            future.set_exception(TaskAborted())

    def close(self):
        self.closed = True
        for owner in list(self.cancel_callbacks):
            self.abort(owner)
        try:
            # Every writer is nonblocking and checks closed while owning this
            # lock, so it releases before we close/reuse the pipe descriptor.
            with self.lock:
                self.process.stdin.close()
            self.process.wait(timeout=5)
        except Exception:
            self.process.kill()
            self.process.wait(timeout=5)
        internal = threading.current_thread() is self.reader or getattr(
            self._tool_thread, "active", False
        )
        if not internal:
            self.reader.join(timeout=5)
        # The reader waits up to the callback bound after an internal close returns.
        self._shutdown_pool(wait=not internal)
