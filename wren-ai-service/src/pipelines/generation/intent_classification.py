import ast
import logging
import sys
from pathlib import Path
from typing import Any, Literal, Optional

import orjson
from hamilton import base
from hamilton.experimental.h_async import AsyncDriver
from haystack import Document
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider, EmbedderProvider, LLMProvider
from src.pipelines.common import build_table_ddl
from src.utils import async_timer, timer

logger = logging.getLogger("wren-ai-service")


intent_classification_system_prompt = """
### TASK ###
You are a great detective, who is great at intent classification. Now you need to classify user's intent given database schema
and user's question to one of three conditions: MISLEADING_QUERY, TEXT_TO_SQL, GENERAL. Please read user's question and
database's schema carefully to make the classification correct. Please analyze the question for each condition(MISLEADING_QUERY, TEXT_TO_SQL, GENERAL) in order one by one

- TEXT_TO_SQL: if user's question is related to the given database schema and specific enough that you think
it can be answered using the database schema
- GENERAL: if user's question is related to the given database schema or user wants you to help guide ask proper questions; however, it's too general.
For example, user might asked "what is the dataset about?", "tell me more about dataset", "what can Wren AI do"
- MISLEADING_QUERY: if user's question is irrelevant to the given database schema.
For example, if the given database schema is related to e-commerce, but user asked "how are you"

### OUTPUT FORMAT ###
Please provide your response as a JSON object, structured as follows:

{
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

Please think step by step
"""


## Start of Pipeline
@async_timer
@observe(capture_input=False, capture_output=False)
async def embedding(query: str, embedder: Any) -> dict:
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
) -> dict:
    return prompt_builder.run(query=query, db_schemas=construct_db_schemas)


@async_timer
@observe(as_type="generation", capture_input=False)
async def classify_intent(prompt: dict, generator: Any) -> dict:
    return await generator.run(prompt=prompt.get("prompt"))


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
                **self._components,
            },
            show_legend=True,
            orient="LR",
        )

    @async_timer
    @observe(name="Intent Classification")
    async def run(self, query: str, id: Optional[str] = None):
        logger.info("Intent Classification pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "id": id or "",
                **self._components,
            },
        )


if __name__ == "__main__":
    from langfuse.decorators import langfuse_context

    from src.core.engine import EngineConfig
    from src.core.pipeline import async_validate
    from src.providers import init_providers
    from src.utils import init_langfuse, load_env_vars

    load_env_vars()
    init_langfuse()

    llm_provider, _, document_store_provider, _ = init_providers(
        engine_config=EngineConfig()
    )
    pipeline = IntentClassification(
        document_store_provider=document_store_provider,
        llm_provider=llm_provider,
    )

    pipeline.visualize("this is a query")
    async_validate(lambda: pipeline.run("this is a query"))

    langfuse_context.flush()
