import logging
import sys
from typing import Any, Dict, List

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack import Document
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider, LLMProvider
from src.pipelines.common import clean_up_new_lines, retrieve_metadata
from src.pipelines.generation.utils.sql import (
    SQL_GENERATION_MODEL_KWARGS,
    SQLGenPostProcessor,
    construct_executable_identifier_catalog,
    construct_instructions,
    get_text_to_sql_rules,
)
from src.pipelines.retrieval.sql_functions import SqlFunction
from src.pipelines.retrieval.sql_knowledge import SqlKnowledge
from src.utils import trace_cost

logger = logging.getLogger("wren-ai-service")


def get_sql_correction_system_prompt(sql_knowledge: SqlKnowledge | None = None) -> str:
    text_to_sql_rules = get_text_to_sql_rules(sql_knowledge)

    return f"""
### TASK ###
You are a Wren SQL expert with exceptional logical thinking skills and debugging skills. Regenerate a grounded Wren SQL query from the user's question and the current DATABASE SCHEMA after a previous SQL attempt failed.

### SQL CORRECTION INSTRUCTIONS ###

1. First, use the error message only to identify which part of the failed SQL was unsupported by DATABASE SCHEMA, SQL FUNCTIONS, or USER INSTRUCTIONS.
2. Then, generate a syntactically correct Wren SQL query from the user's intent and the current DATABASE SCHEMA.
3. If the invalid SQL contains a table, column, function, literal value, or metadata-table query that is not supported by the current DATABASE SCHEMA or SQL FUNCTIONS, do not preserve it.
4. Never correct an invalid SQL query by checking INFORMATION_SCHEMA or system catalogs.
5. If a user question is provided, treat it as the source of intent and regenerate the SQL from that intent using DATABASE SCHEMA instead of repairing guessed identifiers.
6. Treat SQL diagnosis and the invalid SQL as error context only. Do not copy placeholders, assumed table names, assumed column names, or unsupported functions from them.
7. Do not preserve a table, column, join, filter, grouping, ordering, or function from the failed SQL unless it appears exactly in DATABASE SCHEMA or SQL FUNCTIONS.
8. Treat physical/source/lineage names from the failed SQL, error message, reasoning, comments, aliases, descriptions, or samples as semantic context only; never use them as executable identifiers unless the exact same identifier appears in DATABASE SCHEMA.
9. If the error is an invalid object, invalid column, unsupported function, or date/type failure, do not try a similar replacement from source metadata. Regenerate from the user's intent and current DATABASE SCHEMA. If the unsupported part is needed to answer the requested subject, output column, filter, grouping, measure, timeframe, or relationship, return null for sql instead of substituting non-schema identifiers.
10. If the failed SQL used connector-specific syntax such as TOP, square-bracket identifiers, backticks, or non-Wren identifier quoting, discard that syntax and regenerate using Wren SQL syntax only.

### SQL RULES ###
Make sure you follow the SQL Rules strictly.

{text_to_sql_rules}

### FINAL ANSWER FORMAT ###
The final answer must be JSON. Return a SQL string only when it is fully grounded in DATABASE SCHEMA and SQL FUNCTIONS and answers the user's requested intent. Do not create table or column identifiers from the user's wording. If no fully grounded SQL can be generated, return null for sql.

{{
    "sql": "corrected SQL query string using only identifiers declared in DATABASE SCHEMA, or null"
}}
"""


