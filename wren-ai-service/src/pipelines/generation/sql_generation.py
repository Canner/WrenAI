import logging
import sys
from typing import Any, Dict, List

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.common import show_current_time
from src.pipelines.generation.utils.sql import (
    TEXT_TO_SQL_RULES,
    SQLGenPostProcessor,
    construct_instructions,
    sql_generation_system_prompt,
)
from src.web.v1.services import Configuration

logger = logging.getLogger("wren-ai-service")


sql_generation_user_prompt_template = """
### TASK ###
Given a user query, your task is to interpret the query based on the database schema and
generate one SQL statement that best potentially answer user's query.

### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document }}
{% endfor %}

{% if exclude %}
### EXCLUDED STATEMETS ###
Ensure that the following excluded statements are not used in the generated queries to maintain variety and avoid repetition.
{% for doc in exclude %}
    {{ doc.statement }}
{% endfor %}
{% endif %}

{{ text_to_sql_rules }}
{% if instructions %}
{{ instructions }}
{% endif %}

### FINAL ANSWER FORMAT ###
The final answer must be the JSON format like following:

{
    "results": [
        {"sql": <SQL_QUERY_STRING>}
    ]
}

{% if sql_samples %}
### SAMPLES ###
{% for sample in sql_samples %}
Summary:
{{sample.summary}}
SQL:
{{sample.sql}}
{% endfor %}
{% endif %}

### QUESTION ###
User's Question: {{ query }}
Current Time: {{ current_time }}

Let's think step by step.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    query: str,
    documents: List[str],
    exclude: List[Dict],
    text_to_sql_rules: str,
    prompt_builder: PromptBuilder,
    configuration: Configuration | None = None,
    sql_samples: List[Dict] | None = None,
) -> dict:
    return prompt_builder.run(
        query=query,
        documents=documents,
        exclude=exclude,
        text_to_sql_rules=text_to_sql_rules,
        instructions=construct_instructions(configuration),
        sql_samples=sql_samples,
        current_time=show_current_time(configuration.timezone),
    )


@observe(as_type="generation", capture_input=False)
async def generate_sql(
    prompt: dict,
    generator: Any,
) -> dict:
    return await generator(prompt=prompt.get("prompt"))


@observe(capture_input=False)
async def post_process(
    generate_sql: dict,
    post_processor: SQLGenPostProcessor,
    project_id: str | None = None,
) -> dict:
    return await post_processor.run(generate_sql.get("replies"), project_id=project_id)


## End of Pipeline
class SQLResult(BaseModel):
    sql: str


class GenerationResults(BaseModel):
    results: list[SQLResult]


SQL_GENERATION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "sql_results",
            "schema": GenerationResults.model_json_schema(),
        },
    }
}


class SQLGeneration(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        engine: Engine,
        **kwargs,
    ):
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=sql_generation_system_prompt,
                generation_kwargs=SQL_GENERATION_MODEL_KWARGS,
            ),
            "prompt_builder": PromptBuilder(
                template=sql_generation_user_prompt_template
            ),
            "post_processor": SQLGenPostProcessor(engine=engine),
        }

        self._configs = {
            "text_to_sql_rules": TEXT_TO_SQL_RULES,
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="SQL Generation")
    async def run(
        self,
        query: str,
        contexts: List[str],
        exclude: List[Dict],
        configuration: Configuration = Configuration(),
        sql_samples: List[Dict] | None = None,
        project_id: str | None = None,
    ):
        logger.info("SQL Generation pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "documents": contexts,
                "exclude": exclude,
                "sql_samples": sql_samples,
                "project_id": project_id,
                "configuration": configuration,
                **self._components,
                **self._configs,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        SQLGeneration,
        "sql_generation",
        query="this is a test query",
        contexts=[],
        exclude=[],
    )
