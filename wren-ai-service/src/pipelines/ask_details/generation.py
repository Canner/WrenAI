import logging
import sys
from pathlib import Path
from typing import Any

import orjson
from hamilton import base
from hamilton.experimental.h_async import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline, async_validate
from src.core.provider import LLMProvider
from src.pipelines.ask_details.components.prompts import (
    ask_details_system_prompt,
)
from src.pipelines.common import GenerationPostProcessor
from src.utils import (
    async_timer,
    timer,
)

logger = logging.getLogger("wren-ai-service")


ask_details_user_prompt_template = """
### INPUT ###
SQL query: {{ sql }}

### FINAL ANSWER FORMAT ###
The final answer must be a valid JSON format as following:

{
    "description": <SHORT_SQL_QUERY_DESCRIPTION>,
    "steps: [
        {
            "sql": <SQL_QUERY_STRING_1>,
            "summary": <SUMMARY_STRING_1>,
            "cte_name": <CTE_NAME_STRING_1>
        }
    ] # a list of steps
}

Let's think step by step.
"""


## Start of Pipeline
@timer
@observe(capture_input=False)
def prompt(sql: str, prompt_builder: PromptBuilder) -> dict:
    logger.debug(f"sql: {sql}")
    return prompt_builder.run(sql=sql)


@async_timer
@observe(as_type="generation", capture_input=False)
async def generate(prompt: dict, generator: Any) -> dict:
    logger.debug(f"prompt: {orjson.dumps(prompt, option=orjson.OPT_INDENT_2).decode()}")
    return await generator.run(prompt=prompt.get("prompt"))


@async_timer
@observe(capture_input=False)
async def post_process(generate: dict, post_processor: GenerationPostProcessor) -> dict:
    logger.debug(
        f"generate: {orjson.dumps(generate, option=orjson.OPT_INDENT_2).decode()}"
    )
    return await post_processor.run(generate.get("replies"))


## End of Pipeline


class Generation(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        engine: Engine,
    ):
        self.generator = llm_provider.get_generator(
            system_prompt=ask_details_system_prompt
        )
        self.prompt_builder = PromptBuilder(template=ask_details_user_prompt_template)
        self.post_processor = GenerationPostProcessor(engine=engine)

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def visualize(self, sql: str) -> None:
        destination = "outputs/pipelines/ask_details"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            ["post_process"],
            output_file_path=f"{destination}/generation.dot",
            inputs={
                "sql": sql,
                "generator": self.generator,
                "prompt_builder": self.prompt_builder,
                "post_processor": self.post_processor,
            },
            show_legend=True,
            orient="LR",
        )

    @async_timer
    @observe(name="Ask_Details Generation")
    async def run(self, sql: str):
        logger.info("Ask_Details Generation pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "sql": sql,
                "generator": self.generator,
                "prompt_builder": self.prompt_builder,
                "post_processor": self.post_processor,
            },
        )


if __name__ == "__main__":
    from langfuse.decorators import langfuse_context

    from src.core.pipeline import async_validate
    from src.utils import init_langfuse, init_providers, load_env_vars

    load_env_vars()
    init_langfuse()

    llm_provider, _, _, engine = init_providers()
    pipeline = Generation(
        llm_provider=llm_provider,
        engine=engine,
    )

    pipeline.visualize("SELECT * FROM table_name")
    async_validate(lambda: pipeline.run("SELECT * FROM table_name"))

    langfuse_context.flush()
