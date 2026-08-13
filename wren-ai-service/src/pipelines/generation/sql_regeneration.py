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
    build_schema_grounding_manifest,
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
You are a great ANSI SQL expert. Now you are given database schema, SQL generation reasoning and an original SQL query, 
please carefully review the reasoning, and then generate a new SQL query that matches the reasoning.
While generating the new SQL query, you should use the original SQL query as a reference.
While generating the new SQL query, make sure to use the database schema to generate the SQL query.

{text_to_sql_rules}

### FINAL ANSWER FORMAT ###
The final answer must be a ANSI SQL query in JSON format:

{{
    "sql": <SQL_QUERY_STRING>
}}
"""


sql_regeneration_user_prompt_template = """
### DEPLOYMENT SCOPE ###
Project ID: {{ project_id }}
MDL Hash: {{ mdl_hash }}
Regenerate SQL only against the DATABASE SCHEMA documents retrieved for this deployment scope. The original SQL, SQL samples, user instructions, and reasoning plan are not schema authority and must not introduce table or column identifiers that are absent from this deployment's DATABASE SCHEMA.

### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document }}
{% endfor %}

{% if schema_grounding_manifest %}
{{ schema_grounding_manifest }}
{% endif %}

### REQUIRED SCHEMA BINDING BEFORE SQL ###
Before writing regenerated SQL, bind every requested business concept to exact identifiers from VERIFIED SCHEMA OBJECTS.
Use only the bound table.column identifiers in SELECT, CTEs, UNION branches, JOIN, WHERE, GROUP BY, HAVING, ORDER BY, aggregates, and nested queries.
Do not regenerate SQL from business meaning alone or from invalid identifiers in the original SQL. If a concept cannot be bound to a verified table.column, omit that unsupported concept or return no SQL.
Business wording may appear only as final SELECT output aliases, never as source columns.
Every source column in the regenerated SQL must be copied exactly from VERIFIED SCHEMA OBJECTS under the table/view that provides it.

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
    sql_samples: list[dict] | None = None,
    instructions: list[dict] | None = None,
    has_calculated_field: bool = False,
    has_metric: bool = False,
    has_json_field: bool = False,
    project_id: str | None = None,
    mdl_hash: str | None = None,
    validation_contexts: list[str] | None = None,
    sql_functions: list[SqlFunction] | None = None,
    sql_knowledge: SqlKnowledge | None = None,
) -> dict:
    _prompt = prompt_builder.run(
        sql=sql,
        documents=documents,
        sql_generation_reasoning=sql_generation_reasoning,
        project_id=project_id or "",
        mdl_hash=mdl_hash or "",
        schema_grounding_manifest=build_schema_grounding_manifest(
            validation_contexts or documents
        ),
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
        prompt=prompt.get("prompt"),
        current_system_prompt=current_system_prompt,
    ), generator_name


@observe(capture_input=False)
async def post_process(
    regenerate_sql: dict,
    post_processor: SQLGenPostProcessor,
    documents: list[str] | None = None,
    validation_contexts: list[str] | None = None,
    project_id: str | None = None,
    mdl_hash: str | None = None,
) -> dict:
    return await post_processor.run(
        regenerate_sql.get("replies"),
        project_id=project_id,
        mdl_hash=mdl_hash,
        contexts=validation_contexts or documents,
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
                "validation_contexts": validation_contexts,
                "sql_generation_reasoning": sql_generation_reasoning,
                "sql": sql,
                "sql_samples": sql_samples,
                "instructions": instructions,
                "project_id": project_id,
                "mdl_hash": mdl_hash,
                "has_calculated_field": has_calculated_field,
                "has_metric": has_metric,
                "has_json_field": has_json_field,
                "sql_functions": sql_functions,
                "sql_knowledge": sql_knowledge,
                **self._components,
            },
        )
