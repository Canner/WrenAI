import pytest

from src.web.v1.services.sql_answer import SqlAnswerService


class _FakeSchemaRetrievalPipeline:
    def __init__(self):
        self.calls = []

    async def run(self, **kwargs):
        self.calls.append(kwargs)
        return {
            "construct_retrieval_results": {
                "retrieval_results": [
                    {
                        "table_name": "dbo_orders",
                        "table_ddl": (
                            "CREATE TABLE dbo_orders ("
                            "CustomerName VARCHAR, OrderId VARCHAR)"
                        ),
                    }
                ]
            }
        }


@pytest.mark.asyncio
async def test_sql_answer_loads_schema_context_with_user_query():
    retrieval = _FakeSchemaRetrievalPipeline()
    service = SqlAnswerService({"db_schema_retrieval": retrieval})

    contexts = await service._load_active_schema_contexts(
        project_id="project-1",
        query="Show top customers by order count.",
    )

    assert contexts == [
        "CREATE TABLE dbo_orders (CustomerName VARCHAR, OrderId VARCHAR)"
    ]
    assert retrieval.calls == [
        {
            "query": "Show top customers by order count.",
            "histories": [],
            "project_id": "project-1",
            "enable_column_pruning": False,
        }
    ]


@pytest.mark.asyncio
async def test_sql_answer_does_not_load_full_schema_without_query():
    retrieval = _FakeSchemaRetrievalPipeline()
    service = SqlAnswerService({"db_schema_retrieval": retrieval})

    contexts = await service._load_active_schema_contexts(
        project_id="project-1",
        query="",
    )

    assert contexts == []
    assert retrieval.calls == []
