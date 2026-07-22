import importlib.util
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
_PATH = _ROOT / "src" / "wren_langchain" / "_format.py"
_spec = importlib.util.spec_from_file_location("_fmt", _PATH)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)


def test_skips_non_dict_rows():
    out = _mod.format_recall_content(
        [None, "x", {"nl": "q1", "sql": "SELECT 1"}, {"nl_query": "q2", "sql_query": "SELECT 2"}]
    )
    assert "q1" in out and "SELECT 1" in out
    assert "q2" in out
    assert out.startswith('1. "')


def test_all_invalid_returns_empty_message():
    assert _mod.format_recall_content([None, 3]) == "_No similar past queries found._"
