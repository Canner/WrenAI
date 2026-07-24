"""CTERewriter must skip non-dict models/columns/views without TypeError."""

from __future__ import annotations

import base64
from types import SimpleNamespace

import orjson
import pytest

from wren.mdl.cte_rewriter import CTERewriter
from wren.model.data_source import DataSource

pytestmark = pytest.mark.unit


def _b64(manifest: dict) -> str:
    return base64.b64encode(orjson.dumps(manifest)).decode()


def _rewriter(manifest: dict) -> CTERewriter:
    session = SimpleNamespace()
    return CTERewriter(_b64(manifest), session, DataSource.postgres, fallback=True)


def test_skips_nonduct_models_and_views() -> None:
    manifest = {
        "catalog": "wren",
        "schema": "public",
        "models": [
            "bad",
            None,
            {
                "name": "orders",
                "columns": [
                    "x",
                    None,
                    {"name": "id", "type": "integer"},
                    {"name": "", "type": "integer"},
                    {"isHidden": True, "name": "secret"},
                ],
            },
            {"name": 123, "columns": []},
        ],
        "views": [
            "nope",
            {"name": "v_ok", "statement": "SELECT 1"},
            {"name": "", "statement": "SELECT 2"},
        ],
    }
    rw = _rewriter(manifest)
    assert list(rw.model_dict) == ["orders"]
    assert rw._model_cols["orders"] == ["id"]
    assert list(rw.view_dict) == ["v_ok"]


def test_iter_model_column_names_tolerates_bad_columns() -> None:
    names = list(
        CTERewriter._iter_model_column_names(
            {
                "name": "t",
                "columns": ["x", {"name": "a"}, {"name": "b", "isHidden": True}],
            }
        )
    )
    assert names == ["a"]
