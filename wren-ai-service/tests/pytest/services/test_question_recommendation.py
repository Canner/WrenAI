import pytest

from src.web.v1.services.question_recommendation import QuestionRecommendation


class DbSchemaRetrievalPipeline:
    async def run(self, **_):
        return {
            "construct_retrieval_results": {
                "retrieval_results": [
                    {
                        "table_name": "dbo_qosSales",
                        "table_ddl": "CREATE TABLE dbo_qosSales (BU VARCHAR, SalesVal FLOAT)",
                        "manifest_column_names": ["BU", "SalesVal"],
                    }
                ]
            }
        }


class EmptyFormattedPipeline:
    async def run(self, **_):
        return {"formatted_output": {}}


class CapturingSqlGenerationPipeline:
    def __init__(self):
        self.schema_contracts = None
        self.run_count = 0

    async def run(self, **kwargs):
        self.run_count += 1
        self.schema_contracts = kwargs.get("schema_contracts")
        return {
            "post_process": {
                "valid_generation_result": {},
                "invalid_generation_result": {
                    "type": "SCHEMA_GROUNDING",
                    "sql": "",
                    "original_sql": "",
                    "error": "invalid",
                },
            }
        }


@pytest.mark.asyncio
async def test_question_recommendation_passes_schema_contracts_to_sql_generation():
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
        {"question": "show orders", "category": "General"},
        request_id="request-id",
        max_questions=5,
        max_categories=3,
        project_id="11",
    )

    assert sql_generation.schema_contracts == [
        {"table_name": "dbo_qosSales", "column_names": ["BU", "SalesVal"]}
    ]


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
