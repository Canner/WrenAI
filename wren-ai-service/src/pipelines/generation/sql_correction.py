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
    construct_instructions,
    construct_schema_identifier_catalog,
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

1. First, think hard about the error message, and figure out the root cause first(please use the DATABASE SCHEMA, SQL FUNCTIONS and USER INSTRUCTIONS to help you figure out the root cause).
2. Then, generate the syntactically correct ANSI SQL query to correct the error.
3. If the failed SQL references a table, view, column, function, alias, or placeholder that is not present in DATABASE SCHEMA or SQL FUNCTIONS, do not preserve it. Regenerate from the USER QUESTION and DATABASE SCHEMA.
4. Treat invalid object name, dataset not found, table not found, invalid column name, and invalid identifier errors as schema-grounding failures. Use exact declared identifiers from DATABASE SCHEMA only.
5. If the error reports an unknown table or field, replace it only with an exact executable identifier declared in DATABASE SCHEMA or SQL FUNCTIONS. Do not retry the same unknown identifier.
6. Do not create dummy CTEs, placeholder tables, table-existence checks, or generic replacement names to make the query executable. If the requested intent is supported by retrieved schema objects, use those exact objects; otherwise return null for sql.
7. For grouped queries, repair SQL Server errors about ORDER BY columns not appearing in GROUP BY by ordering with selected grouping columns or selected aggregate aliases, or by adding the exact ordering key to both SELECT and GROUP BY when that key is declared in DATABASE SCHEMA.
8. Do not preserve generic log, file, JSON, payload, text, or app-metric scans when DATABASE SCHEMA contains exact modeled business columns for the user's requested entity, measure, status, date, or dimension.
9. If the failed SQL invented component fields for a metric that exists directly in DATABASE SCHEMA, replace the calculation with the exact declared metric column.
10. Do not route a question to a different business domain because of generic keyword overlap. Use only retrieved schema metadata that directly represents the requested entities, measures, filters, dates, and dimensions.

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
{{ schema_identifier_catalog }}

The WREN SQL IDENTIFIER CONTRACT above is the authoritative executable schema.
The DATABASE SCHEMA below provides type, semantic, and relationship details for those exact identifiers.

### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document }}
{% endfor %}
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
Answer the user's intent using the current DATABASE SCHEMA. Use comments, aliases, descriptions, calculated fields, metrics, and relationships only to understand meaning; the SQL must use exact declared table and column names from the WREN SQL IDENTIFIER CONTRACT and DATABASE SCHEMA. Treat source metadata, physical names, lineage names, semantic labels, diagnostic text, and user question words as non-executable background unless the exact same identifier is declared in the contract. If a needed table, output column, filter column, grouping column, relation, date field, measure, or function is not declared in DATABASE SCHEMA or SQL FUNCTIONS, return null for sql instead of inventing, substituting, or approximating a similar name. If the retrieved schema does not ground the user's primary requested intent, return null for sql instead of querying an unrelated object.
If any planned SQL identifier cannot be copied exactly from DATABASE SCHEMA or WREN SQL IDENTIFIER CONTRACT, stop and return null for sql. Never create a table or column from the user's wording, failed SQL, dry-run diagnostic, or reasoning plan.
{% endif %}
### FAILED SQL ###
The failed SQL below is diagnostic context only. It is not an executable schema source.
Only preserve an identifier, function, literal filter, grouping, ordering, or join from this SQL when it is also declared exactly in the WREN SQL IDENTIFIER CONTRACT, DATABASE SCHEMA, SQL FUNCTIONS, or USER INSTRUCTIONS.
If it contains placeholders, assumed business names, connector-specific syntax, source/physical names, or unsupported objects, discard those parts and regenerate from the QUESTION plus DATABASE SCHEMA.

{% if invalid_generation_result and invalid_generation_result.sql %}
{{ invalid_generation_result.sql }}
{% else %}
No failed SQL was provided.
{% endif %}

### DRY-RUN DIAGNOSTIC ###
The diagnostic below explains why the previous SQL failed. Use it to understand the failure only.
Do not copy identifiers, source names, physical names, SQL fragments, or replacement candidates from the diagnostic unless they appear exactly in the WREN SQL IDENTIFIER CONTRACT, DATABASE SCHEMA, SQL FUNCTIONS, or USER INSTRUCTIONS.

{% if invalid_generation_result and invalid_generation_result.error %}
{{ invalid_generation_result.error }}
{% else %}
No dry-run diagnostic was provided.
{% endif %}

Regenerate from the user question, current DATABASE SCHEMA, and the diagnostic failure. Keep DATABASE SCHEMA as the only executable identifier source.

Return only the final JSON SQL response.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    documents: list[str],
    invalid_generation_result: Dict,
    prompt_builder: PromptBuilder,
    query: str | None = None,
    sql_generation_reasoning: str | None = None,
    instructions: list[dict] | None = None,
    sql_functions: list[SqlFunction] | None = None,
) -> dict:
    _prompt = prompt_builder.run(
        query=query,
        documents=documents,
        invalid_generation_result=invalid_generation_result,
        sql_generation_reasoning=sql_generation_reasoning,
        instructions=construct_instructions(
            instructions=instructions,
        ),
        sql_functions=sql_functions,
        schema_identifier_catalog=construct_schema_identifier_catalog(documents),
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
    documents: List[Document] | None = None,
    query: str | None = None,
    project_id: str | None = None,
    mdl_hash: str | None = None,
    validation_contexts: list[str] | None = None,
    use_dry_plan: bool = False,
    allow_dry_plan_fallback: bool = True,
) -> dict:
    return await post_processor.run(
        generate_sql_correction.get("replies"),
        project_id=project_id,
        mdl_hash=mdl_hash,
        contexts=documents,
        fallback_query=query,
        use_dry_plan=use_dry_plan,
        data_source=data_source,
        allow_dry_plan_fallback=allow_dry_plan_fallback,
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
        contexts: list[str],
        invalid_generation_result: Dict[str, str],
        query: str | None = None,
        sql_generation_reasoning: str | None = None,
        instructions: list[dict] | None = None,
        sql_functions: list[SqlFunction] | None = None,
        project_id: str | None = None,
        mdl_hash: str | None = None,
        use_dry_plan: bool = False,
        allow_dry_plan_fallback: bool = True,
        sql_knowledge: SqlKnowledge | None = None,
        validation_contexts: list[str] | None = None,
    ):
        logger.info("SQLCorrection pipeline is running...")

        if project_id or use_dry_plan:
            metadata = await retrieve_metadata(
                project_id or "", self._retriever, mdl_hash
            )
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
                "mdl_hash": mdl_hash,
                "use_dry_plan": use_dry_plan,
                "allow_dry_plan_fallback": allow_dry_plan_fallback,
                "data_source": metadata.get("data_source", "local_file"),
                "sql_knowledge": sql_knowledge,
                "validation_contexts": validation_contexts,
                **self._components,
            },
        )
