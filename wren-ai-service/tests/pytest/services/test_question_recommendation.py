import pytest

from src.web.v1.services.question_recommendation import QuestionRecommendation


class DbSchemaRetrievalPipeline:
    async def run(self, **_):
        return {
            "construct_retrieval_results": {
                "retrieval_results": [
                    {
                        "table_name": "model_1",
                        "table_ddl": "CREATE TABLE model_1 (attribute_1 VARCHAR, measure_1 FLOAT)",
                        "manifest_column_names": ["attribute_1", "measure_1"],
                    }
                ]
            }
        }


class EmptyFormattedPipeline:
    async def run(self, **_):
        return {"formatted_output": {}}


class CapturingSqlGenerationPipeline:
    def __init__(self):
        self.kwargs = {}
        self.run_count = 0

    async def run(self, **kwargs):
        self.run_count += 1
        self.kwargs = kwargs
        return {
            "post_process": {
                "valid_generation_result": {},
                "invalid_generation_result": {
                    "type": "DRY_RUN",
                    "sql": "",
                    "original_sql": "",
                    "error": "invalid",
                },
            }
        }


@pytest.mark.asyncio
async def test_question_recommendation_passes_ddl_context_to_sql_generation():
    sql_generation = CapturingSqlGenerationPipeline()
    service = QuestionRecommendation(
        pipelines={
            "db_schema_retrieval": DbSchemaRetrievalPipeline(),
            "sql_pairs_retrieval": EmptyFormattedPipeline(),
            "instructions_retrieval": EmptyFormattedPipeline(),
            "sql_generation": sql_generation,
        },
        allow_sql_functions_retrieval=False,
        allow_sql_knowledge_retrieval=False,
    )

    await service._validate_question(
        {"question": "show model records", "category": "General"},
        request_id="request-id",
        max_questions=5,
        max_categories=3,
        project_id="11",
    )

    assert sql_generation.kwargs["contexts"] == [
        "CREATE TABLE model_1 (attribute_1 VARCHAR, measure_1 FLOAT)"
    ]
    assert "schema_contracts" not in sql_generation.kwargs


class MalformedRecommendationPipeline:
    async def run(self, **_):
        return {
            "normalized": {
                "questions": [
                    {"category": "General"},
                    {"question": "show orders"},
                    "show users",
                ]
            }
        }


@pytest.mark.asyncio
async def test_question_recommendation_skips_malformed_candidates():
    sql_generation = CapturingSqlGenerationPipeline()
    service = QuestionRecommendation(
        pipelines={
            "question_recommendation": MalformedRecommendationPipeline(),
            "db_schema_retrieval": DbSchemaRetrievalPipeline(),
            "sql_pairs_retrieval": EmptyFormattedPipeline(),
            "instructions_retrieval": EmptyFormattedPipeline(),
            "sql_generation": sql_generation,
        },
        allow_sql_functions_retrieval=False,
        allow_sql_knowledge_retrieval=False,
    )

    await service._recommend(
        {
            "event_id": "request-id",
            "max_questions": 5,
            "max_categories": 3,
            "project_id": "11",
            "allow_data_preview": False,
            "use_dry_plan": True,
            "allow_dry_plan_fallback": False,
        }
    )

    assert sql_generation.run_count == 0
