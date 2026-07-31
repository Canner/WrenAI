import pytest

from src.pipelines.common import retrieve_metadata
from src.pipelines.retrieval import historical_question_retrieval, instructions
from src.pipelines.retrieval import sql_pairs_retrieval


PROJECT_FILTER = {
    "operator": "AND",
    "conditions": [
        {"field": "project_id", "operator": "==", "value": "project-a"},
    ],
}


class StoreSpy:
    def __init__(self, count=0):
        self.count = count
        self.filters = []

    async def count_documents(self, filters=None):
        self.filters.append(filters)
        return self.count


class RetrieverSpy:
    def __init__(self, documents=None):
        self.documents = documents or []
        self.calls = []

    async def run(self, query_embedding=None, filters=None):
        self.calls.append(
            {
                "query_embedding": query_embedding,
                "filters": filters,
            }
        )
        return {"documents": self.documents}


@pytest.mark.asyncio
async def test_metadata_retrieval_does_not_fall_back_to_global_documents():
    retriever = RetrieverSpy()

    result = await retrieve_metadata("project-a", retriever)

    assert result == {}
    assert [call["filters"] for call in retriever.calls] == [PROJECT_FILTER]


@pytest.mark.asyncio
async def test_sql_pairs_count_stays_project_scoped_when_project_has_no_documents():
    store = StoreSpy(count=0)

    count = await sql_pairs_retrieval.count_documents(store, project_id="project-a")

    assert count == 0
    assert store.filters == [PROJECT_FILTER]


@pytest.mark.asyncio
async def test_sql_pairs_retrieval_does_not_fall_back_to_global_documents():
    retriever = RetrieverSpy()

    result = await sql_pairs_retrieval.retrieval(
        {"embedding": [0.1]},
        project_id="project-a",
        retriever=retriever,
    )

    assert result == {"documents": []}
    assert [call["filters"] for call in retriever.calls] == [PROJECT_FILTER]


@pytest.mark.asyncio
async def test_historical_question_count_stays_project_scoped_when_project_has_no_documents():
    store = StoreSpy(count=0)

    count = await historical_question_retrieval.count_documents(
        store,
        project_id="project-a",
    )

    assert count == 0
    assert store.filters == [PROJECT_FILTER]


@pytest.mark.asyncio
async def test_historical_question_retrieval_does_not_fall_back_to_global_documents():
    retriever = RetrieverSpy()

    result = await historical_question_retrieval.retrieval(
        {"embedding": [0.1]},
        project_id="project-a",
        view_questions_retriever=retriever,
    )

    assert result == {"documents": []}
    assert [call["filters"] for call in retriever.calls] == [PROJECT_FILTER]


@pytest.mark.asyncio
async def test_instruction_count_stays_project_scoped_when_project_has_no_documents():
    store = StoreSpy(count=0)

    count = await instructions.count_documents(store, project_id="project-a")

    assert count == 0
    assert store.filters == [PROJECT_FILTER]


@pytest.mark.asyncio
async def test_instruction_retrieval_does_not_fall_back_to_global_documents():
    retriever = RetrieverSpy()

    result = await instructions.retrieval(
        {"embedding": [0.1]},
        project_id="project-a",
        retriever=retriever,
    )

    assert result == {"documents": []}
    assert [call["filters"] for call in retriever.calls] == [
        {
            "operator": "AND",
            "conditions": [
                {"field": "is_default", "operator": "==", "value": False},
                {"field": "project_id", "operator": "==", "value": "project-a"},
            ],
        }
    ]


@pytest.mark.asyncio
async def test_default_instructions_do_not_fall_back_to_global_documents():
    retriever = RetrieverSpy()

    result = await instructions.default_instructions(
        count_documents=1,
        retriever=retriever,
        project_id="project-a",
        scope_filter=instructions.ScopeFilter(),
        scope="sql",
    )

    assert result == {"documents": []}
    assert [call["filters"] for call in retriever.calls] == [
        {
            "operator": "AND",
            "conditions": [
                {"field": "is_default", "operator": "==", "value": True},
                {"field": "project_id", "operator": "==", "value": "project-a"},
            ],
        }
    ]
