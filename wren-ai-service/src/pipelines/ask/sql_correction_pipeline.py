import logging
from typing import Dict, List

from haystack import Document, Pipeline
from haystack.components.builders.prompt_builder import PromptBuilder

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.ask.components.post_processors import init_generation_post_processor
from src.pipelines.ask.components.prompts import (
    TEXT_TO_SQL_RULES,
    text_to_sql_system_prompt,
)
from src.utils import init_providers, timer

logger = logging.getLogger("wren-ai-service")


sql_correction_user_prompt_template = """
You are a Trino SQL expert with exceptional logical thinking skills and debugging skills.

### TASK ###
Now you are given a list of syntactically incorrect Trino SQL queries and related error messages.
With given database schema, please think step by step to correct these wrong Trino SQL quries.

### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document.content }}
{% endfor %}

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
{% endfor %}

Let's think step by step.
"""


class SQLCorrection(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
    ):
        self._pipeline = Pipeline()
        self._pipeline.add_component(
            "sql_correction_prompt_builder",
            PromptBuilder(template=sql_correction_user_prompt_template),
        )
        self._pipeline.add_component(
            "sql_correction_generator",
            llm_provider.get_generator(system_prompt=text_to_sql_system_prompt),
        )
        self._pipeline.add_component("post_processor", init_generation_post_processor())

        self._pipeline.connect(
            "sql_correction_prompt_builder.prompt", "sql_correction_generator.prompt"
        )
        self._pipeline.connect(
            "sql_correction_generator.replies", "post_processor.replies"
        )

        super().__init__(self._pipeline)

    @timer
    def run(
        self,
        contexts: List[Document],
        invalid_generation_results: List[Dict[str, str]],
        include_outputs_from: List[str] | None = None,
    ):
        logger.info("Ask SQLCorrection pipeline is running...")
        return self._pipeline.run(
            {
                "sql_correction_prompt_builder": {
                    "invalid_generation_results": invalid_generation_results,
                    "documents": contexts,
                    "alert": TEXT_TO_SQL_RULES,
                },
            },
            include_outputs_from=(
                set(include_outputs_from) if include_outputs_from else None
            ),
        )


if __name__ == "__main__":
    llm_provider, _ = init_providers()
    sql_correction_pipeline = SQLCorrection(
        llm_provider=llm_provider,
    )

    print("generating sql_correction_pipeline.jpg to outputs/pipelines/ask...")
    sql_correction_pipeline.draw("./outputs/pipelines/ask/sql_correction_pipeline.jpg")
