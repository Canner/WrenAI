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

logger = logging.getLogger("wren-ai-service")


sql_generation_reasoning_user_prompt_template = """
### DATABASE SCHEMA ###
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
        description: str = "",
        **kwargs,
    ):
        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

        self._user_queues = {}
        self._llm_provider = llm_provider
        self._description = description
        self._components = self._update_components()

    def _update_components(self):
        return {
            "generator": self._llm_provider.get_generator(
                system_prompt=sql_generation_reasoning_system_prompt,
                streaming_callback=self._streaming_callback,
            ),
            "generator_name": self._llm_provider.get_model(),
            "prompt_builder": PromptBuilder(
                template=sql_generation_reasoning_user_prompt_template
            ),
        }

    def update_llm_provider(self, llm_provider: LLMProvider):
        self._llm_provider = llm_provider
        self._components = self._update_components()

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
                **self._components,
            },
        )
