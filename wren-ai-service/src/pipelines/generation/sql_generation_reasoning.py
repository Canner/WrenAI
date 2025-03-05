import logging
import sys
from typing import Any, List

import orjson
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.web.v1.services import Configuration

logger = logging.getLogger("wren-ai-service")


sql_generation_reasoning_system_prompt = """
### TASK ###
You are a helpful data analyst who is great at thinking deeply and reasoning about the user's question and the database schema, and you provide a step-by-step reasoning plan in order to answer the user's question.

### INSTRUCTIONS ###
1. Think deeply and reason about the user's question and the database schema.
2. Give a step by step reasoning plan in order to answer user's question.
3. The reasoning plan should be in the language same as the language user provided in the input.
4. Make sure to consider the current time provided in the input if the user's question is related to the date/time.

### FINAL ANSWER FORMAT ###
The final answer must be a reasoning plan in JSON format:

{
    "reasoning_plan": <REASONING_PLAN_STRING>
}
"""

sql_generation_reasoning_user_prompt_template = """
### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document }}
{% endfor %}

### QUESTION ###
User's Question: {{ query }}
Current Time: {{ current_time }}
Language: {{ language }}

Let's think step by step.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    query: str,
    documents: List[str],
    prompt_builder: PromptBuilder,
    configuration: Configuration | None = Configuration(),
) -> dict:
    return prompt_builder.run(
        query=query,
        documents=documents,
        current_time=configuration.show_current_time(),
        language=configuration.language,
    )


@observe(as_type="generation", capture_input=False)
async def generate_sql_reasoning(
    prompt: dict,
    generator: Any,
) -> dict:
    return await generator(prompt=prompt.get("prompt"))


@observe()
def post_process(
    generate_sql_reasoning: dict,
) -> dict:
    return orjson.loads(generate_sql_reasoning.get("replies")[0])


## End of Pipeline


class SqlGenerationReasoningResult(BaseModel):
    reasoning_plan: str


SQL_GENERATION_REASONING_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "sql_generation_reasoning_results",
            "schema": SqlGenerationReasoningResult.model_json_schema(),
        },
    }
}


class SQLGenerationReasoning(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **kwargs,
    ):
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=sql_generation_reasoning_system_prompt,
                generation_kwargs=SQL_GENERATION_REASONING_MODEL_KWARGS,
            ),
            "prompt_builder": PromptBuilder(
                template=sql_generation_reasoning_user_prompt_template
            ),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="SQL Generation Reasoning")
    async def run(
        self,
        query: str,
        contexts: List[str],
        configuration: Configuration = Configuration(),
    ):
        logger.info("SQL Generation Reasoning pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "documents": contexts,
                "configuration": configuration,
                **self._components,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        SQLGenerationReasoning,
        "sql_generation_reasoning",
        query="this is a test query",
        contexts=[],
    )
