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
You are an ANSI SQL expert with exceptional logical thinking skills and debugging skills, you need to fix the syntactically incorrect ANSI SQL query.

### SQL CORRECTION INSTRUCTIONS ###

1. First, think hard about the error message, and figure out the root cause first(please use the DATABASE SCHEMA, SQL FUNCTIONS and USER INSTRUCTIONS to help you figure out the root cause).
2. Then, generate the syntactically correct ANSI SQL query to correct the error.
3. Treat missing table, missing dataset, missing view, missing relation, missing column, and invalid identifier errors as schema-grounding failures.
4. Use ONLY tables, views, columns, and relationships present in the DATABASE SCHEMA section.
5. Do not create dummy CTEs, placeholder tables, or SELECT 1 CTEs to simulate missing schema objects.
6. Do not rename an invalid table or column to a similar-looking object unless that exact object is present in DATABASE SCHEMA and still satisfies the original user question.
7. Preserve the active user question and reasoning intent while replacing unsupported objects with a valid schema-grounded plan.

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
### DEPLOYMENT SCOPE ###
Project ID: {{ project_id }}
MDL Hash: {{ mdl_hash }}
Correct the SQL only against the DATABASE SCHEMA documents retrieved for this deployment scope. The invalid SQL and error message are not schema authority; replace identifiers that are not present in this deployment's DATABASE SCHEMA with valid deployed identifiers, or avoid them.

{% if documents %}
### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document }}
{% endfor %}
{% endif %}

{% if invalid_generation_result.question %}
### USER QUESTION ###
{{ invalid_generation_result.question }}
{% endif %}

{% if invalid_generation_result.reasoning_plan %}
### REASONING PLAN ###
{{ invalid_generation_result.reasoning_plan }}
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
SQL: {{ invalid_generation_result.sql }}
{% if invalid_generation_result.execution_error %}
Execution Error: {{ invalid_generation_result.execution_error }}
{% endif %}
Error Message: {{ invalid_generation_result.error }}

Let's think step by step.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    documents: List[Document],
    invalid_generation_result: Dict,
    prompt_builder: PromptBuilder,
    instructions: list[dict] | None = None,
    sql_functions: list[SqlFunction] | None = None,
    project_id: str | None = None,
    mdl_hash: str | None = None,
) -> dict:
    _prompt = prompt_builder.run(
        documents=documents,
        invalid_generation_result=invalid_generation_result,
        project_id=project_id or "",
        mdl_hash=mdl_hash or "",
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
        prompt=prompt.get("prompt"),
        current_system_prompt=current_system_prompt,
    ), generator_name


@observe(capture_input=False)
async def post_process(
    generate_sql_correction: dict,
    post_processor: SQLGenPostProcessor,
    data_source: str,
    documents: List[Document] | None = None,
    project_id: str | None = None,
    mdl_hash: str | None = None,
    use_dry_plan: bool = False,
    allow_dry_plan_fallback: bool = True,
) -> dict:
    return await post_processor.run(
        generate_sql_correction.get("replies"),
        project_id=project_id,
        mdl_hash=mdl_hash,
        contexts=documents,
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
        instructions: list[dict] | None = None,
        sql_functions: list[SqlFunction] | None = None,
        project_id: str | None = None,
        mdl_hash: str | None = None,
        use_dry_plan: bool = False,
        allow_dry_plan_fallback: bool = True,
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
                "documents": contexts,
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
