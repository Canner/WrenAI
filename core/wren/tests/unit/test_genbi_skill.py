"""The data-app skill is discoverable and served by `wren skills`."""

from __future__ import annotations

import pytest

from wren import skills_delivery

pytestmark = pytest.mark.unit


def test_data_app_skill_is_listed():
    names = {s.name for s in skills_delivery.list_skills()}
    assert "data-app" in names


def test_data_app_skill_lists_its_references():
    info = next(s for s in skills_delivery.list_skills() if s.name == "data-app")
    assert sorted(info.references) == [
        "chart-cookbook",
        "streamlit-sdk",
        "troubleshooting",
    ]
    assert info.summary  # non-empty one-line summary from the frontmatter


def test_get_skill_returns_guide():
    body = skills_delivery.get_skill("data-app")
    assert "Build a Data App" in body
    assert "wren genbi create" in body
    assert "cube_panel" in body


def test_full_includes_reference_docs():
    body = skills_delivery.get_skill("data-app", full=True)
    assert "Reference: chart-cookbook" in body
    assert "Reference: streamlit-sdk" in body
    assert "Reference: troubleshooting" in body
