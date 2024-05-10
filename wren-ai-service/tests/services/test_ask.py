import json
import uuid

import pytest

from src.globals import init_providers
from src.pipelines.ask import (
    generation_pipeline,
    indexing_pipeline,
    query_understanding_pipeline,
    retrieval_pipeline,
    sql_correction_pipeline,
)
from src.web.v1.services.ask import (
    AskRequest,
    AskResultRequest,
    AskService,
    SemanticsPreparationRequest,
)


@pytest.fixture
def ask_service():
    llm_provider, document_store_provider = init_providers()
    document_store = document_store_provider.get_store()
    view_store = document_store_provider.get_store(dataset_name="view_questions")
    embedder = llm_provider.get_embedder()
    retriever = document_store_provider.get_retriever(document_store=document_store)
    query_understanding_generator = llm_provider.get_generator()
    text_to_sql_generator = llm_provider.get_generator()
    sql_correction_generator = llm_provider.get_generator()

    return AskService(
        {
            "indexing": indexing_pipeline.Indexing(
                ddl_store=document_store,
                view_store=view_store,
            ),
            "query_understanding": query_understanding_pipeline.QueryUnderstanding(
                generator=query_understanding_generator,
            ),
            "retrieval": retrieval_pipeline.Retrieval(
                embedder=embedder,
                retriever=retriever,
            ),
            "generation": generation_pipeline.Generation(
                generator=text_to_sql_generator,
            ),
            "sql_correction": sql_correction_pipeline.SQLCorrection(
                generator=sql_correction_generator,
            ),
        }
    )


@pytest.fixture
def mdl_str():
    with open("tests/data/book_2_mdl.json", "r") as f:
        return json.dumps(json.load(f))


def test_ask_with_successful_query(ask_service: AskService, mdl_str: str):
    id = str(uuid.uuid4())
    ask_service.prepare_semantics(
        SemanticsPreparationRequest(
            mdl=mdl_str,
            id=id,
        )
    )

    # asking
    query_id = str(uuid.uuid4())
    ask_request = AskRequest(
        query="How many books are there?",
        id=id,
    )
    ask_request.query_id = query_id
    ask_service.ask(ask_request)

    # getting ask result
    ask_result_response = ask_service.get_ask_result(
        AskResultRequest(
            query_id=query_id,
        )
    )

    # from Pao Sheng: I think it has a potential risk if a dangling status case happens.
    # maybe we could consider adding an approach that if over a time limit,
    # the process will throw an exception.
    while (
        ask_result_response.status != "finished"
        and ask_result_response.status != "failed"
    ):
        ask_result_response = ask_service.get_ask_result(
            AskResultRequest(
                query_id=query_id,
            )
        )

    assert ask_result_response.status == "finished"
    assert ask_result_response.response is not None
    assert ask_result_response.response[0].sql != ""
    assert ask_result_response.response[0].summary != ""


def test_ask_with_failed_query(ask_service: AskService, mdl_str: str):
    id = str(uuid.uuid4())
    ask_service.prepare_semantics(
        SemanticsPreparationRequest(
            mdl=mdl_str,
            id=id,
        )
    )

    # asking
    query_id = str(uuid.uuid4())
    ask_request = AskRequest(
        query="xxxx",
        id=id,
    )
    ask_request.query_id = query_id
    ask_service.ask(ask_request)

    # getting ask result
    ask_result_response = ask_service.get_ask_result(
        AskResultRequest(
            query_id=query_id,
        )
    )

    # from Pao Sheng: I think it has a potential risk if a dangling status case happens.
    # maybe we could consider adding an approach that if over a time limit,
    # the process will throw an exception.
    while (
        ask_result_response.status != "finished"
        and ask_result_response.status != "failed"
    ):
        ask_result_response = ask_service.get_ask_result(
            AskResultRequest(
                query_id=query_id,
            )
        )

    assert ask_result_response.status == "failed"
    assert ask_result_response.error.code == "MISLEADING_QUERY"
