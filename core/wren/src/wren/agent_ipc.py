"""Versioned private host IPC; no model-controlled executable or environment."""

from __future__ import annotations

import concurrent.futures
import json
import os
import subprocess
import threading
import uuid
from pathlib import Path

PROTOCOL = "warble-private-service/1"


DEFAULT_CALL_TIMEOUT_S = 100.0
ABANDONED_LIMIT = 1024


class TaskAborted(RuntimeError):
    """The host ended the task and stopped waiting for the runtime."""


class RuntimeIPC:
    def __init__(self, runtime: Path, init: dict, call_timeout_s: float | None = None):
        self.pending = {}
        self.callbacks = {}
        # Ids the host gave up waiting for. A late reply or tool call for one of them is
        # answered or dropped; it is not a protocol violation and must not kill the runtime.
        self.abandoned = {}
        self.call_timeout_s = (
            DEFAULT_CALL_TIMEOUT_S if call_timeout_s is None else call_timeout_s
        )
        self.lock = threading.Lock()
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
        raw = json.dumps(value, ensure_ascii=False)
        if len(raw.encode()) > 1048576:
            raise ValueError("ipc_size")
        with self.lock:
            self.process.stdin.write(raw + "\n")
            self.process.stdin.flush()

    def _tool(self, message):
        response = {
            "type": "tool_result",
            "id": message["id"],
            "owner": message["owner"],
        }
        try:
            callback = self.callbacks[message["owner"]]
            response["value"] = callback(message["name"], message["args"])
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
                    owner = m.get("owner")
                    if owner not in self.callbacks and owner not in self.abandoned:
                        raise ValueError("ipc_order")
                    self.pool.submit(self._tool, m)
                else:
                    future = self.pending.pop(m["id"], None)
                    if future is None:
                        if m["id"] in self.abandoned:
                            continue
                        raise ValueError("ipc_order")
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
            for future in list(self.pending.values()):
                if not future.done():
                    future.set_exception(RuntimeError("runtime_unavailable"))
            self.pending.clear()

    def call(self, op, *, callback=None, invocation_id=None, usage=None, **values):
        """Send one op and wait for its reply.

        ``usage``, when given, receives the runtime's per-attempt ``calls`` of a successful
        reply (a failed one carries them on the exception). They are audit-only and never part
        of the returned value.
        """
        ident = invocation_id or str(uuid.uuid4())
        if ident in self.pending or ident in self.abandoned:
            raise ValueError("invalid_invocation_id")
        future = concurrent.futures.Future()
        self.pending[ident] = future
        if callback:
            self.callbacks[ident] = callback
        try:
            self._send({"id": ident, "op": op, **values})
            # The runtime's own deadlines sit below this cap. The operator can override it.
            value, calls = future.result(timeout=self._timeout())
            if usage is not None and calls is not None:
                usage["calls"] = calls
            return value
        except concurrent.futures.TimeoutError:
            self._abandon(ident, cancel=op == "invoke")
            failure = RuntimeError("runtime_unavailable")
            failure.detail = "ipc_timeout:host"
            raise failure from None
        finally:
            self.callbacks.pop(ident, None)

    def _timeout(self) -> float:
        raw = os.environ.get("WREN_IPC_CALL_TIMEOUT_S")
        return float(raw) if raw else self.call_timeout_s

    def _abandon(self, ident, *, cancel: bool):
        """Stop waiting for ``ident``: clear it and ask the runtime to cancel its work."""
        self._remember(ident)
        self.pending.pop(ident, None)
        if not cancel:
            return
        cancel_id = str(uuid.uuid4())
        self._remember(cancel_id)
        try:
            self._send({"id": cancel_id, "op": "cancel", "owner": ident})
        except Exception:
            pass

    def _remember(self, ident):
        self.abandoned[ident] = True
        while len(self.abandoned) > ABANDONED_LIMIT:
            del self.abandoned[next(iter(self.abandoned))]

    def cancel(self, owner):
        return self.call("cancel", **{"owner": owner})

    def abort(self, owner):
        """End a task now: ask the runtime to cancel it and stop waiting for its answer.

        The call that waits for ``owner`` fails with ``TaskAborted``; whatever the runtime
        still sends for it (a tool call, a final value) is refused or dropped.
        """
        future = self.pending.pop(owner, None)
        self._abandon(owner, cancel=True)
        if future is not None and not future.done():
            future.set_exception(TaskAborted())

    def close(self):
        try:
            self.process.stdin.close()
            self.process.wait(timeout=5)
        except Exception:
            self.process.kill()
            self.process.wait(timeout=5)
        self.pool.shutdown(wait=True, cancel_futures=True)
