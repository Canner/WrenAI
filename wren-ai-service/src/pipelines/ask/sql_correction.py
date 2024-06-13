import logging
import re
import sys
from typing import Any, Dict, List

from hamilton import base
from hamilton.experimental.h_async import AsyncDriver
from haystack import Document
from haystack.components.builders.prompt_builder import PromptBuilder

from src.core.pipeline import BasicPipeline, async_validate
from src.core.provider import LLMProvider
from src.pipelines.ask.components.post_processors import GenerationPostProcessor
from src.pipelines.ask.components.prompts import (
    TEXT_TO_SQL_RULES,
    text_to_sql_system_prompt,
)
from src.utils import async_timer, init_providers, timer

logger = logging.getLogger("wren-ai-service")


sql_correction_user_prompt_template = """
You are a Trino SQL expert with exceptional logical thinking skills and debugging skills.

### TASK ###
Now you are given a list of syntactically incorrect Trino SQL queries and related error messages.
With given database schema, please follow the instruction step by step to correct these wrong Trino SQL quries.

### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document.content }}
{% endfor %}

### Step 1: Identify the error ###
First step of the correction process is to identify the error point.
By analyzing the "error" of each invalid generation result, identify the "error_type" and find the "error point" in the sql.
For the "error_type", there are 2 types of error, choose 1 between them:
- Table does not exist
- Column does not exist

For the "error_point", it should be either a table name or a column name from the sql, display the error point as 1 of the 3 format:
- Table \"table_name\"
- Column \"column_name\"
- Column \"table_name.column_name\"

Example 1: given the invalid generation result
{
    sql: "SELECT EXTRACT(MONTH FROM "PurchaseTimestamp") AS "Month", SUM("PriceSum") AS "TotalRevenue" FROM "Revenue" GROUP BY 1 ORDER BY "TotalRevenue" DESC"
    summary: "Retrieve the month which has the best revenue."
    error: "java.sql.SQLException: java.sql.SQLException: Catalog Error: Table with name Revenue does not exist!\nDid you mean \"reviews\"?"
}

Then the "error_type" and the "error_point" of the above example input are "Table does not exist" and "Table \"Revenue\"" respectively.

Example 2: given the invalid generation result
{
    sql: "SELECT "Value"
            FROM "payments"
            WHERE LOWER("Type") = 'mrr'
            AND "PurchaseTimestamp" >= CAST('2022-01-01' AS TIMESTAMP)
            AND "PurchaseTimestamp" < CAST('2023-01-01' AS TIMESTAMP)"
    summary: "Retrive the mrr type payments"
    error: "java.sql.SQLException: Binder Error: Referenced column \"PurchaseTimestamp\" not found in FROM clause!"
}

Then the "error_type" and the "error_point" of the above example input are "Column does not exist" and "Column \"payments.PurchaseTimestamp\"" respectively.

Example 3: given the invalid generation result
{
    sql: "WITH "ranked_products" AS
            (SELECT "p"."Name",
                    "p"."Category",
                    "p"."Id",
                    ROW_NUMBER() OVER (PARTITION BY "oi"."City"
                                        ORDER BY "oi"."Price" DESC) AS "rn"
            FROM "products" AS "p"
            JOIN "order_items" AS "oi" ON "p"."Id" = "oi"."ProductId")
            SELECT "oi"."City",
                "ranked_products"."Name",
                "ranked_products"."Category"
            FROM "ranked_products"
            WHERE "rn" <= 3"
    summary: "Show the top 3 products of each city"
    error: "java.sql.SQLException: Binder Error: Values list \"oi\" does not have a column named \"City\""
}

The "error_type" and the "error_point" of the above example input are "Column does not exist" and "Column \"oi.City\"" respectively.

### Step 2: Rewrite the sql ###
Given the error type and error point from the previous step, the second step is to rewrite the incorrect sql to a correct one.

1. If the error type is "Table does not exist":
It means the original sql uses a non-existed table. The wrong table name is mentioned in the error point.
Locate the table position in the sql, then regenerate a sql that is relevent to the summary, but without using the wrong table.
Search through the given database schema for the correct table to replace the wrong one.
Join tables and use aggregation functions if necessary.

For example, given the invalid generation result:
{
    sql: "SELECT EXTRACT(MONTH FROM "PurchaseTimestamp") AS "Month", SUM("PriceSum") AS "TotalRevenue" FROM "Revenue" GROUP BY 1 ORDER BY "TotalRevenue" DESC"
    summary: "Retrieve the month which has the best revenue."
    error: "java.sql.SQLException: java.sql.SQLException: Catalog Error: Table with name Revenue does not exist!\nDid you mean \"reviews\"?"
}
From the previous step, the error type is "Table does not exist" and the error point is "Table \"Revenue\"", so the "FROM "Revenue"" clause should be replaced.
According to the semantics of the sql summary and the db schema, you can use the "orders" table to retrieve "PurchaseTimestamp" column, and the "payments" table to retrive "Value" column.
So the final corrected sql will be:
"SELECT EXTRACT(MONTH FROM "o.PurchaseTimestamp") AS "Month", SUM("p.Value") AS "TotalRevenue" FROM "payments" AS "p" JOIN "orders" AS "o" on "p"."OrderId" = "o"."OrderId" GROUP BY 1 ORDER BY "TotalRevenue" DESC"

2. If the error type is "Column does not exist":
It means the original sql uses a non-existed column. The wrong column name is mentioned in the error point.
Locate the column position in the sql, then regenerate a sql that is relevent to the summary, but without using the wrong column.
Search through the given database schema for the correct column to replace the wrong one.
Join tables and use aggregation functions if necessary.

For example, given the invalid generation result:
{
    sql: "SELECT "Value"
            FROM "payments"
            WHERE LOWER("Type") = 'mrr'
            AND "PurchaseTimestamp" >= CAST('2022-01-01' AS TIMESTAMP)
            AND "PurchaseTimestamp" < CAST('2023-01-01' AS TIMESTAMP)"
    summary: "Retrive the mrr type payments"
    error: " java.sql.SQLException: Binder Error: Referenced column \"PurchaseTimestamp\" not found in FROM clause!"
}
From the previous step, the error type is "Column does not exist" and the error point is "Column \"payments.PurchaseTimestamp\"", so you should either replace the "PurchaseTimestamp" column used in the sql, or join other table that has the "PurchaseTimestamp" column.
Since "PurchaseTimestamp" exists in the "orders" table, you can join the orders table to retrieve the "PurchaseTimestamp".
So the final corrected sql will be:
SELECT "Value"
    FROM "payments" p
    JOIN "orders" o ON p.OrderId = o.OrderId
    WHERE LOWER("Type") = 'mrr'
    AND "o.PurchaseTimestamp" >= CAST('2022-01-01' AS TIMESTAMP)
    AND "o.PurchaseTimestamp" < CAST('2023-01-01' AS TIMESTAMP)

### FINAL ANSWER FORMAT ###
The final answer must be a list of corrected SQL quries and its original corresponding summary in JSON format

{
    "results": [
        {"sql": <CORRECTED_SQL_QUERY_STRING_1>, "summary": <ORIGINAL_SUMMARY_STRING_1>},
        {"sql": <CORRECTED_SQL_QUERY_STRING_2>, "summary": <ORIGINAL_SUMMARY_STRING_2>}
    ]
}

{{ alert }}

### QUESTION ###
{% for invalid_generation_result in invalid_generation_results %}
    sql: {{ invalid_generation_result.sql }}
    summary: {{ invalid_generation_result.summary }}
    error: {{ invalid_generation_result.error }}
    error_type: {{ invalid_generation_result.error_type }}
    error_point: {{ invalid_generation_result.error_point }}
    mdl_check_result: {{ invalid_generation_result.mdl_check_result }}
{% endfor %}

Let's think step by step.
"""


