"""Guards for non-mapping properties and safe description lookup."""

from __future__ import annotations

import textwrap
from pathlib import Path

from wren.context import _prop_description, validate_project


def test_prop_description_non_mapping_returns_none():
    assert _prop_description({"properties": "oops"}) is None
    assert _prop_description({"properties": {"description": "ok"}}) == "ok"
    assert _prop_description({}) is None


def test_validate_project_reports_non_mapping_properties(tmp_path: Path):
    (tmp_path / "wren_project.yml").write_text(
        "name: demo\ndata_source: postgres\nschema_version: 2\n",
        encoding="utf-8",
    )
    model_dir = tmp_path / "models" / "orders"
    model_dir.mkdir(parents=True)
    (model_dir / "metadata.yml").write_text(
        textwrap.dedent(
            """\
            name: orders
            table_reference:
              table: orders
            properties: oops
            columns:
              - name: id
                type: INTEGER
                properties: not-a-map
            """
        ),
        encoding="utf-8",
    )
    view_dir = tmp_path / "views" / "v1"
    view_dir.mkdir(parents=True)
    (view_dir / "metadata.yml").write_text(
        textwrap.dedent(
            """\
            name: v1
            properties: []
            """
        ),
        encoding="utf-8",
    )
    (view_dir / "sql.yml").write_text(
        "statement: SELECT 1\n",
        encoding="utf-8",
    )

    errors = validate_project(tmp_path)
    messages = [f"{e.path}: {e.message}" for e in errors]
    joined = "\n".join(messages)
    assert "properties must be a mapping" in joined
    # model + column + view
    assert sum("properties must be a mapping" in m for m in messages) == 3
