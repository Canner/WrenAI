import uuid

import pytest

from src.core.engine import EngineConfig
from src.pipelines.generation import sql_breakdown
from src.utils import init_providers
from src.web.v1.services.ask_details import (
    AskDetailsRequest,
    AskDetailsResultRequest,
    AskDetailsService,
)


@pytest.fixture
def ask_details_service():
    llm_provider, _, _, engine = init_providers(EngineConfig())
    return AskDetailsService(
        {
            "sql_breakdown": sql_breakdown.SQLBreakdown(
                llm_provider=llm_provider,
                engine=engine,
            ),
        }
    )


@pytest.fixture
def service_metadata():
    return {
        "models_metadata": {
            "generation_model": "mock-llm-model",
            "generation_model_kwargs": {},
            "embedding_model": "mock-embedding-model",
            "embedding_model_dim": 768,
        },
        "service_version": "0.8.0-mock",
    }


# TODO: we may need to add one more test for the case that steps must be more than 1
@pytest.mark.asyncio
async def test_ask_details_with_successful_sql(
    ask_details_service: AskDetailsService, service_metadata: dict
):
    # asking details
    query_id = str(uuid.uuid4())
    sql = "SELECT * FROM book"
    ask_details_request = AskDetailsRequest(
        query="How many books are there?'",
        sql=sql,
        summary="This is a summary",
    )
    ask_details_request.query_id = query_id
    await ask_details_service.ask_details(
        ask_details_request, service_metadata=service_metadata
    )

    # getting ask details result
    ask_details_result_response = ask_details_service.get_ask_details_result(
        AskDetailsResultRequest(
            query_id=query_id,
        )
    )

    while (
        ask_details_result_response.status != "finished"
        and ask_details_result_response.status != "failed"
    ):
        ask_details_result_response = ask_details_service.get_ask_details_result(
            AskDetailsResultRequest(
                query_id=query_id,
            )
        )

    assert ask_details_result_response.status == "finished"
    assert ask_details_result_response.response.description != ""
    assert len(ask_details_result_response.response.steps) >= 1
    assert ask_details_result_response.response.steps[0].sql != ""
    assert ask_details_result_response.response.steps[0].summary != ""
    if len(ask_details_result_response.response.steps) == 1:
        assert ask_details_result_response.response.steps[0].cte_name == ""
    else:
        assert ask_details_result_response.response.steps[0].cte_name
        assert ask_details_result_response.response.steps[-1].cte_name == ""


@pytest.mark.asyncio
async def test_ask_details_with_failed_sql(
    ask_details_service: AskDetailsService, service_metadata: dict
):
    # asking details
    query_id = str(uuid.uuid4())
    sql = 'SELECT * FROM "xxx"'
    summary = "This is a summary"
    ask_details_request = AskDetailsRequest(
        query="How many books are there?'",
        sql=sql,
        summary=summary,
    )
    ask_details_request.query_id = query_id
    await ask_details_service.ask_details(
        ask_details_request, service_metadata=service_metadata
    )

    # getting ask details result
    ask_details_result_response = ask_details_service.get_ask_details_result(
        AskDetailsResultRequest(
            query_id=query_id,
        )
    )

    while (
        ask_details_result_response.status != "finished"
        and ask_details_result_response.status != "failed"
    ):
        ask_details_result_response = ask_details_service.get_ask_details_result(
            AskDetailsResultRequest(
                query_id=query_id,
            )
        )

    assert ask_details_result_response.status == "finished"
    assert ask_details_result_response.response.description != ""
    assert len(ask_details_result_response.response.steps) == 1
    assert ask_details_result_response.response.steps[0].sql == sql
    assert ask_details_result_response.response.steps[0].summary != ""
