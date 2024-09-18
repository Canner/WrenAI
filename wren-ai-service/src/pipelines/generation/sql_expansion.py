import logging
import sys
from pathlib import Path
from typing import Any, List

import orjson
from hamilton import base
from hamilton.experimental.h_async import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.common import SQLGenPostProcessor
from src.utils import async_timer, timer
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
"""


## Start of Pipeline
@timer
@observe(capture_input=False)
def prompt(
    query: str,
    documents: List[str],
    history: AskHistory,
    prompt_builder: PromptBuilder,
) -> dict:
    logger.debug(f"query: {query}")
    logger.debug(f"documents: {documents}")
    logger.debug(f"history: {history}")
    return prompt_builder.run(query=query, documents=documents, sql=history.sql)


@async_timer
@observe(as_type="generation", capture_input=False)
async def generate_sql_expansion(prompt: dict, generator: Any) -> dict:
    logger.debug(f"prompt: {orjson.dumps(prompt, option=orjson.OPT_INDENT_2).decode()}")
    return await generator.run(prompt=prompt.get("prompt"))


@async_timer
@observe(capture_input=False)
async def post_process(
    generate_sql_expansion: dict,
    post_processor: SQLGenPostProcessor,
    project_id: str | None = None,
) -> dict:
    logger.debug(
        f"generate_sql_expansion: {orjson.dumps(generate_sql_expansion, option=orjson.OPT_INDENT_2).decode()}"
    )
    return await post_processor.run(
        generate_sql_expansion.get("replies"), project_id=project_id
    )


## End of Pipeline


class SQLExpansion(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        engine: Engine,
    ):
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=sql_expansion_system_prompt
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
                **self._components,
            },
        )


if __name__ == "__main__":
    from langfuse.decorators import langfuse_context

    from src.core.engine import EngineConfig
    from src.core.pipeline import async_validate
    from src.utils import init_langfuse, init_providers, load_env_vars

    load_env_vars()
    init_langfuse()

    llm_provider, _, _, engine = init_providers(engine_config=EngineConfig())
    pipeline = SQLExpansion(llm_provider=llm_provider, engine=engine)

    pipeline.visualize(
        "this is a test query",
        [],
        AskHistory(sql="SELECT * FROM table", summary="Summary", steps=[]),
    )
    async_validate(
        lambda: pipeline.run(
            "this is a test query",
            [],
            AskHistory(sql="SELECT * FROM table", summary="Summary", steps=[]),
        )
    )

    langfuse_context.flush()
