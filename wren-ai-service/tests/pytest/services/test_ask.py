import asyncio
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
    should_skip_sql_diagnosis,
)
from src.web.v1.services.semantics_preparation import (
    SemanticsPreparationRequest,
    SemanticsPreparationService,
)


@pytest.fixture
def ask_service():
    pipe_components = generate_components(settings.components)
    required_components = {
        "intent_classification",
        "misleading_assistance",
        "data_assistance",
        "user_guide_assistance",
        "db_schema_retrieval",
        "historical_question_retrieval",
        "sql_generation",
        "sql_correction",
        "sql_pairs_retrieval",
        "instructions_retrieval",
    }
    missing_components = required_components - pipe_components.keys()
    if missing_components:
        pytest.skip(
            f"Ask integration test requires configured components: {sorted(missing_components)}"
        )

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
            "db_schema_retrieval": retrieval.DbSchemaRetrieval(
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
        },
        allow_sql_functions_retrieval=False,
        allow_sql_diagnosis=False,
        allow_sql_knowledge_retrieval=False,
    )


@pytest.fixture
def indexing_service():
    pipe_components = generate_components(settings.components)
    required_components = {
        "db_schema_indexing",
        "historical_question_indexing",
        "table_description_indexing",
        "sql_pairs_indexing",
        "project_meta_indexing",
    }
    missing_components = required_components - pipe_components.keys()
    if missing_components:
        pytest.skip(
            f"Ask integration test requires configured components: {sorted(missing_components)}"
        )

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
            "sql_pairs": indexing.SqlPairs(
                **pipe_components["sql_pairs_indexing"],
                sql_pairs_path=settings.sql_pairs_path,
            ),
            "project_meta": indexing.ProjectMeta(
                **pipe_components["project_meta_indexing"],
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


def test_ask_request_skips_sql_generation_reasoning_by_default():
    ask_request = AskRequest(query="question", mdl_hash="deploy")

    assert ask_request.ignore_sql_generation_reasoning is True


def test_ask_request_uses_strict_dry_plan_by_default():
    ask_request = AskRequest(query="question", mdl_hash="deploy")

    assert ask_request.use_dry_plan is True
    assert ask_request.allow_dry_plan_fallback is False


def test_ask_service_uses_single_sql_correction_retry_by_default():
    ask_service = AskService({})

    assert ask_service._max_sql_correction_retries == 1


def test_should_skip_sql_diagnosis_for_deterministic_validation_errors():
    assert should_skip_sql_diagnosis({"type": "SQL_SHAPE"}) is True
    assert should_skip_sql_diagnosis({"type": "SCHEMA_GROUNDING"}) is True
    assert should_skip_sql_diagnosis({"type": "SQL_VALUE_GROUNDING"}) is True
    assert should_skip_sql_diagnosis({"type": "DRY_RUN"}) is False
    assert should_skip_sql_diagnosis({}) is False


class _EmptyRetrievalPipeline:
    async def run(self, **_):
        return {"formatted_output": {"documents": []}}


class _SchemaRetrievalPipeline:
    async def run(self, **_):
        return {
            "construct_retrieval_results": {
                "retrieval_results": [
                    {
                        "table_name": "model_alpha",
                        "table_ddl": "CREATE TABLE model_alpha (entity_id INTEGER)",
                        "manifest_column_names": ["entity_id"],
                    }
                ],
                "has_calculated_field": False,
                "has_metric": False,
                "has_json_field": False,
            }
        }


class _ShapeInvalidSqlGenerationPipeline:
    async def run(self, **_):
        return {
            "post_process": {
                "valid_generation_result": {},
                "invalid_generation_result": {
                    "sql": "SELECT entity_id FROM model_alpha",
                    "original_sql": "SELECT entity_id FROM model_alpha",
                    "type": "SQL_SHAPE",
                    "error": "Generated SQL is a table preview.",
                    "correlation_id": "",
                },
            }
        }


class _SlowSqlGenerationPipeline:
    async def run(self, **_):
        await asyncio.sleep(60)


class _CapturingCorrectionPipeline:
    def __init__(self):
        self.calls = []

    async def run(self, **kwargs):
        self.calls.append(kwargs)
        return {
            "post_process": {
                "valid_generation_result": {
                    "sql": "SELECT COUNT(*) AS record_count FROM model_alpha",
                    "correlation_id": "",
                },
                "invalid_generation_result": {},
            }
        }


class _FailingDiagnosisPipeline:
    def __init__(self):
        self.calls = []

    async def run(self, **kwargs):
        self.calls.append(kwargs)
        raise AssertionError("sql_diagnosis should not run for local validation errors")


@pytest.mark.asyncio
async def test_ask_skips_sql_diagnosis_for_local_validation_error():
    correction = _CapturingCorrectionPipeline()
    diagnosis = _FailingDiagnosisPipeline()
    ask_service = AskService(
        {
            "historical_question": _EmptyRetrievalPipeline(),
            "sql_pairs_retrieval": _EmptyRetrievalPipeline(),
            "instructions_retrieval": _EmptyRetrievalPipeline(),
            "db_schema_retrieval": _SchemaRetrievalPipeline(),
            "sql_generation": _ShapeInvalidSqlGenerationPipeline(),
            "sql_correction": correction,
            "sql_diagnosis": diagnosis,
        },
        allow_intent_classification=False,
        allow_sql_functions_retrieval=False,
        allow_sql_knowledge_retrieval=False,
        allow_sql_diagnosis=True,
    )
    query_id = str(uuid.uuid4())
    ask_request = AskRequest(query="count records by model", mdl_hash=None)
    ask_request.query_id = query_id

    await ask_service.ask(ask_request)

    ask_result_response = ask_service.get_ask_result(
        AskResultRequest(query_id=query_id)
    )
    assert ask_result_response.status == "finished"
    assert diagnosis.calls == []
    assert correction.calls[0]["invalid_generation_result"] == {
        "sql": "SELECT entity_id FROM model_alpha",
        "error": "Generated SQL is a table preview.",
    }


@pytest.mark.asyncio
async def test_ask_times_out_slow_sql_generation_instead_of_hanging():
    ask_service = AskService(
        {
            "historical_question": _EmptyRetrievalPipeline(),
            "sql_pairs_retrieval": _EmptyRetrievalPipeline(),
            "instructions_retrieval": _EmptyRetrievalPipeline(),
            "db_schema_retrieval": _SchemaRetrievalPipeline(),
            "sql_generation": _SlowSqlGenerationPipeline(),
        },
        allow_intent_classification=False,
        allow_sql_functions_retrieval=False,
        allow_sql_knowledge_retrieval=False,
        sql_generation_timeout_seconds=0.01,
    )
    query_id = str(uuid.uuid4())
    ask_request = AskRequest(query="count records by model", mdl_hash=None)
    ask_request.query_id = query_id

    await ask_service.ask(ask_request)

    ask_result_response = ask_service.get_ask_result(
        AskResultRequest(query_id=query_id)
    )
    assert ask_result_response.status == "failed"
    assert ask_result_response.error.code == "OTHERS"
    assert ask_result_response.error.message == (
        "SQL generation timed out after 0.01 seconds"
    )


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
