import pytest
from haystack import Document

from src.pipelines.retrieval.db_schema_retrieval import (
    check_using_db_schemas_without_pruning,
    dbschema_retrieval,
    embedding,
    table_retrieval,
)


@pytest.mark.asyncio
async def test_embedding_skips_vector_lookup_for_explicit_tables():
    class Embedder:
        def __init__(self):
            self.called = False

        async def run(self, query):
            self.called = True
            return {"embedding": [0.1]}

    embedder = Embedder()

    result = await embedding(
        query="show rows",
        embedder=embedder,
        histories=[],
        tables=["orders"],
    )

    assert result == {}
    assert not embedder.called


@pytest.mark.asyncio
async def test_table_retrieval_returns_embedding_results_without_reranking_or_capping():
    documents = [
        Document(
            content=str({"name": f"table_{index}"}),
            meta={"type": "TABLE_DESCRIPTION", "name": f"table_{index}"},
        )
        for index in range(8)
    ]

    class Retriever:
        async def run(self, query_embedding, filters):
            return {"documents": documents}

    result = await table_retrieval(
        embedding={"embedding": [0.1, 0.2]},
        project_id="project-1",
        tables=[],
        table_retriever=Retriever(),
    )

    assert result["documents"] == documents


@pytest.mark.asyncio
async def test_table_retrieval_fetches_explicit_table_descriptions_with_project_scope():
    class Retriever:
        def __init__(self):
            self.filters = None

        async def run(self, query_embedding, filters):
            self.filters = filters
            return {"documents": []}

    retriever = Retriever()

    await table_retrieval(
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
async def test_table_retrieval_without_embedding_or_explicit_tables_returns_empty():
    class Retriever:
        def __init__(self):
            self.called = False

        async def run(self, query_embedding, filters):
            self.called = True
            return {"documents": []}

    retriever = Retriever()

    result = await table_retrieval(
        embedding={},
        project_id="project-1",
        tables=[],
        table_retriever=retriever,
    )

    assert result == {"documents": []}
    assert not retriever.called


@pytest.mark.asyncio
async def test_dbschema_retrieval_loads_schema_for_retrieved_tables_with_project_scope():
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
            {
                "operator": "OR",
                "conditions": [
                    {"field": "name", "operator": "==", "value": "orders"}
                ],
            },
            {"field": "project_id", "operator": "==", "value": "project-1"},
        ],
    }


@pytest.mark.asyncio
async def test_dbschema_retrieval_returns_empty_when_no_tables_are_retrieved():
    class Retriever:
        def __init__(self):
            self.called = False

        async def run(self, query_embedding, filters):
            self.called = True
            return {"documents": []}

    retriever = Retriever()

    documents = await dbschema_retrieval(
        table_retrieval={"documents": []},
        project_id="project-1",
        dbschema_retriever=retriever,
    )

    assert documents == []
    assert not retriever.called


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
