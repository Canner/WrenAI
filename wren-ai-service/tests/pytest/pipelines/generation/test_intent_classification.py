import pytest
from haystack import Document

from src.pipelines.generation.intent_classification import (
    dbschema_retrieval,
    post_process,
    should_force_text_to_sql_intent,
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
async def test_intent_table_retrieval_scopes_to_deployed_mdl_hash():
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
            {"field": "mdl_hash", "operator": "==", "value": "deploy-1"},
        ],
    }


def test_intent_override_keeps_data_questions_in_text_to_sql():
    assert should_force_text_to_sql_intent(
        "show orders placed from the country france",
        "GENERAL",
        ["table: orders"],
    )


def test_intent_override_does_not_force_user_guide_questions():
    assert not should_force_text_to_sql_intent(
        "How do I draw a chart?",
        "GENERAL",
        ["table: orders"],
    )


def test_intent_post_process_overrides_general_for_data_question():
    result = post_process(
        {
            "replies": [
                (
                    '{"rephrased_question":"show orders placed from the country france",'
                    '"reasoning":"asks for database records",'
                    '"results":"GENERAL"}'
                )
            ]
        },
        ["table: orders"],
        "show orders placed from the country france",
    )

    assert result["intent"] == "TEXT_TO_SQL"


@pytest.mark.asyncio
async def test_intent_dbschema_retrieval_scopes_to_deployed_mdl_hash():
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
            {"field": "mdl_hash", "operator": "==", "value": "deploy-1"},
        ],
    }
