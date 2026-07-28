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
You are an ANSI SQL expert with exceptional logical thinking skills and debugging skills. Regenerate a grounded Wren SQL query from the user's question and the current DATABASE SCHEMA after a previous SQL attempt failed.

### SQL CORRECTION INSTRUCTIONS ###

1. First, use the error message only to identify which part of the failed SQL was unsupported by DATABASE SCHEMA, SQL FUNCTIONS, or USER INSTRUCTIONS.
2. Then, generate a syntactically correct ANSI SQL query from the user's intent and the current DATABASE SCHEMA.
3. If the invalid SQL contains a table, column, function, literal value, or metadata-table query that is not supported by the current DATABASE SCHEMA or SQL FUNCTIONS, do not preserve it.
4. Never correct an invalid SQL query by checking INFORMATION_SCHEMA or system catalogs.
5. If a user question is provided, treat it as the source of intent and regenerate the SQL from that intent using DATABASE SCHEMA instead of repairing guessed identifiers.
6. Treat SQL diagnosis and the invalid SQL as error context only. Do not copy placeholders, assumed table names, assumed column names, or unsupported functions from them.
7. Do not preserve a table, column, join, filter, grouping, ordering, or function from the failed SQL unless it appears exactly in DATABASE SCHEMA or SQL FUNCTIONS.

### SQL RULES ###
Make sure you follow the SQL Rules strictly.

{text_to_sql_rules}

### FINAL ANSWER FORMAT ###
The final answer must be in JSON format:

{{
    "sql": <CORRECTED_SQL_QUERY_STRING>
}}
"""


sql_correction_user_prompt_template = """
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

### QUESTION ###
{% if query %}
User's Question: {{ query }}
Answer the user's intent using the current DATABASE SCHEMA. Use comments, aliases, descriptions, calculated fields, metrics, and relationships only to understand meaning; the SQL must use exact declared table and column names from DATABASE SCHEMA. Do not copy semantic labels or inferred names into executable SQL.
{% endif %}
{% if sql_generation_reasoning %}
### REASONING PLAN ###
Use this reasoning plan only as non-executable context. Ignore any SQL fragments, placeholder identifiers, inferred identifiers, unsupported functions, or identifiers not present in DATABASE SCHEMA.
{{ sql_generation_reasoning }}
{% endif %}
### FAILED SQL ###
This SQL failed dry run. Do not preserve any identifier or function from it unless it appears exactly in DATABASE SCHEMA or SQL FUNCTIONS.
{{ invalid_generation_result.sql }}
Error Message: {{ invalid_generation_result.error }}

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
) -> dict:
    return await post_processor.run(
        generate_sql_correction.get("replies"),
        project_id=project_id,
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
                **self._components,
            },
        )
