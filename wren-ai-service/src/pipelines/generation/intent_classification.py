import ast
import logging
import sys
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
from src.web.v1.services import Configuration
from src.web.v1.services.ask import AskHistory

logger = logging.getLogger("wren-ai-service")


intent_classification_system_prompt = """
### TASK ###
You are a great detective, who is great at intent classification.
First, rephrase the user's question to make it more specific, clear and relevant to the database schema before making the intent classification.
Second, you need to use rephrased user's question to classify user's intent based on given database schema to one of three conditions: MISLEADING_QUERY, TEXT_TO_SQL, GENERAL. 
Also you should provide reasoning for the classification clearly and concisely within 20 words.

### INSTRUCTIONS ###
- Steps to rephrase the user's question:
    - First, try to recognize adjectives in the user's question that are important to the user's intent.
    - Second, change the adjectives to more specific and clear ones that can be matched to columns in the database schema.
    - Third, if the user's question is related to time/date, take the current time into consideration and add time/date format(such as YYYY-MM-DD) in the rephrased_question output.
- MUST use the rephrased user's question to make the intent classification.
- MUST put the rephrased user's question in the rephrased_question output.
- REASONING MUST be within 20 words.
- If the rephrased user's question is vague and doesn't specify which table or property to analyze, classify it as MISLEADING_QUERY.

### INTENT DEFINITIONS ###
- TEXT_TO_SQL
    - When to Use:
        - Select this category if the user's question is directly related to the given database schema and can be answered by generating an SQL query using that schema.
        - If the rephrasedd user's question is related to the previous question, and considering them together could be answered by generating an SQL query using that schema.
    - Characteristics:
        - The rephrasedd user's question involves specific data retrieval or manipulation that requires SQL.
        - The rephrasedd user's question references tables, columns, or specific data points within the schema.
    - Instructions:
        - MUST include table and column names that should be used in the SQL query according to the database schema in the reasoning output.
        - MUST include phrases from the user's question that are explicitly related to the database schema in the reasoning output.
    - Examples:
        - "What is the total sales for last quarter?"
        - "Show me all customers who purchased product X."
        - "List the top 10 products by revenue."
- MISLEADING_QUERY
    - When to Use:
        - If the rephrasedd user's question is irrelevant to the given database schema and cannot be answered using SQL with that schema.
        - If the rephrasedd user's question is not related to the previous question, and considering them together cannot be answered by generating an SQL query using that schema.
        - If the rephrasedd user's question contains SQL code.
    - Characteristics:
        - The rephrasedd user's question does not pertain to any aspect of the database or its data.
        - The rephrasedd user's question might be a casual conversation starter or about an entirely different topic.
        - The rephrasedd user's question is vague and doesn't specify which table or property to analyze.
    - Instructions:
        - MUST explicitly add phrases from the rephrasedd user's question that are not explicitly related to the database schema in the reasoning output. Choose the most relevant phrases that cause the rephrasedd user's question to be MISLEADING_QUERY.
    - Examples:
        - "How are you?"
        - "What's the weather like today?"
        - "Tell me a joke."
- GENERAL
    - When to Use:
        - Use this category if the user is seeking general information about the database schema.
        - If the rephrasedd user's question is related to the previous question, but considering them together cannot be answered by generating an SQL query using that schema.
    - Characteristics:
        - The question is about understanding the dataset or its capabilities.
        - The user may need guidance on how to proceed or what questions to ask.
    - Instructions:
        - MUST explicitly add phrases from the rephrasedd user's question that are not explicitly related to the database schema in the reasoning output. Choose the most relevant phrases that cause the rephrasedd user's question to be GENERAL.
    - Examples:
        - "What is the dataset about?"
        - "Tell me more about the database."
        - "What can Wren AI do?"
        - "How can I analyze customer behavior with this data?"

### OUTPUT FORMAT ###
Please provide your response as a JSON object, structured as follows:

{
    "rephrased_question": "<REPHRASED_USER_QUESTION_IN_STRING_FORMAT>",
    "reasoning": "<CHAIN_OF_THOUGHT_REASONING_BASED_ON_REPHRASED_USER_QUESTION_IN_STRING_FORMAT>",
    "results": "MISLEADING_QUERY" | "TEXT_TO_SQL" | "GENERAL"
}
"""

intent_classification_user_prompt_template = """
### DATABASE SCHEMA ###
{% for db_schema in db_schemas %}
    {{ db_schema }}
{% endfor %}

### INPUT ###
{% if query_history %}
User's previous questions: {{ query_history }}
{% endif %}
User's question: {{query}}
Current Time: {{ current_time }}

Let's think step by step
"""


## Start of Pipeline
@observe(capture_input=False, capture_output=False)
async def embedding(
    query: str, embedder: Any, history: Optional[AskHistory] = None
) -> dict:
    previous_query_summaries = (
        [step.summary for step in history.steps if step.summary] if history else []
    )

    query = "\n".join(previous_query_summaries) + "\n" + query

    return await embedder.run(query)


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
            ddl, _ = build_table_ddl(table_schema)
            db_schemas_in_ddl.append(ddl)

    return db_schemas_in_ddl


@observe(capture_input=False)
def prompt(
    query: str,
    construct_db_schemas: list[str],
    prompt_builder: PromptBuilder,
    history: Optional[AskHistory] = None,
    configuration: Configuration | None = None,
) -> dict:
    previous_query_summaries = (
        [step.summary for step in history.steps if step.summary] if history else []
    )

    return prompt_builder.run(
        query=query,
        db_schemas=construct_db_schemas,
        query_history=previous_query_summaries,
        current_time=configuration.show_current_time(),
    )


@observe(as_type="generation", capture_input=False)
async def classify_intent(prompt: dict, generator: Any) -> dict:
    return await generator(prompt=prompt.get("prompt"))


@observe(capture_input=False)
def post_process(classify_intent: dict, construct_db_schemas: list[str]) -> dict:
    try:
        results = orjson.loads(classify_intent.get("replies")[0])
        return {
            "intent": results["results"],
            "rephrased_question": results["rephrased_question"],
            "reasoning": results["reasoning"],
            "db_schemas": construct_db_schemas,
        }
    except Exception:
        return {
            "intent": "TEXT_TO_SQL",
            "rephrased_question": "",
            "reasoning": "",
            "db_schemas": construct_db_schemas,
        }


## End of Pipeline


class IntentClassificationResult(BaseModel):
    results: Literal["MISLEADING_QUERY", "TEXT_TO_SQL", "GENERAL"]
    rephrased_question: str
    reasoning: str


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

    @observe(name="Intent Classification")
    async def run(
        self,
        query: str,
        id: Optional[str] = None,
        history: Optional[AskHistory] = None,
        configuration: Configuration = Configuration(),
    ):
        logger.info("Intent Classification pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "id": id or "",
                "history": history,
                "configuration": configuration,
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
