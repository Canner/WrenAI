import ast
import logging
import sys
from pathlib import Path
from typing import Any, Literal, Optional

import orjson
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack import Document
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider, EmbedderProvider, LLMProvider
from src.pipelines.common import build_table_ddl
from src.utils import async_timer, timer
from src.web.v1.services.ask import AskHistory

logger = logging.getLogger("wren-ai-service")


intent_classification_system_prompt = """
### TASK ###
You are a great detective, who is great at intent classification. Now you need to classify user's intent based on given database schema and user's question to one of three conditions: MISLEADING_QUERY, TEXT_TO_SQL, GENERAL. 
Please carefully analyze user's question and analyze database's schema carefully to make the classification correct.
Also you should provide reasoning for the classification in clear and concise way within 20 words.

- TEXT_TO_SQL
    - When to Use: Select this category if the user's question is directly related to the given database schema and can be answered by generating an SQL query using that schema.
    - Characteristics:
        - The question involves specific data retrieval or manipulation that requires SQL.
        - It references tables, columns, or specific data points within the schema.
    - Examples:
        - "What is the total sales for last quarter?"
        - "Show me all customers who purchased product X."
        - "List the top 10 products by revenue."
- MISLEADING_QUERY
    - When to Use: Choose this category if the user's question is irrelevant to the given database schema and cannot be answered using SQL with that schema.
    - Characteristics:
        - The question does not pertain to any aspect of the database or its data.
        - It might be a casual conversation starter or about an entirely different topic.
    - Examples:
        - "How are you?"
        - "What's the weather like today?"
        - "Tell me a joke."
- GENERAL
    - When to Use: Use this category if the user is seeking general information about the database schema, needs help formulating a proper question, or asks a vague question related to the schema.
    - Characteristics:
        - The question is about understanding the dataset or its capabilities.
        - The user may need guidance on how to proceed or what questions to ask.
    - Examples:
        - "What is the dataset about?"
        - "Tell me more about the database."
        - "What can Wren AI do?"
        - "How can I analyze customer behavior with this data?"

### OUTPUT FORMAT ###
Please provide your response as a JSON object, structured as follows:

{
    "reasoning": "<CHAIN_OF_THOUGHT_REASONING_IN_STRING_FORMAT>",
    "results": "MISLEADING_QUERY" | "TEXT_TO_SQL" | "GENERAL"
}
"""

intent_classification_user_prompt_template = """
### DATABASE SCHEMA ###
{% for db_schema in db_schemas %}
    {{ db_schema }}
{% endfor %}

### INPUT ###
User's question: {{query}}

Let's think step by step
"""


## Start of Pipeline
@async_timer
@observe(capture_input=False, capture_output=False)
async def embedding(
    query: str, embedder: Any, history: Optional[AskHistory] = None
) -> dict:
    if history:
        previous_query_summaries = [
            step.summary for step in history.steps if step.summary
        ]
    else:
        previous_query_summaries = []

    query = "\n".join(previous_query_summaries) + "\n" + query

    return await embedder.run(query)


@async_timer
@observe(capture_input=False)
async def table_retrieval(embedding: dict, id: str, table_retriever: Any) -> dict:
    filters = {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_DESCRIPTION"},
        ],
    }

    if id:
        filters["conditions"].append(
            {"field": "project_id", "operator": "==", "value": id}
        )

    return await table_retriever.run(
        query_embedding=embedding.get("embedding"),
        filters=filters,
    )


@async_timer
@observe(capture_input=False)
async def dbschema_retrieval(
    table_retrieval: dict, embedding: dict, id: str, dbschema_retriever: Any
) -> list[Document]:
    tables = table_retrieval.get("documents", [])
    table_names = []
    for table in tables:
        content = ast.literal_eval(table.content)
        table_names.append(content["name"])

    logger.info(f"dbschema_retrieval with table_names: {table_names}")

    table_name_conditions = [
        {"field": "name", "operator": "==", "value": table_name}
        for table_name in table_names
    ]

    filters = {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
            {"operator": "OR", "conditions": table_name_conditions},
        ],
    }

    if id:
        filters["conditions"].append(
            {"field": "project_id", "operator": "==", "value": id}
        )

    results = await dbschema_retriever.run(
        query_embedding=embedding.get("embedding"), filters=filters
    )
    return results["documents"]


