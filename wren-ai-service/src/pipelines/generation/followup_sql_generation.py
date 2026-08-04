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
    construct_ask_history_messages,
    construct_instructions,
    get_calculated_field_instructions,
    get_json_field_instructions,
    get_metric_instructions,
    get_sql_generation_system_prompt,
)
from src.pipelines.retrieval.sql_functions import SqlFunction
from src.pipelines.retrieval.sql_knowledge import SqlKnowledge
from src.utils import trace_cost
from src.web.v1.services.ask import AskHistory

logger = logging.getLogger("wren-ai-service")


text_to_sql_with_followup_user_prompt_template = """
### TASK ###
Given the user's current follow-up question and the current retrieved DATABASE SCHEMA,
generate one SQL query to best answer the user's question.

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
Summary:
{{sample.summary}}
{% endfor %}
{% endif %}

{% if instructions %}
### USER INSTRUCTIONS ###
{% for instruction in instructions %}
{{ loop.index }}. {{ instruction }}
{% endfor %}
{% endif %}

### QUESTION ###
User's Follow-up Question: {{ query }}
Generate one Wren SQL query that answers the full follow-up request using only DATABASE SCHEMA and SQL FUNCTIONS.
Generate an intent-shaped query, not a table preview.
Use schema descriptions, aliases, display labels, metrics, calculated fields, and relationships only to understand meaning.
The SQL must include every supported requested part: subject, entity, filters, timeframe, grouping, measure, ordering, and limit.
If a required part of the request is not grounded by an exact deployed schema object, column, relationship, metric, or supported function, return null for sql.
Do not answer a specific analytical question with a broad table preview or with an unrelated nearby table.
Do not ignore a literal filter value from the user; apply it to the exact schema field representing that filter concept, or return null when that field is unavailable.
For ranked entity questions, select and group by the exact schema field representing the requested entity, not only context fields.
For record or entity volume questions, count rows unless the user requests a declared numeric measure. For value, amount, quantity, rate, cost, or metric questions, use the declared measure that represents the request.
For timeframe requests, filter an exact date_time_candidate column when the retrieved schema provides one for the requested time concept.
For aggregate, trend, ranking, or grouped requests, aggregate exact numeric_measure_candidate columns or count rows as appropriate for the user's requested measure.
Do not copy executable identifiers, SQL fragments, functions, or literal values from reasoning plans, SQL samples, failed SQL, source metadata, comments, or user wording unless they are also exact deployed schema identifiers or current user-provided literal values.

{% if executable_schema_contract %}
### ALLOWED EXECUTABLE IDENTIFIERS FOR THIS REQUEST ###
{{ executable_schema_contract }}
{% endif %}

Return only the final JSON SQL response.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    query: str,
    documents: list[str],
    sql_generation_reasoning: str,
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
async def generate_sql_in_followup(
    prompt: dict,
    generator: Any,
    histories: list[AskHistory],
    generator_name: str,
    sql_knowledge: SqlKnowledge | None = None,
) -> dict:
    history_messages = construct_ask_history_messages(histories)
    current_system_prompt = get_sql_generation_system_prompt(sql_knowledge)
    return await generator(
        prompt=prompt.get("prompt"),
        history_messages=history_messages,
        current_system_prompt=current_system_prompt,
    ), generator_name


@observe(capture_input=False)
async def post_process(
    generate_sql_in_followup: dict,
    post_processor: SQLGenPostProcessor,
    data_source: str,
    query: str,
    project_id: str | None = None,
    use_dry_plan: bool = False,
    allow_dry_plan_fallback: bool = False,
    schema_contracts: list[dict] | None = None,
) -> dict:
    return await post_processor.run(
        generate_sql_in_followup.get("replies"),
        project_id=project_id,
        use_dry_plan=use_dry_plan,
        data_source=data_source,
        allow_dry_plan_fallback=allow_dry_plan_fallback,
        schema_contracts=schema_contracts,
        query=query,
    )


## End of Pipeline


class FollowUpSQLGeneration(BasicPipeline):
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
                template=text_to_sql_with_followup_user_prompt_template
            ),
            "post_processor": SQLGenPostProcessor(engine=engine),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Follow-Up SQL Generation")
    async def run(
        self,
        query: str,
        contexts: list[str],
        sql_generation_reasoning: str,
        histories: list[AskHistory],
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
        sql_knowledge: SqlKnowledge | None = None,
        schema_contracts: list[dict] | None = None,
    ):
        logger.info("Follow-Up SQL Generation pipeline is running...")

        if use_dry_plan:
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
                "query": query,
                "documents": contexts,
                "sql_generation_reasoning": sql_generation_reasoning,
                "histories": histories,
                "project_id": project_id,
                "mdl_hash": mdl_hash,
                "sql_samples": sql_samples,
                "instructions": instructions,
                "has_calculated_field": has_calculated_field,
                "has_metric": has_metric,
                "has_json_field": has_json_field,
                "sql_functions": sql_functions,
                "use_dry_plan": use_dry_plan,
                "allow_dry_plan_fallback": allow_dry_plan_fallback,
                "data_source": metadata.get("data_source", "local_file"),
                "sql_knowledge": sql_knowledge,
                "schema_contracts": schema_contracts,
                **self._components,
            },
        )
