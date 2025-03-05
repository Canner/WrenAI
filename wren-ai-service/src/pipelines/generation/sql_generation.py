import logging
import sys
from typing import Any, Dict, List

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.generation.utils.sql import (
    SqlGenerationResult,
    SQLGenPostProcessor,
    construct_instructions,
    sql_generation_system_prompt,
)
from src.web.v1.services import Configuration

logger = logging.getLogger("wren-ai-service")


sql_generation_user_prompt_template = """
### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document }}
{% endfor %}

{% if instructions %}
### INSTRUCTIONS ###
{{ instructions }}
{% endif %}

{% if sql_samples %}
### SQL SAMPLES ###
{% for sample in sql_samples %}
Question:
{{sample.question}}
SQL:
{{sample.sql}}
{% endfor %}
{% endif %}

### QUESTION ###
User's Question: {{ query }}
Current Time: {{ current_time }}

### REASONING PLAN ###
{{ sql_generation_reasoning }}

Let's think step by step.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    query: str,
    documents: List[str],
    sql_generation_reasoning: str,
    prompt_builder: PromptBuilder,
    configuration: Configuration | None = None,
    sql_samples: List[Dict] | None = None,
    has_calculated_field: bool = False,
    has_metric: bool = False,
) -> dict:
    return prompt_builder.run(
        query=query,
        documents=documents,
        sql_generation_reasoning=sql_generation_reasoning,
        instructions=construct_instructions(
            configuration,
            has_calculated_field,
            has_metric,
            sql_samples,
        ),
        sql_samples=sql_samples,
        current_time=configuration.show_current_time(),
    )


@observe(as_type="generation", capture_input=False)
async def generate_sql(
    prompt: dict,
    generator: Any,
) -> dict:
    return await generator(prompt=prompt.get("prompt"))


@observe(capture_input=False)
async def post_process(
    generate_sql: dict,
    post_processor: SQLGenPostProcessor,
    project_id: str | None = None,
) -> dict:
    return await post_processor.run(generate_sql.get("replies"), project_id=project_id)


## End of Pipeline


SQL_GENERATION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "sql_generation_result",
            "schema": SqlGenerationResult.model_json_schema(),
        },
    }
}


class SQLGeneration(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        engine: Engine,
        **kwargs,
    ):
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=sql_generation_system_prompt,
                generation_kwargs=SQL_GENERATION_MODEL_KWARGS,
            ),
            "prompt_builder": PromptBuilder(
                template=sql_generation_user_prompt_template
            ),
            "post_processor": SQLGenPostProcessor(engine=engine),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="SQL Generation")
    async def run(
        self,
        query: str,
        contexts: List[str],
        sql_generation_reasoning: str,
        configuration: Configuration = Configuration(),
        sql_samples: List[Dict] | None = None,
        project_id: str | None = None,
        has_calculated_field: bool = False,
        has_metric: bool = False,
    ):
        logger.info("SQL Generation pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "documents": contexts,
                "sql_generation_reasoning": sql_generation_reasoning,
                "sql_samples": sql_samples,
                "project_id": project_id,
                "configuration": configuration,
                "has_calculated_field": has_calculated_field,
                "has_metric": has_metric,
                **self._components,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        SQLGeneration,
        "sql_generation",
        query="this is a test query",
        contexts=[],
    )
