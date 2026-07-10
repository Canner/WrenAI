import asyncio
import logging
import sys
from typing import Any, Optional

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.common import clean_up_new_lines
from src.pipelines.generation.utils.sql import (
    construct_instructions,
    construct_semantic_schema_contract,
    sql_generation_reasoning_system_prompt,
)
from src.utils import trace_cost
from src.web.v1.services import Configuration

logger = logging.getLogger("wren-ai-service")


sql_generation_reasoning_user_prompt_template = """
### ACTIVE DATASOURCE METADATA ###
This is the complete deployed metadata for the active datasource, including schema,
tables, columns, metrics, views, and relationships. Use only this metadata when
planning SQL.
{% for document in documents %}
    {{ document }}
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

### INPUTS ###
User's Question: {{ query }}
Language: {{ language }}
Current Time: {{ current_time }}

{% if semantic_schema_contract %}
### SEMANTIC SCHEMA CONTRACT ###
Use this contract for entities, measures, dimensions, filters, joins, normalized
date ranges, aggregations, sorting, ranking, chart requirements, dashboard
requirements, and analytical intent. If it shows missing or ambiguous requirements,
state that limitation in the plan instead of planning unrelated SQL.
{{ semantic_schema_contract }}
{% endif %}

### PLANNING REQUIREMENTS ###
Build a schema-grounded SQL plan, not example-specific SQL. Resolve synonyms from
table names, column names, descriptions, metadata, metrics, views, foreign keys,
and semantic relationships. Identify the exact business entities, measures,
dimensions, filters, date windows, sort direction, top/bottom limits, joins, and
chart/dashboard requirements needed by the question.
For multi-table questions, choose a trusted join path from foreign keys or semantic
relationships and include the join keys. If no path exists, say clarification or
schema support is required.
Resolve relative dates such as today, yesterday, this/last week, this/last month,
this/last quarter, this/last year, last 30 days, last 90 days, and rolling 12
months against Current Time.
Infer aggregation from language: total/sum -> SUM for measures, average -> AVG,
number/count/how many -> COUNT, min/max -> MIN/MAX, top/bottom/highest/lowest ->
ORDER BY with a limit.
Plan only required columns. Avoid SELECT *. Preserve conversational context for
follow-up wording and apply only the requested change.

Let's think step by step.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    query: str,
    documents: list[str],
    sql_samples: list[dict],
    instructions: list[dict],
    prompt_builder: PromptBuilder,
    configuration: Configuration | None = Configuration(),
    schema_intent_analysis: dict[str, Any] | None = None,
) -> dict:
    _prompt = prompt_builder.run(
        query=query,
        documents=documents,
        sql_samples=sql_samples,
        instructions=construct_instructions(
            instructions=instructions,
        ),
        language=configuration.language,
        current_time=configuration.show_current_time(),
        semantic_schema_contract=construct_semantic_schema_contract(
            schema_intent_analysis
        ),
    )
    return {"prompt": clean_up_new_lines(_prompt.get("prompt"))}


@observe(as_type="generation", capture_input=False)
@trace_cost
async def generate_sql_reasoning(
    prompt: dict, generator: Any, query_id: str, generator_name: str
) -> dict:
    return await generator(
        prompt=prompt.get("prompt"), query_id=query_id
    ), generator_name


@observe()
def post_process(
    generate_sql_reasoning: dict,
) -> dict:
    return generate_sql_reasoning.get("replies")[0]


## End of Pipeline


class SQLGenerationReasoning(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **kwargs,
    ):
        self._user_queues = {}
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=sql_generation_reasoning_system_prompt,
                streaming_callback=self._streaming_callback,
            ),
            "generator_name": llm_provider.get_model(),
            "prompt_builder": PromptBuilder(
                template=sql_generation_reasoning_user_prompt_template
            ),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def _streaming_callback(self, chunk, query_id):
        if query_id not in self._user_queues:
            self._user_queues[query_id] = asyncio.Queue()

        # Put the chunk content into the user's queue
        asyncio.create_task(self._user_queues[query_id].put(chunk.content))
        if chunk.meta.get("finish_reason"):
            asyncio.create_task(self._user_queues[query_id].put("<DONE>"))

    async def get_streaming_results(self, query_id):
        async def _get_streaming_results(query_id):
            return await self._user_queues[query_id].get()

        if query_id not in self._user_queues:
            self._user_queues[query_id] = asyncio.Queue()

        while True:
            try:
                # Wait for an item from the user's queue
                self._streaming_results = await asyncio.wait_for(
                    _get_streaming_results(query_id), timeout=120
                )
                if (
                    self._streaming_results == "<DONE>"
                ):  # Check for end-of-stream signal
                    del self._user_queues[query_id]
                    break
                if self._streaming_results:  # Check if there are results to yield
                    yield self._streaming_results
                    self._streaming_results = ""  # Clear after yielding
            except TimeoutError:
                break

    @observe(name="SQL Generation Reasoning")
    async def run(
        self,
        query: str,
        contexts: list[str],
        sql_samples: Optional[list[dict]] = None,
        instructions: Optional[list[str]] = None,
        configuration: Configuration = Configuration(),
        query_id: Optional[str] = None,
        schema_intent_analysis: dict[str, Any] | None = None,
    ):
        logger.info("SQL Generation Reasoning pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "documents": contexts,
                "sql_samples": sql_samples or [],
                "instructions": instructions or [],
                "configuration": configuration,
                "query_id": query_id,
                "schema_intent_analysis": schema_intent_analysis,
                **self._components,
            },
        )
