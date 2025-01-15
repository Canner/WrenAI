import asyncio
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
def prompts(
    sqls: list[str],
    language: str,
    prompt_builder: PromptBuilder,
) -> list[dict]:
    return [
        prompt_builder.run(
            sql=sql,
            language=language,
        )
        for sql in sqls
    ]


@observe(as_type="generation", capture_input=False)
async def generate_sql_questions(prompts: list[dict], generator: Any) -> list[dict]:
    # use asyncio.gather to run all prompts in parallel
    return await asyncio.gather(
        *[generator(prompt=prompt.get("prompt")) for prompt in prompts]
    )


@observe(capture_input=False)
async def post_process(
    generate_sql_questions: list[dict],
) -> list[dict]:
    return [
        orjson.loads(result.get("replies")[0])["question"]
        for result in generate_sql_questions
    ]


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
            "prompt_builder": PromptBuilder(template=sql_question_user_prompt_template),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Sql Question Generation")
    async def run(
        self,
        sqls: list[str],
        configuration: Configuration = Configuration(),
    ):
        logger.info("Sql Question Generation pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "sqls": sqls,
                "language": configuration.language or "English",
                **self._components,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        SQLQuestion,
        "sql_question",
        sqls=["SELECT * FROM table", "SELECT * FROM table2"],
        configuration=Configuration(),
    )
