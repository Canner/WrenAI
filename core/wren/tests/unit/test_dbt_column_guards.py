from wren.dbt import _finalize_column_tests, _find_column, _seed_model_payload


def test_find_column_skips_non_dict_and_non_list():
    assert _find_column({"columns": "x"}, "id") is None
    assert _find_column({"columns": [None, {"name": "id"}]}, "id") == {"name": "id"}


def test_finalize_column_tests_skips_bad_rows():
    models = [
        "bad",
        {
            "name": "m",
            "columns": [
                "x",
                {
                    "name": "id",
                    "not_null": True,
                    "properties": {
                        "_dbt_tests": ["unique"],
                        "_dbt_test_statuses": ["pass"],
                    },
                },
            ],
        },
    ]
    _finalize_column_tests(models)
    col = models[1]["columns"][1]
    assert col["properties"]["dbt_tests"] == "unique"
    assert col.get("is_primary_key") is True
    assert models[1]["primary_key"] == "id"


def test_seed_model_payload_skips_non_dict_columns():
    payload = _seed_model_payload(
        {"name": "m", "columns": ["bad", {"name": "id", "type": "int"}]}
    )
    assert payload["columns"] == [
        {
            "name": "id",
            "type": "int",
            "isCalculated": False,
            "properties": {},
        }
    ]
