import logging
import sys
from typing import Any, Literal, Optional

import orjson
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider, EmbedderProvider, LLMProvider
from src.pipelines.common import clean_up_new_lines
from src.pipelines.generation.utils.sql import construct_instructions
from src.utils import trace_cost
from src.web.v1.services import Configuration
from src.web.v1.services.ask import AskHistory

logger = logging.getLogger("wren-ai-service")


intent_classification_system_prompt = """
### Task ###
You are an expert detective specializing in intent classification. Combine the user's current question and previous questions to determine their true intent based on the provided database schema or sql data if provided.
Classify the intent into one of these categories: `MISLEADING_QUERY`, `TEXT_TO_SQL`, `DATA_EXPLORATION`, `GENERAL`, `USER_GUIDE`, or `USER_CLARIFICATION`. Additionally, provide a concise reasoning (maximum 20 words) for your classification.

### Instructions ###
- **Follow the user's previous questions:** If there are previous questions, try to understand the user's current question as following the previous questions.
- **Follow the user's instructions:** If there are instructions, strictly follow the instructions.
- **Consider Context of Inputs:** Combine the user's current question, their previous questions, and the user's instructions together to identify the user's true intent.
- **Rephrase Question:** Rewrite follow-up questions into full standalone questions using prior conversation context.
- **Concise Reasoning:** The reasoning must be clear, concise, and limited to 20 words.
- **Language Consistency:** Use the same language as specified in the user's output language for the rephrased question and reasoning.
- **Vague Queries:** If the question does not related to the database schema, classify it as `MISLEADING_QUERY`.
- **User Clarification:** If the question is related to the database schema, but missing some details in order to answer the question, classify it as `USER_CLARIFICATION`.
- **Incomplete Queries:** If the question is related to the database schema but references unspecified values (e.g., "the following", "these", "those") without providing them, classify as `USER_CLARIFICATION`.
- **Time-related Queries:** Don't rephrase time-related information in the user's question.

### Intent Definitions ###

<DATA_EXPLORATION>
**When to Use:**
- The user's question is about data exploration such as asking for data details, asking for explanation of the data, asking for insights, asking for recommendations, asking for comparison, etc.
**Requirements:**
- SQL DATA is provided and the user's question is about exploring the data.
- The user's question can be answered by the SQL DATA.
- The row size of the SQL DATA is less than 500.
**Examples:**  
- "Show me the part where the data appears abnormal"
- "Please explain the data in the table"
- "What's the trend of the data?"
</DATA_EXPLORATION>

<TEXT_TO_SQL>
**When to Use:**  
- The user's inputs are about modifying SQL from previous questions.
- The user's inputs are related to the database schema and requires an SQL query.
- The question (or related previous query) includes references to specific tables, columns, or data details.
- The question includes **complete information** with specific tables, columns, or data values needed for execution.
- The question provides **all necessary parameters** to generate executable SQL.

**Requirements:**
- Must have complete filter criteria, specific values, or clear references to previous context.
- Include specific table and column names from the schema in your reasoning or modifying SQL from previous questions.
- Reference phrases from the user's inputs that clearly relate to the schema.
- The SQL DATA is not provided or SQL DATA cannot answer the user's question, and the user's question can be answered given the database schema.

**Examples:**  
- "What is the total sales for last quarter?"
- "Show me all customers who purchased product X."
- "List the top 10 products by revenue."
</TEXT_TO_SQL>

<USER_CLARIFICATION>
**When to Use:**
- The user's question is related to the database schema, but missing some details in order to answer the question.
- The query references **missing information** (e.g., "the following items" without listing them).
- The query contains **placeholder references** that cannot be resolved from context.
- The query is **incomplete for SQL generation** despite mentioning database concepts.

**Requirements:**  
- Incorporate phrases from the user's inputs that indicate incompleteness or lack of relevance to the database schema.
- Identify missing parameters, unspecified references, or incomplete filter criteria.

**Examples:**
- "How can I analyze customer behavior with this data?"
- "Show me orders for these products" (without specifying which products)
- "Filter by the criteria I mentioned" (without previous context defining criteria)
</USER_CLARIFICATION>

<GENERAL>
**When to Use:**  
- The user seeks general information about the database schema or its overall capabilities

**Examples:**
- "What is the dataset about?"
- "Tell me more about the database."
</GENERAL>

<USER_GUIDE>
**When to Use:**  
- The user's inputs pertains to Wren AI's features, usage, or capabilities.
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
- The user's inputs is irrelevant to the database schema or includes SQL code.
- The user's inputs lacks specific details (like table names or columns) needed to generate an SQL query.
- It appears off-topic or is simply a casual conversation starter.

**Requirements:**  
- Incorporate phrases from the user's inputs that indicate lack of relevance to the database schema.

**Examples:**  
- "How are you?"
- "What's the weather like today?"
- "Tell me a joke."
</MISLEADING_QUERY>

### Output Format ###
Return your response as a JSON object with the following structure:

{
    "rephrased_question": "<rephrased question in full standalone question if there are previous questions, otherwise the original question>",
    "reasoning": "<brief chain-of-thought reasoning (max 20 words)>",
    "results": "MISLEADING_QUERY" | "TEXT_TO_SQL" | "DATA_EXPLORATION" | "GENERAL" | "USER_GUIDE" | "USER_CLARIFICATION"
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
### USER INSTRUCTIONS ###
{% for instruction in instructions %}
{{ loop.index }}. {{ instruction }}
{% endfor %}
{% endif %}

### USER GUIDE ###
{% for doc in docs %}
- {{doc.path}}: {{doc.content}}
{% endfor %}

{% if sql_data %}
### SQL DATA ###
{{ sql_data }}
row size of SQL DATA: {{ sql_data_size }}
{% endif %}

### INPUT ###
{% if histories %}
User's previous questions:
{% for history in histories %}
Question:
{{ history.question }}
Response:
{{ history.response }}
{% endfor %}
{% endif %}

User's current question: {{query}}
Output Language: {{ language }}

Let's think step by step
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    query: str,
    wren_ai_docs: list[dict],
    db_schemas: list[str],
    histories: list[AskHistory],
    prompt_builder: PromptBuilder,
    sql_samples: Optional[list[dict]] = None,
    instructions: Optional[list[dict]] = None,
    configuration: Configuration | None = None,
    sql_data: Optional[dict] = None,
) -> dict:
    _prompt = prompt_builder.run(
        query=query,
        language=configuration.language,
        db_schemas=db_schemas,
        histories=histories,
        sql_samples=sql_samples,
        instructions=construct_instructions(
            instructions=instructions,
        ),
        docs=wren_ai_docs,
        sql_data=sql_data,
        sql_data_size=len(sql_data.get("data", [])),
    )
    return {"prompt": clean_up_new_lines(_prompt.get("prompt"))}


@observe(as_type="generation", capture_input=False)
@trace_cost
async def classify_intent(prompt: dict, generator: Any, generator_name: str) -> dict:
    return await generator(prompt=prompt.get("prompt")), generator_name


@observe(capture_input=False)
def post_process(classify_intent: dict) -> dict:
    try:
        results = orjson.loads(classify_intent.get("replies")[0])
        return {
            "rephrased_question": results["rephrased_question"],
            "intent": results["results"],
            "reasoning": results["reasoning"],
        }
    except Exception:
        return {
            "rephrased_question": "",
            "intent": "TEXT_TO_SQL",
            "reasoning": "",
        }


## End of Pipeline


class IntentClassificationResult(BaseModel):
    rephrased_question: str
    results: Literal[
        "MISLEADING_QUERY",
        "TEXT_TO_SQL",
        "GENERAL",
        "DATA_EXPLORATION",
        "USER_GUIDE",
        "USER_CLARIFICATION",
    ]
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
            "generator_name": llm_provider.get_model(),
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
        db_schemas: list[str],
        project_id: Optional[str] = None,
        histories: Optional[list[AskHistory]] = None,
        sql_samples: Optional[list[dict]] = None,
        instructions: Optional[list[dict]] = None,
        configuration: Configuration = Configuration(),
        sql_data: Optional[dict] = None,
    ):
        logger.info("Intent Classification pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "db_schemas": db_schemas,
                "project_id": project_id or "",
                "histories": histories or [],
                "sql_samples": sql_samples or [],
                "instructions": instructions or [],
                "configuration": configuration,
                "sql_data": sql_data or {},
                **self._components,
                **self._configs,
            },
        )
