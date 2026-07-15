import pytest
from haystack import Document

from src.pipelines.retrieval.db_schema_retrieval import (
    check_using_db_schemas_without_pruning,
    dbschema_retrieval,
    embedding,
    table_retrieval,
)


class RecordingEmbedder:
    def __init__(self):
        self.query = None

    async def run(self, query):
        self.query = query
        return {"embedding": [0.1, 0.2]}


@pytest.mark.asyncio
async def test_embedding_uses_question_and_histories_without_query_expansion():
    embedder = RecordingEmbedder()

    result = await embedding(
        query="Show top customers by invoice amount",
        embedder=embedder,
        histories=[],
    )

    assert result == {"embedding": [0.1, 0.2]}
    assert embedder.query == "\nShow top customers by invoice amount"
    assert "transaction purchase billing" not in embedder.query


@pytest.mark.asyncio
async def test_embedding_skips_vector_lookup_for_explicit_tables():
    embedder = RecordingEmbedder()

    result = await embedding(
        query="Show rows",
        embedder=embedder,
        histories=[],
        tables=["orders"],
    )

    assert result == {}
    assert embedder.query is None


@pytest.mark.asyncio
async def test_table_retrieval_uses_vector_retriever_results_without_local_rerank():
    documents = [
        Document(
            content="Raw staging audit rows with load metadata.",
            meta={"type": "TABLE_DESCRIPTION", "name": "staging_audit"},
            score=0.99,
        ),
        Document(
            content="Invoice sales transactions with product categories and sales value.",
            meta={"type": "TABLE_DESCRIPTION", "name": "sales_invoices"},
            score=0.8,
        ),
    ]

    class Retriever:
        def __init__(self):
            self.filters = None

        async def run(self, query_embedding, filters):
            self.filters = filters
            return {"documents": documents}

    retriever = Retriever()

    result = await table_retrieval(
        query="What is the distribution of sales across product categories?",
        embedding={"embedding": [0.1, 0.2]},
        project_id="project-1",
        tables=[],
        table_retriever=retriever,
    )

    assert result["documents"] == documents
    assert retriever.filters == {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_DESCRIPTION"},
            {"field": "project_id", "operator": "==", "value": "project-1"},
        ],
    }


@pytest.mark.asyncio
async def test_table_retrieval_fetches_explicit_table_descriptions():
    class Retriever:
        def __init__(self):
            self.filters = None

        async def run(self, query_embedding, filters):
            self.filters = filters
            return {"documents": []}

    retriever = Retriever()

    await table_retrieval(
        query="show rows",
        embedding={},
        project_id="project-1",
        tables=["orders"],
        table_retriever=retriever,
    )

    assert retriever.filters == {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_DESCRIPTION"},
            {"field": "project_id", "operator": "==", "value": "project-1"},
            {"field": "name", "operator": "in", "value": ["orders"]},
        ],
    }


@pytest.mark.asyncio
async def test_dbschema_retrieval_loads_only_selected_active_project_schema():
    class Retriever:
        def __init__(self):
            self.filters = None

        async def run(self, query_embedding, filters):
            self.filters = filters
            return {
                "documents": [
                    Document(
                        content=str(
                            {
                                "type": "TABLE",
                                "name": "orders",
                                "columns": [],
                            }
                        ),
                        meta={"type": "TABLE_SCHEMA", "name": "orders"},
                    )
                ]
            }

    retriever = Retriever()

    documents = await dbschema_retrieval(
        query="total orders",
        table_retrieval={
            "documents": [
                Document(
                    content=str({"name": "orders"}),
                    meta={"type": "TABLE_DESCRIPTION", "name": "orders"},
                )
            ]
        },
        project_id="project-1",
        dbschema_retriever=retriever,
    )

    assert [document.meta["name"] for document in documents] == ["orders"]
    assert retriever.filters == {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
            {"field": "project_id", "operator": "==", "value": "project-1"},
            {"field": "name", "operator": "in", "value": ["orders"]},
        ],
    }


@pytest.mark.asyncio
async def test_dbschema_retrieval_does_not_load_full_schema_for_unmatched_question():
    class Retriever:
        def __init__(self):
            self.called = False

        async def run(self, query_embedding, filters):
            self.called = True
            return {"documents": []}

    retriever = Retriever()

    documents = await dbschema_retrieval(
        query="show top customers by invoice amount",
        table_retrieval={"documents": []},
        project_id="project-1",
        dbschema_retriever=retriever,
    )

    assert documents == []
    assert not retriever.called


@pytest.mark.asyncio
async def test_dbschema_retrieval_uses_explicit_tables_as_scope():
    class Retriever:
        def __init__(self):
            self.filters = None

        async def run(self, query_embedding, filters):
            self.filters = filters
            return {"documents": []}

    retriever = Retriever()

    await dbschema_retrieval(
        query="show failed repairs",
        table_retrieval={"documents": []},
        project_id="project-1",
        dbschema_retriever=retriever,
        tables=["dbo.failure_patterns", "dbo_failure_patterns"],
    )

    assert retriever.filters == {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
            {"field": "project_id", "operator": "==", "value": "project-1"},
            {
                "field": "name",
                "operator": "in",
                "value": ["dbo.failure_patterns", "dbo_failure_patterns"],
            },
        ],
    }


def test_check_using_db_schemas_without_pruning_triggers_legacy_column_pruning():
    class Encoding:
        def encode(self, value):
            return value.split()

    result = check_using_db_schemas_without_pruning(
        construct_db_schemas=[
            {
                "type": "TABLE",
                "name": "orders",
                "comment": "",
                "columns": [
                    {
                        "type": "COLUMN",
                        "name": "amount",
                        "data_type": "DOUBLE",
                        "comment": "",
                        "is_primary_key": False,
                    }
                ],
                "properties": {},
                "primaryKey": "",
            }
        ],
        dbschema_retrieval=[],
        encoding=Encoding(),
        enable_column_pruning=True,
        context_window_size=1000,
    )

    assert result["db_schemas"] == []
    assert result["tokens"] > 0
