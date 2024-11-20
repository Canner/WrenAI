import logging
import sys
from pathlib import Path
from typing import Any, Dict, Optional

import aiohttp
import orjson
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack import component
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.utils import async_timer, timer

logger = logging.getLogger("wren-ai-service")

sql_to_answer_system_prompt = """
### TASK

You are a data analyst that great at answering user's questions based on the data, sql so that even non technical users can easily understand.
Please answer the user's question in concise and clear manner in Markdown format.

### INSTRUCTIONS

1. Read the user's question and understand the user's intention.
2. Read the sql and understand the data.
4. Generate a consice and clear answer in string format and a reasoning process in string format to the user's question based on the data, sql.
5. If answer is in list format, only list top few examples, and tell users there are more results omitted.
6. Answer must be in the same language user specified.

### OUTPUT FORMAT

Return the output in the following JSON format:

{
    "reasoning": "<STRING>",
    "answer": "<STRING_IN_MARKDOWN_FORMAT>",
}
"""

sql_to_answer_user_prompt_template = """
### Input
User's question: {{ query }}
SQL: {{ sql }}
Data: {{ sql_data }}
Language: {{ language }}
Please think step by step and answer the user's question.
"""


@component
class DataFetcher:
    def __init__(self, engine: Engine):
        self._engine = engine

    @component.output_types(
        results=Optional[Dict[str, Any]],
    )
    async def run(
        self,
        sql: str,
        project_id: str | None = None,
    ):
        async with aiohttp.ClientSession() as session:
            _, data, _ = await self._engine.execute_sql(
                sql,
                session,
                project_id=project_id,
                dry_run=False,
            )

            return {"results": data}


@component
class SQLAnswerGenerationPostProcessor:
    @component.output_types(
        results=Dict[str, Any],
    )
    def run(
        self,
        replies: str,
    ):
        try:
            data = orjson.loads(replies[0])

            return {
                "results": {
                    "answer": data["answer"],
                    "reasoning": data["reasoning"],
                    "error": "",
                }
            }
        except Exception as e:
            logger.exception(f"Error in SQLAnswerGenerationPostProcessor: {e}")

            return {
                "results": {
                    "answer": "",
                    "reasoning": "",
                    "error": str(e),
                }
            }


## Start of Pipeline
@async_timer
@observe(capture_input=False)
async def execute_sql(
    sql: str, data_fetcher: DataFetcher, project_id: str | None = None
) -> dict:
    return await data_fetcher.run(sql=sql, project_id=project_id)


@timer
@observe(capture_input=False)
def prompt(
    query: str,
    sql: str,
    execute_sql: dict,
    language: str,
    prompt_builder: PromptBuilder,
) -> dict:
    return prompt_builder.run(
        query=query,
        sql=sql,
        sql_data=execute_sql["results"],
        language=language,
    )


@async_timer
@observe(as_type="generation", capture_input=False)
async def generate_answer(prompt: dict, generator: Any) -> dict:
    return await generator.run(prompt=prompt.get("prompt"))


@timer
@observe(capture_input=False)
def post_process(
    generate_answer: dict, post_processor: SQLAnswerGenerationPostProcessor
) -> dict:
    return post_processor.run(generate_answer.get("replies"))


## End of Pipeline


class AnswerResults(BaseModel):
    reasoning: str
    answer: str


SQL_ANSWER_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "sql_summary",
            "schema": AnswerResults.model_json_schema(),
        },
    }
}


class SQLAnswer(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        engine: Engine,
        **kwargs,
    ):
        self._components = {
            "data_fetcher": DataFetcher(engine=engine),
            "prompt_builder": PromptBuilder(
                template=sql_to_answer_user_prompt_template
            ),
            "generator": llm_provider.get_generator(
                system_prompt=sql_to_answer_system_prompt,
                generation_kwargs=SQL_ANSWER_MODEL_KWARGS,
            ),
            "post_processor": SQLAnswerGenerationPostProcessor(),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def visualize(
        self,
        query: str,
        sql: str,
        language: str,
        project_id: str | None = None,
    ) -> None:
        destination = "outputs/pipelines/generation"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            ["post_process"],
            output_file_path=f"{destination}/sql_answer.dot",
            inputs={
                "query": query,
                "sql": sql,
                "language": language,
                "project_id": project_id,
                **self._components,
            },
            show_legend=True,
            orient="LR",
        )

    @async_timer
    @observe(name="SQL Answer Generation")
    async def run(
        self,
        query: str,
        sql: str,
        language: str,
        project_id: str | None = None,
    ) -> dict:
        logger.info("Sql_Answer Generation pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "sql": sql,
                "language": language,
                "project_id": project_id,
                **self._components,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        SQLAnswer,
        "sql_answer",
        query="query",
        sql="SELECT * FROM table_name",
        language="English",
    )
