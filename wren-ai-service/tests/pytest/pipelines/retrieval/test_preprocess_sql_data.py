from src.pipelines.retrieval.preprocess_sql_data import preprocess


class _FakeEncoding:
    def encode(self, value: str) -> list[str]:
        return list(value)


def test_preprocess_maps_list_rows_to_column_named_records():
    sql_data = {
        "columns": [
            {"name": "supplierid", "type": "integer"},
            {"name": "supplier_name", "type": "varchar"},
            {"name": "manufacturing_cost_per_unit", "type": "double"},
        ],
        "data": [
            [2, "Supplier 1", 0.06],
            [5, "Supplier 2", 0.06],
        ],
    }

    result = preprocess(
        sql_data=sql_data,
        encoding=_FakeEncoding(),
        context_window_size=1000,
    )

    assert result["sql_data"]["row_records"] == [
        {
            "supplierid": 2,
            "supplier_name": "Supplier 1",
            "manufacturing_cost_per_unit": 0.06,
        },
        {
            "supplierid": 5,
            "supplier_name": "Supplier 2",
            "manufacturing_cost_per_unit": 0.06,
        },
    ]
    assert "row_records" not in sql_data


def test_preprocess_keeps_row_records_in_sync_when_rows_are_reduced():
    sql_data = {
        "columns": [{"name": "name"}, {"name": "value"}],
        "data": [["a", 1], ["b", 2], ["c", 3]],
    }

    result = preprocess(
        sql_data=sql_data,
        encoding=_FakeEncoding(),
        context_window_size=1,
    )

    assert len(result["sql_data"]["row_records"]) == len(result["sql_data"]["data"])
    assert result["num_rows_used_in_llm"] == len(result["sql_data"]["data"])
