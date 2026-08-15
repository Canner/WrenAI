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
You are a great Wren SQL expert with exceptional logical thinking skills and debugging skills.

### SQL CORRECTION INSTRUCTIONS ###

Now you are given a database schema, a user's question, a sql generation reasoning, an original SQL query, and an execution error.
The original SQL query may contain invalid or invented identifiers.
Please read the SQL rules carefully and generate a new Wren SQL query that fixes the original SQL query while using only identifiers and functions grounded in the current DATABASE SCHEMA and SQL FUNCTIONS.
Map business terms through retrieved schema descriptions, aliases, display labels, metrics, and relationships to exact deployed identifiers.
Treat invalid object name, dataset not found, table not found, column not found, unknown relation, and invalid identifier errors as schema-grounding failures.
Do not create dummy CTEs, placeholder tables, metadata checks, or similar-looking replacement identifiers to make the query executable.

### SQL RULES ###
Make sure you follow the SQL Rules strictly.

{text_to_sql_rules}

### FINAL ANSWER FORMAT ###
The final answer must be a SQL query in JSON format. Return one grounded SQL string using only exact identifiers from the current DATABASE SCHEMA and supported SQL FUNCTIONS.

{{
    "sql": <SQL_QUERY_STRING>
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
{% endif %}
{% if sql_generation_reasoning %}
### SQL GENERATION REASONING ###
The following reasoning is a candidate plan for the current question. Use it to understand intent, selected datasets, selected fields, joins, grouping, ordering, and limits. Before using any table, column, relationship, or function mentioned in the plan, verify the exact identifier against DATABASE SCHEMA, WREN SQL IDENTIFIER CONTRACT, EXECUTABLE WREN IDENTIFIER CATALOG, or SQL FUNCTIONS. Ignore any unsupported SQL fragment, alias, literal, placeholder, or identifier-like text.
If the reasoning says a concept is unsupported but DATABASE SCHEMA provides exact identifiers whose descriptions, aliases, display labels, metrics, calculated fields, or relationships represent that concept, prefer DATABASE SCHEMA and generate SQL with those exact identifiers.
If DATABASE SCHEMA supports only a meaningful subset of the request, generate SQL for that grounded subset instead of returning empty SQL.
{{ sql_generation_reasoning }}
{% endif %}
### ORIGINAL SQL QUERY ###
The original SQL may contain invalid identifiers. Use it only to understand the failed attempt; do not copy any table, column, alias, function, literal, or SQL fragment unless it is grounded in the current DATABASE SCHEMA.
{{ invalid_generation_result.sql }}

### ERROR MESSAGE ###
{{ invalid_generation_result.error }}

Generate the final JSON response now.
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
    mdl_hash: str | None = None,
    use_dry_plan: bool = False,
    allow_dry_plan_fallback: bool = True,
) -> dict:
    return await post_processor.run(
        generate_sql_correction.get("replies"),
        project_id=project_id,
        mdl_hash=mdl_hash,
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
        mdl_hash: str | None = None,
        validation_contexts: list[str] | None = None,
        use_dry_plan: bool = False,
        allow_dry_plan_fallback: bool = True,
        sql_knowledge: SqlKnowledge | None = None,
    ):
        logger.info("SQLCorrection pipeline is running...")

        if use_dry_plan:
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
                "validation_contexts": validation_contexts,
                "use_dry_plan": use_dry_plan,
                "allow_dry_plan_fallback": allow_dry_plan_fallback,
                "data_source": metadata.get("data_source", "local_file"),
                "sql_knowledge": sql_knowledge,
                **self._components,
            },
        )
