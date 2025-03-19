from unittest.mock import AsyncMock, MagicMock

import pytest

from src.pipelines.retrieval.sql_functions import SqlFunction, SqlFunctions

MOCK_FUNCTION_DEFINITION = {
    "name": "test_func",
    "param_types": "int,text",
    "return_type": "boolean",
}

MOCK_FUNCTION_LIST = [
    {"name": "func1", "param_types": "int", "return_type": "text"},
    {"name": "func2", "param_types": "text,text", "return_type": "boolean"},
]


@pytest.fixture
def mock_engine():
    engine = MagicMock()
    engine.get_func_list = AsyncMock(return_value=MOCK_FUNCTION_LIST)
    return engine


@pytest.fixture
def sql_functions_pipeline(mock_engine):
    return SqlFunctions(engine=mock_engine)


def test_sql_function_init():
    func = SqlFunction(MOCK_FUNCTION_DEFINITION)
    expected = "test_func($0: int, $1: text) -> boolean"
    assert str(func) == expected
    assert repr(func) == expected


def test_sql_function_empty_params():
    func = SqlFunction({"name": "test_func", "return_type": "text"})
    assert str(func) == "test_func(any) -> text"


@pytest.mark.asyncio
async def test_sql_functions_pipeline_run(sql_functions_pipeline):
    result = await sql_functions_pipeline.run("postgres")

    assert len(result) == 2
    assert str(result[0]) == "func1($0: int) -> text"
    assert str(result[1]) == "func2($0: text, $1: text) -> boolean"

    cached_result = await sql_functions_pipeline.run("postgres")
    assert result == cached_result

    sql_functions_pipeline._components["engine"].get_func_list.assert_called_once()


@pytest.mark.asyncio
async def test_sql_functions_pipeline_different_datasource(sql_functions_pipeline):
    await sql_functions_pipeline.run("postgres")
    await sql_functions_pipeline.run("mysql")

    assert sql_functions_pipeline._components["engine"].get_func_list.call_count == 2


@pytest.mark.asyncio
async def test_sql_functions_pipeline_case_insensitive(sql_functions_pipeline):
    result1 = await sql_functions_pipeline.run("POSTGRES")
    result2 = await sql_functions_pipeline.run("postgres")

    assert sql_functions_pipeline._components["engine"].get_func_list.call_count == 1
    assert result1 == result2


def test_sql_function_param_type_none():
    func = SqlFunction(
        {"name": "test_func", "param_types": None, "return_type": "text"}
    )
    assert str(func) == "test_func(any) -> text"


def test_sql_function_return_type_none():
    func = SqlFunction(
        {"name": "test_func", "param_types": "int,text", "return_type": None}
    )
    assert str(func) == "test_func($0: int, $1: text) -> any"


def test_sql_function_return_type_same_as_args():
    func = SqlFunction(
        {
            "name": "test_func",
            "param_types": "int,text",
            "return_type": "same as arg types",
        }
    )
    assert str(func) == "test_func($0: int, $1: text) -> ['int', 'text']"