@timer
@observe()
def construct_db_schemas(dbschema_retrieval: list[Document]) -> list[str]:
    db_schemas = {}
    for document in dbschema_retrieval:
        content = ast.literal_eval(document.content)
        if content["type"] == "TABLE":
            if document.meta["name"] not in db_schemas:
                db_schemas[document.meta["name"]] = content
            else:
                db_schemas[document.meta["name"]] = {
                    **content,
                    "columns": db_schemas[document.meta["name"]].get("columns", []),
                }
        elif content["type"] == "TABLE_COLUMNS":
            if document.meta["name"] not in db_schemas:
                db_schemas[document.meta["name"]] = {"columns": content["columns"]}
            else:
                if "columns" not in db_schemas[document.meta["name"]]:
                    db_schemas[document.meta["name"]]["columns"] = content["columns"]
                else:
                    db_schemas[document.meta["name"]]["columns"] += content["columns"]

    # remove incomplete schemas
    db_schemas = {k: v for k, v in db_schemas.items() if "type" in v and "columns" in v}

    db_schemas_in_ddl = []
    for table_schema in list(db_schemas.values()):
        if table_schema["type"] == "TABLE":
            db_schemas_in_ddl.append(
                build_table_ddl(
                    table_schema,
                )
            )

    return db_schemas_in_ddl


@timer
@observe(capture_input=False)
def prompt(
    query: str,
    construct_db_schemas: list[str],
    prompt_builder: PromptBuilder,
    history: Optional[AskHistory] = None,
) -> dict:
    if history:
        previous_query_summaries = [
            step.summary for step in history.steps if step.summary
        ]
    else:
        previous_query_summaries = []

    query = "\n".join(previous_query_summaries) + "\n" + query

    return prompt_builder.run(
        query=query,
        db_schemas=construct_db_schemas,
    )


@async_timer
@observe(as_type="generation", capture_input=False)
async def classify_intent(prompt: dict, generator: Any) -> dict:
    return await generator(prompt=prompt.get("prompt"))


@timer
@observe(capture_input=False)
def post_process(classify_intent: dict, construct_db_schemas: list[str]) -> dict:
    try:
        intent = orjson.loads(classify_intent.get("replies")[0])["results"]
        return {
            "intent": intent,
            "db_schemas": construct_db_schemas,
        }
    except Exception:
        return {"intent": "TEXT_TO_SQL", "db_schemas": construct_db_schemas}


## End of Pipeline


class IntentClassificationResult(BaseModel):
    results: Literal["MISLEADING_QUERY", "TEXT_TO_SQL", "GENERAL"]


INTENT_CLASSIFICAION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "intent_classification",
            "schema": IntentClassificationResult.model_json_schema(),
        },
    }
}


class IntentClassification(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        embedder_provider: EmbedderProvider,
        document_store_provider: DocumentStoreProvider,
        table_retrieval_size: Optional[int] = 50,
        table_column_retrieval_size: Optional[int] = 100,
        **kwargs,
    ):
        self._components = {
            "embedder": embedder_provider.get_text_embedder(),
            "table_retriever": document_store_provider.get_retriever(
                document_store_provider.get_store(dataset_name="table_descriptions"),
                top_k=table_retrieval_size,
            ),
            "dbschema_retriever": document_store_provider.get_retriever(
                document_store_provider.get_store(),
                top_k=table_column_retrieval_size,
            ),
            "generator": llm_provider.get_generator(
                system_prompt=intent_classification_system_prompt,
                generation_kwargs=INTENT_CLASSIFICAION_MODEL_KWARGS,
            ),
            "prompt_builder": PromptBuilder(
                template=intent_classification_user_prompt_template
            ),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def visualize(
        self,
        query: str,
        id: Optional[str] = None,
        history: Optional[AskHistory] = None,
    ) -> None:
        destination = "outputs/pipelines/generation"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            ["post_process"],
            output_file_path=f"{destination}/intent_classification.dot",
            inputs={
                "query": query,
                "id": id or "",
                "history": history,
                **self._components,
            },
            show_legend=True,
            orient="LR",
        )

    @async_timer
    @observe(name="Intent Classification")
    async def run(
        self, query: str, id: Optional[str] = None, history: Optional[AskHistory] = None
    ):
        logger.info("Intent Classification pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "id": id or "",
                "history": history,
                **self._components,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        IntentClassification,
        "intent_classification",
        query="show me the dataset",
    )
