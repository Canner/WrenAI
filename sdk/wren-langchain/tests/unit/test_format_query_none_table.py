"""format_query_content must tolerate a None or unreadable table."""

from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path


def _load_format():
    path = Path(__file__).resolve().parents[2] / "src" / "wren_langchain" / "_format.py"
    # Provide a lightweight pyarrow stub if missing — only Table is referenced.
    original = sys.modules.get("pyarrow")
    if "pyarrow" not in sys.modules:
        pa = types.ModuleType("pyarrow")

        class _Table:
            def to_pylist(self):
                return []

        pa.Table = _Table
        sys.modules["pyarrow"] = pa

    try:
        spec = importlib.util.spec_from_file_location("wren_langchain_format_ut", path)
        mod = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(mod)
    finally:
        if original is not None:
            sys.modules["pyarrow"] = original
        else:
            sys.modules.pop("pyarrow", None)
    return mod


def test_format_query_content_none_table() -> None:
    fmt = _load_format()
    content, warnings = fmt.format_query_content(None)
    assert content == "[]"
    assert warnings and "None" in warnings[0]


def test_format_query_content_unreadable_table() -> None:
    fmt = _load_format()

    class _Broken:
        def to_pylist(self):
            raise RuntimeError("boom")

    content, warnings = fmt.format_query_content(_Broken())
    assert content == "[]"
    assert warnings and "unable to read table" in warnings[0]
