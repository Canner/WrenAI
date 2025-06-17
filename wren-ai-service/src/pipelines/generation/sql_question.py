import logging
import sys
from typing import Any

import orjson
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.utils import trace_cost
from src.web.v1.services import Configuration

logger = logging.getLogger("wren-ai-service")


sql_question_system_prompt = """
### TASK ###

You are a data analyst great at translating any SQL query into a question that can be answered by the given SQL query.

### INSTRUCTIONS ###

- The question should be in the language of the user provided
- The question should be a single sentence, concise, and easy to understand

### OUTPUT FORMAT ###

Please return the result in the following JSON format:

{
    "question": <QUESTION_STRING_IN_USER_LANGUAGE>
}
"""

sql_question_user_prompt_template = """
SQL: {{sql}}
Language: {{language}}

Let's think step by step.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    sql: str,
    language: str,
    prompt_builder: PromptBuilder,
) -> dict:
    return prompt_builder.run(
        sql=sql,
        language=language,
    )


@observe(as_type="generation", capture_input=False)
@trace_cost
async def generate_sql_question(
    prompt: dict, generator: Any, generator_name: str
) -> dict:
    return await generator(prompt=prompt.get("prompt")), generator_name


@observe(capture_input=False)
def post_process(
    generate_sql_question: dict,
) -> str:
    return orjson.loads(generate_sql_question.get("replies")[0])["question"]


## End of Pipeline


class SQLQuestionResult(BaseModel):
    question: str


SQL_QUESTION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "sql_question_result",
            "schema": SQLQuestionResult.model_json_schema(),
        },
    }
}


class SQLQuestion(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **kwargs,
    ):
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=sql_question_system_prompt,
                generation_kwargs=SQL_QUESTION_MODEL_KWARGS,
            ),
            "generator_name": llm_provider.get_model(),
            "prompt_builder": PromptBuilder(template=sql_question_user_prompt_template),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Sql Question Generation")
    async def run(
        self,
        sql: str,
        configuration: Configuration = Configuration(),
    ):
        logger.info("Sql Question Generation pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "sql": sql,
                "language": configuration.language or "English",
                **self._components,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        SQLQuestion,
        "sql_question",
        sql="SELECT * FROM table",
        configuration=Configuration(),
    )
