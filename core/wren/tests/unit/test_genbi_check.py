"""Unit tests for wren.genbi.check — MDL drift detection.

A panel declares the cube + measures + dimensions it queries. This module
compares those declarations against the current MDL manifest and reports drift
(missing cube / measure / dimension / time dimension) so ``wren genbi serve``
can refuse to launch a broken app before the user ever sees a traceback.
"""

from __future__ import annotations

import pytest

from wren.genbi import check

pytestmark = pytest.mark.unit


MANIFEST = {
    "catalog": "test",
    "schema": "public",
    "cubes": [
        {
            "name": "sales",
            "baseObject": "orders",
            "measures": [{"name": "revenue"}, {"name": "order_count"}],
            "dimensions": [{"name": "status"}, {"name": "region"}],
            "timeDimensions": [{"name": "created_at"}],
        }
    ],
}


def test_clean_spec_has_no_drift():
    spec = check.PanelSpec(
        cube="sales",
        measures=["revenue"],
        dimensions=["status", "region"],
        time_dimensions=["created_at"],
    )
    assert check.check_spec(spec, MANIFEST) == []


def test_missing_cube_is_reported():
    spec = check.PanelSpec(cube="nonexistent", measures=["revenue"])
    issues = check.check_spec(spec, MANIFEST)
    assert len(issues) == 1
    assert issues[0].kind == "missing_cube"
    assert issues[0].member == "nonexistent"


def test_missing_measure_is_reported():
    spec = check.PanelSpec(cube="sales", measures=["revenue", "profit"])
    issues = check.check_spec(spec, MANIFEST)
    assert [(i.kind, i.member) for i in issues] == [("missing_measure", "profit")]


def test_missing_dimension_is_reported():
    spec = check.PanelSpec(cube="sales", measures=["revenue"], dimensions=["country"])
    issues = check.check_spec(spec, MANIFEST)
    assert [(i.kind, i.member) for i in issues] == [("missing_dimension", "country")]


def test_missing_time_dimension_is_reported():
    spec = check.PanelSpec(
        cube="sales", measures=["revenue"], time_dimensions=["shipped_at"]
    )
    issues = check.check_spec(spec, MANIFEST)
    assert [(i.kind, i.member) for i in issues] == [
        ("missing_time_dimension", "shipped_at")
    ]


def test_multiple_drifts_reported_together():
    spec = check.PanelSpec(
        cube="sales",
        measures=["profit"],
        dimensions=["country"],
    )
    issues = check.check_spec(spec, MANIFEST)
    kinds = {(i.kind, i.member) for i in issues}
    assert ("missing_measure", "profit") in kinds
    assert ("missing_dimension", "country") in kinds


def test_missing_cube_short_circuits_member_checks():
    # When the whole cube is gone, don't also spam per-measure/dimension drift.
    spec = check.PanelSpec(cube="gone", measures=["revenue"], dimensions=["status"])
    issues = check.check_spec(spec, MANIFEST)
    assert [i.kind for i in issues] == ["missing_cube"]


def test_check_panels_aggregates_across_specs():
    specs = [
        check.PanelSpec(cube="sales", measures=["revenue"]),
        check.PanelSpec(cube="sales", measures=["profit"]),
    ]
    issues = check.check_panels(specs, MANIFEST)
    assert [(i.kind, i.member) for i in issues] == [("missing_measure", "profit")]
