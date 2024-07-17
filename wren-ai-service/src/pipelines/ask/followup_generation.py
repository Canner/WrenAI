import logging
import sys
from pathlib import Path
from typing import Any, List

from hamilton import base
from hamilton.experimental.h_async import AsyncDriver
from haystack import Document
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.ask.components.post_processors import GenerationPostProcessor
from src.pipelines.ask.components.prompts import (
    TEXT_TO_SQL_RULES,
    text_to_sql_system_prompt,
)
from src.utils import async_timer, timer
from src.web.v1.services.ask import AskRequest

logger = logging.getLogger("wren-ai-service")


text_to_sql_with_followup_user_prompt_template = """
### TASK ###
Given the following user's follow-up question and previous SQL query and summary,
generate at most 3 SQL queries in order to interpret the user's question in various plausible ways.

### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document.content }}
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
            "sql": "SELECT department, COUNT() as employee_count FROM employees GROUP BY department HAVING COUNT() > 10",
            "summary": "Modified to show only departments with more than 10 employees."
        },
        {
            "sql": "SELECT department FROM employees GROUP BY department HAVING COUNT() > 10",
            "summary": "Shows only the names of departments with more than 10 employees."
        },
        {
            "sql": "SELECT department, COUNT() as employee_count FROM employees WHERE department IN (SELECT department FROM employees GROUP BY department HAVING COUNT(*) > 10)",
            "summary": "Lists departments and their employee count, including only those with more than 10 employees."
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
            "sql": "SELECT products.name, SUM(sales.sales) as total_sales FROM sales JOIN products ON sales.product_id = products.id GROUP BY products.name",
            "summary": "Includes product name with total sales."
        },
        {
            "sql": "SELECT p.name, s.total_sales FROM (SELECT product_id, SUM(sales) as total_sales FROM sales GROUP BY product_id) s JOIN products p ON s.product_id = p.id",
            "summary": "Joins product table to include names in the total sales summary."
        },
        {
            "sql": "SELECT p.name, IFNULL(SUM(s.sales), 0) as total_sales FROM products p LEFT JOIN sales s ON p.id = s.product_id GROUP BY p.name",
            "summary": "Includes all products, even those with no sales, showing total sales with product names."
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
            "sql": "SELECT department_id, employee_name, salary FROM employees WHERE (department_id, salary) IN (SELECT department_id, MAX(salary) FROM employees GROUP BY department_id)",
            "summary": "Shows the names of employees who earn the highest salary in their respective departments."
        },
        {
            "sql": "SELECT e.department_id, e.employee_name, e.salary FROM employees e INNER JOIN (SELECT department_id, MAX(salary) as max_salary FROM employees GROUP BY department_id) d ON e.department_id = d.department_id AND e.salary = d.max_salary",
            "summary": "Lists employees with the highest salary in each department."
        },
        {
            "sql": "WITH MaxSalaries AS (SELECT department_id, MAX(salary) as max_salary FROM employees GROUP BY department_id) SELECT e.department_id, e.employee_name, e.salary FROM employees e JOIN MaxSalaries m ON e.department_id = m.department_id AND e.salary = m.max_salary",
            "summary": "Utilizes a CTE to display each department's highest earners along with their names and salaries."
        }
    ]
}

### FINAL ANSWER FORMAT ###
The final answer must be the JSON format like following:

{
    "results": [
        {"sql": <SQL_QUERY_STRING_1>, "summary": <SUMMARY_STRING_1>},
        {"sql": <SQL_QUERY_STRING2>, "summary": <SUMMARY_STRING_2>},
        {"sql": <SQL_QUERY_STRING3>, "summary": <SUMMARY_STRING_3>}
    ]
}

{{ alert }}

### QUESTION ###
Previous SQL Summary: {{ history.summary }}
Previous SQL Query: {{ history.sql }}
User's Follow-up Question: {{ query }}

Let's think step by step.
"""


## Start of Pipeline
@timer
@observe(capture_input=False)
def prompt(
    query: str,
    documents: List[Document],
    history: AskRequest.AskResponseDetails,
    alert: str,
    prompt_builder: PromptBuilder,
) -> dict:
    logger.debug(f"query: {query}")
    logger.debug(f"documents: {documents}")
    logger.debug(f"history: {history}")
    return prompt_builder.run(
        query=query, documents=documents, history=history, alert=alert
    )


@async_timer
@observe(as_type="generation", capture_input=False)
async def generate(prompt: dict, generator: Any) -> dict:
    logger.debug(f"prompt: {prompt}")
    return await generator.run(prompt=prompt.get("prompt"))


@async_timer
@observe(capture_input=False)
async def post_process(generate: dict, post_processor: GenerationPostProcessor) -> dict:
    logger.debug(f"generate: {generate}")
    return await post_processor.run(generate.get("replies"))


## End of Pipeline


class FollowUpGeneration(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        engine: Engine,
    ):
        self.generator = llm_provider.get_generator(
            system_prompt=text_to_sql_system_prompt
        )
        self.prompt_builder = PromptBuilder(
            template=text_to_sql_with_followup_user_prompt_template
        )
        self.post_processor = GenerationPostProcessor(engine=engine)

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def visualize(
        self,
        query: str,
        contexts: List[Document],
        history: AskRequest.AskResponseDetails,
    ) -> None:
        destination = "outputs/pipelines/ask"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            ["post_process"],
            output_file_path=f"{destination}/followup_generation.dot",
            inputs={
                "query": query,
                "generator": self.generator,
                "prompt_builder": self.prompt_builder,
                "post_processor": self.post_processor,
                "documents": contexts,
                "history": history,
                "alert": TEXT_TO_SQL_RULES,
            },
            show_legend=True,
            orient="LR",
        )

    @async_timer
    @observe(name="Ask Follow Up Generation")
    async def run(
        self,
        query: str,
        contexts: List[Document],
        history: AskRequest.AskResponseDetails,
    ):
        logger.info("Ask FollowUpGeneration pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "generator": self.generator,
                "prompt_builder": self.prompt_builder,
                "post_processor": self.post_processor,
                "documents": contexts,
                "history": history,
                "alert": TEXT_TO_SQL_RULES,
            },
        )


if __name__ == "__main__":
    from langfuse.decorators import langfuse_context

    from src.core.pipeline import async_validate
    from src.utils import init_langfuse, init_providers, load_env_vars

    load_env_vars()
    init_langfuse()

    llm_provider, _, _, engine = init_providers()
    pipeline = FollowUpGeneration(llm_provider=llm_provider, engine=engine)

    pipeline.visualize(
        "this is a test query",
        [],
        AskRequest.AskResponseDetails(
            sql="SELECT * FROM table", summary="Summary", steps=[]
        ),
    )
    async_validate(
        lambda: pipeline.run(
            "this is a test query",
            [],
            AskRequest.AskResponseDetails(
                sql="SELECT * FROM table", summary="Summary", steps=[]
            ),
        )
    )

    langfuse_context.flush()
