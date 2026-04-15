from collections.abc import Callable

import pytest
from haystack import Document

from src.pipelines.common import (
    build_runtime_scope_filters,
    resolve_pipeline_runtime_scope_id,
    retrieve_data_source,
    retrieve_metadata,
)
from src.pipelines.generation.intent_classification import (
    dbschema_retrieval as intent_dbschema_retrieval,
)
from src.pipelines.generation.intent_classification import (
    table_retrieval as intent_table_retrieval,
)
from src.pipelines.retrieval.db_schema_retrieval import (
    dbschema_retrieval as ask_dbschema_retrieval,
)
from src.pipelines.retrieval.db_schema_retrieval import (
    table_retrieval as ask_table_retrieval,
)
from src.pipelines.retrieval.historical_question_retrieval import (
    count_documents as historical_count_documents,
)
from src.pipelines.retrieval.instructions import (
    ScopeFilter,
    default_instructions,
)
from src.pipelines.retrieval.instructions import (
    retrieval as instructions_retrieval,
)
from src.pipelines.retrieval.sql_pairs_retrieval import (
    count_documents as sql_pairs_count_documents,
)
from src.pipelines.retrieval.sql_pairs_retrieval import (
    retrieval as sql_pairs_retrieval,
)


class MockStore:
    def __init__(self, count: int = 1) -> None:
        self.count = count
        self.last_filters = None

    async def count_documents(self, filters=None) -> int:
        self.last_filters = filters
        return self.count


class MockRetriever:
    def __init__(self, documents: list[Document] | None = None) -> None:
        self.documents = documents or []
        self.calls: list[dict] = []

    async def run(self, query_embedding=None, filters=None) -> dict:
        self.calls.append(
            {
                "query_embedding": query_embedding,
                "filters": filters,
            }
        )
        return {"documents": self.documents}


def _table_description_document(table_name: str) -> Document:
    return Document(content=str({"name": table_name}), meta={"name": table_name})


def test_build_runtime_scope_filters_returns_none_without_scope_or_conditions():
    assert build_runtime_scope_filters(None) is None
    assert build_runtime_scope_filters("   ") is None


def test_resolve_pipeline_runtime_scope_id_prefers_runtime_scope_then_project_bridge():
    assert (
        resolve_pipeline_runtime_scope_id(
            " deploy-1 ",
            bridge_scope_id="legacy-project-1",
        )
        == "deploy-1"
    )
    assert (
        resolve_pipeline_runtime_scope_id(
            None,
            bridge_scope_id=" legacy-project-1 ",
        )
        == "legacy-project-1"
    )


def test_build_runtime_scope_filters_wraps_legacy_project_field_once():
    assert build_runtime_scope_filters(
        " deploy-1 ",
        conditions=[{"field": "is_default", "operator": "==", "value": False}],
    ) == {
        "operator": "AND",
        "conditions": [
            {"field": "is_default", "operator": "==", "value": False},
            {"field": "project_id", "operator": "==", "value": "deploy-1"},
        ],
    }


def test_build_runtime_scope_filters_uses_or_for_multiple_scope_ids():
    assert build_runtime_scope_filters(
        " deploy-1, kb-2 ,deploy-1",
        conditions=[{"field": "is_default", "operator": "==", "value": False}],
    ) == {
        "operator": "AND",
        "conditions": [
            {"field": "is_default", "operator": "==", "value": False},
            {
                "operator": "OR",
                "conditions": [
                    {
                        "field": "project_id",
                        "operator": "==",
                        "value": "deploy-1",
                    },
                    {
                        "field": "project_id",
                        "operator": "==",
                        "value": "kb-2",
                    },
                ],
            },
        ],
    }


@pytest.mark.asyncio
async def test_retrieve_metadata_uses_runtime_scope_filters():
    retriever = MockRetriever(documents=[Document(content="metadata", meta={"foo": "bar"})])

    result = await retrieve_metadata(" deploy-1 ", retriever)

    assert result == {"foo": "bar"}
    assert retriever.calls == [
        {
            "query_embedding": [],
            "filters": build_runtime_scope_filters("deploy-1"),
        }
    ]


@pytest.mark.asyncio
async def test_retrieve_data_source_returns_metadata_data_source_with_default_fallback():
    retriever = MockRetriever(
        documents=[Document(content="metadata", meta={"data_source": "postgres"})]
    )

    assert await retrieve_data_source(" deploy-1 ", retriever) == "postgres"

    empty_retriever = MockRetriever(documents=[Document(content="metadata", meta={})])
    assert await retrieve_data_source(" deploy-1 ", empty_retriever) == "local_file"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "count_documents_fn",
    [historical_count_documents, sql_pairs_count_documents],
)
async def test_count_documents_reuses_scope_filter_helper(
    count_documents_fn: Callable,
):
    store = MockStore(count=3)

    count = await count_documents_fn(store, " deploy-1 ")

    assert count == 3
    assert store.last_filters == build_runtime_scope_filters("deploy-1")


@pytest.mark.asyncio
async def test_sql_pairs_retrieval_reuses_scope_filter_helper():
    retriever = MockRetriever()

    await sql_pairs_retrieval(
        embedding={"embedding": [0.1, 0.2]},
        runtime_scope_id=" deploy-1 ",
        retriever=retriever,
    )

    assert retriever.calls == [
        {
            "query_embedding": [0.1, 0.2],
            "filters": build_runtime_scope_filters("deploy-1"),
        }
    ]


