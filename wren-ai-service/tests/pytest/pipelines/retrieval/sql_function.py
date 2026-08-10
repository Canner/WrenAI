from unittest.mock import AsyncMock, MagicMock

import pytest
from haystack import Document

from src.pipelines.retrieval.sql_functions import SqlFunction, SqlFunctions

MOCK_FUNCTION_DEFINITION = {
    "name": "test_func",
    "function_type": "scalar",
    "description": "Returns a test value.",
}

MOCK_FUNCTION_LIST = [
    {
        "name": "func1",
        "function_type": "scalar",
        "description": "Returns the first value.",
    },
    {
        "name": "func2",
        "function_type": "aggregate",
        "description": "Aggregates values.",
    },
    {"name": "func_without_description", "function_type": "scalar"},
]


@pytest.fixture
def mock_engine():
    engine = MagicMock()
    engine.get_func_list = AsyncMock(return_value=MOCK_FUNCTION_LIST)
    return engine


@pytest.fixture
def sql_functions_pipeline(mock_engine):
    retriever = MagicMock()
    retriever.run = AsyncMock(
        return_value={"documents": [Document(content="", meta={"data_source": "postgres"})]}
    )
    document_store_provider = MagicMock()
    document_store_provider.get_store.return_value = MagicMock()
    document_store_provider.get_retriever.return_value = retriever
    pipeline = SqlFunctions(
        engine=mock_engine,
        document_store_provider=document_store_provider,
    )
    pipeline._test_retriever = retriever
    return pipeline


def test_sql_function_init():
    func = SqlFunction(MOCK_FUNCTION_DEFINITION)
    expected = "type: scalar, name: TEST_FUNC, description: Returns a test value."
    assert str(func) == expected
    assert repr(func) == expected


def test_sql_function_empty_requires_legacy_fields():
    assert SqlFunction.empty({"name": "test_func", "function_type": "scalar"})
    assert SqlFunction.empty({"name": "test_func", "description": "Returns a value."})
    assert SqlFunction.empty(
        {"function_type": "scalar", "description": "Returns a value."}
    )
    assert not SqlFunction.empty(MOCK_FUNCTION_DEFINITION)


@pytest.mark.asyncio
async def test_sql_functions_pipeline_run(sql_functions_pipeline):
    result = await sql_functions_pipeline.run("postgres")

    assert len(result) == 2
    assert str(result[0]) == (
        "type: scalar, name: FUNC1, description: Returns the first value."
    )
    assert str(result[1]) == (
        "type: aggregate, name: FUNC2, description: Aggregates values."
    )

    cached_result = await sql_functions_pipeline.run("postgres")
    assert result == cached_result

    sql_functions_pipeline._components["engine"].get_func_list.assert_called_once()


@pytest.mark.asyncio
async def test_sql_functions_pipeline_different_datasource(sql_functions_pipeline):
    sql_functions_pipeline._test_retriever.run.side_effect = [
        {"documents": [Document(content="", meta={"data_source": "postgres"})]},
        {"documents": [Document(content="", meta={"data_source": "mysql"})]},
    ]

    await sql_functions_pipeline.run("postgres")
    await sql_functions_pipeline.run("mysql")

    assert sql_functions_pipeline._components["engine"].get_func_list.call_count == 2


@pytest.mark.asyncio
async def test_sql_functions_pipeline_case_insensitive(sql_functions_pipeline):
    sql_functions_pipeline._test_retriever.run.side_effect = [
        {"documents": [Document(content="", meta={"data_source": "POSTGRES"})]},
        {"documents": [Document(content="", meta={"data_source": "postgres"})]},
    ]

    result1 = await sql_functions_pipeline.run("POSTGRES")
    result2 = await sql_functions_pipeline.run("postgres")

    assert sql_functions_pipeline._components["engine"].get_func_list.call_count == 1
    assert result1 == result2


def test_sql_function_ignores_signature_metadata():
    func = SqlFunction(
        {
            "name": "dateadd",
            "function_type": "scalar",
            "param_types": ["varchar", "int", "datetime"],
            "return_type": "Datetime",
            "description": "Adds a signed number of dateparts to a date.",
        }
    )
    assert (
        str(func)
        == "type: scalar, name: DATEADD, description: Adds a signed number of dateparts to a date."
    )
