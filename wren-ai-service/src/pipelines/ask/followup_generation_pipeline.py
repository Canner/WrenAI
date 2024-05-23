import logging
from typing import List

from haystack import Document, Pipeline
from haystack.components.builders.prompt_builder import PromptBuilder

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.ask.components.post_processors import init_generation_post_processor
from src.pipelines.ask.components.prompts import (
    TEXT_TO_SQL_RULES,
    text_to_sql_system_prompt,
)
from src.utils import init_providers, load_env_vars, timer
from src.web.v1.services.ask import AskRequest

load_env_vars()
logger = logging.getLogger("wren-ai-service")


text_to_sql_with_followup_user_prompt_template = """
### TASK ###
Given the following user query and the history of the last query along with the generated SQL result,
generate appropriate SQL queries that match the user's current request.
Generate at most 3 SQL queries in order to interpret the user query in various plausible ways.

### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document.content }}
{% endfor %}

Generated SQL Queries amd Summaries:
{
    "results": [
        {
            "sql": "SELECT users.* FROM users JOIN purchases ON users.id = purchases.user_id WHERE users.sign_up_date >= '2023-01-01';",
            "summary": "Users joined in 2023 with purchases."
        },
        {
            "sql": "SELECT DISTINCT users.* FROM users INNER JOIN purchases ON users.id = purchases.user_id WHERE users.sign_up_date >= '2023-01-01';",
            "summary": "Unique users with purchases since 2023."
        }
    ]
}

### FINAL ANSWER FORMAT ###
The final answer must be the JSON format like following:

{
    "results": [
        {"sql": <SQL_QUERY_STRING_1>, "summary": <SUMMARY_STRING_1>},
        {"sql": <SQL_QUERY_STRING2>, "summary": <SUMMARY_STRING_2>}
    ]
}

{{ alert }}

### QUESTION ###
Previous SQL Summary: {{ history.summary }}
Previous Generated SQL Query: {{ history.sql }}
Current User Query: {{ query }}

Let's think step by step.
"""


class FollowUpGeneration(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
    ):
        self._pipeline = Pipeline()
        self._pipeline.add_component(
            "text_to_sql_prompt_builder",
            PromptBuilder(template=text_to_sql_with_followup_user_prompt_template),
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
        history: AskRequest.AskResponseDetails,
        include_outputs_from: List[str] | None = None,
    ):
        logger.info("Ask FollowUpGeneration pipeline is running...")
        return self._pipeline.run(
            {
                "text_to_sql_prompt_builder": {
                    "query": query,
                    "documents": contexts,
                    "history": history,
                    "alert": TEXT_TO_SQL_RULES,
                },
            },
            include_outputs_from=(
                set(include_outputs_from) if include_outputs_from else None
            ),
        )


if __name__ == "__main__":
    llm_provider, _ = init_providers()
    followup_generation_pipeline = FollowUpGeneration(
        llm_provider=llm_provider,
    )

    print("generating followup_generation_pipeline.jpg to outputs/pipelines/ask...")
    followup_generation_pipeline.draw(
        "./outputs/pipelines/ask/followup_generation_pipeline.jpg"
    )
