import logging
import sys
from pathlib import Path
from typing import Any, Dict, List

import orjson
from hamilton import base
from hamilton.experimental.h_async import AsyncDriver
from haystack import component
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe

from src.core.pipeline import BasicPipeline, async_validate
from src.core.provider import LLMProvider
from src.utils import async_timer, timer

logger = logging.getLogger("wren-ai-service")

chart_generation_system_prompt = """
"""

chart_generation_user_prompt_template = """
"""


@component
class ChartGenerationPostProcessor:
    @component.output_types(
        results=Dict[str, Any],
    )
    def run(
        self,
        replies: str,
    ):
        pass


## Start of Pipeline
@timer
@observe(capture_input=False)
def prompt(
    data: List[dict],
    prompt_builder: PromptBuilder,
) -> dict:
    logger.debug(f"data: {data}")

    return prompt_builder.run(data=data)


@async_timer
@observe(as_type="generation", capture_input=False)
async def generate_chart(prompt: dict, generator: Any) -> dict:
    logger.debug(f"prompt: {orjson.dumps(prompt, option=orjson.OPT_INDENT_2).decode()}")

    return await generator.run(prompt=prompt.get("prompt"))


@timer
@observe(capture_input=False)
def post_process(
    generate_chart: dict, post_processor: ChartGenerationPostProcessor
) -> dict:
    logger.debug(
        f"generate_chart: {orjson.dumps(generate_chart, option=orjson.OPT_INDENT_2).decode()}"
    )

    return post_processor.run(generate_chart.get("replies"))


## End of Pipeline


class ChartGeneration(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
    ):
        self._components = {
            "prompt_builder": PromptBuilder(
                template=chart_generation_user_prompt_template
            ),
            "generator": llm_provider.get_generator(
                system_prompt=chart_generation_system_prompt
            ),
            "post_processor": ChartGenerationPostProcessor(),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def visualize(self, data: List[Dict]) -> None:
        destination = "outputs/pipelines/generation"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            ["post_process"],
            output_file_path=f"{destination}/chart_generation.dot",
            inputs={
                "data": data,
                **self._components,
            },
            show_legend=True,
            orient="LR",
        )

    @async_timer
    @observe(name="Chart Generation")
    async def run(
        self,
        data: List[dict],
    ) -> dict:
        logger.info("Chart Generation pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "data": data,
                **self._components,
            },
        )


if __name__ == "__main__":
    from langfuse.decorators import langfuse_context

    from src.core.engine import EngineConfig
    from src.core.pipeline import async_validate
    from src.utils import init_langfuse, init_providers, load_env_vars

    load_env_vars()
    init_langfuse()

    llm_provider, _, _, engine = init_providers(EngineConfig())
    pipeline = ChartGeneration(
        llm_provider=llm_provider,
    )

    pipeline.visualize([])
    async_validate(lambda: pipeline.run([{"data": [1, 2, 3]}]))

    langfuse_context.flush()