sql_correction_user_prompt_template = """
{% if documents %}
### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document }}
{% endfor %}

{% if executable_identifier_catalog %}
{{ executable_identifier_catalog }}
{% endif %}
{% endif %}

{% if sql_functions %}
### SQL FUNCTIONS ###
{% for function in sql_functions %}
{{ function }}
{% endfor %}
{% endif %}

{% if instructions %}
### USER INSTRUCTIONS ###
{% for instruction in instructions %}
{{ loop.index }}. {{ instruction }}
{% endfor %}
{% endif %}

### QUESTION ###
{% if query %}
User's Question: {{ query }}
Before writing SQL, review every DATABASE SCHEMA document supplied in this prompt. Select table, view, metric, and column identifiers only from schema objects whose declared fields support the user's requested subject, output columns, filters, groupings, measures, time concepts, and relationships. Do not use the first retrieved object by default; retrieval rank is only candidate order. If a declared identifier contains prefixes, numeric ordinals, underscores, spaces, punctuation, casing, abbreviations, or suffixes, copy the whole identifier exactly as declared and do not rebuild it from the business meaning.
Answer the user's intent using the current DATABASE SCHEMA. Use comments, aliases, descriptions, source metadata, physical names, lineage names, calculated fields, metrics, and relationships only to understand meaning; the SQL must use exact declared table and column names from DATABASE SCHEMA. Do not copy semantic labels, source/physical/lineage names, diagnostic text, user question words, or inferred names into executable SQL. If a needed table, output column, filter column, grouping column, relation, date field, measure, or function is not declared in DATABASE SCHEMA or SQL FUNCTIONS, return null for sql instead of inventing, substituting, or approximating a similar name. If the retrieved schema does not ground the user's primary requested intent, return null for sql instead of querying an unrelated object.
If any planned SQL identifier cannot be copied exactly from DATABASE SCHEMA or WREN SQL IDENTIFIER CONTRACT, stop and return null for sql. Never create a table or column from the user's wording, failed SQL, dry-run diagnostic, or reasoning plan.
{% endif %}
### FAILED SQL ###
The failed SQL is intentionally omitted so it cannot provide executable identifiers, literal values, placeholders, functions, SQL patterns, or unsupported object names.

### DRY-RUN DIAGNOSTIC ###
The dry-run diagnostic text is intentionally omitted because it may contain failed SQL, guessed identifiers, connector-specific syntax, source names, physical names, or invalid replacement candidates.

{% if invalid_generation_result.get("type") == "MANIFEST_GROUNDING" %}
### MANIFEST GROUNDING FAILURE ###
The previous generated SQL was rejected before dry-run because it was not fully grounded in the retrieved Wren schema.
{{ invalid_generation_result.get("error", "") }}
Do not reuse rejected identifiers. Regenerate from the user question and the exact table and column identifiers in DATABASE SCHEMA only.
{% endif %}

Regenerate from the user question and current DATABASE SCHEMA only. Do not repair, preserve, or copy anything from the failed SQL or dry-run diagnostic.

Return only the final JSON SQL response.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    documents: List[Document],
    invalid_generation_result: Dict,
    prompt_builder: PromptBuilder,
    query: str | None = None,
    sql_generation_reasoning: str | None = None,
    instructions: list[dict] | None = None,
    sql_functions: list[SqlFunction] | None = None,
    schema_manifest: dict[str, list[str]] | None = None,
) -> dict:
    _prompt = prompt_builder.run(
        query=query,
        documents=documents,
        executable_identifier_catalog=construct_executable_identifier_catalog(
            schema_manifest
        ),
        invalid_generation_result=invalid_generation_result,
        sql_generation_reasoning=sql_generation_reasoning,
        instructions=construct_instructions(
            instructions=instructions,
        ),
        sql_functions=sql_functions,
    )
    return {"prompt": clean_up_new_lines(_prompt.get("prompt"))}


@observe(as_type="generation", capture_input=False)
@trace_cost
async def generate_sql_correction(
    prompt: dict,
    generator: Any,
    generator_name: str,
    sql_knowledge: SqlKnowledge | None = None,
) -> dict:
    current_system_prompt = get_sql_correction_system_prompt(sql_knowledge)
    return await generator(
        prompt=prompt.get("prompt"), current_system_prompt=current_system_prompt
    ), generator_name


@observe(capture_input=False)
async def post_process(
    generate_sql_correction: dict,
    post_processor: SQLGenPostProcessor,
    data_source: str,
    project_id: str | None = None,
    use_dry_plan: bool = False,
    allow_dry_plan_fallback: bool = True,
    schema_manifest: dict[str, list[str]] | None = None,
) -> dict:
    return await post_processor.run(
        generate_sql_correction.get("replies"),
        project_id=project_id,
        use_dry_plan=use_dry_plan,
        data_source=data_source,
        allow_dry_plan_fallback=allow_dry_plan_fallback,
        schema_manifest=schema_manifest,
    )


## End of Pipeline


class SQLCorrection(BasicPipeline):
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
                system_prompt=get_sql_correction_system_prompt(None),
                generation_kwargs=SQL_GENERATION_MODEL_KWARGS,
            ),
            "generator_name": llm_provider.get_model(),
            "prompt_builder": PromptBuilder(
                template=sql_correction_user_prompt_template
            ),
            "post_processor": SQLGenPostProcessor(engine=engine),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="SQL Correction")
    async def run(
        self,
        contexts: List[Document],
        invalid_generation_result: Dict[str, str],
        query: str | None = None,
        sql_generation_reasoning: str | None = None,
        instructions: list[dict] | None = None,
        sql_functions: list[SqlFunction] | None = None,
        project_id: str | None = None,
        use_dry_plan: bool = False,
        allow_dry_plan_fallback: bool = True,
        sql_knowledge: SqlKnowledge | None = None,
        schema_manifest: dict[str, list[str]] | None = None,
    ):
        logger.info("SQLCorrection pipeline is running...")

        if use_dry_plan:
            metadata = await retrieve_metadata(project_id or "", self._retriever)
        else:
            metadata = {}

        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "invalid_generation_result": invalid_generation_result,
                "query": query,
                "documents": contexts,
                "sql_generation_reasoning": sql_generation_reasoning,
                "instructions": instructions,
                "sql_functions": sql_functions,
                "project_id": project_id,
                "use_dry_plan": use_dry_plan,
                "allow_dry_plan_fallback": allow_dry_plan_fallback,
                "data_source": metadata.get("data_source", "local_file"),
                "sql_knowledge": sql_knowledge,
                "schema_manifest": schema_manifest,
                **self._components,
            },
        )
