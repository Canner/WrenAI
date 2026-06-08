"""Unit tests for wren.genbi.introspect — static extraction of cube panels.

Drift checking needs to know which cube/measures/dimensions an app references.
Rather than make the agent hand-maintain a sidecar, we statically parse
``app.py`` for ``cube_panel(...)`` calls. Widget-bound dimensions
(``dimensions=[dim]`` where ``dim = st.selectbox(..., [options])``) are expanded
to every option, so the whole reachable dimension set is validated.
"""

from __future__ import annotations

import pytest

from wren.genbi import introspect

pytestmark = pytest.mark.unit


def test_extracts_literal_cube_panel():
    src = """
import streamlit as st
from wren.genbi.panel import cube_panel
cube_panel(cube="sales", measures=["revenue", "order_count"],
           dimensions=["region", "category"])
"""
    specs = introspect.extract_panel_specs(src)
    assert len(specs) == 1
    s = specs[0]
    assert s.cube == "sales"
    assert s.measures == ["revenue", "order_count"]
    assert s.dimensions == ["region", "category"]


def test_expands_selectbox_bound_dimension():
    src = """
import streamlit as st
from wren.genbi.panel import cube_panel
dim = st.selectbox("Group by", ["status", "priority"])
cube_panel(cube="orders", measures=["revenue"], dimensions=[dim])
"""
    specs = introspect.extract_panel_specs(src)
    assert specs[0].cube == "orders"
    # Both reachable dimensions are validated, not just one.
    assert sorted(specs[0].dimensions) == ["priority", "status"]


def test_extracts_time_dimension_name():
    src = """
from wren.genbi.panel import cube_panel
cube_panel(cube="sales", measures=["revenue"],
           time_dimension={"dimension": "created_at", "granularity": "month"})
"""
    specs = introspect.extract_panel_specs(src)
    assert specs[0].time_dimensions == ["created_at"]


def test_ignores_raw_panel_and_other_calls():
    src = """
import streamlit as st
from wren.genbi.panel import cube_panel, raw_panel
st.title("x")
raw_panel(sql="SELECT 1")
cube_panel(cube="sales", measures=["revenue"])
"""
    specs = introspect.extract_panel_specs(src)
    assert len(specs) == 1
    assert specs[0].cube == "sales"


def test_multiple_cube_panels():
    src = """
from wren.genbi.panel import cube_panel
cube_panel(cube="a", measures=["m1"])
cube_panel(cube="b", measures=["m2"], dimensions=["d"])
"""
    specs = introspect.extract_panel_specs(src)
    assert [s.cube for s in specs] == ["a", "b"]


def test_skips_unresolvable_dimension_keeps_literals():
    src = """
from wren.genbi.panel import cube_panel
cube_panel(cube="sales", measures=["revenue"], dimensions=["region", helper()])
"""
    specs = introspect.extract_panel_specs(src)
    # The literal stays; the unresolvable call expression is dropped.
    assert specs[0].dimensions == ["region"]


def test_syntax_error_returns_empty():
    assert introspect.extract_panel_specs("def (:bad python") == []
