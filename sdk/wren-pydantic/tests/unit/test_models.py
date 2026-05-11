"""Pydantic return-model unit tests for tool outputs.

Models must match Core's MemoryStore.get_context() and recall_queries()
return shapes verbatim (see core/wren/src/wren/memory/store.py). Tests
pin those contracts so a Core upgrade that drifts surfaces here, not
later in a tool call against the real engine.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from wren_pydantic._models import (
    FetchContextResult,
    ModelSummary,
    RecalledPair,
    WrenQueryResult,
)

# ── WrenQueryResult ───────────────────────────────────────────────────────


def test_wren_query_result_round_trip():
    payload = WrenQueryResult(
        columns=["id", "name"],
        rows=[{"id": 1, "name": "alice"}, {"id": 2, "name": "bob"}],
        row_count=2,
        truncated=False,
    )
    dumped = payload.model_dump()
    restored = WrenQueryResult.model_validate(dumped)
    assert restored == payload


def test_wren_query_result_rejects_negative_row_count():
    with pytest.raises(ValidationError, match="row_count"):
        WrenQueryResult(columns=[], rows=[], row_count=-1, truncated=False)


def test_wren_query_result_row_count_must_equal_len_rows():
    """The model is the row count of *this payload* — must equal len(rows)."""
    with pytest.raises(ValidationError, match="row_count"):
        WrenQueryResult(
            columns=["c"], rows=[{"c": 1}, {"c": 2}], row_count=99, truncated=True
        )


def test_wren_query_result_truncated_flag_marks_limit_overflow():
    payload = WrenQueryResult(
        columns=["c"], rows=[{"c": 1}], row_count=1, truncated=True
    )
    assert payload.truncated is True


# ── ModelSummary ──────────────────────────────────────────────────────────


def test_model_summary_description_optional():
    summary = ModelSummary(name="orders", column_count=8)
    assert summary.description is None
    assert summary.name == "orders"


# ── FetchContextResult ────────────────────────────────────────────────────
# Core's get_context returns one of:
#   {"strategy": "full",   "schema": "<text>"}
#   {"strategy": "search", "results": [<dict>, ...]}


def test_fetch_context_full_strategy_accepts_schema_key():
    """`full` payload uses `schema` key (aliased to schema_text)."""
    payload = FetchContextResult.model_validate(
        {"strategy": "full", "schema": "the full schema text"}
    )
    assert payload.strategy == "full"
    assert payload.schema_text == "the full schema text"
    assert payload.results is None


def test_fetch_context_search_strategy_uses_results_key():
    payload = FetchContextResult.model_validate(
        {"strategy": "search", "results": [{"item_type": "column", "name": "loan_id"}]}
    )
    assert payload.strategy == "search"
    assert payload.results == [{"item_type": "column", "name": "loan_id"}]
    assert payload.schema_text is None


def test_fetch_context_rejects_unknown_strategy():
    with pytest.raises(ValidationError, match="strategy"):
        FetchContextResult.model_validate({"strategy": "something_else"})


# ── RecalledPair ──────────────────────────────────────────────────────────
# Core's recall_queries returns dicts with keys text, nl_query, sql_query,
# datasource, created_at, tags (comma-joined string), _distance (after search).


def test_recalled_pair_accepts_core_keys():
    payload = RecalledPair.model_validate(
        {
            "text": "top customers",
            "nl_query": "top customers",
            "sql_query": "SELECT * FROM customers",
            "datasource": "postgres",
            "tags": "revenue,ranking",
            "_distance": 0.18,
        }
    )
    assert payload.nl_query == "top customers"
    assert payload.sql_query == "SELECT * FROM customers"
    assert payload.tags == "revenue,ranking"  # Core stores as comma string
    assert payload.score == pytest.approx(0.18)


def test_recalled_pair_score_optional_for_seeded_pairs():
    """Pairs loaded from queries.yml have no _distance until they're searched."""
    pair = RecalledPair.model_validate(
        {"nl_query": "top", "sql_query": "SELECT 1", "tags": ""}
    )
    assert pair.score is None
    assert pair.tags == ""


def test_recalled_pair_ignores_unknown_keys():
    """Forward-compat: Core may add fields (e.g. `created_at`) without
    breaking validation."""
    pair = RecalledPair.model_validate(
        {
            "nl_query": "q",
            "sql_query": "SELECT 1",
            "tags": "",
            "created_at": "2026-05-11T00:00:00Z",
            "future_field": "noise",
        }
    )
    assert pair.nl_query == "q"
