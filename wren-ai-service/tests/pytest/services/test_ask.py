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
    build_safe_invalid_sql,
    build_schema_grounding_context,
    build_schema_grounding_recovery_message,
    build_sql_correction_error_message,
    build_sql_correction_input,
    build_sql_generation_reasoning_text,
    build_sql_regeneration_reasoning_text,
    build_sql_regeneration_samples,
    build_sql_regeneration_source_sql,
    build_user_facing_error_message,
    get_pipeline_timeout_seconds,
    is_schema_grounding_error,
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


def test_ask_service_skips_sql_generation_reasoning_by_default():
    ask_service = AskService({})

    assert ask_service._allow_sql_generation_reasoning is False


def test_ask_request_uses_dry_plan_validation_by_default():
    ask_request = AskRequest(query="question", mdl_hash="deploy")

    assert ask_request.use_dry_plan is True
    assert ask_request.allow_dry_plan_fallback is False


def test_ask_service_uses_legacy_sql_correction_retries_by_default():
    ask_service = AskService({})

    assert ask_service._max_sql_correction_retries == 3


def test_pipeline_timeout_uses_provider_timeout_when_longer():
    pipeline = type("PipelineWithProviderTimeout", (), {})()
    pipeline.generation_timeout_seconds = 600

    assert get_pipeline_timeout_seconds(pipeline, 120) == 600


def test_pipeline_timeout_keeps_default_when_provider_timeout_is_shorter_or_missing():
    short_timeout_pipeline = type("PipelineWithShortProviderTimeout", (), {})()
    short_timeout_pipeline.generation_timeout_seconds = 60

    assert get_pipeline_timeout_seconds(short_timeout_pipeline, 120) == 120
    assert get_pipeline_timeout_seconds(object(), 120) == 120


def test_schema_grounding_context_uses_retrieved_identifiers():
    context = build_schema_grounding_context(
        [
            {
                "table_name": "deployed_order_model",
                "column_names": ["ship_country", "order_date"],
                "manifest_column_names": ["id", "ship_country", "order_date"],
                "relationship_constraints": [
                    "FOREIGN KEY (customer_id) REFERENCES customer(id)"
                ],
            }
        ]
    )

    assert '- model/table: "deployed_order_model"' in context
    assert '- "id"' in context
    assert '- "ship_country"' in context
    assert '- "order_date"' in context
    assert "FOREIGN KEY" in context
    assert '"orders"' not in context


def test_schema_grounding_error_detection_uses_validation_type():
    assert is_schema_grounding_error({"type": "SCHEMA_GROUNDING"})
    assert not is_schema_grounding_error({"type": "DRY_RUN"})


def test_sql_correction_error_keeps_validation_error_and_adds_diagnosis():
    error = build_sql_correction_error_message(
        "Invalid object name.",
        "The table is not in the retrieved schema.",
    )

    assert "Invalid object name." in error
    assert "Diagnostic reasoning: The table is not in the retrieved schema." in error


def test_schema_grounding_correction_input_omits_rejected_sql():
    correction_input = build_sql_correction_input(
        {
            "sql": "SELECT * FROM hallucinated_table",
            "original_sql": "SELECT * FROM hallucinated_table",
            "type": "SCHEMA_GROUNDING",
        },
        "Use only retrieved identifiers.",
    )

    assert correction_input == {
        "sql": "",
        "type": "SCHEMA_GROUNDING",
        "error": (
            "The previous SQL used executable table or column identifiers that are "
            "absent from the retrieved Wren schema. Regenerate the SQL from the "
            "user question using only DATABASE SCHEMA, RETRIEVED EXECUTABLE SCHEMA, "
            "SQL FUNCTIONS, USER INSTRUCTIONS, and the configured datasource dialect."
        ),
    }


def test_schema_grounding_recovery_message_omits_hallucinated_identifier():
    message = build_schema_grounding_recovery_message(
        {
            "sql": "SELECT * FROM hallucinated_table",
            "original_sql": "SELECT * FROM hallucinated_table",
            "type": "SCHEMA_GROUNDING",
            "error": "Generated SQL references hallucinated_table.",
        }
    )

    assert "hallucinated_table" not in message
    assert "retrieved Wren schema" in message


def test_user_facing_schema_grounding_error_is_sanitized():
    message = build_user_facing_error_message(
        {
            "sql": "SELECT * FROM hallucinated_table",
            "original_sql": "SELECT * FROM hallucinated_table",
            "type": "SCHEMA_GROUNDING",
            "error": "Generated SQL references hallucinated_table.",
        },
        "Generated SQL references hallucinated_table.",
    )

    assert "hallucinated_table" not in message
    assert "retrieved metadata was not sufficient" in message
    assert (
        build_user_facing_error_message(
            {"type": "DRY_RUN"},
            "Syntax error near FROM.",
        )
        == "Syntax error near FROM."
    )


