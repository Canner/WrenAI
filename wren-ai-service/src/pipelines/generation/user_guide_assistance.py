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

logger = logging.getLogger("wren-ai-service")


user_guide_assistance_system_prompt = """
You are a helpful assistant that can help users understand Wren AI. 
You are given a user question and a user guide.
You need to understand the user question and the user guide, and then answer the user question.

### INSTRUCTIONS ###
1. Your answer should be in the same language as the language user provided.
2. You must follow the user guide to answer the user question.
3. If you think you cannot answer the user question given the user guide, please kindly respond user that you don't find relevant answer in the user guide.
4. You should add citations to the user guide(document url) in your answer.
5. You should provide your answer in Markdown format.

### OUTPUT FORMAT ###
Please provide your response in proper Markdown format without ```markdown``` tags.
"""

user_guide_assistance_user_prompt_template = """
User Question: {{query}}
Language: {{language}}
User Guide:
{% for doc in docs %}
- {{doc.path}}: {{doc.content}}
{% endfor %}

Please think step by step.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    query: str,
    language: str,
    wren_ai_docs: list[dict],
    prompt_builder: PromptBuilder,
) -> dict:
    return prompt_builder.run(
        query=query,
        language=language,
        docs=wren_ai_docs,
    )


@observe(as_type="generation", capture_input=False)
@trace_cost
async def user_guide_assistance(
    prompt: dict, generator: Any, query_id: str, generator_name: str
) -> dict:
    return await generator(
        prompt=prompt.get("prompt"), query_id=query_id
    ), generator_name


## End of Pipeline


class UserGuideAssistance(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        wren_ai_docs: list[dict],
        **kwargs,
    ):
        self._user_queues = {}
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=user_guide_assistance_system_prompt,
                streaming_callback=self._streaming_callback,
            ),
            "generator_name": llm_provider.get_model(),
            "prompt_builder": PromptBuilder(
                template=user_guide_assistance_user_prompt_template
            ),
        }
        self._configs = {
            "wren_ai_docs": wren_ai_docs,
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

    @observe(name="User Guide Assistance")
    async def run(
        self,
        query: str,
        language: str,
        query_id: Optional[str] = None,
    ):
        logger.info("User Guide Assistance pipeline is running...")
        return await self._pipe.execute(
            ["user_guide_assistance"],
            inputs={
                "query": query,
                "language": language,
                "query_id": query_id or "",
                **self._components,
                **self._configs,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        UserGuideAssistance,
        "user_guide_assistance",
        query="what can Wren AI do?",
        language="en",
    )
