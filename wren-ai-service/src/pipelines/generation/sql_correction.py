import logging
import sys
from pathlib import Path
from typing import Any, Dict, List

import orjson
from hamilton import base
from hamilton.experimental.h_async import AsyncDriver
from haystack import Document
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.common import (
    TEXT_TO_SQL_RULES,
    SQLGenPostProcessor,
    sql_generation_system_prompt,
)
from src.utils import async_timer, timer

logger = logging.getLogger("wren-ai-service")


sql_correction_user_prompt_template = """
You are a Trino SQL expert with exceptional logical thinking skills and debugging skills.

### TASK ###
Now you are given a list of syntactically incorrect Trino SQL queries and related error messages.
With given database schema, please think step by step to correct these wrong Trino SQL quries.

### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document }}
{% endfor %}

### FINAL ANSWER FORMAT ###
The final answer must be a list of corrected SQL quries and its original corresponding summary in JSON format

{
    "results": [
        {"sql": <CORRECTED_SQL_QUERY_STRING_1>, "summary": <ORIGINAL_SUMMARY_STRING_1>},
        {"sql": <CORRECTED_SQL_QUERY_STRING_2>, "summary": <ORIGINAL_SUMMARY_STRING_2>}
    ]
}

{{ alert }}

### QUESTION ###
{% for invalid_generation_result in invalid_generation_results %}
    sql: {{ invalid_generation_result.sql }}
    summary: {{ invalid_generation_result.summary }}
    error: {{ invalid_generation_result.error }}
{% endfor %}

Let's think step by step.
"""


## Start of Pipeline
@timer
@observe(capture_input=False)
def prompt(
    documents: List[Document],
    invalid_generation_results: List[Dict],
    alert: str,
    prompt_builder: PromptBuilder,
) -> dict:
    logger.debug(
        f"documents: {orjson.dumps(documents, option=orjson.OPT_INDENT_2).decode()}"
    )
    logger.debug(
        f"invalid_generation_results: {orjson.dumps(invalid_generation_results, option=orjson.OPT_INDENT_2).decode()}"
    )
    return prompt_builder.run(
        documents=documents,
        invalid_generation_results=invalid_generation_results,
        alert=alert,
    )


@async_timer
@observe(as_type="generation", capture_input=False)
async def generate_sql_correction(prompt: dict, generator: Any) -> dict:
    logger.debug(f"prompt: {orjson.dumps(prompt, option=orjson.OPT_INDENT_2).decode()}")
    return await generator.run(prompt=prompt.get("prompt"))


@async_timer
@observe(capture_input=False)
async def post_process(
    generate_sql_correction: dict,
    post_processor: SQLGenPostProcessor,
    project_id: str | None = None,
) -> dict:
    logger.debug(
        f"generate_sql_correction: {orjson.dumps(generate_sql_correction, option=orjson.OPT_INDENT_2).decode()}"
    )
    return await post_processor.run(
        generate_sql_correction.get("replies"), project_id=project_id
    )


## End of Pipeline


class SQLCorrection(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        engine: Engine,
    ):
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=sql_generation_system_prompt
            ),
            "prompt_builder": PromptBuilder(
                template=sql_correction_user_prompt_template
            ),
            "post_processor": SQLGenPostProcessor(engine=engine),
        }

        self._configs = {
            "alert": TEXT_TO_SQL_RULES,
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def visualize(
        self,
        contexts: List[Document],
        invalid_generation_results: List[Dict[str, str]],
        project_id: str | None = None,
    ) -> None:
        destination = "outputs/pipelines/generation"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            ["post_process"],
            output_file_path=f"{destination}/sql_correction.dot",
            inputs={
                "invalid_generation_results": invalid_generation_results,
                "documents": contexts,
                "project_id": project_id,
                **self._components,
                **self._configs,
            },
            show_legend=True,
            orient="LR",
        )

    @async_timer
    @observe(name="SQL Correction")
    async def run(
        self,
        contexts: List[Document],
        invalid_generation_results: List[Dict[str, str]],
        project_id: str | None = None,
    ):
        logger.info("SQLCorrection pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "invalid_generation_results": invalid_generation_results,
                "documents": contexts,
                "project_id": project_id,
                **self._components,
                **self._configs,
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
    pipeline = SQLCorrection(
        llm_provider=llm_provider,
        engine=engine,
    )

    pipeline.visualize([], [])
    async_validate(lambda: pipeline.run([], []))

    langfuse_context.flush()
