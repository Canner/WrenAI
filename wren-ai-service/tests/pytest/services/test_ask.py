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
)
from src.web.v1.services.ask_feedback import (
    AskFeedbackRequest,
    AskFeedbackResultRequest,
    AskFeedbackService,
)
from src.web.v1.services.semantics_preparation import (
    SemanticsPreparationRequest,
    SemanticsPreparationService,
)

DEPLOYED_ORDER_MODEL = "deployed_order_model"
DEPLOYED_SHIP_COUNTRY = "ShipCountry"
DEPLOYED_ORDER_DATE = "OrderDate"
DEPLOYED_SELECTED_DDL = (
    f"CREATE TABLE {DEPLOYED_ORDER_MODEL} ({DEPLOYED_SHIP_COUNTRY} VARCHAR)"
)
DEPLOYED_UNPRUNED_DDL = (
    f"CREATE TABLE {DEPLOYED_ORDER_MODEL} "
    f"({DEPLOYED_SHIP_COUNTRY} VARCHAR, {DEPLOYED_ORDER_DATE} TIMESTAMP)"
)
MODEL_ALPHA = "model_alpha"
MODEL_ALPHA_ENTITY_ID = "entity_id"
MODEL_ALPHA_ENTITY_DDL = (
    f"CREATE TABLE {MODEL_ALPHA} ({MODEL_ALPHA_ENTITY_ID} INTEGER)"
)
MODEL_ALPHA_SELECT_SQL = f"SELECT * FROM {MODEL_ALPHA}"
MODEL_ALPHA_ENTITY_SQL = f"SELECT {MODEL_ALPHA_ENTITY_ID} FROM {MODEL_ALPHA}"
MODEL_ALPHA_COUNT_SQL = f"SELECT COUNT(*) AS record_count FROM {MODEL_ALPHA}"
NON_SCHEMA_REASONING_TABLE = f"not_{MODEL_ALPHA}"
NON_SCHEMA_REASONING_COLUMN = f"not_{MODEL_ALPHA_ENTITY_ID}"

MODEL_ALPHA_SELECTED_MEASURE = "selected_measure"
MODEL_ALPHA_RECOVERED_DIMENSION = "recovered_dimension"
MODEL_ALPHA_PRUNED_DDL = (
    f"CREATE TABLE {MODEL_ALPHA} ({MODEL_ALPHA_SELECTED_MEASURE} INTEGER)"
)
MODEL_ALPHA_UNPRUNED_DDL = (
    f"CREATE TABLE {MODEL_ALPHA} "
    f"({MODEL_ALPHA_SELECTED_MEASURE} INTEGER, "
    f"{MODEL_ALPHA_RECOVERED_DIMENSION} VARCHAR)"
)
MODEL_BETA = "model_beta"
MODEL_BETA_ENTITY_ID = "beta_id"
MODEL_BETA_ENTITY_DDL = f"CREATE TABLE {MODEL_BETA} ({MODEL_BETA_ENTITY_ID} INTEGER)"
MODEL_BETA_ENTITY_SQL = f"SELECT {MODEL_BETA_ENTITY_ID} FROM {MODEL_BETA}"


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


def test_ask_request_runs_sql_generation_reasoning_by_default():
    ask_request = AskRequest(query="question", mdl_hash="deploy")

    assert ask_request.ignore_sql_generation_reasoning is False


def test_ask_service_runs_sql_generation_reasoning_by_default():
    ask_service = AskService({})

    assert ask_service._allow_sql_generation_reasoning is True


def test_ask_request_uses_legacy_validation_defaults():
    ask_request = AskRequest(query="question", mdl_hash="deploy")

    assert ask_request.use_dry_plan is False
    assert ask_request.allow_dry_plan_fallback is True


def test_ask_service_uses_legacy_sql_correction_retries_by_default():
    ask_service = AskService({})

    assert ask_service._max_sql_correction_retries == 3


class _EmptyRetrievalPipeline:
    async def run(self, **_):
        return {"formatted_output": {"documents": []}}


