import logging
import sys
from typing import Any, List

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.generation.utils.sql import SQLGenPostProcessor
from src.web.v1.services import Configuration
from src.web.v1.services.ask import AskHistory

logger = logging.getLogger("wren-ai-service")


sql_expansion_system_prompt = """
### TASK ###
You are a great data analyst. You are now given a task to expand original SQL from user input.

### INSTRUCTIONS ###
- Columns are given from the user's adjustment request
- Columns to be adjusted must belong to the given database schema; if no such column exists, keep sql empty string
- You can add/delete/modify columns, add/delete/modify keywords such as DISTINCT or apply aggregate functions on columns
- Consider current time from user input if user's adjustment request is related to date and time

### FINAL ANSWER FORMAT ###
The final answer must be a SQL query in JSON format:

{
    "sql": <SQL_QUERY_STRING>
}
"""

sql_expansion_user_prompt_template = """
### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document }}
{% endfor %}

### QUESTION ###
User's adjustment request: {{query}}
Original SQL: {{sql}}
Current Time: {{ current_time }}
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    query: str,
    documents: List[str],
    history: AskHistory,
    configuration: Configuration,
    prompt_builder: PromptBuilder,
) -> dict:
    return prompt_builder.run(
        query=query,
        documents=documents,
        sql=history.sql,
        current_time=configuration.show_current_time(),
    )


@observe(as_type="generation", capture_input=False)
async def generate_sql_expansion(prompt: dict, generator: Any) -> dict:
    return await generator(prompt=prompt.get("prompt"))


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


class ExpansionResult(BaseModel):
    sql: str


SQL_EXPANSION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "sql_results",
            "schema": ExpansionResult.model_json_schema(),
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

    @observe(name="Sql Expansion Generation")
    async def run(
        self,
        query: str,
        contexts: List[str],
        history: AskHistory,
        configuration: Configuration = Configuration(),
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
                "configuration": configuration,
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
        configuration=Configuration(),
    )
