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
    build_executable_schema_contract,
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
You are a great ANSI SQL expert. Now you are given database schema and a user's question.
Carefully review the user's question and current DATABASE SCHEMA, then generate a new SQL query that answers the user's intent.
The original SQL query and UI planning text are intentionally omitted from the prompt and must not be used as executable context.
While generating the new SQL query, make sure to use the database schema as the only source of executable table and column identifiers.
If the original SQL query or reasoning contains unsupported identifiers, placeholders, or assumptions, ignore those parts and regenerate from the user's question and DATABASE SCHEMA.
Treat physical/source/lineage names from the original SQL, reasoning, samples, comments, or descriptions as semantic context only; never use them as executable identifiers unless the exact same identifier appears in DATABASE SCHEMA.

{text_to_sql_rules}

### FINAL ANSWER FORMAT ###
The final answer must be JSON. Return a SQL string only when it is fully grounded in DATABASE SCHEMA and SQL FUNCTIONS and answers the user's requested intent. Do not create table or column identifiers from the user's wording. If no fully grounded SQL can be generated, return null for sql.

{{
    "sql": "complete executable SQL query string using only identifiers declared in DATABASE SCHEMA, or null"
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
These samples are examples of intent and style only. Their SQL bodies are intentionally omitted so they cannot provide executable identifiers, literal values, placeholders, functions, or SQL patterns.
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
Answer the user's intent using the current DATABASE SCHEMA. Use comments, aliases, descriptions, source metadata, physical names, lineage names, calculated fields, metrics, and relationships only to understand meaning; the SQL must use exact declared table and column names from DATABASE SCHEMA. Do not copy semantic labels, source/physical/lineage names, user question words, or inferred names into executable SQL. If a needed table, output column, filter column, grouping column, relation, date field, measure, or function is not declared in DATABASE SCHEMA or SQL FUNCTIONS, return null for sql instead of inventing, substituting, or approximating a similar name. If the retrieved schema does not ground the user's primary requested intent, return null for sql instead of querying an unrelated object.
Regenerate with executable identifiers from the current DATABASE SCHEMA only.
Regenerate an intent-shaped query, not a table preview. Select explicit columns, filters, groupings, measures, joins, ordering, and limits needed by the question. For metric questions, return dimensions plus the requested measure or grounded expression; never use SELECT * as a substitute.
When DATABASE SCHEMA contains role or semantic hints, use those hints only to choose actual declared columns. Do not write role labels, sample schema names, placeholder table names, placeholder column names, or replacement markers as SQL identifiers or SQL literal values. For timeframe requests, filter an actual declared time/date column with a bounded range. For aggregate, "by", trend, or ranking requests, aggregate actual declared measure columns or count rows, group by actual declared dimension/date columns, order by the selected aggregate alias when ranking, and limit only when requested. Do not return a raw table preview.
For "highest", "lowest", "top", "bottom", "most", "least", or "contributed" questions about a named value, amount, sales, cost, revenue, quantity, or numeric measure, group by the requested contributing dimension, aggregate the exact requested measure with SUM unless another aggregation is explicitly requested, order by that selected aggregate alias in the requested direction, and return only the requested ranked rows. Do not use AVG, subtraction, margin, cost, percentage, or another derived metric unless the user explicitly asks for that metric.
String literals in WHERE or HAVING must come from the current user question or current user instructions only. Never use schema descriptions, column comments, aliases, display labels, source names, or lineage names as data values.
Copy user-provided filter values exactly into SQL string literals, except for normal SQL string escaping. Do not replace them with descriptive labels, unresolved variables, or values to be filled in later.
Never return template SQL. If any required table, column, join, filter value, timeframe boundary, measure, or function is not fully grounded now, return null for sql instead of a partial query.
Do not invent generic table names, generic column names, join keys, common-column placeholders, or substitute identifiers from the original SQL, reasoning, or the wording of the user's question.
Retrieved schema objects are ranked candidates, not automatic datasets to merge. Prefer one grounded model, view, or metric that answers the question. Do not use UNION, UNION ALL, INTERSECT, or EXCEPT to combine similar retrieved candidates unless the current user explicitly asks to combine separate result sets and DATABASE SCHEMA grounds each branch with the same result shape and compatible measure meaning.
For comparison requests, include every requested comparison group or period in the SQL result and compute the requested difference, change, growth, or ranking when the required fields and date operations are grounded. Do not answer a comparison request with only one side of the comparison.

{% if executable_schema_contract %}
### ALLOWED EXECUTABLE IDENTIFIERS FOR THIS REGENERATION ###
{{ executable_schema_contract }}
{% endif %}

### ORIGINAL SQL QUERY ###
The original SQL is intentionally omitted so it cannot provide executable identifiers, literal values, placeholders, functions, or SQL patterns.

Return only the final JSON SQL response.
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
    schema_contracts: list[dict] | None = None,
) -> dict:
    _prompt = prompt_builder.run(
        query=query,
        sql=sql,
        documents=documents,
        executable_schema_contract=build_executable_schema_contract(schema_contracts),
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
    query: str,
    project_id: str | None = None,
    schema_contracts: list[dict] | None = None,
) -> dict:
    return await post_processor.run(
        regenerate_sql.get("replies"),
        project_id=project_id,
        schema_contracts=schema_contracts,
        query=query,
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
        has_calculated_field: bool = False,
        has_metric: bool = False,
        has_json_field: bool = False,
        sql_functions: list[SqlFunction] | None = None,
        sql_knowledge: SqlKnowledge | None = None,
        schema_contracts: list[dict] | None = None,
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
                "has_calculated_field": has_calculated_field,
                "has_metric": has_metric,
                "has_json_field": has_json_field,
                "sql_functions": sql_functions,
                "sql_knowledge": sql_knowledge,
                "schema_contracts": schema_contracts,
                **self._components,
            },
        )
