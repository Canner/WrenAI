"""format_* helpers must tolerate non-dict list rows from memory/search APIs."""

from __future__ import annotations

from wren_langchain._format import (
    format_fetch_context_content,
    format_list_models_content,
    format_recall_content,
)

_FETCH_FALLBACK = "_No relevant context items found._"
_RECALL_FALLBACK = "_No similar past queries found._"
_MODELS_FALLBACK = "_No models defined in this Wren project._"


def test_format_fetch_context_skips_non_dict_items() -> None:
    out = format_fetch_context_content(
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
    # Skipped rows must not shift the numbering — the first valid row is `1.`.
    assert "1. [model] orders" in out
    assert "not-a-dict" not in out


def test_format_fetch_context_non_list_container_falls_back() -> None:
    out = format_fetch_context_content({"strategy": "search", "results": "oops"})
    assert out == _FETCH_FALLBACK


def test_format_fetch_context_all_invalid_falls_back() -> None:
    out = format_fetch_context_content(
        {"strategy": "search", "results": ["x", None, 3]}
    )
    assert out == _FETCH_FALLBACK


def test_format_fetch_context_normalizes_non_str_summary() -> None:
    out = format_fetch_context_content(
        {
            "strategy": "search",
            "results": [{"item_type": "model", "name": "orders", "summary": 42}],
        }
    )
    assert "1. [model] orders — 42" in out


def test_format_recall_skips_non_dict_rows() -> None:
    out = format_recall_content(
        [
            "x",
            {"nl": "List orders", "sql": "SELECT 1"},
        ]
    )
    # Renumbering: the valid row is `1.` even though a bad row preceded it.
    assert '1. "List orders"' in out
    assert "SELECT 1" in out


def test_format_recall_non_list_falls_back() -> None:
    assert format_recall_content("nope") == _RECALL_FALLBACK  # type: ignore[arg-type]


def test_format_recall_all_invalid_falls_back() -> None:
    assert format_recall_content(["x", None, 3]) == _RECALL_FALLBACK


def test_format_list_models_skips_non_dict_models() -> None:
    out = format_list_models_content(
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


def test_format_list_models_non_list_falls_back() -> None:
    assert format_list_models_content({"models": "oops"}) == _MODELS_FALLBACK


def test_format_list_models_all_invalid_falls_back() -> None:
    assert format_list_models_content({"models": ["x", None]}) == _MODELS_FALLBACK


def test_format_list_models_normalizes_non_list_columns() -> None:
    out = format_list_models_content(
        {"models": [{"name": "customers", "columns": "nope", "description": "d"}]}
    )
    assert "| customers | 0 | d |" in out


def test_format_list_models_normalizes_non_dict_properties() -> None:
    out = format_list_models_content(
        {
            "models": [
                {
                    "name": "customers",
                    "columns": [{}],
                    "properties": "oops",
                    "description": "fallback desc",
                }
            ]
        }
    )
    assert "| customers | 1 | fallback desc |" in out
