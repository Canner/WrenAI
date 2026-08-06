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
    build_executable_schema_contract,
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
You are an ANSI SQL expert with exceptional logical thinking skills and debugging skills.
You need to regenerate one grounded Wren SQL query from the user's question and current DATABASE SCHEMA.
The failed SQL and error message are diagnostic context only.

### SQL CORRECTION INSTRUCTIONS ###

1. First, use the error message only to understand why the previous SQL failed.
2. Then, ignore any failed SQL identifier, placeholder, literal, or function that is not declared in the current DATABASE SCHEMA or SQL FUNCTIONS.
3. Regenerate the SQL from the user's question, DATABASE SCHEMA, SQL FUNCTIONS, and USER INSTRUCTIONS.
4. If the user's requested intent cannot be fully grounded by the current DATABASE SCHEMA and SQL FUNCTIONS, return null for sql instead of repairing the failed SQL approximately.

### SQL RULES ###
Make sure you follow the SQL Rules strictly.

{text_to_sql_rules}

### FINAL ANSWER FORMAT ###
The final answer must be in JSON format:

{{
    "sql": "corrected SQL query string using only identifiers declared in DATABASE SCHEMA, or null"
}}
"""


sql_correction_user_prompt_template = """
{% if executable_schema_contract %}
{{ executable_schema_contract }}

{% endif %}

{% if documents %}
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

{% if query %}
### QUESTION ###
User's Question: {{ query }}
{% endif %}

{% if executable_schema_contract %}
### ALLOWED EXECUTABLE IDENTIFIERS FOR THIS CORRECTION ###
{{ executable_schema_contract }}
{% endif %}

### FAILED SQL DIAGNOSTIC CONTEXT ###
Failed SQL: {{ invalid_generation_result.sql }}
Error Message: {{ invalid_generation_result.error }}

Regenerate from the user's question and DATABASE SCHEMA only when a user question is available. Otherwise, correct the failed SQL only by using exact executable identifiers declared in DATABASE SCHEMA or SQL FUNCTIONS. Do not copy table names, column names, functions, literals, aliases, or SQL structure from the failed SQL unless each one is declared in DATABASE SCHEMA or SQL FUNCTIONS.
Correct into an intent-shaped query, not a table preview. Select explicit columns, filters, groupings, measures, joins, ordering, and limits needed by the question. For metric questions, return dimensions plus the requested measure or grounded expression; never use SELECT * as a substitute.
If the error says the SQL is a broad table preview, table preview, missing requested aggregation, missing requested grouping, missing timeframe, or missing ordering/ranking, rebuild the query shape from the user's question. When DATABASE SCHEMA contains column_role_hints_not_identifiers, use those roles only to map intent to exact declared columns. For timeframe requests, filter an exact date_time_candidate column with a bounded range. For aggregate, "by", trend, or ranking requests, aggregate exact numeric_measure_candidate columns or count rows, group by exact dimension/date expressions, order by the selected aggregate alias when ranking, and limit only when requested.
Return only the final JSON SQL response.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    documents: List[Document],
    invalid_generation_result: Dict,
    prompt_builder: PromptBuilder,
    query: str | None = None,
    instructions: list[dict] | None = None,
    sql_functions: list[SqlFunction] | None = None,
    schema_contracts: list[dict] | None = None,
) -> dict:
    _prompt = prompt_builder.run(
        documents=documents,
        executable_schema_contract=build_executable_schema_contract(schema_contracts),
        invalid_generation_result=invalid_generation_result,
        query=query or "",
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
    query: str | None = None,
    project_id: str | None = None,
    use_dry_plan: bool = False,
    allow_dry_plan_fallback: bool = False,
    schema_contracts: list[dict] | None = None,
) -> dict:
    return await post_processor.run(
        generate_sql_correction.get("replies"),
        project_id=project_id,
        use_dry_plan=use_dry_plan,
        data_source=data_source,
        allow_dry_plan_fallback=allow_dry_plan_fallback,
        schema_contracts=schema_contracts,
        query=query,
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
        mdl_hash: str | None = None,
        use_dry_plan: bool = False,
        allow_dry_plan_fallback: bool = False,
        sql_knowledge: SqlKnowledge | None = None,
        schema_contracts: list[dict] | None = None,
    ):
        logger.info("SQLCorrection pipeline is running...")

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
                "invalid_generation_result": invalid_generation_result,
                "query": query,
                "documents": contexts,
                "instructions": instructions,
                "sql_functions": sql_functions,
                "project_id": project_id,
                "mdl_hash": mdl_hash,
                "use_dry_plan": use_dry_plan,
                "allow_dry_plan_fallback": allow_dry_plan_fallback,
                "data_source": metadata.get("data_source", "local_file"),
                "sql_knowledge": sql_knowledge,
                "schema_contracts": schema_contracts,
                **self._components,
            },
        )
