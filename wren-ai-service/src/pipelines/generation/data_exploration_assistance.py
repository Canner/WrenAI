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

logger = logging.getLogger("wren-ai-service")


data_exploration_assistance_system_prompt = """
You are a great data analyst good at exploring data:
- explain the data in a easy to understand manner
- provide insights and trends in the data
- provide suggestions for further analysis
- find out anomalies and outliers in the data

You are given a user question and a sql data.
You need to understand the user question and the sql data, and then answer the user question.

### INSTRUCTIONS ###
1. Your answer should be in the same language as the language user provided.
2. You must follow the sql data to answer the user question.
3. You should provide your answer in Markdown format.

### OUTPUT FORMAT ###
Please provide your response in proper Markdown format.
"""

data_exploration_assistance_user_prompt_template = """
User Question: {{query}}
Language: {{language}}
SQL Data:
{{ sql_data }}

Please think step by step.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    query: str,
    language: str,
    sql_data: dict,
    prompt_builder: PromptBuilder,
) -> dict:
    return prompt_builder.run(
        query=query,
        language=language,
        sql_data=sql_data,
    )


@observe(as_type="generation", capture_input=False)
async def data_exploration_assistance(
    prompt: dict, generator: Any, query_id: str
) -> dict:
    return await generator(prompt=prompt.get("prompt"), query_id=query_id)


## End of Pipeline


class DataExplorationAssistance(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **kwargs,
    ):
        self._user_queues = {}
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=data_exploration_assistance_system_prompt,
                streaming_callback=self._streaming_callback,
            ),
            "prompt_builder": PromptBuilder(
                template=data_exploration_assistance_user_prompt_template
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

    @observe(name="Data Exploration Assistance")
    async def run(
        self,
        query: str,
        sql_data: dict,
        language: str,
        query_id: Optional[str] = None,
    ):
        logger.info("Data Exploration Assistance pipeline is running...")
        return await self._pipe.execute(
            ["data_exploration_assistance"],
            inputs={
                "query": query,
                "language": language,
                "query_id": query_id or "",
                "sql_data": sql_data,
                **self._components,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        DataExplorationAssistance,
        "data_exploration_assistance",
        query="what can Wren AI do?",
        language="en",
    )