class _SchemaRetrievalPipeline:
    async def run(self, **_):
        return {
            "construct_retrieval_results": {
                "retrieval_results": [
                    {
                        "table_name": MODEL_ALPHA,
                        "table_ddl": MODEL_ALPHA_ENTITY_DDL,
                        "manifest_column_names": [MODEL_ALPHA_ENTITY_ID],
                    }
                ],
                "has_calculated_field": False,
                "has_metric": False,
                "has_json_field": False,
            }
        }


class _ExpandableSchemaRetrievalPipeline:
    def __init__(self):
        self.calls = []

    async def run(self, **kwargs):
        self.calls.append(kwargs)
        tables = kwargs.get("tables")
        if tables == [MODEL_BETA]:
            return {
                "construct_retrieval_results": {
                    "retrieval_results": [
                        {
                            "table_name": MODEL_BETA,
                            "table_ddl": MODEL_BETA_ENTITY_DDL,
                            "manifest_column_names": [MODEL_BETA_ENTITY_ID],
                        }
                    ],
                    "has_calculated_field": False,
                    "has_metric": False,
                    "has_json_field": False,
                }
            }

        return {
            "construct_retrieval_results": {
                "retrieval_results": [
                    {
                        "table_name": MODEL_ALPHA,
                        "table_ddl": MODEL_ALPHA_ENTITY_DDL,
                        "manifest_column_names": [MODEL_ALPHA_ENTITY_ID],
                    }
                ],
                "has_calculated_field": False,
                "has_metric": False,
                "has_json_field": False,
            }
        }


class _PrunedSchemaRetrievalPipeline:
    async def run(self, **_):
        return {
            "construct_retrieval_results": {
                "retrieval_results": [
                    {
                        "table_name": MODEL_ALPHA,
                        "table_ddl": MODEL_ALPHA_PRUNED_DDL,
                        "unpruned_table_ddl": MODEL_ALPHA_UNPRUNED_DDL,
                        "column_names": [MODEL_ALPHA_SELECTED_MEASURE],
                        "manifest_column_names": [
                            MODEL_ALPHA_SELECTED_MEASURE,
                            MODEL_ALPHA_RECOVERED_DIMENSION,
                        ],
                    }
                ],
                "has_calculated_field": False,
                "has_metric": False,
                "has_json_field": False,
            }
        }


class _HistoricalQuestionPipeline:
    async def run(self, **_):
        return {
            "formatted_output": {
                "documents": [
                    {
                        "question": "previous analytical request",
                        "statement": "SELECT * FROM stale_model",
                    }
                ]
            }
        }


class _ShapeInvalidSqlGenerationPipeline:
    async def run(self, **_):
        return {
            "post_process": {
                "valid_generation_result": {},
                "invalid_generation_result": {
                    "sql": MODEL_ALPHA_ENTITY_SQL,
                    "original_sql": MODEL_ALPHA_ENTITY_SQL,
                    "type": "SQL_SHAPE",
                    "error": "Generated SQL is a table preview.",
                    "correlation_id": "",
                },
            }
        }


class _MissingRetrievedTableSqlGenerationPipeline:
    async def run(self, **_):
        return {
            "post_process": {
                "valid_generation_result": {},
                "invalid_generation_result": {
                    "sql": MODEL_BETA_ENTITY_SQL,
                    "original_sql": MODEL_BETA_ENTITY_SQL,
                    "type": "SQL_DRY_RUN",
                    "error": f"Generated SQL references tables that were not retrieved from the current schema: {MODEL_BETA}.",
                    "correlation_id": "",
                },
            }
        }


class _NoRelevantSqlGenerationPipeline:
    def __init__(self):
        self.calls = []

    async def run(self, **_):
        self.calls.append(_)
        return {
            "post_process": {
                "valid_generation_result": {},
                "invalid_generation_result": {
                    "sql": "",
                    "original_sql": "",
                    "type": "NO_RELEVANT_SQL",
                    "error": "No grounded SQL was generated from the current schema.",
                    "correlation_id": "",
                },
            }
        }


