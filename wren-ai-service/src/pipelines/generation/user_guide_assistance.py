import asyncio
import logging
import sys
from typing import Any, Optional

import aiohttp
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.utils import remove_trailing_slash

logger = logging.getLogger("wren-ai-service")


user_guide_assistance_system_prompt = """
"""

user_guide_assistance_user_prompt_template = """
User Question: {{query}}
Language: {{language}}
User Guide: {{docs}}
"""


## Start of Pipeline
@observe
async def fetch_wren_ai_docs(doc_endpoint: str, is_oss: bool) -> str:
    doc_endpoint = remove_trailing_slash(doc_endpoint)
    api_endpoint = (
        f"{doc_endpoint}/oss/llms.md" if is_oss else f"{doc_endpoint}/cloud/llms.md"
    )

    async with aiohttp.request(
        "GET",
        api_endpoint,
    ) as response:
        data = await response.text()

    return data


@observe(capture_input=False)
def prompt(
    query: str,
    language: str,
    fetch_wren_ai_docs: str,
    prompt_builder: PromptBuilder,
) -> dict:
    return prompt_builder.run(
        query=query,
        language=language,
        docs=fetch_wren_ai_docs,
    )


@observe(as_type="generation", capture_input=False)
async def user_guide_assistance(prompt: dict, generator: Any, query_id: str) -> dict:
    return await generator(prompt=prompt.get("prompt"), query_id=query_id)


## End of Pipeline


USER_GUIDE_ASSISTANCE_MODEL_KWARGS = {"response_format": {"type": "text"}}


class UserGuideAssistance(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **kwargs,
    ):
        self._user_queues = {}
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=user_guide_assistance_system_prompt,
                generation_kwargs=USER_GUIDE_ASSISTANCE_MODEL_KWARGS,
                streaming_callback=self._streaming_callback,
            ),
            "prompt_builder": PromptBuilder(
                template=user_guide_assistance_user_prompt_template
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

    @observe(name="User Guide Assistance")
    async def run(
        self,
        query: str,
        language: str,
        query_id: Optional[str] = None,
        is_oss: Optional[bool] = True,
        doc_endpoint: Optional[str] = "https://docs.getwren.ai",
    ) -> None:
        logger.info("User Guide Assistance pipeline is running...")
        return await self._pipe.execute(
            ["user_guide_assistance"],
            inputs={
                "query": query,
                "language": language,
                "is_oss": is_oss,
                "doc_endpoint": doc_endpoint,
                "query_id": query_id or "",
                **self._components,
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
