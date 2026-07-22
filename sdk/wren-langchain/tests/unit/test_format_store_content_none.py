"""format_store_content must tolerate None nl/sql."""

import importlib.util
from pathlib import Path

_PATH = Path(__file__).resolve().parents[2] / "src" / "wren_langchain" / "_format.py"
# file is under tests/unit → parents[2] is wren-langchain package root
_PATH = Path(__file__).resolve().parents[2] / "src" / "wren_langchain" / "_format.py"
if not _PATH.exists():
    _PATH = (
        Path(__file__).resolve().parents[3] / "src" / "wren_langchain" / "_format.py"
    )

# Direct load: path is sdk/wren-langchain/tests/unit/... so parents:
# 0=unit 1=tests 2=wren-langchain
_ROOT = Path(__file__).resolve().parents[2]
_PATH = _ROOT / "src" / "wren_langchain" / "_format.py"
_spec = importlib.util.spec_from_file_location("_fmt", _PATH)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)


def test_none_sql():
    out = _mod.format_store_content("q", None, None)
    assert "Stored:" in out
    assert "q" in out


def test_none_nl_and_tags():
    out = _mod.format_store_content(None, "SELECT 1", None)
    assert "SELECT 1" in out


def test_long_sql_truncated():
    sql = "SELECT " + ("x" * 200)
    out = _mod.format_store_content("n", sql, ["a", "b"])
    assert "..." in out
    assert "(2 tags)" in out
