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
    SQLGenPostProcessor,
    construct_instructions,
    construct_valid_table_columns,
    construct_valid_table_names,
    get_sql_generation_model_kwargs,
    get_text_to_sql_rules,
)
from src.pipelines.retrieval.sql_functions import SqlFunction
from src.pipelines.retrieval.sql_knowledge import SqlKnowledge
from src.utils import trace_cost

logger = logging.getLogger("wren-ai-service")


def get_sql_correction_system_prompt(
    sql_knowledge: SqlKnowledge | None = None,
    data_source: str | None = None,
) -> str:
    text_to_sql_rules = get_text_to_sql_rules(
        sql_knowledge,
        data_source=data_source,
    )

    return f"""
### TASK ###
You are an ANSI SQL expert with exceptional logical thinking skills and debugging skills, you need to fix the syntactically incorrect ANSI SQL query.

### SQL CORRECTION INSTRUCTIONS ###

1. First, think hard about the error message, and figure out the root cause first(please use the DATABASE SCHEMA, SQL FUNCTIONS and USER INSTRUCTIONS to help you figure out the root cause).
2. Then, generate the syntactically correct ANSI SQL query to correct the error.

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
### TARGET DATA SOURCE ###
{{ data_source }}

{% if documents %}
### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document }}
{% endfor %}
{% endif %}

{% if valid_table_names %}
### VALID TABLE NAMES ###
Only use these exact table names from the schema. If the invalid SQL references a
table not listed here, replace it with the closest listed table only when the schema
clearly supports the user's request. Do not invent, rename, singularize, pluralize,
or add catalog/schema prefixes unless the table name is shown that way here.
{% for table_name in valid_table_names %}
- {{ table_name }}
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
{% if invalid_generation_result.original_sql %}
Original SQL: {{ invalid_generation_result.original_sql }}
{% endif %}
Invalid SQL: {{ invalid_generation_result.sql }}
Error Message: {{ invalid_generation_result.error }}

### CORRECTION GROUNDING ###
Use DATABASE SCHEMA and VALID TABLE NAMES as the source of truth. If the invalid SQL
uses a table such as bookexamples.sales, sales, orders, or customers that is not listed
above, replace it with an explicitly listed table only when the listed schema supports
the user's request. For sales performance, salesperson ranking, customer growth, revenue,
margin, orders, or invoices, use only the active datasource's exposed sales/customer
tables and numeric columns. Do not SUM or AVG string columns.

Let's think step by step.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    documents: List[Document],
    invalid_generation_result: Dict,
    prompt_builder: PromptBuilder,
    data_source: str,
    query: str | None = None,
    instructions: list[dict] | None = None,
    sql_functions: list[SqlFunction] | None = None,
) -> dict:
    _prompt = prompt_builder.run(
        query=query,
        data_source=data_source,
        documents=documents,
        valid_table_names=construct_valid_table_names(documents),
        invalid_generation_result=invalid_generation_result,
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
    data_source: str,
    sql_knowledge: SqlKnowledge | None = None,
) -> dict:
    current_system_prompt = get_sql_correction_system_prompt(
        sql_knowledge,
        data_source=data_source,
    )
    return await generator(
        prompt=prompt.get("prompt"), current_system_prompt=current_system_prompt
    ), generator_name


@observe(capture_input=False)
async def post_process(
    generate_sql_correction: dict,
    post_processor: SQLGenPostProcessor,
    documents: List[Document],
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
        valid_table_names=construct_valid_table_names(documents),
        valid_table_columns=construct_valid_table_columns(documents),
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
                generation_kwargs=get_sql_generation_model_kwargs(llm_provider),
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
        use_dry_plan: bool = False,
        allow_dry_plan_fallback: bool = True,
        sql_knowledge: SqlKnowledge | None = None,
        query: str | None = None,
    ):
        logger.info("SQLCorrection pipeline is running...")

        metadata = await retrieve_metadata(project_id or "", self._retriever)

        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "invalid_generation_result": invalid_generation_result,
                "documents": contexts,
                "query": query,
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
