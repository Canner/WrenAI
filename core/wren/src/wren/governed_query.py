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
import selectors
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

from wren.model.error import DatabaseTimeoutError, WrenError
from wren.project_fingerprint import MAX_FRAME_BYTES, write_frame

DEFAULT_QUERY_TIMEOUT_S = 90.0
DEFAULT_FILESYSTEM_TIMEOUT_S = 15.0
MAX_ARROW_BYTES = 65536
_CURRENT = contextvars.ContextVar("governed_query_lifetime", default=None)


def require_platform():
    """The controlled service contract requires POSIX pipes and process groups."""
    if os.name != "posix":
        raise RuntimeError("unsupported_platform: governed workers require POSIX")


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
        if os.name == "posix":
            send(signal.SIGKILL)
        return
    send(signal.SIGTERM)
    try:
        process.wait(timeout=0.5)
    except subprocess.TimeoutExpired:
        send(signal.SIGKILL)
        process.wait(timeout=1)
    else:
        # A terminated leader may leave helpers that ignored TERM in its owned group.
        if os.name == "posix":
            send(signal.SIGKILL)


class QueryLifetime:
    """One task's absolute deadline and cancellable query children, across threads."""

    def __init__(self, timeout_s=DEFAULT_QUERY_TIMEOUT_S):
        require_platform()
        self.deadline = time.monotonic() + timeout_s
        self.lock = threading.RLock()
        self.cancelled = False
        self.children = set()
        self.cancel_hooks = set()

    def remaining(self):
        self.check()
        return self.deadline - time.monotonic()

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
            hooks = list(self.cancel_hooks)
            self.cancel_hooks.clear()
            for child in list(self.children):
                _stop(child)
                self.children.discard(child)
        for hook in hooks:
            try:
                hook()
            except Exception:
                pass

    @contextlib.contextmanager
    def cancel_on(self, hook):
        """Link another host wait to this lifetime without sharing its wire ID."""
        with self.lock:
            self.check()
            self.cancel_hooks.add(hook)
        try:
            yield
        finally:
            with self.lock:
                self.cancel_hooks.discard(hook)

    def query(self, engine, sql, limit):
        spec = {
            "manifest_str": engine.manifest_str,
            "data_source": engine.data_source,
            "connection_info": engine.connection_info,
            "function_path": engine.function_path,
            "fallback": engine._fallback,
            "config": engine._config,
        }
        return self._run(
            [sys.executable, "-m", "wren.governed_query"], (spec, sql, limit)
        )

    def fingerprint(self, root, paths):
        worker = Path(__file__).with_name("project_fingerprint.py")
        return self._run(
            [sys.executable, str(worker)], (str(root), [str(path) for path in paths])
        )

    def _run(self, command, value):
        payload = pickle.dumps(value)
        with self.lock:
            self.check()
            process = subprocess.Popen(
                command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            self.children.add(process)
        try:
            output = self._exchange(process, payload)
            self.check()
            if process.returncode:
                raise RuntimeError("query_worker_unavailable")
            value, error = pickle.loads(output)
            if error is not None:
                if error[0] == "wren":
                    raise WrenError(
                        error[1], error[2], phase=error[3], metadata=error[4]
                    )
                if error[0] == "result":
                    raise ValueError(error[1])
                if error[0] == "changed":
                    raise ValueError("context_changed")
                if error[0] == "filesystem":
                    raise RuntimeError("filesystem_unavailable")
                raise RuntimeError("query_execution_failed")
            return value
        except OSError:
            self.check()
            raise RuntimeError("query_worker_unavailable") from None
        finally:
            with self.lock:
                _stop(process)
                self.children.discard(process)
            for stream in (process.stdin, process.stdout):
                stream.close()

    def _exchange(self, process, payload):
        """Bound reads before buffering/deserialization, including a forged frame length.

        Both pipes are nonblocking: a stalled input reader or output writer is
        governed by the same cancellation/deadline and never requires a reader thread.
        """
        output, expected, sent, eof = bytearray(), None, 0, False
        with selectors.DefaultSelector() as selector:
            os.set_blocking(process.stdin.fileno(), False)
            os.set_blocking(process.stdout.fileno(), False)
            selector.register(process.stdin, selectors.EVENT_WRITE)
            selector.register(process.stdout, selectors.EVENT_READ)
            while not eof or process.poll() is None:
                self.check()
                for key, _events in selector.select(
                    min(0.05, max(0.001, self.remaining()))
                ):
                    if key.fileobj is process.stdin:
                        sent += os.write(
                            process.stdin.fileno(), payload[sent : sent + 8192]
                        )
                        if sent == len(payload):
                            selector.unregister(process.stdin)
                            process.stdin.close()
                    else:
                        chunk = os.read(process.stdout.fileno(), 8192)
                        if not chunk:
                            eof = True
                            selector.unregister(process.stdout)
                            continue
                        if len(output) + len(chunk) > MAX_FRAME_BYTES + 8:
                            raise ValueError("result_limit")
                        output.extend(chunk)
                        if expected is None and len(output) >= 8:
                            expected = int.from_bytes(output[:8], "big")
                            if expected > MAX_FRAME_BYTES:
                                raise ValueError("result_limit")
                        if expected is not None and len(output) > expected + 8:
                            raise RuntimeError("query_worker_protocol")
            self.check()
            if expected is None or len(output) != expected + 8:
                raise RuntimeError("query_worker_protocol")
        return bytes(output[8:])


def current_lifetime():
    return _CURRENT.get()


def fingerprint(root, paths):
    lifetime = _CURRENT.get()
    if lifetime is not None:
        return lifetime.fingerprint(root, paths)
    lifetime = QueryLifetime(DEFAULT_FILESYSTEM_TIMEOUT_S)
    try:
        return lifetime.fingerprint(root, paths)
    finally:
        lifetime.cancel()


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


def _bounded_table(table):
    """Validate/compact inside the child; this does not bound connector allocation."""
    import pyarrow as pa  # noqa: PLC0415
    import pyarrow.compute as pc  # noqa: PLC0415

    if table.num_rows > 100 or not 1 <= table.num_columns <= 20:
        raise ValueError("result_limit")
    columns = []
    for column in table.columns:
        if column.null_count == len(column):
            columns.append(pa.nulls(len(column)))
            continue
        if pa.types.is_dictionary(column.type):
            column = column.dictionary_decode()
        kind = column.type
        if hasattr(pa.types, "is_string_view") and pa.types.is_string_view(kind):
            # utf8_length does not have a string-view kernel on every supported Arrow.
            column = column.cast(pa.string())
            kind = column.type
        if pa.types.is_string(kind) or pa.types.is_large_string(kind):
            if pc.max(pc.utf8_length(column)).as_py() > 256:
                raise ValueError("result_limit")
        elif not (
            pa.types.is_boolean(kind)
            or pa.types.is_integer(kind)
            or pa.types.is_floating(kind)
            or pa.types.is_decimal(kind)
            or pa.types.is_date(kind)
            or pa.types.is_timestamp(kind)
        ):
            raise ValueError("unsupported_result")
        columns.append(column)
    compact = pa.Table.from_arrays(columns, names=table.column_names)
    if compact.nbytes > MAX_ARROW_BYTES:
        raise ValueError("result_limit")
    # Take compacts sliced arrays/dictionaries so pickle cannot carry an unused
    # oversized backing buffer even when the visible values themselves fit.
    return compact.take(pa.array(range(compact.num_rows), type=pa.int32()))


def _main():
    from wren.engine import WrenEngine  # noqa: PLC0415

    # The host is this pipe's sole writer; public/model requests never contain
    # serialized objects, executables or connection arguments.
    spec, sql, limit = pickle.loads(sys.stdin.buffer.read())
    try:
        with WrenEngine(**spec) as engine:
            table = _bounded_table(engine.query(sql, limit, read_only=True))
        response = (table, None)
    except WrenError as error:
        response = (
            None,
            ("wren", error.error_code, error.message, error.phase, error.metadata),
        )
    except ValueError as error:
        response = (
            (None, ("result", str(error)))
            if str(error) in {"result_limit", "unsupported_result"}
            else (None, ("internal",))
        )
    except Exception:
        response = (None, ("internal",))
    write_frame(*response)


if __name__ == "__main__":
    _main()
