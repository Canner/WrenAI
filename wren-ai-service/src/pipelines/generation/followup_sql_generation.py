import logging
import sys
from pathlib import Path
from typing import Any, List

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.common import (
    TEXT_TO_SQL_RULES,
    SQLGenPostProcessor,
    construct_instructions,
    show_current_time,
    sql_generation_system_prompt,
)
from src.utils import async_timer, timer
from src.web.v1.services import Configuration
from src.web.v1.services.ask import AskHistory

logger = logging.getLogger("wren-ai-service")


text_to_sql_with_followup_user_prompt_template = """
### TASK ###
Given the following user's follow-up question and previous SQL query and summary,
generate one SQL query to best answer user's question.

### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document }}
{% endfor %}

### EXAMPLES ###

Example 1
[INPUT]
Previous SQL Summary: A query to find the number of employees in each department.
Previous SQL Query: SELECT department, COUNT(*) as employee_count FROM employees GROUP BY department;
User's Question: How do I modify this to only show departments with more than 10 employees?

[OUTPUT]
{
    "results": [
        {
            "sql": "SELECT department, COUNT() as employee_count FROM employees GROUP BY department HAVING COUNT() > 10"
        }
    ]
}

Example 2
[INPUT]
Previous SQL Summary: A query to retrieve the total sales per product.
Previous SQL Query: SELECT product_id, SUM(sales) as total_sales FROM sales GROUP BY product_id;
User's Question: Can you adjust this to include the product name as well?

[OUTPUT]
{
    "results": [
        {
            "sql": "SELECT products.name, SUM(sales.sales) as total_sales FROM sales JOIN products ON sales.product_id = products.id GROUP BY products.name"
        }
    ]
}

Example 3
[INPUT]
Previous SQL Summary: Query to find the highest salary in each department.
Previous SQL Query: SELECT department_id, MAX(salary) as highest_salary FROM employees GROUP BY department_id;
User's Question: What if I want to see the employee names with the highest salary in each department?

[OUTPUT]
{
    "results": [
        {
            "sql": "SELECT department_id, employee_name, salary FROM employees WHERE (department_id, salary) IN (SELECT department_id, MAX(salary) FROM employees GROUP BY department_id)"
        }
    ]
}

### FINAL ANSWER FORMAT ###
The final answer must be the JSON format like following:

{
    "results": [
        {"sql": <SQL_QUERY_STRING>}
    ]
}

{{ alert }}

### CONTEXT ###
Previous SQL Summary:
{% for summary in previous_query_summaries %}
    {{ summary }}
{% endfor %}
Previous SQL Query: {{ history.sql }}
Current Time: {{ current_time }}

{% if instructions %}
Instructions: {{ instructions }}
{% endif %}

### INPUT ###
User's Follow-up Question: {{ query }}

Let's think step by step.
"""


## Start of Pipeline
@timer
@observe(capture_input=False)
def prompt(
    query: str,
    documents: List[str],
    history: AskHistory,
    alert: str,
    configuration: Configuration,
    prompt_builder: PromptBuilder,
) -> dict:
    previous_query_summaries = [step.summary for step in history.steps if step.summary]

    return prompt_builder.run(
        query=query,
        documents=documents,
        history=history,
        previous_query_summaries=previous_query_summaries,
        alert=alert,
        instructions=construct_instructions(configuration),
        current_time=show_current_time(configuration.timezone),
    )


@async_timer
@observe(as_type="generation", capture_input=False)
async def generate_sql_in_followup(prompt: dict, generator: Any) -> dict:
    return await generator(prompt=prompt.get("prompt"))


@async_timer
@observe(capture_input=False)
async def post_process(
    generate_sql_in_followup: dict,
    post_processor: SQLGenPostProcessor,
    project_id: str | None = None,
) -> dict:
    return await post_processor.run(
        generate_sql_in_followup.get("replies"), project_id=project_id
    )


## End of Pipeline


class SQLResult(BaseModel):
    sql: str


class GenerationResults(BaseModel):
    results: list[SQLResult]


FOLLOWUP_SQL_GENERATION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "sql_results",
            "schema": GenerationResults.model_json_schema(),
        },
    }
}


class FollowUpSQLGeneration(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        engine: Engine,
        **kwargs,
    ):
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=sql_generation_system_prompt,
                generation_kwargs=FOLLOWUP_SQL_GENERATION_MODEL_KWARGS,
            ),
            "prompt_builder": PromptBuilder(
                template=text_to_sql_with_followup_user_prompt_template
            ),
            "post_processor": SQLGenPostProcessor(engine=engine),
        }

        self._configs = {
            "alert": TEXT_TO_SQL_RULES,
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def visualize(
        self,
        query: str,
        contexts: List[str],
        history: AskHistory,
        configuration: Configuration = Configuration(),
        project_id: str | None = None,
    ) -> None:
        destination = "outputs/pipelines/generation"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            ["post_process"],
            output_file_path=f"{destination}/followup_sql_generation.dot",
            inputs={
                "query": query,
                "documents": contexts,
                "history": history,
                "project_id": project_id,
                "configuration": configuration,
                **self._components,
                **self._configs,
            },
            show_legend=True,
            orient="LR",
        )

    @async_timer
    @observe(name="Follow-Up SQL Generation")
    async def run(
        self,
        query: str,
        contexts: List[str],
        history: AskHistory,
        configuration: Configuration = Configuration(),
        project_id: str | None = None,
    ):
        logger.info("Follow-Up SQL Generation pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "documents": contexts,
                "history": history,
                "project_id": project_id,
                "configuration": configuration,
                **self._components,
                **self._configs,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        FollowUpSQLGeneration,
        "followup_sql_generation",
        query="show me the dataset",
        contexts=[],
        history=AskHistory(sql="SELECT * FROM table", summary="Summary", steps=[]),
    )
