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
from src.pipelines.generation.utils.sql import (
    construct_ask_history_messages,
    construct_instructions,
)
from src.web.v1.services import Configuration
from src.web.v1.services.ask import AskHistory

logger = logging.getLogger("wren-ai-service")


intent_classification_system_prompt = """
### Task ###
You are an expert detective specializing in intent classification. Use the user's current question and query history to determine their true intent based on the provided database schema. Classify the intent into one of these categories: `MISLEADING_QUERY`, `TEXT_TO_SQL`, `GENERAL`, or `USER_GUIDE`. Additionally, provide a concise reasoning (maximum 20 words) for your classification.

### Instructions ###
- **Consider Both Inputs:** Analyze both the user's current question and their query history together.
- **Concise Reasoning:** The reasoning must be clear, concise, and limited to 20 words.
- **Language Consistency:** Use the same language as specified in the user's output language.
- **Vague Queries:** If the question is vague or does not specify a table or property from the schema, classify it as `MISLEADING_QUERY`.

### Intent Definitions ###

<TEXT_TO_SQL>
**When to Use:**  
- The user's question is related to the database schema and requires an SQL query.
- The question (or related previous query) includes references to specific tables, columns, or data details.

**Requirements:**  
- Include specific table and column names from the schema in your reasoning.
- Reference phrases from the user's question that clearly relate to the schema.

**Examples:**  
- "What is the total sales for last quarter?"
- "Show me all customers who purchased product X."
- "List the top 10 products by revenue."
</TEXT_TO_SQL>

<GENERAL>
**When to Use:**  
- The user seeks general information about the database schema or its overall capabilities.
- The combined queries do not provide enough detail to generate a specific SQL query.

**Requirements:**  
- Highlight phrases from the user's question that indicate a general inquiry not tied to specific schema details.

**Examples:**  
- "What is the dataset about?"
- "Tell me more about the database."
- "How can I analyze customer behavior with this data?"
</GENERAL>

<USER_GUIDE>
**When to Use:**  
- The user's question pertains to Wren AI's features, usage, or capabilities.
- The query relates directly to content in the user guide.

**Examples:**  
- "What can Wren AI do?"
- "How can I reset a project?"
- "How can I delete a project?"
- "How can I connect to other databases?"
- "How do I draw a chart?"
</USER_GUIDE>

<MISLEADING_QUERY>
**When to Use:**  
- The user's question is irrelevant to the database schema or includes SQL code.
- The question lacks specific details (like table names or columns) needed to generate an SQL query.
- It appears off-topic or is simply a casual conversation starter.

**Requirements:**  
- Incorporate phrases from the user's question that indicate the lack of relevance to the database schema.

**Examples:**  
- "How are you?"
- "What's the weather like today?"
- "Tell me a joke."
</MISLEADING_QUERY>

### Output Format ###
Return your response as a JSON object with the following structure:

{
  "reasoning": "<brief chain-of-thought reasoning (max 20 words)>",
  "results": "MISLEADING_QUERY" | "TEXT_TO_SQL" | "GENERAL" | "USER_GUIDE"
}
"""

intent_classification_user_prompt_template = """
### DATABASE SCHEMA ###
{% for db_schema in db_schemas %}
    {{ db_schema }}
{% endfor %}

{% if sql_samples %}
### SQL SAMPLES ###
{% for sql_sample in sql_samples %}
Question:
{{sql_sample.question}}
SQL:
{{sql_sample.sql}}
{% endfor %}
{% endif %}

{% if instructions %}
### INSTRUCTIONS ###
{{ instructions }}
{% endif %}

### USER GUIDE ###
{% for doc in docs %}
- {{doc.path}}: {{doc.content}}
{% endfor %}

### INPUT ###
User's question: {{query}}
Current Time: {{ current_time }}
Output Language: {{ language }}

Let's think step by step
"""


## Start of Pipeline
@observe(capture_input=False, capture_output=False)
async def embedding(query: str, embedder: Any, histories: list[AskHistory]) -> dict:
    previous_query_summaries = (
        [history.question for history in histories] if histories else []
    )

    query = "\n".join(previous_query_summaries) + "\n" + query

    return await embedder.run(query)


@observe(capture_input=False)
async def table_retrieval(
    embedding: dict, project_id: str, table_retriever: Any
) -> dict:
    filters = {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_DESCRIPTION"},
        ],
    }

    if project_id:
        filters["conditions"].append(
            {"field": "project_id", "operator": "==", "value": project_id}
        )

    return await table_retriever.run(
        query_embedding=embedding.get("embedding"),
        filters=filters,
    )


@observe(capture_input=False)
async def dbschema_retrieval(
    table_retrieval: dict, embedding: dict, project_id: str, dbschema_retriever: Any
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

    if project_id:
        filters["conditions"].append(
            {"field": "project_id", "operator": "==", "value": project_id}
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
    wren_ai_docs: list[dict],
    construct_db_schemas: list[str],
    prompt_builder: PromptBuilder,
    sql_samples: Optional[list[dict]] = None,
    instructions: Optional[list[dict]] = None,
    configuration: Configuration | None = None,
) -> dict:
    return prompt_builder.run(
        query=query,
        language=configuration.language,
        db_schemas=construct_db_schemas,
        sql_samples=sql_samples,
        instructions=construct_instructions(
            instructions=instructions,
            configuration=configuration,
        ),
        current_time=configuration.show_current_time(),
        docs=wren_ai_docs,
    )


@observe(as_type="generation", capture_input=False)
async def classify_intent(
    prompt: dict, histories: list[AskHistory], generator: Any
) -> dict:
    history_messages = construct_ask_history_messages(histories)

    return await generator(
        prompt=prompt.get("prompt"), history_messages=history_messages
    )


@observe(capture_input=False)
def post_process(classify_intent: dict, construct_db_schemas: list[str]) -> dict:
    try:
        results = orjson.loads(classify_intent.get("replies")[0])
        return {
            "intent": results["results"],
            "reasoning": results["reasoning"],
            "db_schemas": construct_db_schemas,
        }
    except Exception:
        return {
            "intent": "TEXT_TO_SQL",
            "reasoning": "",
            "db_schemas": construct_db_schemas,
        }


## End of Pipeline


class IntentClassificationResult(BaseModel):
    results: Literal["MISLEADING_QUERY", "TEXT_TO_SQL", "GENERAL", "USER_GUIDE"]
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
        wren_ai_docs: list[dict],
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

        self._configs = {
            "wren_ai_docs": wren_ai_docs,
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Intent Classification")
    async def run(
        self,
        query: str,
        project_id: Optional[str] = None,
        histories: Optional[list[AskHistory]] = None,
        sql_samples: Optional[list[dict]] = None,
        instructions: Optional[list[dict]] = None,
        configuration: Configuration = Configuration(),
    ):
        logger.info("Intent Classification pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "project_id": project_id or "",
                "histories": histories or [],
                "sql_samples": sql_samples or [],
                "instructions": instructions or [],
                "configuration": configuration,
                **self._components,
                **self._configs,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        IntentClassification,
        "intent_classification",
        query="show me the dataset",
    )
