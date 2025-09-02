import logging
import sys
from typing import Any, List

import orjson
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack import Document
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.common import clean_up_new_lines
from src.utils import trace_cost

logger = logging.getLogger("wren-ai-service")


sql_diagnosis_system_prompt = """
### TASK ###
You are an ANSI SQL expert with exceptional logical thinking skills and debugging skills, you need to diagnose the issue with the given SQL query, error message and database schema.

### SQL DIAGNOSIS INSTRUCTIONS ###

1. First, think hard about the error message, and analyze the invalid SQL query to figure out the root cause and which part is incorrect.
2. Then, map the incorrect part of the invalid SQL query to the corresponding part of the original SQL query.
3. Then, return the reasoning behind the diagnosis.(You should give me the part of the original SQL query that is incorrect and the reason why it is incorrect)
4. Also, return a boolean value to indicate whether the issue is a SQL syntax issue.

### FINAL ANSWER FORMAT ###
The final answer must be in JSON format:

{
    "reasoning": <REASONING_STRING>,
    "is_sql_syntax_issue": <IS_SQL_SYNTAX_ISSUE_BOOLEAN>
}
"""

sql_diagnosis_user_prompt_template = """
### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document }}
{% endfor %}

### ORIGINAL SQL ###
{{ original_sql }}

### INVALID SQL ###
{{ invalid_sql }}

### ERROR MESSAGE ###
{{ error_message }}

Please think step by step.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    documents: List[Document],
    original_sql: str,
    invalid_sql: str,
    error_message: str,
    prompt_builder: PromptBuilder,
) -> dict:
    _prompt = prompt_builder.run(
        documents=documents,
        original_sql=original_sql,
        invalid_sql=invalid_sql,
        error_message=error_message,
    )
    return {"prompt": clean_up_new_lines(_prompt.get("prompt"))}


@observe(as_type="generation", capture_input=False)
@trace_cost
async def generate_sql_diagnosis(
    prompt: dict, generator: Any, generator_name: str
) -> dict:
    return await generator(prompt=prompt.get("prompt")), generator_name


@observe(capture_input=False)
async def post_process(
    generate_sql_diagnosis: dict,
) -> str:
    return orjson.loads(generate_sql_diagnosis.get("replies")[0])


## End of Pipeline


class SqlDiagnosisResult(BaseModel):
    reasoning: str
    is_sql_syntax_issue: bool


SQL_DIAGNOSIS_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "sql_diagnosis_result",
            "schema": SqlDiagnosisResult.model_json_schema(),
        },
    }
}


class SQLDiagnosis(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **kwargs,
    ):
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=sql_diagnosis_system_prompt,
                generation_kwargs=SQL_DIAGNOSIS_MODEL_KWARGS,
            ),
            "generator_name": llm_provider.get_model(),
            "prompt_builder": PromptBuilder(
                template=sql_diagnosis_user_prompt_template
            ),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="SQL Diagnosis")
    async def run(
        self,
        contexts: List[Document],
        original_sql: str,
        invalid_sql: str,
        error_message: str,
    ):
        logger.info("SQLDiagnosis pipeline is running...")

        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "documents": contexts,
                "original_sql": original_sql,
                "invalid_sql": invalid_sql,
                "error_message": error_message,
                **self._components,
            },
        )
