from wren.context import _check_descriptions


def test_check_descriptions_skips_non_dict_models_and_columns():
    warnings = _check_descriptions(
        {
            "models": [
                "bad",
                {
                    "name": "orders",
                    "properties": "oops",
                    "columns": "x",
                },
                {
                    "name": "ok",
                    "properties": {"description": "d"},
                    "columns": [None, {"name": "id"}],  # missing col desc when strict
                },
            ],
            "views": ["nope", {"name": "v1"}],
        },
        strict=True,
    )
    # orders model missing desc; ok column id missing desc; v1 view missing desc
    joined = "\n".join(warnings)
    assert "Model 'orders'" in joined
    assert "Column 'id' in model 'ok'" in joined
    assert "View 'v1'" in joined
