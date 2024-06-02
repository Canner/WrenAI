import logging
from typing import Dict, List

from haystack import Document, Pipeline
from haystack.components.builders.prompt_builder import PromptBuilder

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.ask.components.post_processors import (
    init_generation_post_processor,
)
from src.pipelines.ask.components.prompts import (
    TEXT_TO_SQL_RULES,
    text_to_sql_system_prompt,
)
from src.utils import init_providers, load_env_vars, timer

load_env_vars()
logger = logging.getLogger("wren-ai-service")


text_to_sql_user_prompt_template = """
### TASK ###
Given a user query that is ambiguous in nature, your task is to interpret the query in various plausible ways and
generate three SQL statements that could potentially answer each interpreted version of the queries and within-10-words summary.
Provide three different interpretations and corresponding SQL queries that reflect these interpretations.
Ensure that your SQL queries are diverse, covering a range of possible meanings behind the ambiguous query.

### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document.content }}
{% endfor %}

### EXCLUDED STATEMETS ###
Ensure that the following excluded statements are not used in the generated queries to maintain variety and avoid repetition.
{% for doc in exclude %}
    {{ doc.statement}}
{% endfor %}

### EXAMPLES ###
Consider the structure of a generic database which includes common tables like users, orders, products, and transactions.
Here are the ambiguous user queries:

1. "Find the records of recent high-value transactions."
2. "Show me popular items that are not selling well."
3. "Retrieve user feedback on products from last month."

For each query, start by explaining the different ways the query can be interpreted. Then, provide SQL queries corresponding to each interpretation.
Your SQL statements should include SELECT statements, appropriate WHERE clauses to filter the results, and JOINs if necessary to combine information from different tables.
Remember to include ordering and limit clauses where relevant to address the 'recent', 'high-value', 'popular', and 'last month' aspects of the queries.

Example for the first query:

Interpretation 1: Recent high-value transactions are defined as transactions that occurred in the last 30 days with a value greater than $10,000.
SQL Query 1: SELECT * FROM "transactions" WHERE "transaction_date" >= NOW() - INTERVAL '30 days' AND "value" > 10000 ORDER BY "transaction_date" DESC;
SUMMARY 1: Recent high-value transactions.

Interpretation 2: High-value transactions are those in the top "10%" of all transactions in terms of value, and 'recent' is defined as the last 3 months.
SQL Query 2: WITH "ranked_transactions" AS (SELECT *, NTILE(10) OVER (ORDER BY "value" DESC) AS "percentile_rank" FROM "transactions" WHERE "transaction_date" >= NOW() - INTERVAL '3 months') SELECT * FROM "ranked_transactions" WHERE "percentile_rank" = 1 ORDER BY "transaction_date" DESC;
SUMMARY 2: Top 10% transactions last 3 months.

Interpretation 3: 'Recent' refers to the last week, and 'high-value' transactions are those above the average transaction value of the past week.
SQL Query 3: SELECT * FROM "transactions" WHERE "transaction_date" >= NOW() - INTERVAL '7 days' AND "value" > (SELECT AVG("value") FROM "transactions" WHERE "transaction_date" >= NOW() - INTERVAL '7 days') ORDER BY "transaction_date" DESC;
SUMMARY 3: Above-average transactions last week.

Proceed in a similar manner for the other queries.

{{ alert }}

### FINAL ANSWER FORMAT ###
The final answer must be the JSON format like following:

{
    "results": [
        {"sql": <SQL_QUERY_STRING_1>, "summary": <SUMMARY_STRING_1>},
        {"sql": <SQL_QUERY_STRING2>, "summary": <SUMMARY_STRING_2>}
    ]
}

### QUESTION ###
{{ query }}

Let's think step by step.
"""


class Generation(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
    ):
        self._pipeline = Pipeline()
        self._pipeline.add_component(
            "text_to_sql_prompt_builder",
            PromptBuilder(template=text_to_sql_user_prompt_template),
        )
        self._pipeline.add_component(
            "text_to_sql_generator",
            llm_provider.get_generator(system_prompt=text_to_sql_system_prompt),
        )
        self._pipeline.add_component("post_processor", init_generation_post_processor())

        self._pipeline.connect(
            "text_to_sql_prompt_builder.prompt", "text_to_sql_generator.prompt"
        )
        self._pipeline.connect(
            "text_to_sql_generator.replies", "post_processor.replies"
        )
        super().__init__(self._pipeline)

    @timer
    def run(
        self,
        query: str,
        contexts: List[Document],
        exclude: List[Dict],
        include_outputs_from: List[str] | None = None,
    ):
        logger.info("Ask Generation pipeline is running...")
        return self._pipeline.run(
            {
                "text_to_sql_prompt_builder": {
                    "query": query,
                    "documents": contexts,
                    "alert": TEXT_TO_SQL_RULES,
                    "exclude": exclude,
                }
            },
            include_outputs_from=(
                set(include_outputs_from) if include_outputs_from else None
            ),
        )


if __name__ == "__main__":
    llm_provider, _ = init_providers()
    generation_pipeline = Generation(
        llm_provider=llm_provider,
    )

    print("generating generation_pipeline.jpg to outputs/pipelines/ask...")
    generation_pipeline.draw("./outputs/pipelines/ask/generation_pipeline.jpg")
