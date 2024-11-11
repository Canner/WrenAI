import asyncio
import logging
import sys
from pathlib import Path
from typing import Any, Optional

import orjson
from hamilton import base
from hamilton.experimental.h_async import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.utils import async_timer, timer

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

### OUTPUT FORMAT ###
Please provide your response in proper Markdown format.
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
@timer
@observe(capture_input=False)
def prompt(
    query: str,
    db_schemas: list[str],
    language: str,
    prompt_builder: PromptBuilder,
) -> dict:
    logger.debug(f"query: {query}")
    logger.debug(f"db_schemas: {db_schemas}")
    logger.debug(f"language: {language}")

    return prompt_builder.run(query=query, db_schemas=db_schemas, language=language)


@async_timer
@observe(as_type="generation", capture_input=False)
async def data_assistance(prompt: dict, generator: Any, query_id: str) -> dict:
    logger.debug(f"prompt: {orjson.dumps(prompt, option=orjson.OPT_INDENT_2).decode()}")

    return await generator.run(prompt=prompt.get("prompt"), query_id=query_id)


## End of Pipeline


class DataAssistanceResult(BaseModel):
    results: str


DATA_ASSISTANCE_MODEL_KWARGS = {"response_format": {"type": "text"}}


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
                generation_kwargs=DATA_ASSISTANCE_MODEL_KWARGS,
                streaming_callback=self._streaming_callback,
            ),
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
        if chunk.meta.get("finish_reason") == "stop":
            asyncio.create_task(self._user_queues[query_id].put("<DONE>"))

    async def get_streaming_results(self, query_id):
        if query_id not in self._user_queues:
            self._user_queues[
                query_id
            ] = asyncio.Queue()  # Ensure the user's queue exists
        while True:
            # Wait for an item from the user's queue
            self._streaming_results = await self._user_queues[query_id].get()
            if self._streaming_results == "<DONE>":  # Check for end-of-stream signal
                del self._user_queues[query_id]
                break
            if self._streaming_results:  # Check if there are results to yield
                yield self._streaming_results
                self._streaming_results = ""  # Clear after yielding

    def visualize(
        self,
        query: str,
        db_schemas: list[str],
        language: str,
        query_id: Optional[str] = None,
    ) -> None:
        destination = "outputs/pipelines/generation"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            ["data_assistance"],
            output_file_path=f"{destination}/data_assistance.dot",
            inputs={
                "query": query,
                "db_schemas": db_schemas,
                "language": language,
                "query_id": query_id or "",
                **self._components,
            },
            show_legend=True,
            orient="LR",
        )

    @async_timer
    @observe(name="Data Assistance")
    async def run(
        self,
        query: str,
        db_schemas: list[str],
        language: str,
        query_id: Optional[str] = None,
    ):
        logger.info("Data Assistance pipeline is running...")
        return await self._pipe.execute(
            ["data_assistance"],
            inputs={
                "query": query,
                "db_schemas": db_schemas,
                "language": language,
                "query_id": query_id or "",
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

    llm_provider, _, _, _ = init_providers(engine_config=EngineConfig())
    pipeline = DataAssistance(
        llm_provider=llm_provider,
    )

    pipeline.visualize("show me the dataset", [], "English")
    async_validate(lambda: pipeline.run("show me the dataset", [], "English"))

    langfuse_context.flush()
