import asyncio
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
from pydantic import BaseModel

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
Now you are given syntactically incorrect Trino SQL query and related error message.
With given database schema, please think step by step to correct the wrong Trino SQL query.

### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document }}
{% endfor %}

### FINAL ANSWER FORMAT ###
The final answer must be a list of corrected SQL quries in JSON format:

{
    "results": [
        {"sql": <CORRECTED_SQL_QUERY_STRING>},
    ]
}

{{ alert }}

### QUESTION ###
SQL: {{ invalid_generation_result.sql }}
Error Message: {{ invalid_generation_result.error }}

Let's think step by step.
"""


## Start of Pipeline
@timer
@observe(capture_input=False)
def prompts(
    documents: List[Document],
    invalid_generation_results: List[Dict],
    alert: str,
    prompt_builder: PromptBuilder,
) -> list[dict]:
    logger.debug(
        f"documents: {orjson.dumps(documents, option=orjson.OPT_INDENT_2).decode()}"
    )
    logger.debug(
        f"invalid_generation_results: {orjson.dumps(invalid_generation_results, option=orjson.OPT_INDENT_2).decode()}"
    )
    return [
        prompt_builder.run(
            documents=documents,
            invalid_generation_result=invalid_generation_result,
            alert=alert,
        )
        for invalid_generation_result in invalid_generation_results
    ]


@async_timer
@observe(as_type="generation", capture_input=False)
async def generate_sql_corrections(prompts: list[dict], generator: Any) -> list[dict]:
    logger.debug(
        f"prompts: {orjson.dumps(prompts, option=orjson.OPT_INDENT_2).decode()}"
    )

    tasks = []
    for prompt in prompts:
        task = asyncio.ensure_future(generator.run(prompt=prompt.get("prompt")))
        tasks.append(task)

    return await asyncio.gather(*tasks)


@async_timer
@observe(capture_input=False)
async def post_process(
    generate_sql_corrections: list[dict],
    post_processor: SQLGenPostProcessor,
    project_id: str | None = None,
) -> list[dict]:
    logger.debug(
        f"generate_sql_corrections: {orjson.dumps(generate_sql_corrections, option=orjson.OPT_INDENT_2).decode()}"
    )

    return await post_processor.run(generate_sql_corrections, project_id=project_id)


## End of Pipeline


class CorrectedSQLResult(BaseModel):
    sql: str


class CorrectedResults(BaseModel):
    results: list[CorrectedSQLResult]


SQL_CORRECTION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "corrected_sql",
            "schema": CorrectedResults.model_json_schema(),
        },
    }
}


class SQLCorrection(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        engine: Engine,
        **kwargs,
    ):
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=sql_generation_system_prompt,
                generation_kwargs=SQL_CORRECTION_MODEL_KWARGS,
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
    from src.providers import init_providers
    from src.utils import init_langfuse, load_env_vars

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
