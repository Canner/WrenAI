"""format_query_content must tolerate a None table."""

from __future__ import annotations

import importlib.util
from pathlib import Path


def _load_format():
    path = (
        Path(__file__).resolve().parents[2]
        / "src"
        / "wren_langchain"
        / "_format.py"
    )
    # Provide a lightweight pyarrow stub if missing — only to_pylist is used.
    import sys
    import types

    if "pyarrow" not in sys.modules:
        pa = types.ModuleType("pyarrow")

        class _Table:
            def to_pylist(self):
                return []

        pa.Table = _Table
        sys.modules["pyarrow"] = pa

    spec = importlib.util.spec_from_file_location("wren_langchain_format_ut", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def test_format_query_content_none_table() -> None:
    fmt = _load_format()
    content, warnings = fmt.format_query_content(None)  # type: ignore[arg-type]
    assert content == "[]"
    assert warnings and "None" in warnings[0]
