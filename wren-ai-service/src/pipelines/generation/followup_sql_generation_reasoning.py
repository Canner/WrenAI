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
    sql_generation_reasoning_system_prompt,
)
from src.utils import trace_cost
from src.web.v1.services import Configuration
from src.web.v1.services.ask import AskHistory

logger = logging.getLogger("wren-ai-service")


sql_generation_reasoning_user_prompt_template = """
### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document }}
{% endfor %}

{% if schema_grounding %}
### RETRIEVED EXECUTABLE SCHEMA ###
The following identifiers come from Ask Retrieval for this question. Use these exact model/table and column names when planning SQL.
{{ schema_grounding }}
{% endif %}

{% if sql_samples %}
### SQL SAMPLES ###
These samples are confirmed question examples for this project deployment. Use them to understand intent and style only.
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

### User's QUERY HISTORY ###
{% for history in histories %}
Question:
{{ history.question }}
SQL:
{{ history.sql }}
{% endfor %}

### QUESTION ###
User's Question: {{ query }}
Language: {{ language }}
Current Time: {{ current_time }}

Let's think step by step.
When the user uses a business term, map it only to an identifier listed in DATABASE SCHEMA or RETRIEVED EXECUTABLE SCHEMA. Do not turn a user word into a table or column name unless it is listed there.
Use SQL sample questions and query history questions only as intent examples. Do not copy from the user's wording as an identifier unless it is listed in DATABASE SCHEMA or RETRIEVED EXECUTABLE SCHEMA.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    query: str,
    documents: list[str],
    histories: list[AskHistory],
    sql_samples: list[dict],
    instructions: list[dict],
    prompt_builder: PromptBuilder,
    schema_grounding: str | None = None,
    configuration: Configuration | None = Configuration(),
) -> dict:
    _prompt = prompt_builder.run(
        query=query,
        documents=documents,
        schema_grounding=schema_grounding,
        histories=histories,
        sql_samples=sql_samples,
        instructions=construct_instructions(
            instructions=instructions,
        ),
        language=configuration.language,
        current_time=configuration.show_current_time(),
    )
    return {"prompt": clean_up_new_lines(_prompt.get("prompt"))}


@observe(as_type="generation", capture_input=False)
@trace_cost
async def generate_sql_reasoning(
    prompt: dict,
    generator: Any,
    query_id: str,
    generator_name: str,
) -> dict:
    return await generator(
        prompt=prompt.get("prompt"),
        query_id=query_id,
    ), generator_name


@observe()
def post_process(
    generate_sql_reasoning: dict,
) -> dict:
    return generate_sql_reasoning.get("replies")[0]


## End of Pipeline


class FollowUpSQLGenerationReasoning(BasicPipeline):
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

    @observe(name="FollowupSQL Generation Reasoning")
    async def run(
        self,
        query: str,
        contexts: list[str],
        histories: list[AskHistory],
        sql_samples: Optional[list[dict]] = None,
        instructions: Optional[list[dict]] = None,
        schema_grounding: str | None = None,
        configuration: Configuration = Configuration(),
        query_id: Optional[str] = None,
    ):
        logger.info("Followup SQL Generation Reasoning pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "documents": contexts,
                "schema_grounding": schema_grounding,
                "histories": histories,
                "sql_samples": sql_samples or [],
                "instructions": instructions or [],
                "configuration": configuration,
                "query_id": query_id,
                **self._components,
            },
        )
