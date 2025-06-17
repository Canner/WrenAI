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
from src.utils import trace_cost
from src.web.v1.services.ask import AskHistory

logger = logging.getLogger("wren-ai-service")


data_assistance_system_prompt = """
### TASK ###
You are a data analyst great at answering user's questions about given database schema.
Please carefully read user's question and database schema to answer it in easy to understand manner
using the Markdown format. Your goal is to help guide user understand its database!

### INSTRUCTIONS ###

- Answer must be in the same language user specified.
- There should be proper line breaks, whitespace, and Markdown formatting(headers, lists, tables, etc.) in your response.
- If the language is Traditional/Simplified Chinese, Korean, or Japanese, the maximum response length is 150 words; otherwise, the maximum response length is 110 words.
- MUST NOT add SQL code in your response.

### OUTPUT FORMAT ###
Please provide your response in proper Markdown format without ```markdown``` tags.
"""

data_assistance_user_prompt_template = """
### DATABASE SCHEMA ###
{% for db_schema in db_schemas %}
    {{ db_schema }}
{% endfor %}

### INPUT ###
User's question: {{query}}
Language: {{language}}

Please think step by step
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    query: str,
    db_schemas: list[str],
    language: str,
    histories: list[AskHistory],
    prompt_builder: PromptBuilder,
) -> dict:
    previous_query_summaries = (
        [history.question for history in histories] if histories else []
    )
    query = "\n".join(previous_query_summaries) + "\n" + query

    return prompt_builder.run(
        query=query,
        db_schemas=db_schemas,
        language=language,
    )


@observe(as_type="generation", capture_input=False)
@trace_cost
async def data_assistance(
    prompt: dict, generator: Any, query_id: str, generator_name: str
) -> dict:
    return await generator(
        prompt=prompt.get("prompt"),
        query_id=query_id,
    ), generator_name


## End of Pipeline


class DataAssistance(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **kwargs,
    ):
        self._user_queues = {}
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=data_assistance_system_prompt,
                streaming_callback=self._streaming_callback,
            ),
            "generator_name": llm_provider.get_model(),
            "prompt_builder": PromptBuilder(
                template=data_assistance_user_prompt_template
            ),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def _streaming_callback(self, chunk, query_id):
        if query_id not in self._user_queues:
            self._user_queues[
                query_id
            ] = asyncio.Queue()  # Create a new queue for the user if it doesn't exist
        # Put the chunk content into the user's queue
        asyncio.create_task(self._user_queues[query_id].put(chunk.content))
        if chunk.meta.get("finish_reason"):
            asyncio.create_task(self._user_queues[query_id].put("<DONE>"))

    async def get_streaming_results(self, query_id):
        async def _get_streaming_results(query_id):
            return await self._user_queues[query_id].get()

        if query_id not in self._user_queues:
            self._user_queues[
                query_id
            ] = asyncio.Queue()  # Ensure the user's queue exists
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

    @observe(name="Data Assistance")
    async def run(
        self,
        query: str,
        db_schemas: list[str],
        language: str,
        query_id: Optional[str] = None,
        histories: Optional[list[AskHistory]] = None,
    ):
        logger.info("Data Assistance pipeline is running...")
        return await self._pipe.execute(
            ["data_assistance"],
            inputs={
                "query": query,
                "db_schemas": db_schemas,
                "language": language,
                "query_id": query_id or "",
                "histories": histories or [],
                **self._components,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        DataAssistance,
        "data_assistance",
        query="show me the dataset",
        db_schemas=[],
        language="English",
    )
