"""Guards for non-dict MDL rows in MCP list/describe helpers (mirrors mcp_server)."""


def list_models_payload(models):
    result = []
    for model in models:
        if not isinstance(model, dict):
            continue
        description = model.get("description")
        if description is None:
            description = (model.get("properties") or {}).get("description")
        columns = model.get("columns") or []
        if not isinstance(columns, list):
            columns = []
        result.append(
            {
                "name": model.get("name"),
                "description": description,
                "column_count": len(columns),
            }
        )
    return {"models": result}


def describe_columns(model):
    columns = []
    for col in model.get("columns") or []:
        if not isinstance(col, dict):
            continue
        columns.append({"name": col.get("name")})
    return columns


def test_list_skips_junk():
    out = list_models_payload(
        [
            {"name": "a", "columns": [{"name": "id"}]},
            None,
            "x",
            {"name": "b", "columns": "bad"},
        ]
    )
    assert out["models"][0]["column_count"] == 1
    assert out["models"][1]["column_count"] == 0
    assert len(out["models"]) == 2


def test_describe_skips_non_dict_cols():
    cols = describe_columns({"columns": [None, {"name": "id"}, "x"]})
    assert cols == [{"name": "id"}]
