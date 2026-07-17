"""format_* helpers must tolerate non-dict list rows from memory/search APIs."""

from __future__ import annotations

import importlib.util
import pathlib

_PATH = (
    pathlib.Path(__file__).resolve().parents[2]
    / "src"
    / "wren_langchain"
    / "_format.py"
)
_spec = importlib.util.spec_from_file_location("wren_langchain_format_ut", _PATH)
_fmt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fmt)


def test_format_fetch_context_skips_non_dict_items() -> None:
    out = _fmt.format_fetch_context_content(
        {
            "strategy": "search",
            "results": [
                "not-a-dict",
                None,
                {
                    "item_type": "model",
                    "name": "orders",
                    "summary": "Orders table",
                },
            ],
        }
    )
    assert "[model] orders" in out
    assert "not-a-dict" not in out


def test_format_recall_skips_non_dict_rows() -> None:
    out = _fmt.format_recall_content(
        [
            "x",
            {"nl": "List orders", "sql": "SELECT 1"},
        ]
    )
    assert "List orders" in out
    assert "SELECT 1" in out


def test_format_list_models_skips_non_dict_models() -> None:
    out = _fmt.format_list_models_content(
        {
            "models": [
                "bad",
                None,
                {
                    "name": "customers",
                    "columns": [{}, {}],
                    "description": "desc",
                },
            ]
        }
    )
    assert "| customers | 2 | desc |" in out
