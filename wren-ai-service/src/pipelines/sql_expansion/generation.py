import logging
import sys
from pathlib import Path
from typing import Any, List

import orjson
from hamilton import base
from hamilton.experimental.h_async import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.sql_generation.components.post_processors import (
    GenerationPostProcessor,
)
from src.utils import async_timer, timer
from src.web.v1.services.ask import AskHistory

logger = logging.getLogger("wren-ai-service")


sql_expansion_system_prompt = """
"""

sql_expansion_user_prompt_template = """
"""


## Start of Pipeline
@timer
@observe(capture_input=False)
def prompt(
    query: str,
    documents: List[str],
    history: AskHistory,
    prompt_builder: PromptBuilder,
) -> dict:
    logger.debug(f"query: {query}")
    logger.debug(f"documents: {documents}")
    logger.debug(f"history: {history}")
    return prompt_builder.run(query=query, documents=documents, history=history)


@async_timer
@observe(as_type="generation", capture_input=False)
async def generate_sql_expansion(prompt: dict, generator: Any) -> dict:
    logger.debug(f"prompt: {orjson.dumps(prompt, option=orjson.OPT_INDENT_2).decode()}")
    return await generator.run(prompt=prompt.get("prompt"))


@async_timer
@observe(capture_input=False)
async def post_process(
    generate_sql_expansion: dict,
    post_processor: GenerationPostProcessor,
    project_id: str | None = None,
) -> dict:
    logger.debug(
        f"generate_sql_expansion: {orjson.dumps(generate_sql_expansion, option=orjson.OPT_INDENT_2).decode()}"
    )
    return await post_processor.run(
        generate_sql_expansion.get("replies"), project_id=project_id
    )


## End of Pipeline


class Generation(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        engine: Engine,
    ):
        self.generator = llm_provider.get_generator(
            system_prompt=sql_expansion_system_prompt
        )
        self.prompt_builder = PromptBuilder(template=sql_expansion_user_prompt_template)
        self.post_processor = GenerationPostProcessor(engine=engine)

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def visualize(
        self,
        query: str,
        contexts: List[str],
        history: AskHistory,
        project_id: str | None = None,
    ) -> None:
        destination = "outputs/pipelines/sql_expansion"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            ["post_process"],
            output_file_path=f"{destination}/generation.dot",
            inputs={
                "query": query,
                "generator": self.generator,
                "prompt_builder": self.prompt_builder,
                "post_processor": self.post_processor,
                "documents": contexts,
                "history": history,
                "project_id": project_id,
            },
            show_legend=True,
            orient="LR",
        )

    @async_timer
    @observe(name="Sql Expansion Generation")
    async def run(
        self,
        query: str,
        contexts: List[str],
        history: AskHistory,
        project_id: str | None = None,
    ):
        logger.info("Sql Expansion Generation pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "generator": self.generator,
                "prompt_builder": self.prompt_builder,
                "post_processor": self.post_processor,
                "documents": contexts,
                "history": history,
                "project_id": project_id,
            },
        )


if __name__ == "__main__":
    from langfuse.decorators import langfuse_context

    from src.core.engine import EngineConfig
    from src.core.pipeline import async_validate
    from src.utils import init_langfuse, init_providers, load_env_vars

    load_env_vars()
    init_langfuse()

    llm_provider, _, _, engine = init_providers(engine_config=EngineConfig())
    pipeline = Generation(llm_provider=llm_provider, engine=engine)

    pipeline.visualize(
        "this is a test query",
        [],
        AskHistory(sql="SELECT * FROM table", summary="Summary", steps=[]),
    )
    async_validate(
        lambda: pipeline.run(
            "this is a test query",
            [],
            AskHistory(sql="SELECT * FROM table", summary="Summary", steps=[]),
        )
    )

    langfuse_context.flush()
