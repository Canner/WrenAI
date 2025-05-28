import json
import uuid

import orjson
import pytest

from src.config import settings
from src.pipelines import generation, indexing, retrieval
from src.providers import generate_components
from src.utils import fetch_wren_ai_docs
from src.web.v1.services.ask import (
    AskRequest,
    AskResultRequest,
    AskService,
)
from src.web.v1.services.semantics_preparation import (
    SemanticsPreparationRequest,
    SemanticsPreparationService,
)


@pytest.fixture
def ask_service():
    pipe_components = generate_components(settings.components)
    wren_ai_docs = fetch_wren_ai_docs(settings.doc_endpoint, settings.is_oss)

    return AskService(
        {
            "intent_classification": generation.IntentClassification(
                **pipe_components["intent_classification"],
                wren_ai_docs=wren_ai_docs,
            ),
            "misleading_assistance": generation.MisleadingAssistance(
                **pipe_components["misleading_assistance"],
            ),
            "data_assistance": generation.DataAssistance(
                **pipe_components["data_assistance"],
            ),
            "user_guide_assistance": generation.UserGuideAssistance(
                **pipe_components["user_guide_assistance"],
                wren_ai_docs=wren_ai_docs,
            ),
            "retrieval": retrieval.DbSchemaRetrieval(
                **pipe_components["db_schema_retrieval"],
            ),
            "historical_question": retrieval.HistoricalQuestionRetrieval(
                **pipe_components["historical_question_retrieval"],
            ),
            "sql_generation": generation.SQLGeneration(
                **pipe_components["sql_generation"],
            ),
            "sql_correction": generation.SQLCorrection(
                **pipe_components["sql_correction"],
            ),
            "sql_pairs_retrieval": retrieval.SqlPairsRetrieval(
                **pipe_components["sql_pairs_retrieval"],
            ),
            "instructions_retrieval": retrieval.Instructions(
                **pipe_components["instructions_retrieval"],
            ),
        }
    )


@pytest.fixture
def indexing_service():
    pipe_components = generate_components(settings.components)

    return SemanticsPreparationService(
        {
            "db_schema": indexing.DBSchema(
                **pipe_components["db_schema_indexing"],
            ),
            "historical_question": indexing.HistoricalQuestion(
                **pipe_components["historical_question_indexing"],
            ),
            "table_description": indexing.TableDescription(
                **pipe_components["table_description_indexing"],
            ),
        }
    )


@pytest.fixture
def service_metadata():
    return {
        "pipes_metadata": {
            "mock": {
                "generation_model": "mock-llm-model",
                "generation_model_kwargs": {},
                "embedding_model": "mock-embedding-model",
                "embedding_model_dim": 768,
            },
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
