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
    construct_instructions,
    generate_simple_analytics_sql,
    get_calculated_field_instructions,
    get_json_field_instructions,
    get_metric_instructions,
    get_sql_generation_system_prompt,
    unsupported_schema_generation_result,
)
from src.pipelines.retrieval.sql_functions import SqlFunction
from src.pipelines.retrieval.sql_knowledge import SqlKnowledge
from src.utils import trace_cost

logger = logging.getLogger("wren-ai-service")


sql_generation_user_prompt_template = """
{{ schema_identifier_catalog }}

The WREN SQL IDENTIFIER CONTRACT above is the authoritative executable schema.
The DATABASE SCHEMA below provides type, semantic, and relationship details for those exact identifiers.

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
Answer the user's intent using the current DATABASE SCHEMA. Use comments, aliases, descriptions, calculated fields, metrics, and relationships only to understand meaning; the SQL must use exact declared table and column names from the WREN SQL IDENTIFIER CONTRACT and DATABASE SCHEMA. Treat source metadata, physical names, lineage names, semantic labels, and user question words as non-executable background unless the exact same identifier is declared in the contract. If a needed table, output column, filter column, grouping column, relation, date field, measure, or function is not declared in DATABASE SCHEMA or SQL FUNCTIONS, return null for sql instead of inventing, substituting, or approximating a similar name. If the retrieved schema does not ground the user's primary requested intent, return null for sql instead of querying an unrelated object.
If any planned SQL identifier cannot be copied exactly from DATABASE SCHEMA or WREN SQL IDENTIFIER CONTRACT, stop and return null for sql. Never create a table or column from the user's wording, even when the wording looks like a business term or object name.

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
) -> dict:
    _prompt = prompt_builder.run(
        query=query,
        documents=documents,
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
        schema_identifier_catalog=construct_schema_identifier_catalog(documents),
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
    query: str | None = None,
    grounding_query: str | None = None,
    documents: list[str] | None = None,
    project_id: str | None = None,
    mdl_hash: str | None = None,
    validation_contexts: list[str] | None = None,
    use_dry_plan: bool = False,
    allow_dry_plan_fallback: bool = True,
    allow_data_preview: bool = False,
) -> dict:
    return await post_processor.run(
        generate_sql.get("replies"),
        project_id=project_id,
        mdl_hash=mdl_hash,
        contexts=validation_contexts or documents,
        fallback_query=grounding_query or query,
        use_dry_plan=use_dry_plan,
        data_source=data_source,
        allow_dry_plan_fallback=allow_dry_plan_fallback,
        allow_data_preview=allow_data_preview,
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
        allow_dry_plan_fallback: bool = True,
        allow_data_preview: bool = False,
        sql_knowledge: SqlKnowledge | None = None,
        grounding_query: str | None = None,
        validation_contexts: list[str] | None = None,
    ):
        logger.info(
            "SQL Generation pipeline is running for project_id=%s mdl_hash=%s",
            project_id or "",
            mdl_hash or "",
        )

        if project_id or use_dry_plan:
            metadata = await retrieve_metadata(
                project_id or "", self._retriever, mdl_hash
            )
        else:
            metadata = {}
        data_source = metadata.get("data_source", "local_file")

        effective_grounding_query = grounding_query or query
        unsupported_result = unsupported_schema_generation_result(
            effective_grounding_query,
            contexts=contexts,
            data_source=data_source,
        )
        if unsupported_result:
            logger.info(
                "SQL generation skipped before LLM because selected schema does not cover requested concepts: %s",
                unsupported_result["invalid_generation_result"]["error"],
            )
            return {"post_process": unsupported_result}

        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "grounding_query": effective_grounding_query,
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
                "validation_contexts": validation_contexts,
                **self._components,
            },
        )

    async def run_deterministic_fast_path(
        self,
        query: str,
        contexts: list[str],
        project_id: str | None = None,
        mdl_hash: str | None = None,
        use_dry_plan: bool = False,
        allow_dry_plan_fallback: bool = True,
        allow_data_preview: bool = False,
        grounding_query: str | None = None,
    ) -> dict | None:
        if use_dry_plan:
            metadata = await retrieve_metadata(
                project_id or "", self._retriever, mdl_hash
            )
        else:
            metadata = {}
        data_source = metadata.get("data_source", "local_file")
        effective_grounding_query = grounding_query or query

        unsupported_result = unsupported_schema_generation_result(
            effective_grounding_query,
            contexts=contexts,
            data_source=data_source,
        )
        if unsupported_result:
            logger.info(
                "SQL generation deterministic fast path returned unsupported schema before LLM."
            )
            return {"post_process": unsupported_result, "fast_path": "unsupported"}

        deterministic_sql = generate_simple_analytics_sql(
            effective_grounding_query,
            contexts,
        )
        if not deterministic_sql:
            return None

        logger.info("SQL generation deterministic fast path produced a candidate.")
        post_process = await self._components["post_processor"].run(
            [deterministic_sql],
            project_id=project_id,
            mdl_hash=mdl_hash,
            contexts=contexts,
            fallback_query=effective_grounding_query,
            use_dry_plan=use_dry_plan,
            data_source=data_source,
            allow_dry_plan_fallback=allow_dry_plan_fallback,
            allow_data_preview=allow_data_preview,
        )
        if post_process.get("valid_generation_result"):
            logger.info("SQL generation deterministic fast path accepted candidate.")
            return {"post_process": post_process, "fast_path": "deterministic"}

        logger.info(
            "SQL generation deterministic fast path rejected candidate; continuing to LLM. reason=%s",
            post_process.get("invalid_generation_result", {}).get("error"),
        )
        return None
