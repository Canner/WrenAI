import logging
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import orjson
from hamilton import base
from hamilton.experimental.h_async import AsyncDriver
from haystack import component
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.ask_details.generation import GenerationPostProcessor
from src.pipelines.sql_regeneration.components.prompts import (
    sql_regeneration_system_prompt,
)
from src.utils import async_timer, timer
from src.web.v1.services.sql_regeneration import (
    SQLExplanationWithUserCorrections,
)

logger = logging.getLogger("wren-ai-service")


sql_regeneration_user_prompt_template = """
inputs: {{ results }}

Let's think step by step.
"""


@component
class SQLRegenerationRreprocesser:
    @component.output_types(
        results=Dict[str, Any],
    )
    def run(
        self,
        description: str,
        steps: List[SQLExplanationWithUserCorrections],
    ) -> Dict[str, Any]:
        return {
            "results": {
                "description": description,
                "steps": steps,
            }
        }


@component
class DescriptionRegenerationPostProcessor:
    @component.output_types(
        results=Optional[Dict[str, Any]],
    )
    def run(
        self,
        replies: List[str],
        steps: List[str],
    ) -> Dict[str, Any]:
        try:
            return {
                "results": {
                    "description": orjson.loads(replies[0]).get("description", ""),
                    "steps": steps,
                }
            }
        except Exception as e:
            logger.exception(f"Error in DescriptionRegenerationPostProcessor: {e}")
            return {"results": None}


## Start of Pipeline
@timer
@observe(capture_input=False)
def preprocess(
    description: str,
    steps: List[SQLExplanationWithUserCorrections],
    sql_regeneration_preprocesser: SQLRegenerationRreprocesser,
) -> dict[str, Any]:
    logger.debug(f"steps: {steps}")
    logger.debug(f"description: {description}")
    return sql_regeneration_preprocesser.run(
        description=description,
        steps=steps,
    )


@timer
@observe(capture_input=False)
def sql_regeneration_prompt(
    preprocess: Dict[str, Any],
    sql_regeneration_prompt_builder: PromptBuilder,
) -> dict:
    logger.debug(f"preprocess: {preprocess}")
    return sql_regeneration_prompt_builder.run(results=preprocess["results"])


@async_timer
@observe(as_type="generation", capture_input=False)
async def sql_regeneration_generate(
    sql_regeneration_prompt: dict,
    sql_regeneration_generator: Any,
) -> dict:
    logger.debug(
        f"sql_regeneration_prompt: {orjson.dumps(sql_regeneration_prompt, option=orjson.OPT_INDENT_2).decode()}"
    )
    return await sql_regeneration_generator.run(
        prompt=sql_regeneration_prompt.get("prompt")
    )


@timer
@observe(capture_input=False)
def sql_regeneration_post_process(
    sql_regeneration_generate: dict,
    sql_regeneration_post_processor: GenerationPostProcessor,
) -> dict:
    logger.debug(
        f"sql_regeneration_generate: {orjson.dumps(sql_regeneration_generate, option=orjson.OPT_INDENT_2).decode()}"
    )
    return sql_regeneration_post_processor.run(
        replies=sql_regeneration_generate.get("replies"),
    )


## End of Pipeline


class Generation(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        engine: Engine,
    ):
        self.sql_regeneration_preprocesser = SQLRegenerationRreprocesser()
        self.sql_regeneration_prompt_builder = PromptBuilder(
            template=sql_regeneration_user_prompt_template
        )
        self.sql_regeneration_generator = llm_provider.get_generator(
            system_prompt=sql_regeneration_system_prompt
        )
        self.sql_regeneration_post_processor = GenerationPostProcessor(engine=engine)

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def visualize(
        self,
        description: str,
        steps: List[SQLExplanationWithUserCorrections],
    ) -> None:
        destination = "outputs/pipelines/sql_regeneration"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            ["sql_regeneration_post_process"],
            output_file_path=f"{destination}/generation.dot",
            inputs={
                "description": description,
                "steps": steps,
                "sql_regeneration_preprocesser": self.sql_regeneration_preprocesser,
                "sql_regeneration_prompt_builder": self.sql_regeneration_prompt_builder,
                "sql_regeneration_generator": self.sql_regeneration_generator,
                "sql_regeneration_post_processor": self.sql_regeneration_post_processor,
            },
            show_legend=True,
            orient="LR",
        )

    @async_timer
    @observe(name="SQL-Regeneration Generation")
    async def run(
        self,
        description: str,
        steps: List[SQLExplanationWithUserCorrections],
    ):
        logger.info("SQL Regeneration Generation pipeline is running...")
        return await self._pipe.execute(
            ["sql_regeneration_post_process"],
            inputs={
                "description": description,
                "steps": steps,
                "sql_regeneration_preprocesser": self.sql_regeneration_preprocesser,
                "sql_regeneration_prompt_builder": self.sql_regeneration_prompt_builder,
                "sql_regeneration_generator": self.sql_regeneration_generator,
                "sql_regeneration_post_processor": self.sql_regeneration_post_processor,
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

    pipeline.visualize("This is a description", [])
    async_validate(lambda: pipeline.run("This is a description", []))

    langfuse_context.flush()
