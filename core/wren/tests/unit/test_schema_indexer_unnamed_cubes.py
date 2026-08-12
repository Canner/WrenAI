"""cubes/measures/dimensions/timeDimensions follow the unnamed-skip policy (#2591)."""

from __future__ import annotations

from wren.memory.schema_indexer import describe_schema, extract_schema_items


def _manifest():
    return {
        "cubes": [
            {"baseObject": "orders", "measures": [{"expression": "sum(x)"}]},
            {
                "name": "c1",
                "baseObject": "orders",
                "measures": [{"name": "m1"}, {"expression": "sum(z)"}],
                "dimensions": [{"name": "d1"}, {"expression": "y"}],
                "timeDimensions": [{"name": "t1"}, {"type": "date"}],
            },
        ]
    }


def test_describe_schema_skips_unnamed_cube_and_children():
    text = describe_schema(_manifest())
    assert text.count("### Cube:") == 1
    assert "### Cube: c1" in text
    assert "m1" in text
    assert "d1" in text
    assert "t1" in text
    # Unnamed cube and unnamed measure/dimension are dropped, not rendered
    # with an empty label.
    assert "sum(x)" not in text
    assert "sum(z)" not in text


def test_extract_schema_items_skips_unnamed_cube_and_children():
    items = extract_schema_items(_manifest())
    names = {i.get("item_name") for i in items}
    assert {"c1", "m1", "d1", "t1"} <= names
    assert "" not in names
    assert None not in names
