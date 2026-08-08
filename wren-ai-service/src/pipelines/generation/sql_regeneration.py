import logging
import sys
from typing import Any

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder

from langfuse.decorators import observe
from src.core.engine import Engine
from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider, LLMProvider
from src.pipelines.common import clean_up_new_lines, retrieve_metadata
from src.pipelines.generation.utils.sql import (
    SQL_GENERATION_MODEL_KWARGS,
    SQLGenPostProcessor,
    add_schema_grounding_to_system_prompt,
    construct_instructions,
    get_additional_sql_instructions,
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
    additional_sql_instructions = get_additional_sql_instructions(sql_knowledge)
    additional_sql_instructions_section = (
        f"""
### SQL KNOWLEDGE ###
{additional_sql_instructions}
"""
        if additional_sql_instructions
        else ""
    )

    return f"""
### TASK ###
You are a great Wren SQL expert. Now you are given database schema, SQL generation reasoning and an original SQL query,
please carefully review the request and then generate a new SQL query grounded in the database schema.
Use the original SQL query only as intent context. Do not preserve table or column names from it unless they appear in the database schema.
While generating the new SQL query, make sure to use the database schema to generate the SQL query.
When the original SQL was rejected for schema grounding, ignore it completely and regenerate from the user question, retrieved metadata, and configured datasource dialect only.

{text_to_sql_rules}

{additional_sql_instructions_section}

### FINAL ANSWER FORMAT ###
The final answer must be one JSON object and nothing else. Do not return markdown, explanations, reasoning, or a query plan object.
The JSON object must have exactly one key named "sql". Do not use keys such as "query", "sql_function", "arguments", "columns", "table", or "where".
The value of "sql" must be one Wren SQL SELECT statement string.

{{
    "sql": "SELECT ..."
}}
"""


sql_regeneration_user_prompt_template = """
### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document }}
{% endfor %}

{% if schema_grounding %}
### RETRIEVED EXECUTABLE SCHEMA ###
The following identifiers come from Ask Retrieval for this question. Use these exact model/table and column names when writing SQL.
{{ schema_grounding }}
{% endif %}

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

{% if data_source %}
### SQL DIALECT ###
Configured data source: {{ data_source }}.
Generate Wren SQL that dry-plans and dry-runs successfully for this configured data source through Wren Engine/IBIS.
Follow SQL KNOWLEDGE and SQL FUNCTIONS for this data source. Do not use a function, cast style, interval literal, or date/time expression merely because it exists in another database dialect.
{% endif %}

{% if sql_samples %}
### SQL SAMPLES ###
These samples are confirmed question examples for this project deployment. Use them for intent and style only. They are not a source of executable SQL identifiers.
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
SQL generation reasoning: {{ sql_generation_reasoning }}
The reasoning text is non-executable intent context only. Do not copy table names, column names, aliases, functions, clauses, literal values, or SQL fragments from it unless they appear exactly in DATABASE SCHEMA, RETRIEVED EXECUTABLE SCHEMA, or SQL FUNCTIONS.
Original SQL query: {{ sql }}

Use DATABASE SCHEMA and RETRIEVED EXECUTABLE SCHEMA as the only sources for executable table and column identifiers. The original SQL and reasoning plan can explain intent, but they must not introduce identifiers that are absent from DATABASE SCHEMA.
Choose the FROM model/table from the retrieved schema only. Add WHERE only for requested filters or time ranges that map to retrieved columns. Add GROUP BY only for requested totals, counts, distributions, comparisons, or trends. Add ORDER BY only for ranking, sorting, recent/latest, or deterministic LIMIT requests. Use JOIN only when multiple retrieved models are required and the retrieved schema declares the relationship; otherwise answer from one model when possible.
Think through the request silently. Return only the final JSON SQL response.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    query: str,
    documents: list[str],
    sql_generation_reasoning: str,
    sql: str,
    prompt_builder: PromptBuilder,
    schema_grounding: str | None = None,
    sql_samples: list[dict] | None = None,
    instructions: list[dict] | None = None,
    has_calculated_field: bool = False,
    has_metric: bool = False,
    has_json_field: bool = False,
    sql_functions: list[SqlFunction] | None = None,
    sql_knowledge: SqlKnowledge | None = None,
    data_source: str | None = None,
) -> dict:
    _prompt = prompt_builder.run(
        query=query,
        sql=sql,
        documents=documents,
        sql_generation_reasoning=sql_generation_reasoning,
        schema_grounding=schema_grounding,
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
        data_source=data_source,
    )
    return {"prompt": clean_up_new_lines(_prompt.get("prompt"))}


@observe(as_type="generation", capture_input=False)
@trace_cost
async def regenerate_sql(
    prompt: dict,
    generator: Any,
    generator_name: str,
    sql_knowledge: SqlKnowledge | None = None,
    schema_grounding: str | None = None,
) -> dict:
    current_system_prompt = add_schema_grounding_to_system_prompt(
        get_sql_regeneration_system_prompt(sql_knowledge),
        schema_grounding,
    )
    return await generator(
        prompt=prompt.get("prompt"),
        current_system_prompt=current_system_prompt,
    ), generator_name


@observe(capture_input=False)
async def post_process(
    regenerate_sql: dict,
    post_processor: SQLGenPostProcessor,
    schema_grounding: str | None = None,
    project_id: str | None = None,
    mdl_hash: str | None = None,
    use_dry_plan: bool = False,
    allow_dry_plan_fallback: bool = False,
    data_source: str = "",
    allow_data_preview: bool = False,
) -> dict:
    return await post_processor.run(
        regenerate_sql.get("replies"),
        project_id=project_id,
        mdl_hash=mdl_hash,
        use_dry_plan=use_dry_plan,
        data_source=data_source,
        allow_dry_plan_fallback=allow_dry_plan_fallback,
        allow_data_preview=allow_data_preview,
        schema_grounding=schema_grounding,
        meta=regenerate_sql.get("meta"),
    )


## End of Pipeline


class SQLRegeneration(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        engine: Engine,
        document_store_provider: DocumentStoreProvider | None = None,
        **kwargs,
    ):
        self.generation_timeout_seconds = llm_provider.get_timeout()
        self._retriever = (
            document_store_provider.get_retriever(
                document_store_provider.get_store("project_meta")
            )
            if document_store_provider
            else None
        )
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
        schema_grounding: str | None = None,
        sql_samples: list[dict] | None = None,
        instructions: list[dict] | None = None,
        project_id: str | None = None,
        mdl_hash: str | None = None,
        has_calculated_field: bool = False,
        has_metric: bool = False,
        has_json_field: bool = False,
        sql_functions: list[SqlFunction] | None = None,
        sql_knowledge: SqlKnowledge | None = None,
        use_dry_plan: bool = False,
        allow_dry_plan_fallback: bool = False,
        allow_data_preview: bool = False,
    ):
        logger.info("SQL Regeneration pipeline is running...")

        if use_dry_plan and self._retriever:
            metadata = await retrieve_metadata(
                project_id or "",
                self._retriever,
                mdl_hash=mdl_hash,
            )
        else:
            metadata = {}

        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "documents": contexts,
                "query": query,
                "sql_generation_reasoning": sql_generation_reasoning,
                "sql": sql,
                "schema_grounding": schema_grounding,
                "sql_samples": sql_samples,
                "instructions": instructions,
                "project_id": project_id,
                "mdl_hash": mdl_hash,
                "has_calculated_field": has_calculated_field,
                "has_metric": has_metric,
                "has_json_field": has_json_field,
                "sql_functions": sql_functions,
                "sql_knowledge": sql_knowledge,
                "use_dry_plan": use_dry_plan,
                "allow_dry_plan_fallback": allow_dry_plan_fallback,
                "allow_data_preview": allow_data_preview,
                "data_source": metadata.get("data_source", "local_file"),
                **self._components,
            },
        )
