import logging
import sys
from typing import List

import orjson
from hamilton import base
from hamilton.experimental.h_async import AsyncDriver
from haystack import component
from haystack.components.builders.prompt_builder import PromptBuilder

from src.core.pipeline import BasicPipeline, async_validate
from src.core.provider import LLMProvider
from src.utils import init_providers, timer

logger = logging.getLogger("wren-ai-service")


_prompt = """
### TASK ###
Based on the user's input below, classify whether the query is not random words.
Provide your classification as 'Yes' or 'No'. Yes if you think the query is not random words, and No if you think the query is random words.

### FINAL ANSWER FORMAT ###
The final answer must be the JSON format like following:

{
    "result": "yes" or "no"
}

### INPUT ###
{{ query }}

Let's think step by step.
"""


builder = PromptBuilder(template=_prompt)


def prompt(query: str) -> dict:
    logger.debug(f"query: {query}")
    return builder.run(query=query)


generator = None


async def generate(prompt: dict) -> dict:
    logger.debug(f"prompt: {prompt}")
    return await generator.run(prompt=prompt.get("prompt"))


@component
class QueryUnderstandingPostProcessor:
    @component.output_types(
        is_valid_query=bool,
    )
    def run(self, replies: List[str]):
        try:
            result = orjson.loads(replies[0])["result"]

            if result == "yes":
                return {
                    "is_valid_query": True,
                }

            return {
                "is_valid_query": False,
            }
        except Exception as e:
            logger.error(f"Error in QueryUnderstandingPostProcessor: {e}")

            return {
                "is_valid_query": True,
            }


post_processor = QueryUnderstandingPostProcessor()


def post_process(generate: dict) -> dict:
    logger.debug(f"generate: {generate}")
    return post_processor.run(generate.get("replies"))


class QueryUnderstanding(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
    ):
        global generator
        generator = llm_provider.get_generator()
        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @timer
    async def run(
        self,
        query: str,
    ):
        logger.info("Ask QueryUnderstanding pipeline is running...")
        return await self._pipe.execute(["post_process"], inputs={"query": query})


if __name__ == "__main__":
    llm_provider, _ = init_providers()
    pipeline = QueryUnderstanding(
        llm_provider=llm_provider,
    )

    async_validate(lambda: pipeline.run("this is a test query"))

    # print("generating query_understanding_pipeline.jpg to outputs/pipelines/ask...")
    # query_understanding_pipeline.draw(
    #     "./outputs/pipelines/ask/query_understanding_pipeline.jpg"
    # )
