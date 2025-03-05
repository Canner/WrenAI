import logging
import sys
from typing import Any

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.generation.utils.sql import (
    TEXT_TO_SQL_RULES,
    SQLBreakdownGenPostProcessor,
)

logger = logging.getLogger("wren-ai-service")


sql_breakdown_system_prompt = """
### TASK ###
You are an ANSI SQL expert with exceptional logical thinking skills.
You are going to break a complex SQL query into 1 to 3 steps to make it easier to understand for end users.
Each step should have a SQL query part, a summary explaining the purpose of that query, and a CTE name to link the queries.
Also, you need to give a short description describing the purpose of the original SQL query.
Description and summary in each step MUST BE in the same language as user specified.

### SQL QUERY BREAKDOWN INSTRUCTIONS ###
- SQL BREAKDOWN MUST BE 1 to 3 steps only.
- YOU MUST BREAK DOWN any SQL query into small steps if there is JOIN operations or sub-queries.
- ONLY USE the tables and columns mentioned in the original sql query.
- ONLY CHOOSE columns belong to the tables mentioned in the database schema.
- ALWAYS USE alias for tables and referenced CTEs.
- ALWAYS SHOW alias for columns and tables such as SELECT [column_name] AS [alias_column_name].
- MUST USE alias from the original SQL query.

### SUMMARY AND DESCRIPTION INSTRUCTIONS ###
- SUMMARY AND DESCRIPTION MUST BE the same language as the user speficied.
- SUMMARY AND DESCRIPTION MUST BE human-readable and easy to understand.
- SUMMARY AND DESCRIPTION MUST BE concise and to the point.

### EXAMPLES ###
Example 1:
Original SQL Query:

SELECT product_id, SUM(sales) AS total_sales
FROM sales_data
GROUP BY product_id
HAVING SUM(sales) > 10000;

Results:

- Description: The breakdown simplifies the process of aggregating sales data by product and filtering for top-selling products.
- Step 1:
    - sql: SELECT product_id, sales FROM sales_data
    - summary: Selects product IDs and their corresponding sales from the sales_data table.
    - cte_name: basic_sales_data
- Step 2:
    - sql: SELECT product_id, SUM(sales) AS total_sales FROM basic_sales_data GROUP BY product_id
    - summary: Aggregates sales by product, summing up sales for each product ID.
    - cte_name: aggregated_sales
- Step 3:
    - sql: SELECT product_id, total_sales FROM aggregated_sales WHERE total_sales > 10000
    - summary: Filters the aggregated sales data to only include products whose total sales exceed 10,000.
    - cte_name: <empty_string>

Example 2:
Original SQL Query:

SELECT product_id FROM sales_data

Results:

- Description: The breakdown simplifies the process of selecting product IDs from the sales_data table.
- Step 1:
    - sql: SELECT product_id FROM sales_data
    - summary: Selects product IDs from the sales_data table.
    - cte_name: <empty_string>

### FINAL ANSWER FORMAT ###
The final answer must be a valid JSON format as following:

{
    "description": <SHORT_SQL_QUERY_DESCRIPTION_STRING>,
    "steps: [
        {
            "sql": <SQL_QUERY_STRING_1>,
            "summary": <SUMMARY_STRING_1>,
            "cte_name": <CTE_NAME_STRING_1>
        },
        {
            "sql": <SQL_QUERY_STRING_2>,
            "summary": <SUMMARY_STRING_2>,
            "cte_name": <CTE_NAME_STRING_2>
        },
        ...
    ] # a list of steps
}
"""

sql_breakdown_user_prompt_template = """
### INPUT ###
User's Question: {{ query }}
SQL query: {{ sql }}
Language: {{ language }}

{{ text_to_sql_rules }}

Let's think step by step.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    query: str,
    sql: str,
    language: str,
    text_to_sql_rules: str,
    prompt_builder: PromptBuilder,
) -> dict:
    return prompt_builder.run(
        query=query, sql=sql, language=language, text_to_sql_rules=text_to_sql_rules
    )


@observe(as_type="generation", capture_input=False)
async def generate_sql_details(prompt: dict, generator: Any) -> dict:
    return await generator(prompt=prompt.get("prompt"))


@observe(capture_input=False)
async def post_process(
    generate_sql_details: dict,
    post_processor: SQLBreakdownGenPostProcessor,
    project_id: str | None = None,
) -> dict:
    return await post_processor.run(
        generate_sql_details.get("replies"), project_id=project_id
    )


## End of Pipeline
class StepResult(BaseModel):
    sql: str
    summary: str
    cte_name: str


class BreakdownResults(BaseModel):
    description: str
    steps: list[StepResult]


SQL_BREAKDOWN_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "sql_summary",
            "schema": BreakdownResults.model_json_schema(),
        },
    }
}


class SQLBreakdown(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        engine: Engine,
        **kwargs,
    ):
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=sql_breakdown_system_prompt,
                generation_kwargs=SQL_BREAKDOWN_MODEL_KWARGS,
            ),
            "prompt_builder": PromptBuilder(
                template=sql_breakdown_user_prompt_template
            ),
            "post_processor": SQLBreakdownGenPostProcessor(engine=engine),
        }

        self._configs = {
            "text_to_sql_rules": TEXT_TO_SQL_RULES,
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="SQL Breakdown Generation")
    async def run(
        self,
        query: str,
        sql: str,
        language: str = "English",
        project_id: str | None = None,
    ) -> dict:
        logger.info("SQL Breakdown Generation pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "sql": sql,
                "project_id": project_id,
                "language": language,
                **self._components,
                **self._configs,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        SQLBreakdown,
        "sql_breakdown",
        query="query",
        sql="SELECT * FROM table_name",
        language="English",
    )
