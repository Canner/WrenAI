"""Pydantic return-model unit tests for tool outputs."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from wren_pydantic._models import (
    FetchContextResult,
    ModelSummary,
    RecalledPair,
    WrenQueryResult,
)


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


def test_wren_query_result_truncated_flag_marks_limit_overflow():
    """Caller sets truncated=True when row_count exceeded the requested limit."""
    payload = WrenQueryResult(columns=["c"], rows=[{"c": 1}], row_count=1, truncated=True)
    assert payload.truncated is True


def test_model_summary_description_optional():
    """description is optional — a model with no description in MDL should still build."""
    summary = ModelSummary(name="orders", column_count=8)
    assert summary.description is None
    assert summary.name == "orders"


def test_fetch_context_result_strategy_enum_enforced():
    """strategy must be either 'search' or 'full_schema' — anything else fails."""
    FetchContextResult(strategy="search", items=[])
    FetchContextResult(strategy="full_schema", items=[])
    with pytest.raises(ValidationError, match="strategy"):
        FetchContextResult(strategy="something_else", items=[])


def test_recalled_pair_defaults_empty_tags_and_no_score():
    pair = RecalledPair(nl="top customers", sql="SELECT * FROM customers")
    assert pair.tags == []
    assert pair.score is None