## Start of Pipeline


@timer
def error_classify(
    invalid_generation_results: List[Dict],
    mdl_structure: dict[str, set],
) -> List[Dict]:
    # mdl checker
    def _mdl_check(
        target: str,
        mdl_structure: dict[str, set],
    ) -> {bool, list[str]}:
        # Check if the string is a key in the dictionary
        if target in mdl_structure:
            return True, []

        # Check if the string is in any of the sets
        keys_with_string = [
            key for key, values in mdl_structure.items() if target in values
        ]

        if keys_with_string:
            return True, keys_with_string

        # Return False if the string is not found
        return False, []

    # parser for map function
    def _parse_error(result):
        error_message = result.get("error", "")
        logger.debug(error_message)

        # Check for "column not found" in values list
        match = re.search(
            r'Values list "?([^"]+)"? does not have a column named "?([^"]+)"?',
            error_message,
        )
        if match:
            result["error_type"] = "column not found"
            result["error_point"] = f"{match.group(1)}.{match.group(2)}"
            result["mdl_check_result"] = _mdl_check(match.group(2), mdl_structure)
            logger.debug(f"match: {result}")
            return result

        # Check for "column not found" in referenced column
        match = re.search(r'Referenced column "?([^"]+)"? not found in', error_message)
        if match:
            result["error_type"] = "column not found"
            result["error_point"] = match.group(1)
            result["mdl_check_result"] = _mdl_check(match.group(1), mdl_structure)
            return result

        # Check for "table not found"
        match = re.search(r'Table with name "?([^"]+)"? does not exist!', error_message)
        if match:
            result["error_type"] = "table not found"
            result["error_point"] = match.group(1)
            result["mdl_check_result"] = _mdl_check(match.group(1), mdl_structure)
            return result

        result["error_type"] = "others"
        result["error_point"] = ""
        result["mdl_check_result"] = ()
        return result

    # Print the updated list to verify
    logger.debug(
        f"results classified: {list(map(_parse_error, invalid_generation_results))}"
    )

    return list(map(_parse_error, invalid_generation_results))