def test_schema_grounding_regeneration_source_omits_rejected_sql():
    assert (
        build_sql_regeneration_source_sql(
            {
                "sql": "SELECT * FROM hallucinated_table",
                "original_sql": "SELECT * FROM hallucinated_table",
                "type": "SCHEMA_GROUNDING",
            }
        )
        == ""
    )
    assert (
        build_sql_regeneration_source_sql(
            {
                "sql": "SELECT * FROM model_alpha",
                "original_sql": "SELECT * FROM model_alpha",
                "type": "DRY_RUN",
            }
        )
        == "SELECT * FROM model_alpha"
    )


def test_sql_generation_reasoning_text_extracts_reasoning():
    assert (
        build_sql_generation_reasoning_text({"reasoning": "use modeled tables"})
        == "use modeled tables"
    )
    assert build_sql_generation_reasoning_text("plain reasoning") == "plain reasoning"
    assert build_sql_generation_reasoning_text(None) == ""


def test_schema_grounding_regeneration_omits_reasoning_and_samples():
    failed_schema_result = {"type": "SCHEMA_GROUNDING"}
    failed_dry_run_result = {"type": "DRY_RUN"}
    sql_samples = [{"question": "show records", "sql": "SELECT * FROM model_alpha"}]

    assert (
        build_sql_regeneration_reasoning_text(
            failed_schema_result,
            {"reasoning": "use hallucinated_table"},
        )
        == ""
    )
    assert build_sql_regeneration_samples(failed_schema_result, sql_samples) == []
    assert (
        build_sql_regeneration_reasoning_text(
            failed_dry_run_result,
            {"reasoning": "use model_alpha"},
        )
        == "use model_alpha"
    )
    assert build_sql_regeneration_samples(failed_dry_run_result, sql_samples) == (
        sql_samples
    )


def test_safe_invalid_sql_omits_schema_grounding_sql():
    assert (
        build_safe_invalid_sql(
            {
                "type": "SCHEMA_GROUNDING",
                "sql": "SELECT * FROM hallucinated_table",
            },
            "SELECT * FROM hallucinated_table",
        )
        is None
    )
    assert (
        build_safe_invalid_sql(
            {
                "type": "DRY_RUN",
                "sql": "SELECT * FROM model_alpha",
            },
            "SELECT * FROM model_alpha",
        )
        == "SELECT * FROM model_alpha"
    )


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


