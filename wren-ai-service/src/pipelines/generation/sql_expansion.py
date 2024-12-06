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
from src.pipelines.common import SQLGenPostProcessor, show_current_time
from src.utils import async_timer, timer
from src.web.v1.services import Configuration
from src.web.v1.services.ask import AskHistory

logger = logging.getLogger("wren-ai-service")


sql_expansion_system_prompt = """
### TASK ###
You are a great data analyst. You are now given a task to expand original SQL by adding more columns or add more keywords such as DISTINCT.

### INSTRUCTIONS ###
- Columns are given from the user's input
- Columns to be added must belong to the given database schema; if no such column exists, keep SQL_QUERY_STRING empty

### OUTPUT FORMAT ###
Please return the result in the following JSON format:

{
    "results": [
        {"sql": <SQL_QUERY_STRING>}
    ]
}
"""

sql_expansion_user_prompt_template = """
SQL: {{sql}}

Database Schema:
{% for document in documents %}
    {{ document }}
{% endfor %}

User's input: {{query}}
Current Time: {{ current_time }}
"""


## Start of Pipeline
@timer
@observe(capture_input=False)
def prompt(
    query: str,
    documents: List[str],
    history: AskHistory,
    timezone: Configuration.Timezone,
    prompt_builder: PromptBuilder,
) -> dict:
    return prompt_builder.run(
        query=query,
        documents=documents,
        sql=history.sql,
        current_time=show_current_time(timezone),
    )


@async_timer
@observe(as_type="generation", capture_input=False)
async def generate_sql_expansion(prompt: dict, generator: Any) -> dict:
    return await generator(prompt=prompt.get("prompt"))


@async_timer
@observe(capture_input=False)
async def post_process(
    generate_sql_expansion: dict,
    post_processor: SQLGenPostProcessor,
    project_id: str | None = None,
) -> dict:
    return await post_processor.run(
        generate_sql_expansion.get("replies"), project_id=project_id
    )


## End of Pipeline


class ExpandedResult(BaseModel):
    sql: str


class ExpansionResults(BaseModel):
    results: list[ExpandedResult]


SQL_EXPANSION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "sql_results",
            "schema": ExpansionResults.model_json_schema(),
        },
    }
}


class SQLExpansion(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        engine: Engine,
        **kwargs,
    ):
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=sql_expansion_system_prompt,
                generation_kwargs=SQL_EXPANSION_MODEL_KWARGS,
            ),
            "prompt_builder": PromptBuilder(
                template=sql_expansion_user_prompt_template
            ),
            "post_processor": SQLGenPostProcessor(engine=engine),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def visualize(
        self,
        query: str,
        contexts: List[str],
        history: AskHistory,
        timezone: Configuration.Timezone,
        project_id: str | None = None,
    ) -> None:
        destination = "outputs/pipelines/generation"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            ["post_process"],
            output_file_path=f"{destination}/sql_expansion.dot",
            inputs={
                "query": query,
                "documents": contexts,
                "history": history,
                "project_id": project_id,
                "timezone": timezone,
                **self._components,
            },
            show_legend=True,
            orient="LR",
        )

    @async_timer
    @observe(name="Sql Expansion Generation")
    async def run(
        self,
        query: str,
        contexts: List[str],
        history: AskHistory,
        timezone: Configuration.Timezone = Configuration().timezone,
        project_id: str | None = None,
    ):
        logger.info("Sql Expansion Generation pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "documents": contexts,
                "history": history,
                "project_id": project_id,
                "timezone": timezone,
                **self._components,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        SQLExpansion,
        "sql_expansion",
        query="query",
        contexts=[],
        history=AskHistory(sql="SELECT * FROM table", summary="Summary", steps=[]),
        timezone=Configuration.Timezone(name="UTC", utc_offset="+00:00"),
    )
