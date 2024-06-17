import logging
import sys
from pathlib import Path
from typing import Any, List

import orjson
from hamilton import base
from hamilton.experimental.h_async import AsyncDriver
from haystack import component
from haystack.components.builders.prompt_builder import PromptBuilder

from src.core.pipeline import BasicPipeline, async_validate
from src.core.provider import LLMProvider
from src.utils import async_timer, init_providers, timer

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


## Start of Pipeline
@timer
def prompt(query: str, prompt_builder: PromptBuilder) -> dict:
    logger.debug(f"query: {query}")
    return prompt_builder.run(query=query)


@async_timer
async def generate(prompt: dict, generator: Any) -> dict:
    logger.debug(f"prompt: {prompt}")
    return await generator.run(prompt=prompt.get("prompt"))


@timer
def post_process(
    generate: dict, post_processor: QueryUnderstandingPostProcessor
) -> dict:
    logger.debug(f"generate: {generate}")
    return post_processor.run(generate.get("replies"))


## End of Pipeline


class QueryUnderstanding(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
    ):
        self.generator = llm_provider.get_generator()
        self.prompt_builder = PromptBuilder(template=_prompt)
        self.post_processor = QueryUnderstandingPostProcessor()

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def visualize(
        self,
        query: str,
    ) -> None:
        destination = "outputs/pipelines/ask"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            ["post_process"],
            output_file_path=f"{destination}/query_understanding.dot",
            inputs={
                "query": query,
                "generator": self.generator,
                "prompt_builder": self.prompt_builder,
                "post_processor": self.post_processor,
            },
            show_legend=True,
            orient="LR",
        )

    @async_timer
    async def run(
        self,
        query: str,
    ):
        logger.info("Ask QueryUnderstanding pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "generator": self.generator,
                "prompt_builder": self.prompt_builder,
                "post_processor": self.post_processor,
            },
        )


if __name__ == "__main__":
    from src.utils import load_env_vars

    load_env_vars()

    llm_provider, _ = init_providers()
    pipeline = QueryUnderstanding(
        llm_provider=llm_provider,
    )

    input = "this is a test query"
    pipeline.visualize(input)
    async_validate(lambda: pipeline.run(input))
