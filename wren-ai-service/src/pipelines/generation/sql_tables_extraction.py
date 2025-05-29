import logging
import sys
from typing import Any

import orjson
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.utils import trace_cost

logger = logging.getLogger("wren-ai-service")


sql_tables_extraction_system_prompt = """
### TASK ###

You are a data analyst great at extracting a list of tables from any SQL query.

### EXAMPLES ###

SQL: SELECT * FROM table1
Output: {
    "tables": ["table1"]
}

SQL: SELECT * FROM table1, table2
Output: {
    "tables": ["table1", "table2"]
}

SQL: SELECT * FROM table1 JOIN table2 ON table1.id = table2.id
Output: {
    "tables": ["table1", "table2"]
}

### OUTPUT FORMAT ###

Please return the result in the following JSON format:

{
    "tables": <LIST_OF_TABLES_IN_STRING_FORMAT>
}
"""

sql_tables_extraction_user_prompt_template = """
SQL: {{sql}}

Let's think step by step.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    sql: str,
    prompt_builder: PromptBuilder,
) -> dict:
    return prompt_builder.run(sql=sql)


@observe(as_type="generation", capture_input=False)
@trace_cost
async def extract_sql_tables(prompt: dict, generator: Any, generator_name: str) -> dict:
    return await generator(prompt=prompt.get("prompt")), generator_name


@observe(capture_input=False)
async def post_process(
    extract_sql_tables: dict,
) -> list[str]:
    return orjson.loads(extract_sql_tables.get("replies")[0])["tables"]


## End of Pipeline


class SQLTablesExtractionResult(BaseModel):
    tables: list[str]


SQL_TABLES_EXTRACTION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "sql_tables_extraction_result",
            "schema": SQLTablesExtractionResult.model_json_schema(),
        },
    }
}


class SQLTablesExtraction(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **kwargs,
    ):
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=sql_tables_extraction_system_prompt,
                generation_kwargs=SQL_TABLES_EXTRACTION_MODEL_KWARGS,
            ),
            "generator_name": llm_provider.get_model(),
            "prompt_builder": PromptBuilder(
                template=sql_tables_extraction_user_prompt_template
            ),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Sql Tables Extraction")
    async def run(
        self,
        sql: str,
    ):
        logger.info("Sql Tables Extraction pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "sql": sql,
                **self._components,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        SQLTablesExtraction,
        "sql_tables_extraction",
        sql="SELECT * FROM table",
    )
