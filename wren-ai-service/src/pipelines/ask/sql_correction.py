import asyncio
import json
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

sql_correction_prompt_templates_by_error_type = {
    "table not found": """
You are a Trino SQL expert with exceptional logical thinking skills and debugging skills.

### TASK ###
Now you are given a syntactically incorrect Trino SQL query and related error information.
With given database schema, please follow the instruction step by step to correct these wrong Trino SQL quries.

### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document.content }}
{% endfor %}

### TASK INSTRUCTIONS ###
The input sql has the problem of using non-existed tables. The wrong table name can be found in the "error_point" attribute of the input data.
To solve this problem, you should locate the table position in the sql, then regenerate a sql that is relevent to the summary, but without using the wrong table.
Search through the given database schema for the correct table to replace the wrong one.
Join tables and use aggregation functions if necessary.

### INPUT STRUCTURE ###
The input is constructed of 5 elements:
1. "sql": This is the incorrect sql you need to rewrite.
2. "summary": The brief explanation of the purpose of the sql, your rewritten sql still needs to follow the meaning of this summary.
3. "error": The error message return from the sql engine.
4. "error_type": The type of the sql error, it is "table not found" in this case.
5. "error_point": This attribute indicate the error table name of the input sql.
6. "mdl_check_result": This attribute contains 2 components: the first component is a boolean value, which shows if the incorrect table name is actually existed in the db schema. The second attribute is typically a empty list in this case.

### EXAMPLE ###
For example, given the input:
{
    sql: "SELECT EXTRACT(MONTH FROM "PurchaseTimestamp") AS "Month", SUM("PriceSum") AS "TotalRevenue" FROM "Revenue" GROUP BY 1 ORDER BY "TotalRevenue" DESC"
    summary: "Retrieve the month which has the best revenue."
    error: "java.sql.SQLException: java.sql.SQLException: Catalog Error: Table with name Revenue does not exist!\nDid you mean \"reviews\"?"
    error_type: "table not found"
    error_point: "Revenue"
    mdl_check_result: (False, [])
}
The error type is "table not found" and the error point is "Table \"Revenue\"", so the "FROM "Revenue"" clause should be replaced.
According to the semantics of the sql summary and the db schema, you can use the "orders" table to retrieve "PurchaseTimestamp" column, and the "payments" table to retrive "Value" column.
So the final corrected sql will be:
"SELECT EXTRACT(MONTH FROM "o.PurchaseTimestamp") AS "Month", SUM("p.Value") AS "TotalRevenue" FROM "payments" AS "p" JOIN "orders" AS "o" on "p"."OrderId" = "o"."OrderId" GROUP BY 1 ORDER BY "TotalRevenue" DESC"

### FINAL ANSWER FORMAT ###
The final answer must be the corrected SQL quries and its original corresponding summary in JSON format.
You only need to keep these 2 elements.

{
    "sql": <CORRECTED_SQL_QUERY_STRING>, 
    "summary": <ORIGINAL_SUMMARY_STRING>
}

{{ alert }}

### QUESTION ###
{{ invalid_generation_result }}

Let's think step by step.
""",
    "column not found": """
You are a Trino SQL expert with exceptional logical thinking skills and debugging skills.

### TASK ###
Now you are given a syntactically incorrect Trino SQL query and related error information.
With given database schema, please follow the instruction step by step to correct these wrong Trino SQL quries.

### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document.content }}
{% endfor %}

### TASK INSTRUCTIONS ###
It means the original sql uses a non-existed column. The wrong column name is mentioned in the error point.
If the first part of "mdl_check_result" is True, which means the column name is existed in the db schema, but the table of original sql is wrong.
You can use the corrected table names listed in the second part of "mdl_check_result".
If the first part of "mdl_check_result" is False, the current column name is not found in the db schema, please search through the db schema for another column to replace it.
Join tables and use aggregation functions if necessary.

### INPUT STRUCTURE ###
The input is constructed of 5 elements:
1. "sql": This is the incorrect sql you need to rewrite.
2. "summary": The brief explanation of the purpose of the sql, your rewritten sql still needs to follow the meaning of this summary.
3. "error": The error message return from the sql engine.
4. "error_type": The type of the sql error, it is "column not found" in this case.
5. "error_point": This attribute indicate the wrong column name of the input sql.
6. "mdl_check_result": This attribute contains 2 components: the first component is a boolean value, which shows if the incorrect column name is actually existed in the db schema. If the first value is True, the second attribute will be a list containing the table names which the column actually belongs to; else, the second attribute is an empty list.

### EXAMPLE ###
For example, given the input:
{
    sql: "SELECT "Value"
            FROM "payments"
            WHERE LOWER("Type") = 'mrr'
            AND "PurchaseTimestamp" >= CAST('2022-01-01' AS TIMESTAMP)
            AND "PurchaseTimestamp" < CAST('2023-01-01' AS TIMESTAMP)"
    summary: "Retrive the mrr type payments"
    error: " java.sql.SQLException: Binder Error: Referenced column \"PurchaseTimestamp\" not found in FROM clause!"
}
The error type is "column not found" and the error point is "Column \"payments.PurchaseTimestamp\"", so you should either replace the "PurchaseTimestamp" column used in the sql, or join other table that has the "PurchaseTimestamp" column.
According to the "mdl_check_result", the "PurchaseTimestamp" exists in the "orders" table, so you can join the orders table to retrieve the "PurchaseTimestamp".
So the final corrected sql will be:
SELECT "Value"
    FROM "payments" p
    JOIN "orders" o ON p.OrderId = o.OrderId
    WHERE LOWER("Type") = 'mrr'
    AND "o.PurchaseTimestamp" >= CAST('2022-01-01' AS TIMESTAMP)
    AND "o.PurchaseTimestamp" < CAST('2023-01-01' AS TIMESTAMP)

### FINAL ANSWER FORMAT ###
The final answer must be the corrected SQL quries and its original corresponding summary in JSON format
You only need to keep these 2 elements.

{
    "sql": <CORRECTED_SQL_QUERY_STRING>, 
    "summary": <ORIGINAL_SUMMARY_STRING>
}

{{ alert }}

### QUESTION ###
{{ invalid_generation_result }}

Let's think step by step.
""",
    "others": """
You are a Trino SQL expert with exceptional logical thinking skills and debugging skills.

### TASK ###
Now you are given a list of syntactically incorrect Trino SQL queries and related error messages.
With given database schema, please think step by step to correct these wrong Trino SQL quries.

### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document.content }}
{% endfor %}

### FINAL ANSWER FORMAT ###
The final answer must be the corrected SQL quries and its original corresponding summary in JSON format
You only need to keep these 2 elements.

{
    "sql": <CORRECTED_SQL_QUERY_STRING>, 
    "summary": <ORIGINAL_SUMMARY_STRING>
}

{{ alert }}

### QUESTION ###
{{ invalid_generation_result }}

Let's think step by step.
""",
}

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
        logger.debug(f"check target: {target}")
        logger.debug(f"input mdl: {mdl_structure}")
        # Check if the string is a key in the dictionary
        if target in mdl_structure:
            return True, []

        # Check if the string is in any of the sets
        keys_with_string = [
            key for key, values in mdl_structure.items() if target in values
        ]
        logger.debug(f"match tables: {keys_with_string}")
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
            if (
                result["mdl_check_result"][0] is True
                and match.group(1) in result["mdl_check_result"][1]
            ):
                logger.debug(
                    f"Column {match.group(2)} found in Table {match.group(1)}. This sql will not be corrected."
                )
                result["error_type"] = "skip correction"
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
            if result["mdl_check_result"][0] is True:
                logger.debug(
                    f"Table {match.group(1)} found in mdl. This sql will not be corrected."
                )
                result["error_type"] = "skip correction"
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
def build_prompts(
    documents: List[Document],
    error_classify: List[Dict],
    alert: str,
    prompt_builders: List[PromptBuilder],
) -> dict:
    logger.debug(f"documents: {documents}")
    logger.debug(f"invalid_generation_results: {error_classify}")
    return {
        "run_correction": [
            prompt_builders[invalid_generation_result["error_type"]].run(
                documents=documents,
                invalid_generation_result=invalid_generation_result,
                alert=alert,
            )
            for invalid_generation_result in error_classify
            if invalid_generation_result["error_type"] != "skip correction"
        ],
        "skip_correction": [
            invalid_generation_result
            for invalid_generation_result in error_classify
            if invalid_generation_result["error_type"] == "skip correction"
        ],
    }


