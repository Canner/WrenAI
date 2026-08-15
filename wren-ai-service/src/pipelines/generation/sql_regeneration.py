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
from src.pipelines.common import clean_up_new_lines
from src.pipelines.generation.utils.sql import (
    SQL_GENERATION_MODEL_KWARGS,
    SQLGenPostProcessor,
    construct_instructions,
    get_calculated_field_instructions,
    get_json_field_instructions,
    get_metric_instructions,
    get_text_to_sql_rules,
)
from src.pipelines.retrieval.sql_functions import SqlFunction
from src.pipelines.retrieval.sql_knowledge import SqlKnowledge
from src.utils import trace_cost

logger = logging.getLogger("wren-ai-service")


def get_sql_regeneration_system_prompt(
    sql_knowledge: SqlKnowledge | None = None,
) -> str:
    text_to_sql_rules = get_text_to_sql_rules(sql_knowledge)

    return f"""
### TASK ###
You are a great Wren SQL expert. Now you are given database schema and a user's question.
Generate a new grounded Wren SQL query that answers the user's question.
While generating the new SQL query, use only identifiers and functions grounded in the current DATABASE SCHEMA and SQL FUNCTIONS.

{text_to_sql_rules}

### FINAL ANSWER FORMAT ###
The final answer must be a SQL query in JSON format. Return null for sql if the current DATABASE SCHEMA does not contain the table, column, relationship, or function required to answer the user's intent.

{{
    "sql": <SQL_QUERY_STRING_OR_NULL>
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

{% if json_field_instructions %}
{{ json_field_instructions }}
{% endif %}

{% if sql_functions %}
### SQL FUNCTIONS ###
{% for function in sql_functions %}
{{ function }}
{% endfor %}
{% endif %}

{% if sql_samples %}
### SQL SAMPLES ###
Use these samples only to understand business intent and answer style. Do not copy table names, column names, aliases, functions, literals, or SQL fragments from them unless those identifiers are also declared in the current DATABASE SCHEMA.
{% for sample in sql_samples %}
Question:
{{sample.question}}
{% endfor %}
{% endif %}

{% if instructions %}
### USER INSTRUCTIONS ###
{% for instruction in instructions %}
{{ loop.index }}. {{ instruction }}
{% endfor %}
{% endif %}

### QUESTION ###
User's Question: {{ query }}
{% if sql_generation_reasoning %}
### SQL GENERATION REASONING ###
The following reasoning is non-executable semantic context only. Do not copy identifiers, SQL fragments, aliases, functions, literals, or placeholder names from it. Regenerate SQL only from DATABASE SCHEMA, WREN SQL IDENTIFIER CONTRACT, EXECUTABLE WREN IDENTIFIER CATALOG, and SQL FUNCTIONS.
{{ sql_generation_reasoning }}
{% endif %}
### ORIGINAL SQL QUERY ###
The original SQL may contain invalid identifiers. Use it only to understand the failed attempt; do not copy any table, column, alias, function, literal, or SQL fragment unless it is grounded in the current DATABASE SCHEMA.
{{ sql }}

Generate the final JSON response now.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    query: str,
    documents: list[str],
    sql_generation_reasoning: str,
    sql: str,
    prompt_builder: PromptBuilder,
    sql_samples: list[dict] | None = None,
    instructions: list[dict] | None = None,
    has_calculated_field: bool = False,
    has_metric: bool = False,
    has_json_field: bool = False,
    sql_functions: list[SqlFunction] | None = None,
    sql_knowledge: SqlKnowledge | None = None,
) -> dict:
    _prompt = prompt_builder.run(
        query=query,
        sql=sql,
        documents=documents,
        sql_generation_reasoning=sql_generation_reasoning,
        instructions=construct_instructions(
            instructions=instructions,
        ),
        calculated_field_instructions=(
            get_calculated_field_instructions(sql_knowledge)
            if has_calculated_field
            else ""
        ),
        metric_instructions=(
            get_metric_instructions(sql_knowledge) if has_metric else ""
        ),
        json_field_instructions=(
            get_json_field_instructions(sql_knowledge) if has_json_field else ""
        ),
        sql_samples=sql_samples,
        sql_functions=sql_functions,
    )
    return {"prompt": clean_up_new_lines(_prompt.get("prompt"))}


@observe(as_type="generation", capture_input=False)
@trace_cost
async def regenerate_sql(
    prompt: dict,
    generator: Any,
    generator_name: str,
    sql_knowledge: SqlKnowledge | None = None,
) -> dict:
    current_system_prompt = get_sql_regeneration_system_prompt(sql_knowledge)
    return await generator(
        prompt=prompt.get("prompt"), current_system_prompt=current_system_prompt
    ), generator_name


@observe(capture_input=False)
async def post_process(
    regenerate_sql: dict,
    post_processor: SQLGenPostProcessor,
    project_id: str | None = None,
    mdl_hash: str | None = None,
) -> dict:
    return await post_processor.run(
        regenerate_sql.get("replies"),
        project_id=project_id,
        mdl_hash=mdl_hash,
    )


## End of Pipeline


class SQLRegeneration(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        engine: Engine,
        **kwargs,
    ):
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=get_sql_regeneration_system_prompt(None),
                generation_kwargs=SQL_GENERATION_MODEL_KWARGS,
            ),
            "generator_name": llm_provider.get_model(),
            "prompt_builder": PromptBuilder(
                template=sql_regeneration_user_prompt_template
            ),
            "post_processor": SQLGenPostProcessor(engine=engine),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="SQL Regeneration")
    async def run(
        self,
        contexts: list[str],
        query: str,
        sql_generation_reasoning: str,
        sql: str,
        sql_samples: list[dict] | None = None,
        instructions: list[dict] | None = None,
        project_id: str | None = None,
        mdl_hash: str | None = None,
        validation_contexts: list[str] | None = None,
        has_calculated_field: bool = False,
        has_metric: bool = False,
        has_json_field: bool = False,
        sql_functions: list[SqlFunction] | None = None,
        sql_knowledge: SqlKnowledge | None = None,
    ):
        logger.info("SQL Regeneration pipeline is running...")

        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "documents": contexts,
                "query": query,
                "sql_generation_reasoning": sql_generation_reasoning,
                "sql": sql,
                "sql_samples": sql_samples,
                "instructions": instructions,
                "project_id": project_id,
                "mdl_hash": mdl_hash,
                "validation_contexts": validation_contexts,
                "has_calculated_field": has_calculated_field,
                "has_metric": has_metric,
                "has_json_field": has_json_field,
                "sql_functions": sql_functions,
                "sql_knowledge": sql_knowledge,
                **self._components,
            },
        )
