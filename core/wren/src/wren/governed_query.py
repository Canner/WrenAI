"""Terminable host-owned SQL execution for governed services only.

Each query gets a fresh engine/connection in a child interpreter. Credentials travel
through an anonymous pipe, never command arguments. Terminating the local worker closes
its connections; remote server-side cancellation is connector/server dependent.
"""

from __future__ import annotations

import contextlib
import contextvars
import os
import pickle
import signal
import subprocess
import sys
import threading
import time

from wren.engine import WrenEngine
from wren.model.error import DatabaseTimeoutError, WrenError

DEFAULT_QUERY_TIMEOUT_S = 90.0
_CURRENT = contextvars.ContextVar("governed_query_lifetime", default=None)


class QueryCancelled(RuntimeError):
    """The host ended the query's owning task."""


def _stop(process):
    """Reap this worker (and its process group on POSIX), escalating to SIGKILL."""

    def send(sig):
        try:
            if os.name == "posix":
                os.killpg(process.pid, sig)
            elif sig == signal.SIGTERM:
                process.terminate()
            else:
                process.kill()
        except ProcessLookupError:
            pass

    if process.poll() is not None:
        return
    send(signal.SIGTERM)
    try:
        process.wait(timeout=0.5)
    except subprocess.TimeoutExpired:
        send(signal.SIGKILL)
        process.wait(timeout=1)


class QueryLifetime:
    """One task's absolute deadline and cancellable query children, across threads."""

    def __init__(self, timeout_s=DEFAULT_QUERY_TIMEOUT_S):
        self.deadline = time.monotonic() + timeout_s
        self.lock = threading.RLock()
        self.cancelled = False
        self.children = set()

    def check(self):
        if self.cancelled:
            raise QueryCancelled("query_cancelled")
        if time.monotonic() >= self.deadline:
            raise DatabaseTimeoutError("Host query deadline exceeded")

    @contextlib.contextmanager
    def bind(self):
        token = _CURRENT.set(self)
        try:
            self.check()
            yield
            self.check()
        finally:
            _CURRENT.reset(token)

    def cancel(self):
        # Registration and termination share the lock: no child can escape a
        # close that races with Popen. Cancellation is idempotent.
        with self.lock:
            self.cancelled = True
            for child in list(self.children):
                _stop(child)
                self.children.discard(child)

    def query(self, engine, sql, limit):
        spec = {
            "manifest_str": engine.manifest_str,
            "data_source": engine.data_source,
            "connection_info": engine.connection_info,
            "function_path": engine.function_path,
            "fallback": engine._fallback,
            "config": engine._config,
        }
        payload = pickle.dumps((spec, sql, limit))
        with self.lock:
            self.check()
            process = subprocess.Popen(
                [sys.executable, "-m", "wren.governed_query"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            self.children.add(process)
        try:
            data = payload
            while True:
                self.check()
                try:
                    output, _ = process.communicate(
                        data,
                        timeout=min(0.05, max(0.001, self.deadline - time.monotonic())),
                    )
                    break
                except subprocess.TimeoutExpired:
                    data = None
            self.check()
            if process.returncode:
                raise RuntimeError("query_worker_unavailable")
            value, error = pickle.loads(output)
            if error is not None:
                if error[0] == "wren":
                    raise WrenError(
                        error[1], error[2], phase=error[3], metadata=error[4]
                    )
                raise RuntimeError("query_execution_failed")
            return value
        finally:
            with self.lock:
                _stop(process)
                self.children.discard(process)
            for stream in (process.stdin, process.stdout):
                stream.close()


def query(engine, sql, limit):
    """Execute only on the governed path; ordinary WrenEngine.query is unchanged."""
    lifetime = _CURRENT.get()
    if lifetime is not None:
        return lifetime.query(engine, sql, limit)
    lifetime = QueryLifetime()
    try:
        return lifetime.query(engine, sql, limit)
    finally:
        lifetime.cancel()


def _main():
    # This pipe has exactly one trusted writer: the parent host. No model-supplied
    # serialized objects or executable paths are accepted by the public service.
    spec, sql, limit = pickle.loads(sys.stdin.buffer.read())
    try:
        with WrenEngine(**spec) as engine:
            table = engine.query(sql, limit, read_only=True)
        response = (table, None)
    except WrenError as error:
        response = (
            None,
            ("wren", error.error_code, error.message, error.phase, error.metadata),
        )
    except Exception:
        response = (None, ("internal",))
    sys.stdout.buffer.write(pickle.dumps(response))
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    _main()
