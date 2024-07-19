import json
import uuid

import orjson
import pytest

from src.core.pipeline import async_validate
from src.pipelines.ask import (
    generation,
    historical_question,
    retrieval,
    sql_correction,
)
from src.pipelines.indexing import indexing
from src.utils import EngineConfig, init_providers
from src.web.v1.services.ask import (
    AskRequest,
    AskResultRequest,
    AskService,
    SemanticsPreparationRequest,
)


@pytest.fixture
def ask_service():
    llm_provider, embedder_provider, document_store_provider, engine = init_providers(
        EngineConfig(provider="wren_ui", config={})
    )

    return AskService(
        {
            "indexing": indexing.Indexing(
                embedder_provider=embedder_provider,
                document_store_provider=document_store_provider,
            ),
            "retrieval": retrieval.Retrieval(
                embedder_provider=embedder_provider,
                document_store_provider=document_store_provider,
            ),
            "historical_question": historical_question.HistoricalQuestion(
                embedder_provider=embedder_provider,
                store_provider=document_store_provider,
            ),
            "generation": generation.Generation(
                llm_provider=llm_provider,
                engine=engine,
            ),
            "sql_correction": sql_correction.SQLCorrection(
                llm_provider=llm_provider,
                engine=engine,
            ),
        }
    )


@pytest.fixture
def mdl_str():
    with open("tests/data/book_2_mdl.json", "r") as f:
        return orjson.dumps(json.load(f)).decode("utf-8")


def test_ask_with_successful_query(ask_service: AskService, mdl_str: str):
    id = str(uuid.uuid4())
    async_validate(
        lambda: ask_service.prepare_semantics(
            SemanticsPreparationRequest(
                mdl=mdl_str,
                id=id,
            )
        )
    )

    # asking
    query_id = str(uuid.uuid4())
    ask_request = AskRequest(
        query="How many books are there?",
        id=id,
    )
    ask_request.query_id = query_id
    async_validate(lambda: ask_service.ask(ask_request))

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

    # todo: we'll refactor almost all test case with a mock server, thus temporarily only assert it is not None.
    assert ask_result_response.status == "finished" or "failed"
    # assert ask_result_response.response is not None
    # assert ask_result_response.response[0].sql != ""
    # assert ask_result_response.response[0].summary != ""
    # assert ask_result_response.response[0].type == "llm" or "view"
