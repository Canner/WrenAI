import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, List

import dspy
import orjson
from hamilton import base
from hamilton.experimental.h_async import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from eval.dspy_modules.ask_generation import AskGenerationV1
from eval.dspy_modules.prompt_optimizer import configure_llm_provider
from src.core.engine import Engine
from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.common import (
    TEXT_TO_SQL_RULES,
    SQLGenPostProcessor,
    construct_instructions,
    show_current_time,
    sql_generation_system_prompt,
)
from src.utils import async_timer, timer
from src.web.v1.services.ask import AskConfigurations

logger = logging.getLogger("wren-ai-service")


sql_generation_user_prompt_template = """
### TASK ###
Given a user query that is ambiguous in nature, your task is to interpret the query in various plausible ways and
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

{{ alert }}
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

{% if samples %}
### SAMPLES ###
{% for sample in samples %}
Question:
{{sample.question}}
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
@timer
@observe(capture_input=False)
def prompt(
    query: str,
    documents: List[str],
    exclude: List[Dict],
    alert: str,
    prompt_builder: PromptBuilder,
    configurations: AskConfigurations | None = None,
    samples: List[Dict] | None = None,
    dspy_module: dspy.Module | None = None,
) -> dict:
    logger.debug(f"query: {query}")
    logger.debug(f"documents: {documents}")

    if dspy_module:
        # use dspy to predict, the input is question and context
        context = []
        dspy_inputs = {}
        for doc in documents:
            context.append(str(doc))
        dspy_inputs["context"] = context
        dspy_inputs["question"] = query
        return dspy_inputs

    logger.debug(
        f"exclude: {orjson.dumps(exclude, option=orjson.OPT_INDENT_2).decode()}"
    )
    logger.debug(f"configurations: {configurations}")
    if samples:
        logger.debug(f"samples: {samples}")

    return prompt_builder.run(
        query=query,
        documents=documents,
        exclude=exclude,
        alert=alert,
        instructions=construct_instructions(configurations),
        samples=samples,
        current_time=show_current_time(configurations.timezone),
    )


@async_timer
@observe(as_type="generation", capture_input=False)
async def generate_sql(
    prompt: dict, generator: Any, dspy_module: dspy.Module | None = None
) -> dict:
    if dspy_module:
        # use dspy to predict, the input is question and context
        prediction = dspy_module(
            question=prompt["question"].as_string(), context=" ".join(prompt["context"])
        )
        return {"replies": [prediction.answer]}

    logger.debug(f"prompt: {orjson.dumps(prompt, option=orjson.OPT_INDENT_2).decode()}")
    return await generator.run(prompt=prompt.get("prompt"))


@async_timer
@observe(capture_input=False)
async def post_process(
    generate_sql: dict,
    post_processor: SQLGenPostProcessor,
    project_id: str | None = None,
) -> dict:
    logger.debug(
        f"generate_sql: {orjson.dumps(generate_sql, option=orjson.OPT_INDENT_2).decode()}"
    )
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
        dspy_module = None
        if optimized_path := os.getenv("DSPY_OPTIMAZED_MODEL", ""):
            # use dspy to evaluate
            configure_llm_provider(
                os.getenv("GENERATION_MODEL"), os.getenv("LLM_OPENAI_API_KEY")
            )
            dspy_module = AskGenerationV1()
            dspy_module.load(optimized_path)
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=sql_generation_system_prompt,
                generation_kwargs=SQL_GENERATION_MODEL_KWARGS,
            ),
            "prompt_builder": PromptBuilder(
                template=sql_generation_user_prompt_template
            ),
            "post_processor": SQLGenPostProcessor(engine=engine),
            "dspy_module": dspy_module,
        }

        self._configs = {
            "alert": TEXT_TO_SQL_RULES,
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def visualize(
        self,
        query: str,
        contexts: List[str],
        exclude: List[Dict],
        configurations: AskConfigurations = AskConfigurations(),
        samples: List[Dict] | None = None,
        project_id: str | None = None,
    ) -> None:
        destination = "outputs/pipelines/generation"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            ["post_process"],
            output_file_path=f"{destination}/sql_generation.dot",
            inputs={
                "query": query,
                "documents": contexts,
                "exclude": exclude,
                "samples": samples,
                "project_id": project_id,
                "configurations": configurations,
                **self._components,
                **self._configs,
            },
            show_legend=True,
            orient="LR",
        )

    @async_timer
    @observe(name="SQL Generation")
    async def run(
        self,
        query: str,
        contexts: List[str],
        exclude: List[Dict],
        configurations: AskConfigurations = AskConfigurations(),
        samples: List[Dict] | None = None,
        project_id: str | None = None,
    ):
        logger.info("SQL Generation pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "documents": contexts,
                "exclude": exclude,
                "samples": samples,
                "project_id": project_id,
                "configurations": configurations,
                **self._components,
                **self._configs,
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

    llm_provider, _, _, engine = init_providers(engine_config=EngineConfig())
    pipeline = SQLGeneration(
        llm_provider=llm_provider,
        engine=engine,
    )

    pipeline.visualize("this is a test query", [], [])
    async_validate(lambda: pipeline.run("this is a test query", [], []))

    langfuse_context.flush()