@async_timer
async def generate(build_prompts: dict, generator: Any) -> dict:
    logger.debug(f"prompts: {build_prompts}")

    async def _run_single_prompt(prompt: Dict) -> Dict:
        logger.debug(f"prompt: {prompt}")
        return await generator.run(prompt=prompt.get("prompt"))

    tasks = [_run_single_prompt(prompt) for prompt in build_prompts["run_correction"]]
    generate_results = await asyncio.gather(*tasks)

    return {
        "generate_results": generate_results,
        "skip_correction": build_prompts["skip_correction"],
    }


@async_timer
async def post_process(generate: dict, post_processor: GenerationPostProcessor) -> dict:
    logger.debug(f"generate: {generate}")
    replies = [
        json.dumps(
            {
                "results": [
                    json.loads(result.get("replies")[0])
                    for result in generate["generate_results"]
                ]
            }
        )
    ]
    post_processed_results = await post_processor.run(replies)

    logger.debug(post_processed_results)
    logger.debug(f"the sql skip correction: {generate["skip_correction"]}")
    post_processed_results["invalid_generation_results"] = (
        post_processed_results["invalid_generation_results"]
        + generate["skip_correction"]
    )

    return post_processed_results


## End of Pipeline


class SQLCorrection(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
    ):
        self.generator = llm_provider.get_generator(
            system_prompt=text_to_sql_system_prompt
        )
        self.prompt_builders = {
            error_type: PromptBuilder(
                template=sql_correction_prompt_templates_by_error_type[error_type]
            )
            for error_type in sql_correction_prompt_templates_by_error_type.keys()
        }
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
        logger.debug(mdl_structure)
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "invalid_generation_results": invalid_generation_results,
                "documents": contexts,
                "mdl_structure": mdl_structure,
                "alert": TEXT_TO_SQL_RULES,
                "generator": self.generator,
                "prompt_builders": self.prompt_builders,
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
