import json
import uuid

import pytest

from src.pipelines.ask import (
    generation_pipeline,
    indexing_pipeline,
    retrieval_pipeline,
    sql_correction_pipeline,
)
from src.pipelines.ask.components.document_store import init_document_store
from src.pipelines.ask.components.embedder import init_embedder
from src.pipelines.ask.components.generator import init_generator
from src.pipelines.ask.components.retriever import init_retriever
from src.web.v1.services.ask import (
    AskRequest,
    AskResultRequest,
    AskService,
    SemanticsPreparationRequest,
)


@pytest.fixture
def ask_service():
    document_store = init_document_store()
    embedder = init_embedder()
    retriever = init_retriever(document_store=document_store)
    text_to_sql_generator = init_generator()
    sql_correction_generator = init_generator()

    return AskService(
        {
            "indexing": indexing_pipeline.Indexing(
                document_store=document_store,
            ),
            "retrieval": retrieval_pipeline.Retrieval(
                embedder=embedder,
                retriever=retriever,
            ),
            "generation": generation_pipeline.Generation(
                text_to_sql_generator=text_to_sql_generator,
            ),
            "sql_correction": sql_correction_pipeline.SQLCorrection(
                sql_correction_generator=sql_correction_generator,
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
    assert (
        ask_result_response.error.code == "NO_RELAVANT_SQL"
        or ask_result_response.error.code == "NO_RELEVANT_DATA"
    )
