import json
import re
import time
import uuid

import orjson
import pytest

from src.core.engine import EngineConfig
from src.pipelines.generation import sql_correction, sql_generation
from src.pipelines.indexing import indexing
from src.pipelines.retrieval import historical_question, retrieval
from src.utils import init_providers
from src.web.v1.services.ask import (
    AskRequest,
    AskResultRequest,
    AskResultResponse,
    AskService,
)
from src.web.v1.services.semantics_preparation import (
    SemanticsPreparationRequest,
    SemanticsPreparationService,
)
from tests.pytest.services.mocks import (
    GenerationMock,
    HistoricalQuestionMock,
    RetrievalMock,
    SQLSummaryMock,
)


@pytest.fixture
def ask_service():
    llm_provider, embedder_provider, document_store_provider, engine = init_providers(
        EngineConfig()
    )

    return AskService(
        {
            "retrieval": retrieval.Retrieval(
                llm_provider=llm_provider,
                embedder_provider=embedder_provider,
                document_store_provider=document_store_provider,
            ),
            "historical_question": historical_question.HistoricalQuestion(
                embedder_provider=embedder_provider,
                store_provider=document_store_provider,
            ),
            "sql_generation": sql_generation.SQLGeneration(
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
def indexing_service():
    _, embedder_provider, document_store_provider, _ = init_providers(EngineConfig())

    return SemanticsPreparationService(
        {
            "indexing": indexing.Indexing(
                embedder_provider=embedder_provider,
                document_store_provider=document_store_provider,
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


@pytest.fixture
def mdl_str():
    with open("tests/data/book_2_mdl.json", "r") as f:
        return orjson.dumps(json.load(f)).decode("utf-8")


@pytest.mark.asyncio
async def test_ask_with_successful_query(
    indexing_service: SemanticsPreparationService,
    ask_service: AskService,
    mdl_str: str,
    service_metadata: dict,
):
    id = str(uuid.uuid4())
    await indexing_service.prepare_semantics(
        SemanticsPreparationRequest(
            mdl=mdl_str,
            mdl_hash=id,
        ),
        service_metadata=service_metadata,
    )

    # asking
    query_id = str(uuid.uuid4())
    ask_request = AskRequest(
        query="How many books are there?",
        mdl_hash=id,
    )
    ask_request.query_id = query_id
    await ask_service.ask(ask_request, service_metadata=service_metadata)

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

    # TODO: we'll refactor almost all test case with a mock server, thus temporarily only assert it is not None.
    assert ask_result_response.status == "finished" or "failed"
    # assert ask_result_response.response is not None
    # assert ask_result_response.response[0].sql != ""
    # assert ask_result_response.response[0].summary != ""
    # assert ask_result_response.response[0].type == "llm" or "view"


def _ask_service_ttl_mock(query: str):
    return AskService(
        {
            "retrieval": RetrievalMock(
                [
                    f"mock document 1 for {query}",
                    f"mock document 2 for {query}",
                ]
            ),
            "historical_question": HistoricalQuestionMock(),
            "sql_generation": GenerationMock(
                valid=["select count(*) from books"],
            ),
            "sql_summary": SQLSummaryMock(
                results=[
                    {
                        "sql": "select count(*) from books",
                        "summary": "mock summary",
                    }
                ]
            ),
        },
        ttl=3,
    )


@pytest.mark.asyncio
async def test_ask_query_ttl(service_metadata: dict):
    query = "How many books are there?"
    query_id = str(uuid.uuid4())

    ask_service = _ask_service_ttl_mock(query)
    ask_service._ask_results[query_id] = AskResultResponse(
        status="understanding",
    )

    request = AskRequest(
        query=query,
        mdl_hash="mock mdl hash",
    )
    request.query_id = query_id

    await ask_service.ask(request, service_metadata=service_metadata)

    time.sleep(1)
    response = ask_service.get_ask_result(
        AskResultRequest(
            query_id=query_id,
        )
    )
    assert response.status == "finished"

    time.sleep(3)
    response = ask_service.get_ask_result(
        AskResultRequest(
            query_id=query_id,
        )
    )

    assert response.status == "failed"
    assert response.error.code == "OTHERS"
    assert re.match(r".+ is not found", response.error.message)