class _IntentClassificationPipeline:
    def __init__(self, intent: str):
        self.intent = intent
        self.calls = []

    async def run(self, **kwargs):
        self.calls.append(kwargs)
        return {
            "post_process": {
                "intent": self.intent,
                "rephrased_question": kwargs.get("query", ""),
                "reasoning": f"classified as {self.intent}",
                "db_schemas": [],
            }
        }


class _CapturingAssistancePipeline:
    def __init__(self):
        self.calls = []

    async def run(self, **kwargs):
        self.calls.append(kwargs)
        return {}


class _ValidSqlGenerationPipeline:
    def __init__(self):
        self.calls = []

    async def run(self, **kwargs):
        self.calls.append(kwargs)
        return {
            "post_process": {
                "valid_generation_result": {
                    "sql": MODEL_ALPHA_COUNT_SQL,
                    "correlation_id": "",
                },
                "invalid_generation_result": {},
            }
        }


class _CapturingCorrectionPipeline:
    def __init__(self):
        self.calls = []

    async def run(self, **kwargs):
        self.calls.append(kwargs)
        return {
            "post_process": {
                "valid_generation_result": {
                    "sql": MODEL_ALPHA_COUNT_SQL,
                    "correlation_id": "",
                },
                "invalid_generation_result": {},
            }
        }


class _ExtractBetaTablePipeline:
    def __init__(self):
        self.calls = []

    async def run(self, **kwargs):
        self.calls.append(kwargs)
        return {"post_process": [MODEL_BETA]}


class _UnexpectedCorrectionPipeline:
    async def run(self, **_):
        raise AssertionError("sql_correction should not run after successful generation")


