from wren.genbi.composer import _format_model_inventory


def test_formats_clean_models():
    text = _format_model_inventory(
        [{"name": "orders", "columns": [{"name": "id"}, {"name": "total"}]}]
    )
    assert "orders" in text
    assert "id" in text


def test_skips_non_dict_models_and_columns():
    text = _format_model_inventory(
        [
            None,
            "x",
            {
                "name": "t",
                "columns": [None, {"name": "a"}, "bad"],
            },
        ]
    )
    assert "t" in text
    assert "a" in text
    assert "None" not in text


def test_all_junk_falls_back_to_empty_message():
    text = _format_model_inventory([None, "x", 1])
    assert "no models found" in text
