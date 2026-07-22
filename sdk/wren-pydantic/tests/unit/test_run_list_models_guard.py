"""_run_list_models skips non-dict / incomplete model rows."""

from __future__ import annotations

from unittest.mock import MagicMock

from wren_pydantic._tools import _run_list_models


def test_skips_bad_models():
    toolkit = MagicMock()
    toolkit._mdl_source.load_manifest.return_value = {
        "models": [
            None,
            "x",
            {"columns": []},  # no name
            {"name": "ok", "columns": None, "properties": "nope"},
            {"name": "t", "columns": [{"n": 1}], "properties": {"description": "d"}},
        ]
    }
    out = _run_list_models(toolkit)
    assert [m.name for m in out] == ["ok", "t"]
    assert out[0].column_count == 0
    assert out[1].column_count == 1
    assert out[1].description == "d"
