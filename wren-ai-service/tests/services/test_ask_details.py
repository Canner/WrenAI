import uuid

import pytest

from src.pipelines.ask_details import generation_pipeline
from src.utils import init_providers
from src.web.v1.services.ask_details import (
    AskDetailsRequest,
    AskDetailsResultRequest,
    AskDetailsService,
)


@pytest.fixture
def ask_details_service():
    llm_provider, _ = init_providers()
    return AskDetailsService(
        {
            "generation": generation_pipeline.Generation(
                llm_provider=llm_provider,
            ),
        }
    )


# TODO: we may need to add one more test for the case that steps must be more than 1
def test_ask_details_with_successful_sql(ask_details_service: AskDetailsService):
    # asking details
    query_id = str(uuid.uuid4())
    sql = "SELECT * FROM book"
    ask_details_request = AskDetailsRequest(
        query="How many books are there?'",
        sql=sql,
        summary="This is a summary",
    )
    ask_details_request.query_id = query_id
    ask_details_service.ask_details(ask_details_request)

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


def test_ask_details_with_failed_sql(ask_details_service: AskDetailsService):
    # asking details
    query_id = str(uuid.uuid4())
    sql = "SELECT * FROM xxx"
    summary = "This is a summary"
    ask_details_request = AskDetailsRequest(
        query="How many books are there?'",
        sql=sql,
        summary=summary,
    )
    ask_details_request.query_id = query_id
    ask_details_service.ask_details(ask_details_request)

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
