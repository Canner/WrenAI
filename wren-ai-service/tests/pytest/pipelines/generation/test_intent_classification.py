import pytest
from haystack import Document

from src.pipelines.generation.intent_classification import (
    dbschema_retrieval,
    table_retrieval,
)


class CapturingRetriever:
    def __init__(self, documents=None):
        self.documents = documents or []
        self.calls = []

    async def run(self, **kwargs):
        self.calls.append(kwargs)
        return {"documents": self.documents}


@pytest.mark.asyncio
async def test_intent_table_retrieval_uses_legacy_project_scope_with_mdl_hash():
    retriever = CapturingRetriever()

    await table_retrieval(
        embedding={"embedding": [0.1, 0.2]},
        project_id="project-1",
        mdl_hash="deploy-1",
        table_retriever=retriever,
    )

    assert retriever.calls[0]["filters"] == {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_DESCRIPTION"},
            {"field": "project_id", "operator": "==", "value": "project-1"},
        ],
    }


@pytest.mark.asyncio
async def test_intent_dbschema_retrieval_uses_legacy_project_scope_with_mdl_hash():
    retriever = CapturingRetriever()

    await dbschema_retrieval(
        table_retrieval={
            "documents": [
                Document(content=str({"name": "orders"}), meta={"name": "orders"})
            ]
        },
        embedding={"embedding": [0.1, 0.2]},
        project_id="project-1",
        mdl_hash="deploy-1",
        dbschema_retriever=retriever,
    )

    assert retriever.calls[0]["filters"] == {
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
