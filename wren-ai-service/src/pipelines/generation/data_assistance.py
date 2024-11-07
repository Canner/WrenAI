import logging
import sys
from pathlib import Path
from typing import Any

import orjson
from hamilton import base
from hamilton.experimental.h_async import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.utils import async_timer, timer

logger = logging.getLogger("wren-ai-service")


data_assistance_system_prompt = """
### TASK ###
You are a data analyst great at answering user's questions about given database schema.
Please carefully read user's question and database schema to answer it in easy to understand manner
using the Markdown format. Your goal is to help guide user understand its database and what questions they can ask!

### OUTPUT FORMAT ###
Please provide your response as a JSON object, structured as follows:

{
    "results": <answer_in_markdown_string_format>
}
"""

data_assistance_user_prompt_template = """
### DATABASE SCHEMA ###
{% for db_schema in db_schemas %}
    {{ db_schema }}
{% endfor %}

### INPUT ###
User's question: {{query}}

Please think step by step
"""


## Start of Pipeline
@timer
@observe(capture_input=False)
def prompt(
    query: str,
    db_schemas: list[str],
    prompt_builder: PromptBuilder,
) -> dict:
    logger.debug(f"query: {query}")
    logger.debug(f"db_schemas: {db_schemas}")

    return prompt_builder.run(query=query, db_schemas=db_schemas)


@async_timer
@observe(as_type="generation", capture_input=False)
async def data_assistance(prompt: dict, generator: Any) -> dict:
    logger.debug(f"prompt: {orjson.dumps(prompt, option=orjson.OPT_INDENT_2).decode()}")

    return await generator.run(prompt=prompt.get("prompt"))


@timer
@observe(capture_input=False)
def post_process(data_assistance: dict) -> str:
    logger.debug(
        f"data_assistance: {orjson.dumps(data_assistance, option=orjson.OPT_INDENT_2).decode()}"
    )

    return orjson.loads(data_assistance.get("replies")[0])["results"]


## End of Pipeline


class DataAssistanceResult(BaseModel):
    results: str


DATA_ASSISTANCE_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "data_assistance",
            "schema": DataAssistanceResult.model_json_schema(),
        },
    }
}


class DataAssistance(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **kwargs,
    ):
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=data_assistance_system_prompt,
                generation_kwargs=DATA_ASSISTANCE_MODEL_KWARGS,
            ),
            "prompt_builder": PromptBuilder(
                template=data_assistance_user_prompt_template
            ),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def visualize(
        self,
        query: str,
        db_schemas: list[str],
    ) -> None:
        destination = "outputs/pipelines/generation"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            ["post_process"],
            output_file_path=f"{destination}/data_assistance.dot",
            inputs={
                "query": query,
                "db_schemas": db_schemas,
                **self._components,
            },
            show_legend=True,
            orient="LR",
        )

    @async_timer
    @observe(name="Data Assistance")
    async def run(self, query: str, db_schemas: list[str]):
        logger.info("Data Assistance pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "db_schemas": db_schemas,
                **self._components,
            },
        )


if __name__ == "__main__":
    from langfuse.decorators import langfuse_context

    from src.core.engine import EngineConfig
    from src.core.pipeline import async_validate
    from src.providers import init_providers
    from src.utils import init_langfuse, load_env_vars

    load_env_vars()
    init_langfuse()

    llm_provider, _, _, _ = init_providers(engine_config=EngineConfig())
    pipeline = DataAssistance(
        llm_provider=llm_provider,
    )

    pipeline.visualize("this is a query", [])
    async_validate(lambda: pipeline.run("this is a query", []))

    langfuse_context.flush()
