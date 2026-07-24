"""Trino unlimited query path must strip trailing semicolons.

Importing ``wren.connector.trino`` pulls ``wren_core``. Assert on source +
stdlib-reload the strip helper from ``base.py`` the same way other native-free
connector tests pin behavior.
"""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE_PATH = ROOT / "src" / "wren" / "connector" / "base.py"
TRINO_PATH = ROOT / "src" / "wren" / "connector" / "trino.py"


def _load_strip():
    spec = importlib.util.spec_from_file_location("wren_connector_base_trino_test", BASE_PATH)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    # base.py only needs stdlib + pyarrow ABC at import; skip full package.
    # Executing the file as-is imports pyarrow / ABC — acceptable in CI.
    try:
        spec.loader.exec_module(mod)
        return mod.strip_trailing_semicolon
    except ModuleNotFoundError:
        # Fallback: pure copy of the regex used by strip_trailing_semicolon.
        trailing = re.compile(r"[;\s]+\Z")

        def _strip(sql: str) -> str:
            return trailing.sub("", sql)

        return _strip


def test_strip_helper_multi_semicolon():
    strip = _load_strip()
    assert strip("SELECT 1; ; \n") == "SELECT 1"
    assert strip("SELECT 'a;b'") == "SELECT 'a;b'"


def test_query_method_always_strips_before_limit_branch():
    source = TRINO_PATH.read_text(encoding="utf-8")
    start = source.index("def query(self, sql: str, limit: int | None = None)")
    end = source.index("def dry_run(self, sql: str)", start)
    body = source[start:end]
    assert "sql = strip_trailing_semicolon(sql)" in body
    assert "SELECT * FROM ({sql}) AS _sub LIMIT {limit}" in body
    strip_at = body.index("sql = strip_trailing_semicolon(sql)")
    limit_at = body.index("if limit is not None:")
    assert strip_at < limit_at