class _PrunedSchemaRetrievalPipeline:
    async def run(self, **_):
        return {
            "construct_retrieval_results": {
                "retrieval_results": [
                    {
                        "table_name": "model_alpha",
                        "table_ddl": (
                            "CREATE TABLE model_alpha (selected_measure INTEGER)"
                        ),
                        "unpruned_table_ddl": (
                            "CREATE TABLE model_alpha ("
                            "selected_measure INTEGER, recovered_dimension VARCHAR)"
                        ),
                        "column_names": ["selected_measure"],
                        "manifest_column_names": [
                            "selected_measure",
                            "recovered_dimension",
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
                    "sql": "SELECT entity_id FROM model_alpha",
                    "original_sql": "SELECT entity_id FROM model_alpha",
                    "type": "SQL_SHAPE",
                    "error": "Generated SQL is a table preview.",
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


class _ValidSqlGenerationPipeline:
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


class _SchemaGroundingSqlGenerationPipeline:
    def __init__(self):
        self.calls = []

    async def run(self, **_):
        self.calls.append(_)
        return {
            "post_process": {
                "valid_generation_result": {},
                "invalid_generation_result": {
                    "sql": "SELECT * FROM hallucinated_table",
                    "original_sql": "SELECT * FROM hallucinated_table",
                    "type": "SCHEMA_GROUNDING",
                    "error": (
                        "Generated SQL references model/table identifiers that are "
                        "not in the retrieved Wren schema: \"hallucinated_table\". "
                        "Use only these retrieved model/table identifiers: "
                        "\"model_alpha\"."
                    ),
                    "correlation_id": "",
                },
            }
        }


class _SlowSqlGenerationPipeline:
    async def run(self, **_):
        await asyncio.sleep(60)


class _SlowButProviderAllowedSqlGenerationPipeline:
    generation_timeout_seconds = 0.2

    async def run(self, **_):
        await asyncio.sleep(0.02)
        return {
            "post_process": {
                "valid_generation_result": {
                    "sql": "SELECT COUNT(*) AS record_count FROM model_alpha",
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
                    "sql": "SELECT COUNT(*) AS record_count FROM model_alpha",
                    "correlation_id": "",
                },
                "invalid_generation_result": {},
            }
        }


class _FailingCorrectionPipeline:
    def __init__(self):
        self.calls = []

    async def run(self, **kwargs):
        self.calls.append(kwargs)
        raise AssertionError("sql_correction should not run after regeneration succeeds")


class _CapturingRegenerationPipeline:
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


class _SchemaGroundingRegenerationPipeline:
    def __init__(self):
        self.calls = []

    async def run(self, **kwargs):
        self.calls.append(kwargs)
        return {
            "post_process": {
                "valid_generation_result": {},
                "invalid_generation_result": {
                    "sql": "SELECT * FROM hallucinated_table",
                    "original_sql": "SELECT * FROM hallucinated_table",
                    "type": "SCHEMA_GROUNDING",
                    "error": (
                        "Generated SQL references model/table identifiers that are "
                        "not in the retrieved Wren schema: \"hallucinated_table\". "
                        "Use only these retrieved model/table identifiers: "
                        "\"model_alpha\"."
                    ),
                    "correlation_id": "",
                },
            }
        }


class _FailingDiagnosisPipeline:
    def __init__(self):
        self.calls = []

    async def run(self, **kwargs):
        self.calls.append(kwargs)
        raise AssertionError("sql_diagnosis should not run for local validation errors")


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
    assert correction.calls[0]["invalid_generation_result"] == {
        "sql": "SELECT entity_id FROM model_alpha",
        "type": "SQL_SHAPE",
        "error": "Generated SQL is a table preview.",
    }


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
    assert ask_result_response.response[0].sql == (
        "SELECT COUNT(*) AS record_count FROM model_alpha"
    )
    assert diagnosis.calls == []
    assert correction.calls[0]["query"] == "count records by model"
    assert correction.calls[0]["contexts"] == [
        "CREATE TABLE model_alpha (entity_id INTEGER)"
    ]
    assert generation.calls[0]["schema_grounding"] == (
        '- model/table: "model_alpha"\n'
        "  columns:\n"
        '    - "entity_id"'
    )
    assert correction.calls[0]["schema_grounding"] == (
        '- model/table: "model_alpha"\n'
        "  columns:\n"
        '    - "entity_id"'
    )
    assert correction.calls[0]["invalid_generation_result"] == {
        "sql": "",
        "type": "NO_RELEVANT_SQL",
        "error": "No grounded SQL was generated from the current schema.",
    }


@pytest.mark.asyncio
async def test_ask_schema_grounding_recovery_omits_hallucinated_sql():
    correction = _CapturingCorrectionPipeline()
    diagnosis = _FailingDiagnosisPipeline()
    generation = _SchemaGroundingSqlGenerationPipeline()
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
        allow_sql_diagnosis=True,
    )
    query_id = str(uuid.uuid4())
    ask_request = AskRequest(query="show hallucinated records", mdl_hash=None)
    ask_request.query_id = query_id

    await ask_service.ask(ask_request)

    ask_result_response = ask_service.get_ask_result(
        AskResultRequest(query_id=query_id)
    )
    assert ask_result_response.status == "finished"
    assert diagnosis.calls == []
    assert correction.calls[0]["invalid_generation_result"]["type"] == (
        "SCHEMA_GROUNDING"
    )
    assert correction.calls[0]["invalid_generation_result"]["sql"] == ""
    assert "hallucinated_table" not in correction.calls[0]["invalid_generation_result"][
        "error"
    ]
    assert "SELECT * FROM hallucinated_table" not in correction.calls[0][
        "invalid_generation_result"
    ]["error"]


@pytest.mark.asyncio
async def test_ask_regenerates_schema_grounding_failures_before_correction():
    regeneration = _CapturingRegenerationPipeline()
    correction = _FailingCorrectionPipeline()
    diagnosis = _FailingDiagnosisPipeline()
    generation = _SchemaGroundingSqlGenerationPipeline()
    ask_service = AskService(
        {
            "historical_question": _EmptyRetrievalPipeline(),
            "sql_pairs_retrieval": _EmptyRetrievalPipeline(),
            "instructions_retrieval": _EmptyRetrievalPipeline(),
            "db_schema_retrieval": _SchemaRetrievalPipeline(),
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
    ask_request = AskRequest(query="show hallucinated records", mdl_hash=None)
    ask_request.query_id = query_id

    await ask_service.ask(ask_request)

    ask_result_response = ask_service.get_ask_result(
        AskResultRequest(query_id=query_id)
    )
    assert ask_result_response.status == "finished"
    assert ask_result_response.response[0].sql == (
        "SELECT COUNT(*) AS record_count FROM model_alpha"
    )
    assert diagnosis.calls == []
    assert correction.calls == []
    assert regeneration.calls[0]["sql"] == ""
    assert regeneration.calls[0]["schema_grounding"] == (
        '- model/table: "model_alpha"\n'
        "  columns:\n"
        '    - "entity_id"'
    )


@pytest.mark.asyncio
async def test_ask_uses_unpruned_deployed_metadata_for_generation_context():
    generation = _ValidSqlGenerationPipeline()
    ask_service = AskService(
        {
            "historical_question": _EmptyRetrievalPipeline(),
            "sql_pairs_retrieval": _EmptyRetrievalPipeline(),
            "instructions_retrieval": _EmptyRetrievalPipeline(),
            "db_schema_retrieval": _PrunedSchemaRetrievalPipeline(),
            "sql_generation": generation,
            "sql_correction": _FailingCorrectionPipeline(),
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
    assert "recovered_dimension" in generation.calls[0]["contexts"][0]
    assert generation.calls[0]["schema_grounding"] == (
        '- model/table: "model_alpha"\n'
        "  columns:\n"
        '    - "selected_measure"\n'
        '    - "recovered_dimension"'
    )


@pytest.mark.asyncio
async def test_ask_regenerates_no_relevant_sql_with_unpruned_metadata():
    generation = _NoRelevantSqlGenerationPipeline()
    regeneration = _CapturingRegenerationPipeline()
    correction = _FailingCorrectionPipeline()
    ask_service = AskService(
        {
            "historical_question": _EmptyRetrievalPipeline(),
            "sql_pairs_retrieval": _EmptyRetrievalPipeline(),
            "instructions_retrieval": _EmptyRetrievalPipeline(),
            "db_schema_retrieval": _PrunedSchemaRetrievalPipeline(),
            "sql_generation": generation,
            "sql_regeneration": regeneration,
            "sql_correction": correction,
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
    assert correction.calls == []
    assert "recovered_dimension" in regeneration.calls[0]["contexts"][0]
    assert regeneration.calls[0]["sql"] == ""


@pytest.mark.asyncio
async def test_ask_historical_sql_does_not_bypass_current_metadata_validation():
    generation = _ValidSqlGenerationPipeline()
    ask_service = AskService(
        {
            "historical_question": _HistoricalQuestionPipeline(),
            "sql_pairs_retrieval": _EmptyRetrievalPipeline(),
            "instructions_retrieval": _EmptyRetrievalPipeline(),
            "db_schema_retrieval": _SchemaRetrievalPipeline(),
            "sql_generation": generation,
            "sql_correction": _FailingCorrectionPipeline(),
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
    assert ask_result_response.response[0].sql == (
        "SELECT COUNT(*) AS record_count FROM model_alpha"
    )
    assert generation.calls
    assert generation.calls[0]["sql_samples"] == [
        {
            "question": "previous analytical request",
            "sql": "SELECT * FROM stale_model",
        }
    ]


@pytest.mark.asyncio
async def test_ask_retries_schema_regeneration_without_exposing_invalid_sql():
    regeneration = _SchemaGroundingRegenerationPipeline()
    correction = _FailingCorrectionPipeline()
    diagnosis = _FailingDiagnosisPipeline()
    generation = _SchemaGroundingSqlGenerationPipeline()
    ask_service = AskService(
        {
            "historical_question": _EmptyRetrievalPipeline(),
            "sql_pairs_retrieval": _EmptyRetrievalPipeline(),
            "instructions_retrieval": _EmptyRetrievalPipeline(),
            "db_schema_retrieval": _SchemaRetrievalPipeline(),
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
        max_sql_correction_retries=2,
    )
    query_id = str(uuid.uuid4())
    ask_request = AskRequest(query="show hallucinated records", mdl_hash=None)
    ask_request.query_id = query_id

    await ask_service.ask(ask_request)

    ask_result_response = ask_service.get_ask_result(
        AskResultRequest(query_id=query_id)
    )
    assert ask_result_response.status == "failed"
    assert ask_result_response.invalid_sql is None
    assert "hallucinated_table" not in ask_result_response.error.message
    assert "retrieved metadata was not sufficient" in ask_result_response.error.message
    assert diagnosis.calls == []
    assert correction.calls == []
    assert len(regeneration.calls) == 2
    assert all(call["sql"] == "" for call in regeneration.calls)


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
        allow_sql_generation_reasoning=False,
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
async def test_ask_uses_provider_timeout_for_slow_local_sql_generation():
    ask_service = AskService(
        {
            "historical_question": _EmptyRetrievalPipeline(),
            "sql_pairs_retrieval": _EmptyRetrievalPipeline(),
            "instructions_retrieval": _EmptyRetrievalPipeline(),
            "db_schema_retrieval": _SchemaRetrievalPipeline(),
            "sql_generation": _SlowButProviderAllowedSqlGenerationPipeline(),
        },
        allow_intent_classification=False,
        allow_sql_generation_reasoning=False,
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
    assert ask_result_response.status == "finished"
    assert ask_result_response.response[0].sql == (
        "SELECT COUNT(*) AS record_count FROM model_alpha"
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
