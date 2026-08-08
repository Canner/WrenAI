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
    add_schema_grounding_to_system_prompt,
    construct_instructions,
    get_additional_sql_instructions,
    get_text_to_sql_rules,
)
from src.pipelines.retrieval.sql_functions import SqlFunction
from src.pipelines.retrieval.sql_knowledge import SqlKnowledge
from src.utils import trace_cost

logger = logging.getLogger("wren-ai-service")


def get_sql_correction_system_prompt(sql_knowledge: SqlKnowledge | None = None) -> str:
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
You are a Wren SQL expert with exceptional logical thinking skills and debugging skills, you need to fix the syntactically incorrect Wren SQL query for the configured data source.

### SQL CORRECTION INSTRUCTIONS ###

1. First, think hard about the error message, and figure out the root cause first(please use the DATABASE SCHEMA, SQL FUNCTIONS and USER INSTRUCTIONS to help you figure out the root cause).
2. Then, generate the syntactically correct Wren SQL query to correct the error.

### SQL RULES ###
Make sure you follow the SQL Rules strictly.

{text_to_sql_rules}

{additional_sql_instructions_section}

### FINAL ANSWER FORMAT ###
The final answer must be one JSON object and nothing else. Do not return markdown, explanations, reasoning, or a query plan object.
The JSON object must have exactly one key named "sql". Do not use keys such as "query", "sql_function", "arguments", "columns", "table", or "where".
The value of "sql" must be one corrected Wren SQL SELECT statement string.

{{
    "sql": "SELECT ..."
}}
"""


sql_correction_user_prompt_template = """
{% if documents %}
### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document }}
{% endfor %}
{% endif %}

{% if schema_grounding %}
### RETRIEVED EXECUTABLE SCHEMA ###
The following identifiers come from Ask Retrieval for this question. Use these exact model/table and column names when correcting SQL.
{{ schema_grounding }}
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
Correct the SQL so it dry-plans and dry-runs successfully for this configured data source through Wren Engine/IBIS.
Follow SQL KNOWLEDGE and SQL FUNCTIONS for this data source. Do not preserve unsupported functions, cast styles, interval literals, or date/time expressions from the failed SQL.
{% endif %}

{% if instructions %}
### USER INSTRUCTIONS ###
{% for instruction in instructions %}
{{ loop.index }}. {{ instruction }}
{% endfor %}
{% endif %}

### QUESTION ###
User's Question: {{ query }}
Validation Type: {{ invalid_generation_result.type or "UNKNOWN" }}
{% if invalid_generation_result.type == "SCHEMA_GROUNDING" %}
Rejected SQL: omitted because it contains ungrounded executable identifiers.
{% else %}
SQL: {{ invalid_generation_result.sql }}
{% endif %}
Error Message: {{ invalid_generation_result.error }}

Use DATABASE SCHEMA and RETRIEVED EXECUTABLE SCHEMA as the only sources for executable table and column identifiers. The invalid SQL and error message explain what failed, but they must not introduce identifiers that are absent from the retrieved schema.
If Validation Type is SCHEMA_GROUNDING, regenerate the SQL from the user's question and retrieved schema. Do not reuse table names, column names, aliases, or SQL fragments from the rejected SQL.
If the invalid SQL contains a table or column name that is not listed as a retrieved model/table or column identifier, replace it using the retrieved schema rather than preserving it.
Choose the FROM model/table from the retrieved schema only. Add WHERE only for requested filters or time ranges that map to retrieved columns. Add GROUP BY only for requested totals, counts, distributions, comparisons, or trends. Add ORDER BY only for ranking, sorting, recent/latest, or deterministic LIMIT requests. Use JOIN only when multiple retrieved models are required and the retrieved schema declares the relationship; otherwise answer from one model when possible.
Think through the error silently. Return only the final JSON SQL response.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    documents: List[Document],
    invalid_generation_result: Dict,
    prompt_builder: PromptBuilder,
    query: str | None = None,
    schema_grounding: str | None = None,
    instructions: list[dict] | None = None,
    sql_functions: list[SqlFunction] | None = None,
    data_source: str | None = None,
) -> dict:
    _prompt = prompt_builder.run(
        documents=documents,
        schema_grounding=schema_grounding,
        invalid_generation_result=invalid_generation_result,
        query=query or "",
        instructions=construct_instructions(
            instructions=instructions,
        ),
        sql_functions=sql_functions,
        data_source=data_source,
    )
    return {"prompt": clean_up_new_lines(_prompt.get("prompt"))}


@observe(as_type="generation", capture_input=False)
@trace_cost
async def generate_sql_correction(
    prompt: dict,
    generator: Any,
    generator_name: str,
    sql_knowledge: SqlKnowledge | None = None,
    schema_grounding: str | None = None,
) -> dict:
    current_system_prompt = add_schema_grounding_to_system_prompt(
        get_sql_correction_system_prompt(sql_knowledge),
        schema_grounding,
    )
    return await generator(
        prompt=prompt.get("prompt"),
        current_system_prompt=current_system_prompt,
    ), generator_name


@observe(capture_input=False)
async def post_process(
    generate_sql_correction: dict,
    post_processor: SQLGenPostProcessor,
    data_source: str,
    schema_grounding: str | None = None,
    query: str | None = None,
    project_id: str | None = None,
    mdl_hash: str | None = None,
    use_dry_plan: bool = False,
    allow_dry_plan_fallback: bool = False,
) -> dict:
    return await post_processor.run(
        generate_sql_correction.get("replies"),
        project_id=project_id,
        mdl_hash=mdl_hash,
        use_dry_plan=use_dry_plan,
        data_source=data_source,
        allow_dry_plan_fallback=allow_dry_plan_fallback,
        schema_grounding=schema_grounding,
        meta=generate_sql_correction.get("meta"),
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
        self.generation_timeout_seconds = llm_provider.get_timeout()
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
        schema_grounding: str | None = None,
        instructions: list[dict] | None = None,
        sql_functions: list[SqlFunction] | None = None,
        project_id: str | None = None,
        mdl_hash: str | None = None,
        use_dry_plan: bool = False,
        allow_dry_plan_fallback: bool = False,
        sql_knowledge: SqlKnowledge | None = None,
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
                "schema_grounding": schema_grounding,
                "instructions": instructions,
                "sql_functions": sql_functions,
                "project_id": project_id,
                "mdl_hash": mdl_hash,
                "use_dry_plan": use_dry_plan,
                "allow_dry_plan_fallback": allow_dry_plan_fallback,
                "data_source": metadata.get("data_source", "local_file"),
                "sql_knowledge": sql_knowledge,
                **self._components,
            },
        )
