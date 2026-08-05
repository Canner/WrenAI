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
    build_executable_schema_contract,
    construct_instructions,
    get_calculated_field_instructions,
    get_json_field_instructions,
    get_metric_instructions,
    get_sql_dialect_instructions,
    get_sql_generation_system_prompt,
)
from src.pipelines.retrieval.sql_functions import SqlFunction
from src.pipelines.retrieval.sql_knowledge import SqlKnowledge
from src.utils import trace_cost

logger = logging.getLogger("wren-ai-service")


sql_generation_user_prompt_template = """
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

{% if sql_dialect_instructions %}
{{ sql_dialect_instructions }}
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
Generate one Wren SQL query that answers the full user request using only DATABASE SCHEMA and SQL FUNCTIONS.
Generate an intent-shaped query, not a table preview.
Use schema descriptions, aliases, display labels, metrics, calculated fields, and relationships only to understand meaning.
The SQL must include every supported requested part: subject, entity, filters, timeframe, grouping, measure, ordering, and limit.
If a required part of the request is not grounded by an exact deployed schema object, column, relationship, metric, or supported function, return null for sql.
Do not answer a specific analytical question with a broad table preview or with an unrelated nearby table.
Do not ignore a literal filter value from the user; apply it to the exact schema field representing that filter concept, or return null when that field is unavailable.
String literals in WHERE or HAVING must come from the current user question or current user instructions only. Never use schema descriptions, column comments, aliases, display labels, source names, or lineage names as data values.
Copy user-provided filter values exactly into SQL string literals, except for normal SQL string escaping. Do not replace them with descriptive labels, unresolved variables, or values to be filled in later.
A WHERE predicate is allowed only when the current user question or current user instructions explicitly request that filter or comparison, or when it is a date/time boundary derived directly from an explicit timeframe in the current question. Do not add filters to narrow the result, choose a default segment, or satisfy an assumed business rule.
If the user asks for a specific entity but does not provide the entity value, return null for sql instead of fabricating a placeholder, ID, name, or code.
Never return template SQL. If any required table, column, join, filter value, timeframe boundary, measure, or function is not fully grounded now, return null for sql instead of a partial query.
Do not invent generic table names, generic column names, join keys, common-column placeholders, or substitute identifiers from the wording of the user's question.
For ranked entity questions, select and group by the exact schema field representing the requested entity, not only context fields.
For record or entity volume questions, count rows unless the user requests a declared numeric measure. For value, amount, quantity, rate, cost, or metric questions, use the declared measure that represents the request.
For timeframe requests, filter an actual declared column whose metadata marks it as the requested time concept. Metadata role labels are not executable column names.
For aggregate, trend, ranking, or grouped requests, aggregate actual declared measure columns or count rows as appropriate for the user's requested measure. Metadata role labels are not executable column names.
For ranking requests, include the requested ordering and limit. Do not introduce unrelated filters to create or justify the ranking.
For "highest", "lowest", "top", "bottom", "most", "least", or "contributed" questions about a named value, amount, sales, cost, revenue, quantity, or numeric measure, group by the requested contributing dimension, aggregate the exact requested measure with SUM unless another aggregation is explicitly requested, order by that selected aggregate alias in the requested direction, and return only the requested ranked rows. Do not use AVG, subtraction, margin, cost, percentage, or another derived metric unless the user explicitly asks for that metric.
Retrieved schema objects are ranked candidates, not automatic datasets to merge. Prefer one grounded model, view, or metric that answers the question. Do not use UNION, UNION ALL, INTERSECT, or EXCEPT to combine similar retrieved candidates unless the current user explicitly asks to combine separate result sets and DATABASE SCHEMA grounds each branch with the same result shape and compatible measure meaning.
For comparison requests, include every requested comparison group or period in the SQL result and compute the requested difference, change, growth, or ranking when the required fields and date operations are grounded. Do not answer a comparison request with only one side of the comparison.
Do not copy executable identifiers, SQL fragments, functions, or literal values from reasoning plans, SQL samples, failed SQL, source metadata, comments, or user wording unless they are also exact deployed schema identifiers or current user-provided literal values.

{% if executable_schema_contract %}
### ALLOWED EXECUTABLE IDENTIFIERS FOR THIS REQUEST ###
{{ executable_schema_contract }}
{% endif %}

{% if sql_generation_reasoning %}
### REASONING PLAN ###
{{ sql_generation_reasoning }}
{% endif %}

Return only the final JSON SQL response.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    query: str,
    documents: list[str],
    prompt_builder: PromptBuilder,
    sql_generation_reasoning: str | None = None,
    sql_samples: list[dict] | None = None,
    instructions: list[dict] | None = None,
    has_calculated_field: bool = False,
    has_metric: bool = False,
    has_json_field: bool = False,
    sql_functions: list[SqlFunction] | None = None,
    sql_knowledge: SqlKnowledge | None = None,
    schema_contracts: list[dict] | None = None,
    data_source: str | None = None,
) -> dict:
    _prompt = prompt_builder.run(
        query=query,
        documents=documents,
        sql_dialect_instructions=get_sql_dialect_instructions(data_source),
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
async def generate_sql(
    prompt: dict,
    generator: Any,
    generator_name: str,
    sql_knowledge: SqlKnowledge | None = None,
) -> dict:
    current_system_prompt = get_sql_generation_system_prompt(sql_knowledge)
    return await generator(
        prompt=prompt.get("prompt"), current_system_prompt=current_system_prompt
    ), generator_name


@observe(capture_input=False)
async def post_process(
    generate_sql: dict,
    post_processor: SQLGenPostProcessor,
    data_source: str,
    query: str,
    project_id: str | None = None,
    use_dry_plan: bool = False,
    allow_dry_plan_fallback: bool = False,
    allow_data_preview: bool = False,
    schema_contracts: list[dict] | None = None,
) -> dict:
    return await post_processor.run(
        generate_sql.get("replies"),
        project_id=project_id,
        use_dry_plan=use_dry_plan,
        data_source=data_source,
        allow_dry_plan_fallback=allow_dry_plan_fallback,
        allow_data_preview=allow_data_preview,
        schema_contracts=schema_contracts,
        query=query,
    )


## End of Pipeline


class SQLGeneration(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        document_store_provider: DocumentStoreProvider,
        engine: Engine,
        **kwargs,
    ):
        self._retriever = document_store_provider.get_retriever(
            document_store_provider.get_store("project_meta")
        )

        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=get_sql_generation_system_prompt(None),
                generation_kwargs=SQL_GENERATION_MODEL_KWARGS,
            ),
            "generator_name": llm_provider.get_model(),
            "prompt_builder": PromptBuilder(
                template=sql_generation_user_prompt_template
            ),
            "post_processor": SQLGenPostProcessor(engine=engine),
            "data_source": kwargs.get("data_source", "local_file"),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="SQL Generation")
    async def run(
        self,
        query: str,
        contexts: list[str],
        sql_generation_reasoning: str | None = None,
        sql_samples: list[dict] | None = None,
        instructions: list[dict] | None = None,
        project_id: str | None = None,
        mdl_hash: str | None = None,
        has_calculated_field: bool = False,
        has_metric: bool = False,
        has_json_field: bool = False,
        sql_functions: list[SqlFunction] | None = None,
        use_dry_plan: bool = False,
        allow_dry_plan_fallback: bool = False,
        allow_data_preview: bool = False,
        sql_knowledge: SqlKnowledge | None = None,
        schema_contracts: list[dict] | None = None,
    ):
        logger.info("SQL Generation pipeline is running...")

        if use_dry_plan:
            metadata = await retrieve_metadata(
                project_id or "",
                self._retriever,
                mdl_hash=mdl_hash,
            )
        else:
            metadata = {}
        data_source = metadata.get("data_source") or self._components.get(
            "data_source", "local_file"
        )

        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "documents": contexts,
                "sql_generation_reasoning": sql_generation_reasoning,
                "sql_samples": sql_samples,
                "instructions": instructions,
                "project_id": project_id,
                "mdl_hash": mdl_hash,
                "has_calculated_field": has_calculated_field,
                "has_metric": has_metric,
                "has_json_field": has_json_field,
                "sql_functions": sql_functions,
                "use_dry_plan": use_dry_plan,
                "allow_dry_plan_fallback": allow_dry_plan_fallback,
                "data_source": data_source,
                "allow_data_preview": allow_data_preview,
                "sql_knowledge": sql_knowledge,
                "schema_contracts": schema_contracts,
                **self._components,
            },
        )
