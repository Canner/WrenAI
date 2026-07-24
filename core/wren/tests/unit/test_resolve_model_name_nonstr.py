"""resolve_model_name must ignore non-str names without AttributeError."""

from __future__ import annotations

import pytest

from wren.policy import resolve_model_name

pytestmark = pytest.mark.unit


def test_resolve_filters_non_str_candidates() -> None:
    names = {"Orders", None, 12, "", "customers"}  # type: ignore[list-item]
    assert resolve_model_name("orders", quoted=False, model_names=names) == "Orders"
    assert resolve_model_name("missing", quoted=False, model_names=names) is None


def test_resolve_rejects_non_str_lookup() -> None:
    assert resolve_model_name(None, quoted=False, model_names={"a"}) is None  # type: ignore[arg-type]
    assert resolve_model_name(1, quoted=True, model_names={"1"}) is None  # type: ignore[arg-type]


def test_resolve_quoted_exact() -> None:
    assert resolve_model_name("Orders", quoted=True, model_names={"Orders"}) == "Orders"
    assert resolve_model_name("orders", quoted=True, model_names={"Orders"}) is None