@pytest.mark.asyncio
async def test_ask_table_retrieval_preserves_type_and_scope_filters():
    retriever = MockRetriever()

    await ask_table_retrieval(
        embedding={"embedding": [0.1, 0.2]},
        runtime_scope_id=" deploy-1 ",
        tables=["orders"],
        table_retriever=retriever,
    )

    assert retriever.calls == [
        {
            "query_embedding": [0.1, 0.2],
            "filters": build_runtime_scope_filters(
                "deploy-1",
                conditions=[
                    {
                        "field": "type",
                        "operator": "==",
                        "value": "TABLE_DESCRIPTION",
                    }
                ],
            ),
        }
    ]


@pytest.mark.asyncio
async def test_ask_table_retrieval_without_embedding_preserves_name_condition():
    retriever = MockRetriever()

    await ask_table_retrieval(
        embedding={},
        runtime_scope_id=" deploy-1 ",
        tables=["orders"],
        table_retriever=retriever,
    )

    assert retriever.calls == [
        {
            "query_embedding": [],
            "filters": build_runtime_scope_filters(
                "deploy-1",
                conditions=[
                    {
                        "field": "type",
                        "operator": "==",
                        "value": "TABLE_DESCRIPTION",
                    },
                    {"field": "name", "operator": "in", "value": ["orders"]},
                ],
            ),
        }
    ]


@pytest.mark.asyncio
async def test_ask_dbschema_retrieval_preserves_type_or_name_and_scope_filters():
    retriever = MockRetriever()

    result = await ask_dbschema_retrieval(
        table_retrieval={"documents": [_table_description_document("orders")]},
        runtime_scope_id=" deploy-1 ",
        dbschema_retriever=retriever,
    )

    assert result == []
    assert retriever.calls == [
        {
            "query_embedding": [],
            "filters": build_runtime_scope_filters(
                "deploy-1",
                conditions=[
                    {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
                    {
                        "operator": "OR",
                        "conditions": [
                            {"field": "name", "operator": "==", "value": "orders"}
                        ],
                    },
                ],
            ),
        }
    ]


@pytest.mark.asyncio
async def test_intent_table_retrieval_preserves_type_and_scope_filters():
    retriever = MockRetriever()

    await intent_table_retrieval(
        embedding={"embedding": [0.1, 0.2]},
        runtime_scope_id=" deploy-1 ",
        table_retriever=retriever,
    )

    assert retriever.calls == [
        {
            "query_embedding": [0.1, 0.2],
            "filters": build_runtime_scope_filters(
                "deploy-1",
                conditions=[
                    {
                        "field": "type",
                        "operator": "==",
                        "value": "TABLE_DESCRIPTION",
                    }
                ],
            ),
        }
    ]


@pytest.mark.asyncio
async def test_intent_dbschema_retrieval_preserves_type_or_name_and_scope_filters():
    retriever = MockRetriever()

    result = await intent_dbschema_retrieval(
        table_retrieval={"documents": [_table_description_document("orders")]},
        embedding={"embedding": [0.1, 0.2]},
        runtime_scope_id=" deploy-1 ",
        dbschema_retriever=retriever,
    )

    assert result == []
    assert retriever.calls == [
        {
            "query_embedding": [0.1, 0.2],
            "filters": build_runtime_scope_filters(
                "deploy-1",
                conditions=[
                    {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
                    {
                        "operator": "OR",
                        "conditions": [
                            {"field": "name", "operator": "==", "value": "orders"}
                        ],
                    },
                ],
            ),
        }
    ]


@pytest.mark.asyncio
async def test_intent_dbschema_retrieval_short_circuits_when_no_tables_match():
    retriever = MockRetriever()

    result = await intent_dbschema_retrieval(
        table_retrieval={"documents": []},
        embedding={"embedding": [0.1, 0.2]},
        runtime_scope_id=" deploy-1 ",
        dbschema_retriever=retriever,
    )

    assert result == []
    assert retriever.calls == []


@pytest.mark.asyncio
async def test_instructions_retrieval_preserves_non_default_condition():
    retriever = MockRetriever()

    await instructions_retrieval(
        embedding={"embedding": [0.1, 0.2]},
        runtime_scope_id=" deploy-1 ",
        retriever=retriever,
    )

    assert retriever.calls == [
        {
            "query_embedding": [0.1, 0.2],
            "filters": build_runtime_scope_filters(
                "deploy-1",
                conditions=[
                    {"field": "is_default", "operator": "==", "value": False}
                ],
            ),
        }
    ]


@pytest.mark.asyncio
async def test_default_instructions_preserve_default_condition_and_scope_filter():
    retriever = MockRetriever(
        documents=[
            Document(
                content="sql question",
                meta={
                    "instruction": "sql instruction",
                    "instruction_id": "sql-1",
                    "scope": "sql",
                },
            ),
            Document(
                content="chart question",
                meta={
                    "instruction": "chart instruction",
                    "instruction_id": "chart-1",
                    "scope": "chart",
                },
            ),
        ]
    )

    result = await default_instructions(
        count_documents=2,
        retriever=retriever,
        runtime_scope_id=" deploy-1 ",
        scope_filter=ScopeFilter(),
        scope="sql",
    )

    assert retriever.calls == [
        {
            "query_embedding": None,
            "filters": build_runtime_scope_filters(
                "deploy-1",
                conditions=[
                    {"field": "is_default", "operator": "==", "value": True}
                ],
            ),
        }
    ]
    assert [document.meta["instruction_id"] for document in result["documents"]] == [
        "sql-1"
    ]
