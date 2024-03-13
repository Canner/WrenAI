import uuid

import pytest

from src.pipelines.ask_details import generation_pipeline
from src.pipelines.ask_details.components.generator import init_generator
from src.web.v1.services.ask_details import (
    AskDetailsRequest,
    AskDetailsResultRequest,
    AskDetailsService,
)


@pytest.fixture
def ask_details_service():
    generator = init_generator()

    return AskDetailsService(
        {
            "generation": generation_pipeline.Generation(
                generator=generator,
            ),
        }
    )


def test_ask_details_wit_easy_query(ask_details_service: AskDetailsService):
    # asking details
    query_id = str(uuid.uuid4())
    sql = "SELECT * FROM books"
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

    while ask_details_result_response.status != "finished":
        ask_details_result_response = ask_details_service.get_ask_details_result(
            AskDetailsResultRequest(
                query_id=query_id,
            )
        )

    if ask_details_result_response.status == "finished":
        assert ask_details_result_response.response.description != ""
        assert len(ask_details_result_response.response.steps) >= 1
        assert ask_details_result_response.response.steps[0].sql != ""
        assert ask_details_result_response.response.steps[0].summary != ""
        assert ask_details_result_response.response.steps[0].cte_name == ""
