from src.pipelines.generation.semantics_description import output


def test_without_hallucination():
    test_normalize = {
        "model1": {
            "name": "model1",
            "columns": [{"name": "column1"}],
        }
    }
    test_picked_models = [
        {
            "name": "model1",
            "columns": [{"name": "column1"}],
        }
    ]

    result = output(test_normalize, test_picked_models)

    assert "model1" in result
    assert result["model1"]["name"] == "model1"
    assert len(result["model1"]["columns"]) == 1
    assert result["model1"]["columns"][0]["name"] == "column1"


def test_with_hallucination():
    test_normalize = {
        "model1": {
            "name": "model1",
            "columns": [{"name": "column1"}, {"name": "$column2$"}],
        }
    }
    test_picked_models = [
        {
            "name": "model1",
            "columns": [{"name": "column1"}, {"name": "column2"}],
        }
    ]

    result = output(test_normalize, test_picked_models)

    assert "model1" in result
    assert result["model1"]["name"] == "model1"
    assert len(result["model1"]["columns"]) == 1
    assert result["model1"]["columns"][0]["name"] == "column1"


def test_with_hallucination_and_no_columns():
    test_normalize = {
        "model1": {
            "name": "model1",
            "columns": [{"name": "$column2$"}],
        }
    }
    test_picked_models = [
        {
            "name": "model1",
            "columns": [{"name": "column1"}],
        }
    ]

    result = output(test_normalize, test_picked_models)

    assert "model1" in result
    assert result["model1"]["name"] == "model1"
    assert len(result["model1"]["columns"]) == 0