@timer
def prompt(
    documents: List[Document],
    error_classify: List[Dict],
    alert: str,
    prompt_builder: PromptBuilder,
) -> dict:
    logger.debug(f"documents: {documents}")
    logger.debug(f"invalid_generation_results: {error_classify}")
    return prompt_builder.run(
        documents=documents,
        invalid_generation_results=error_classify,
        alert=alert,
    )


@async_timer
async def generate(prompt: dict, generator: Any) -> dict:
    logger.debug(f"prompt: {prompt}")
    return await generator.run(prompt=prompt.get("prompt"))


@async_timer
async def post_process(generate: dict, post_processor: GenerationPostProcessor) -> dict:
    logger.debug(f"generate: {generate}")
    return await post_processor.run(generate.get("replies"))


## End of Pipeline


class SQLCorrection(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
    ):
        self.generator = llm_provider.get_generator(
            system_prompt=text_to_sql_system_prompt
        )
        self.prompt_builder = PromptBuilder(
            template=sql_correction_user_prompt_template
        )
        self.post_processor = GenerationPostProcessor()

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @async_timer
    async def run(
        self,
        contexts: List[Document],
        mdl_structure: dict[str, set],
        invalid_generation_results: List[Dict[str, str]],
    ):
        logger.info("Ask SQLCorrection pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "invalid_generation_results": invalid_generation_results,
                "documents": contexts,
                "mdl_structure": mdl_structure,
                "alert": TEXT_TO_SQL_RULES,
                "generator": self.generator,
                "prompt_builder": self.prompt_builder,
                "post_processor": self.post_processor,
            },
        )


if __name__ == "__main__":
    from src.utils import load_env_vars

    load_env_vars()

    llm_provider, _ = init_providers()
    pipeline = SQLCorrection(
        llm_provider=llm_provider,
    )

    async_validate(lambda: pipeline.run([], []))