class _CapturingRegenerationPipeline:
    def __init__(self):
        self.calls = []

    async def run(self, **kwargs):
        self.calls.append(kwargs)
        return {
            "post_process": {
                "valid_generation_result": {
                    "sql": MODEL_ALPHA_COUNT_SQL,
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


class _CapturingDiagnosisPipeline:
    def __init__(self):
        self.calls = []

    async def run(self, **kwargs):
        self.calls.append(kwargs)
        return {"post_process": {"reasoning": "Use the retrieved schema."}}


class _InventedIdentifierReasoningPipeline:
    async def run(self, **_):
        return {
            "post_process": (
                f"Use this SQL: SELECT * FROM {NON_SCHEMA_REASONING_TABLE} "
                f"WHERE {NON_SCHEMA_REASONING_COLUMN} = 1"
            )
        }


@pytest.mark.asyncio
async def test_ask_runs_sql_correction_for_validation_error():
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
        allow_sql_generation_reasoning=False,
        allow_sql_functions_retrieval=False,
        allow_sql_knowledge_retrieval=False,
        allow_sql_diagnosis=False,
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
    invalid_generation_result = correction.calls[0]["invalid_generation_result"]
    assert invalid_generation_result | {
        "sql": MODEL_ALPHA_ENTITY_SQL,
        "error": "Generated SQL is a table preview.",
    } == invalid_generation_result
    assert invalid_generation_result["question"] == ask_request.query
    assert invalid_generation_result["execution_error"] == "Generated SQL is a table preview."


@pytest.mark.asyncio
async def test_ask_expands_correction_context_from_failed_sql_like_legacy():
    correction = _CapturingCorrectionPipeline()
    extraction = _ExtractBetaTablePipeline()
    retrieval = _ExpandableSchemaRetrievalPipeline()
    ask_service = AskService(
        {
            "historical_question": _EmptyRetrievalPipeline(),
            "sql_pairs_retrieval": _EmptyRetrievalPipeline(),
            "instructions_retrieval": _EmptyRetrievalPipeline(),
            "db_schema_retrieval": retrieval,
            "sql_generation": _MissingRetrievedTableSqlGenerationPipeline(),
            "sql_tables_extraction": extraction,
            "sql_correction": correction,
            "sql_diagnosis": _FailingDiagnosisPipeline(),
        },
        allow_intent_classification=False,
        allow_sql_generation_reasoning=False,
        allow_sql_functions_retrieval=False,
        allow_sql_knowledge_retrieval=False,
        allow_sql_diagnosis=False,
    )
    query_id = str(uuid.uuid4())
    ask_request = AskRequest(query="count records by model", mdl_hash="deploy-hash")
    ask_request.query_id = query_id

    await ask_service.ask(ask_request)

    ask_result_response = ask_service.get_ask_result(
        AskResultRequest(query_id=query_id)
    )
    assert ask_result_response.status == "finished"
    assert ask_result_response.retrieved_tables == [MODEL_ALPHA, MODEL_BETA]
    assert extraction.calls == [{"sql": MODEL_BETA_ENTITY_SQL}]
    assert retrieval.calls[1]["tables"] == [MODEL_BETA]
    assert retrieval.calls[1]["mdl_hash"] == "deploy-hash"
    assert correction.calls[0]["contexts"] == [
        MODEL_ALPHA_ENTITY_DDL,
        MODEL_BETA_ENTITY_DDL,
    ]
    invalid_generation_result = correction.calls[0]["invalid_generation_result"]
    assert invalid_generation_result | {
        "sql": MODEL_BETA_ENTITY_SQL,
        "error": f"Generated SQL references tables that were not retrieved from the current schema: {MODEL_BETA}.",
    } == invalid_generation_result
    assert invalid_generation_result["question"] == ask_request.query


@pytest.mark.asyncio
async def test_ask_correction_recovers_no_relevant_sql_with_schema_context():
    correction = _CapturingCorrectionPipeline()
    diagnosis = _FailingDiagnosisPipeline()
    generation = _NoRelevantSqlGenerationPipeline()
    ask_service = AskService(
        {
            "historical_question": _EmptyRetrievalPipeline(),
            "sql_pairs_retrieval": _EmptyRetrievalPipeline(),
            "instructions_retrieval": _EmptyRetrievalPipeline(),
            "db_schema_retrieval": _SchemaRetrievalPipeline(),
            "sql_generation": generation,
            "sql_correction": correction,
            "sql_diagnosis": diagnosis,
        },
        allow_intent_classification=False,
        allow_sql_generation_reasoning=False,
        allow_sql_functions_retrieval=False,
        allow_sql_knowledge_retrieval=False,
        allow_sql_diagnosis=False,
    )
    query_id = str(uuid.uuid4())
    ask_request = AskRequest(query="count records by model", mdl_hash=None)
    ask_request.query_id = query_id

    await ask_service.ask(ask_request)

    ask_result_response = ask_service.get_ask_result(
        AskResultRequest(query_id=query_id)
    )
    assert ask_result_response.status == "finished"
    assert ask_result_response.response[0].sql == MODEL_ALPHA_COUNT_SQL
    assert diagnosis.calls == []
    assert correction.calls[0]["contexts"] == [MODEL_ALPHA_ENTITY_DDL]
    invalid_generation_result = correction.calls[0]["invalid_generation_result"]
    assert invalid_generation_result | {
        "sql": "",
        "error": "No grounded SQL was generated from the current schema.",
    } == invalid_generation_result
    assert invalid_generation_result["question"] == ask_request.query


@pytest.mark.asyncio
async def test_ask_uses_exact_retrieved_metadata_for_generation_context():
    generation = _ValidSqlGenerationPipeline()
    ask_service = AskService(
        {
            "historical_question": _EmptyRetrievalPipeline(),
            "sql_pairs_retrieval": _EmptyRetrievalPipeline(),
            "instructions_retrieval": _EmptyRetrievalPipeline(),
            "db_schema_retrieval": _PrunedSchemaRetrievalPipeline(),
            "sql_generation": generation,
            "sql_correction": _UnexpectedCorrectionPipeline(),
            "sql_diagnosis": _FailingDiagnosisPipeline(),
        },
        allow_intent_classification=False,
        allow_sql_generation_reasoning=False,
        allow_sql_functions_retrieval=False,
        allow_sql_knowledge_retrieval=False,
        allow_sql_diagnosis=True,
    )
    query_id = str(uuid.uuid4())
    ask_request = AskRequest(query="count records by retrieved dimension", mdl_hash=None)
    ask_request.query_id = query_id

    await ask_service.ask(ask_request)

    ask_result_response = ask_service.get_ask_result(
        AskResultRequest(query_id=query_id)
    )
    assert ask_result_response.status == "finished"
    assert generation.calls[0]["contexts"] == [MODEL_ALPHA_PRUNED_DDL]


@pytest.mark.asyncio
async def test_ask_passes_reasoning_text_to_sql_generation_like_legacy():
    generation = _ValidSqlGenerationPipeline()
    ask_service = AskService(
        {
            "historical_question": _EmptyRetrievalPipeline(),
            "sql_pairs_retrieval": _EmptyRetrievalPipeline(),
            "instructions_retrieval": _EmptyRetrievalPipeline(),
            "db_schema_retrieval": _SchemaRetrievalPipeline(),
            "sql_generation_reasoning": _InventedIdentifierReasoningPipeline(),
            "sql_generation": generation,
            "sql_correction": _UnexpectedCorrectionPipeline(),
            "sql_diagnosis": _FailingDiagnosisPipeline(),
        },
        allow_intent_classification=False,
        allow_sql_generation_reasoning=True,
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
    assert NON_SCHEMA_REASONING_TABLE in ask_result_response.sql_generation_reasoning
    assert generation.calls[0]["contexts"] == [MODEL_ALPHA_ENTITY_DDL]
    assert (
        generation.calls[0]["sql_generation_reasoning"]
        == ask_result_response.sql_generation_reasoning
    )


@pytest.mark.asyncio
async def test_followup_ask_passes_reasoning_text_to_sql_generation_like_legacy():
    generation = _ValidSqlGenerationPipeline()
    ask_service = AskService(
        {
            "historical_question": _EmptyRetrievalPipeline(),
            "sql_pairs_retrieval": _EmptyRetrievalPipeline(),
            "instructions_retrieval": _EmptyRetrievalPipeline(),
            "db_schema_retrieval": _SchemaRetrievalPipeline(),
            "followup_sql_generation_reasoning": _InventedIdentifierReasoningPipeline(),
            "followup_sql_generation": generation,
            "sql_correction": _UnexpectedCorrectionPipeline(),
            "sql_diagnosis": _FailingDiagnosisPipeline(),
        },
        allow_intent_classification=False,
        allow_sql_generation_reasoning=True,
        allow_sql_functions_retrieval=False,
        allow_sql_knowledge_retrieval=False,
        allow_sql_diagnosis=True,
    )
    query_id = str(uuid.uuid4())
    ask_request = AskRequest(
        query="now count those records",
        mdl_hash=None,
        histories=[
            {
                "question": "show model records",
                "sql": MODEL_ALPHA_SELECT_SQL,
            }
        ],
    )
    ask_request.query_id = query_id

    await ask_service.ask(ask_request)

    ask_result_response = ask_service.get_ask_result(
        AskResultRequest(query_id=query_id)
    )
    assert ask_result_response.status == "finished"
    assert NON_SCHEMA_REASONING_TABLE in ask_result_response.sql_generation_reasoning
    assert generation.calls[0]["contexts"] == [MODEL_ALPHA_ENTITY_DDL]
    assert (
        generation.calls[0]["sql_generation_reasoning"]
        == ask_result_response.sql_generation_reasoning
    )


@pytest.mark.asyncio
async def test_ask_general_intent_continues_to_text_to_sql_when_schema_is_retrieved():
    intent_classification = _IntentClassificationPipeline("GENERAL")
    data_assistance = _CapturingAssistancePipeline()
    generation = _ValidSqlGenerationPipeline()
    ask_service = AskService(
        {
            "intent_classification": intent_classification,
            "historical_question": _EmptyRetrievalPipeline(),
            "sql_pairs_retrieval": _EmptyRetrievalPipeline(),
            "instructions_retrieval": _EmptyRetrievalPipeline(),
            "data_assistance": data_assistance,
            "db_schema_retrieval": _SchemaRetrievalPipeline(),
            "sql_generation": generation,
            "sql_correction": _UnexpectedCorrectionPipeline(),
            "sql_diagnosis": _FailingDiagnosisPipeline(),
        },
        allow_intent_classification=True,
        allow_sql_generation_reasoning=False,
        allow_sql_functions_retrieval=False,
        allow_sql_knowledge_retrieval=False,
        allow_sql_diagnosis=True,
    )
    query_id = str(uuid.uuid4())
    ask_request = AskRequest(query="display all records", mdl_hash="deploy-hash")
    ask_request.query_id = query_id

    result = await ask_service.ask(ask_request)

    ask_result_response = ask_service.get_ask_result(
        AskResultRequest(query_id=query_id)
    )
    assert result["metadata"]["type"] == "TEXT_TO_SQL"
    assert ask_result_response.status == "finished"
    assert ask_result_response.type == "TEXT_TO_SQL"
    assert ask_result_response.response[0].sql == MODEL_ALPHA_COUNT_SQL
    assert generation.calls
    assert data_assistance.calls == []


@pytest.mark.asyncio
async def test_ask_general_intent_falls_back_to_data_assistance_without_schema():
    intent_classification = _IntentClassificationPipeline("GENERAL")
    data_assistance = _CapturingAssistancePipeline()
    generation = _ValidSqlGenerationPipeline()
    ask_service = AskService(
        {
            "intent_classification": intent_classification,
            "historical_question": _EmptyRetrievalPipeline(),
            "sql_pairs_retrieval": _EmptyRetrievalPipeline(),
            "instructions_retrieval": _EmptyRetrievalPipeline(),
            "data_assistance": data_assistance,
            "db_schema_retrieval": _EmptyRetrievalPipeline(),
            "sql_generation": generation,
            "sql_correction": _UnexpectedCorrectionPipeline(),
            "sql_diagnosis": _FailingDiagnosisPipeline(),
        },
        allow_intent_classification=True,
        allow_sql_generation_reasoning=False,
        allow_sql_functions_retrieval=False,
        allow_sql_knowledge_retrieval=False,
        allow_sql_diagnosis=True,
    )
    query_id = str(uuid.uuid4())
    ask_request = AskRequest(query="display all records", mdl_hash="deploy-hash")
    ask_request.query_id = query_id

    result = await ask_service.ask(ask_request)
    await asyncio.sleep(0)

    ask_result_response = ask_service.get_ask_result(
        AskResultRequest(query_id=query_id)
    )
    assert result["metadata"]["type"] == "GENERAL"
    assert ask_result_response.status == "finished"
    assert ask_result_response.type == "GENERAL"
    assert ask_result_response.general_type == "DATA_ASSISTANCE"
    assert data_assistance.calls
    assert generation.calls == []


@pytest.mark.asyncio
async def test_ask_feedback_does_not_pass_reasoning_text_to_sql_regeneration():
    regeneration = _CapturingRegenerationPipeline()
    ask_feedback_service = AskFeedbackService(
        {
            "db_schema_retrieval": _SchemaRetrievalPipeline(),
            "sql_pairs_retrieval": _EmptyRetrievalPipeline(),
            "instructions_retrieval": _EmptyRetrievalPipeline(),
            "sql_regeneration": regeneration,
            "sql_correction": _UnexpectedCorrectionPipeline(),
            "sql_diagnosis": _FailingDiagnosisPipeline(),
        },
        allow_sql_functions_retrieval=False,
        allow_sql_knowledge_retrieval=False,
        allow_sql_diagnosis=True,
    )
    query_id = str(uuid.uuid4())
    ask_feedback_request = AskFeedbackRequest(
        question="retry model records",
        tables=[MODEL_ALPHA],
        sql_generation_reasoning=(
            f"Use this SQL: SELECT * FROM {NON_SCHEMA_REASONING_TABLE}"
        ),
        sql=MODEL_ALPHA_SELECT_SQL,
        mdl_hash="deployment-hash",
    )
    ask_feedback_request.query_id = query_id

    await ask_feedback_service.ask_feedback(ask_feedback_request)

    ask_feedback_response = ask_feedback_service.get_ask_feedback_result(
        AskFeedbackResultRequest(query_id=query_id)
    )
    assert ask_feedback_response.status == "finished"
    assert regeneration.calls[0]["contexts"] == [MODEL_ALPHA_ENTITY_DDL]
    assert regeneration.calls[0]["sql_generation_reasoning"] is None
    assert regeneration.calls[0]["project_id"] == ask_feedback_request.project_id
    assert regeneration.calls[0]["mdl_hash"] == ask_feedback_request.mdl_hash


@pytest.mark.asyncio
async def test_ask_corrects_no_relevant_sql_with_exact_retrieved_metadata():
    generation = _NoRelevantSqlGenerationPipeline()
    regeneration = _CapturingRegenerationPipeline()
    correction = _CapturingCorrectionPipeline()
    diagnosis = _CapturingDiagnosisPipeline()
    ask_service = AskService(
        {
            "historical_question": _EmptyRetrievalPipeline(),
            "sql_pairs_retrieval": _EmptyRetrievalPipeline(),
            "instructions_retrieval": _EmptyRetrievalPipeline(),
            "db_schema_retrieval": _PrunedSchemaRetrievalPipeline(),
            "sql_generation": generation,
            "sql_regeneration": regeneration,
            "sql_correction": correction,
            "sql_diagnosis": diagnosis,
        },
        allow_intent_classification=False,
        allow_sql_generation_reasoning=False,
        allow_sql_functions_retrieval=False,
        allow_sql_knowledge_retrieval=False,
        allow_sql_diagnosis=True,
    )
    query_id = str(uuid.uuid4())
    ask_request = AskRequest(query="count records by retrieved dimension", mdl_hash=None)
    ask_request.query_id = query_id

    await ask_service.ask(ask_request)

    ask_result_response = ask_service.get_ask_result(
        AskResultRequest(query_id=query_id)
    )
    assert ask_result_response.status == "finished"
    assert regeneration.calls == []
    assert diagnosis.calls[0]["contexts"] == [MODEL_ALPHA_UNPRUNED_DDL]
    assert correction.calls[0]["contexts"] == [MODEL_ALPHA_PRUNED_DDL]
    assert correction.calls[0]["validation_contexts"] == [MODEL_ALPHA_UNPRUNED_DDL]
    invalid_generation_result = correction.calls[0]["invalid_generation_result"]
    assert invalid_generation_result | {
        "sql": "",
        "error": "Use the retrieved schema.",
    } == invalid_generation_result
    assert invalid_generation_result["execution_error"] == (
        "No grounded SQL was generated from the current schema."
    )
    assert invalid_generation_result["schema_grounding_failure"] is False
    assert invalid_generation_result["question"] == ask_request.query


@pytest.mark.asyncio
async def test_ask_returns_historical_sql_like_legacy():
    generation = _ValidSqlGenerationPipeline()
    ask_service = AskService(
        {
            "historical_question": _HistoricalQuestionPipeline(),
            "sql_pairs_retrieval": _EmptyRetrievalPipeline(),
            "instructions_retrieval": _EmptyRetrievalPipeline(),
            "db_schema_retrieval": _SchemaRetrievalPipeline(),
            "sql_generation": generation,
            "sql_correction": _UnexpectedCorrectionPipeline(),
            "sql_diagnosis": _FailingDiagnosisPipeline(),
        },
        allow_intent_classification=False,
        allow_sql_generation_reasoning=False,
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
    assert ask_result_response.response[0].sql == "SELECT * FROM stale_model"
    assert generation.calls == []


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
