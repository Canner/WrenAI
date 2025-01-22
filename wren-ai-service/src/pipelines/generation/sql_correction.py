import asyncio
import logging
import sys
from typing import Any, Dict, List

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack import Document
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.generation.utils.sql import (
    TEXT_TO_SQL_RULES,
    SQLGenPostProcessor,
    sql_generation_system_prompt,
)

logger = logging.getLogger("wren-ai-service")


sql_correction_user_prompt_template = """
You are an ANSI SQL expert with exceptional logical thinking skills and debugging skills.

### TASK ###
Now you are given syntactically incorrect ANSI SQL query and related error message.
With given database schema, please think step by step to correct the wrong ANSI SQL query.

### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document }}
{% endfor %}

{{ alert }}

### QUESTION ###
SQL: {{ invalid_generation_result.sql }}
Error Message: {{ invalid_generation_result.error }}

Let's think step by step.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompts(
    documents: List[Document],
    invalid_generation_results: List[Dict],
    alert: str,
    prompt_builder: PromptBuilder,
) -> list[dict]:
    return [
        prompt_builder.run(
            documents=documents,
            invalid_generation_result=invalid_generation_result,
            alert=alert,
        )
        for invalid_generation_result in invalid_generation_results
    ]


@observe(as_type="generation", capture_input=False)
async def generate_sql_corrections(prompts: list[dict], generator: Any) -> list[dict]:
    tasks = []
    for prompt in prompts:
        task = asyncio.ensure_future(generator(prompt=prompt.get("prompt")))
        tasks.append(task)

    return await asyncio.gather(*tasks)


@observe(capture_input=False)
async def post_process(
    generate_sql_corrections: list[dict],
    post_processor: SQLGenPostProcessor,
    project_id: str | None = None,
) -> list[dict]:
    return await post_processor.run(generate_sql_corrections, project_id=project_id)


## End of Pipeline


class SqlCorrectionResult(BaseModel):
    sql: str


SQL_CORRECTION_MODEL_KWARGS = {
    "response_format": SqlCorrectionResult,
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
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        SQLCorrection,
        "sql_correction",
        invalid_generation_results=[],
        contexts=[],
    )
