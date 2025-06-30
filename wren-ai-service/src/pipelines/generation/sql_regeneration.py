import logging
import sys
from typing import Any

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.generation.utils.sql import (
    SQL_GENERATION_MODEL_KWARGS,
    TEXT_TO_SQL_RULES,
    SQLGenPostProcessor,
    calculated_field_instructions,
    construct_instructions,
    metric_instructions,
)
from src.pipelines.retrieval.sql_functions import SqlFunction
from src.utils import trace_cost
from src.web.v1.services import Configuration

logger = logging.getLogger("wren-ai-service")


sql_regeneration_system_prompt = f"""
### TASK ###
You are a great ANSI SQL expert. Now you are given database schema, SQL generation reasoning and an original SQL query, 
please carefully review the reasoning, and then generate a new SQL query that matches the reasoning.
While generating the new SQL query, you should use the original SQL query as a reference.
While generating the new SQL query, make sure to use the database schema to generate the SQL query.

{TEXT_TO_SQL_RULES}

### FINAL ANSWER FORMAT ###
The final answer must be a ANSI SQL query in JSON format:

{{
    "sql": <SQL_QUERY_STRING>
}}
"""

sql_regeneration_user_prompt_template = """
### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document }}
{% endfor %}

{% if calculated_field_instructions %}
{{ calculated_field_instructions }}
{% endif %}

{% if metric_instructions %}
{{ metric_instructions }}
{% endif %}

{% if sql_functions %}
### SQL FUNCTIONS ###
{% for function in sql_functions %}
{{ function }}
{% endfor %}
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

{% if instructions %}
### USER INSTRUCTIONS ###
{% for instruction in instructions %}
{{ loop.index }}. {{ instruction }}
{% endfor %}
{% endif %}

### QUESTION ###
SQL generation reasoning: {{ sql_generation_reasoning }}
Original SQL query: {{ sql }}

Let's think step by step.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    documents: list[str],
    sql_generation_reasoning: str,
    sql: str,
    prompt_builder: PromptBuilder,
    configuration: Configuration | None = Configuration(),
    sql_samples: list[dict] | None = None,
    instructions: list[dict] | None = None,
    has_calculated_field: bool = False,
    has_metric: bool = False,
    sql_functions: list[SqlFunction] | None = None,
) -> dict:
    return prompt_builder.run(
        sql=sql,
        documents=documents,
        sql_generation_reasoning=sql_generation_reasoning,
        instructions=construct_instructions(
            instructions=instructions,
        ),
        calculated_field_instructions=calculated_field_instructions
        if has_calculated_field
        else "",
        metric_instructions=metric_instructions if has_metric else "",
        sql_samples=sql_samples,
        sql_functions=sql_functions,
    )


@observe(as_type="generation", capture_input=False)
@trace_cost
async def regenerate_sql(
    prompt: dict,
    generator: Any,
    generator_name: str,
) -> dict:
    return await generator(prompt=prompt.get("prompt")), generator_name


@observe(capture_input=False)
async def post_process(
    regenerate_sql: dict,
    post_processor: SQLGenPostProcessor,
    engine_timeout: float,
    project_id: str | None = None,
) -> dict:
    return await post_processor.run(
        regenerate_sql.get("replies"),
        timeout=engine_timeout,
        project_id=project_id,
    )


## End of Pipeline


class SQLRegeneration(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        engine: Engine,
        engine_timeout: float = 30.0,
        **kwargs,
    ):
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=sql_regeneration_system_prompt,
                generation_kwargs=SQL_GENERATION_MODEL_KWARGS,
            ),
            "generator_name": llm_provider.get_model(),
            "prompt_builder": PromptBuilder(
                template=sql_regeneration_user_prompt_template
            ),
            "post_processor": SQLGenPostProcessor(engine=engine),
        }

        self._configs = {
            "engine_timeout": engine_timeout,
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="SQL Regeneration")
    async def run(
        self,
        contexts: list[str],
        sql_generation_reasoning: str,
        sql: str,
        configuration: Configuration = Configuration(),
        sql_samples: list[dict] | None = None,
        instructions: list[dict] | None = None,
        project_id: str | None = None,
        has_calculated_field: bool = False,
        has_metric: bool = False,
        sql_functions: list[SqlFunction] | None = None,
    ):
        logger.info("SQL Regeneration pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "documents": contexts,
                "sql_generation_reasoning": sql_generation_reasoning,
                "sql": sql,
                "sql_samples": sql_samples,
                "instructions": instructions,
                "project_id": project_id,
                "configuration": configuration,
                "has_calculated_field": has_calculated_field,
                "has_metric": has_metric,
                "sql_functions": sql_functions,
                **self._components,
                **self._configs,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        SQLRegeneration,
        "sql_regeneration",
        sql_generation_reasoning="this is a test query",
        sql="select * from users",
    )
