import pytest
from haystack import Document
from haystack.components.builders.prompt_builder import PromptBuilder

from src.pipelines.generation.intent_classification import (
    INTENT_CLASSIFICAION_MODEL_KWARGS,
    dbschema_retrieval,
    intent_classification_user_prompt_template,
    prompt,
    table_retrieval,
)
from src.web.v1.services import Configuration


class CapturingRetriever:
    def __init__(self, documents=None):
        self.documents = documents or []
        self.calls = []

    async def run(self, **kwargs):
        self.calls.append(kwargs)
        return {"documents": self.documents}


TEST_PROJECT_ID = "test-project-id"
TEST_MDL_HASH = "test-mdl-hash"
TEST_SCHEMA_DDL = "CREATE TABLE test_model (test_column VARCHAR)"


def test_intent_prompt_includes_deployment_scope_and_rephrase_instruction():
    result = prompt(
        query="show matching records",
        wren_ai_docs=[],
        construct_db_schemas=[TEST_SCHEMA_DDL],
        histories=[],
        sql_samples=[],
        instructions=[],
        project_id=TEST_PROJECT_ID,
        mdl_hash=TEST_MDL_HASH,
        configuration=Configuration(language="English"),
        prompt_builder=PromptBuilder(
            template=intent_classification_user_prompt_template
        ),
    )

    built_prompt = result["prompt"]

    assert f"Project ID: {TEST_PROJECT_ID}" in built_prompt
    assert f"MDL Hash: {TEST_MDL_HASH}" in built_prompt
    assert TEST_SCHEMA_DDL in built_prompt
    assert "Return the structured intent classification response." in built_prompt


def test_intent_model_kwargs_preserve_strict_json_schema():
    json_schema = INTENT_CLASSIFICAION_MODEL_KWARGS["response_format"][
        "json_schema"
    ]

    assert INTENT_CLASSIFICAION_MODEL_KWARGS["preserve_json_schema"] is True
    assert json_schema["strict"] is True
    assert json_schema["schema"]["additionalProperties"] is False


@pytest.mark.asyncio
async def test_intent_table_retrieval_uses_deployment_scope_with_mdl_hash():
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


@pytest.mark.asyncio
async def test_intent_dbschema_retrieval_uses_deployment_scope_with_mdl_hash():
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
