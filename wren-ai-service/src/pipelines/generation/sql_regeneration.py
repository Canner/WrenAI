import logging
import sys
from pathlib import Path
from typing import Any, Dict, List

import orjson
from hamilton import base
from hamilton.experimental.h_async import AsyncDriver
from haystack import component
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.common import SQLBreakdownGenPostProcessor
from src.utils import async_timer, timer
from src.web.v1.services.sql_regeneration import (
    SQLExplanationWithUserCorrections,
)

logger = logging.getLogger("wren-ai-service")


sql_regeneration_system_prompt = """
### Instructions ###

- Given a list of user corrections, regenerate the corresponding SQL query.
- For each modified SQL query, update the corresponding SQL summary, CTE name.
- If subsequent steps are dependent on the corrected step, make sure to update the SQL query, SQL summary and CTE name in subsequent steps if needed.
- Regenerate the description after correcting all of the steps.

### INPUT STRUCTURE ###

{
    "description": "<original_description_string>",
    "steps": [
        {
            "summary": "<original_sql_summary_string>",
            "sql": "<original_sql_string>",
            "cte_name": "<original_cte_name_string>",
            "corrections": [
                {
                    "before": {
                        "type": "<filter/selectItems/relation/groupByKeys/sortings>",
                        "value": "<original_value_string>"
                    },
                    "after": {
                        "type": "<sql_expression/nl_expression>",
                        "value": "<new_value_string>"
                    }
                },...
            ]
        },...
    ]
}

### OUTPUT STRUCTURE ###

Generate modified results according to the following in JSON format:

{
    "description": "<modified_description_string>",
    "steps": [
        {
            "summary": "<modified_sql_summary_string>",
            "sql": "<modified_sql_string>",
            "cte_name": "<modified_cte_name_string>",
        },...
    ]
}
"""

sql_regeneration_user_prompt_template = """
inputs: {{ results }}

Let's think step by step.
"""


@component
class SQLRegenerationPreprocesser:
    @component.output_types(
        results=Dict[str, Any],
    )
    def run(
        self,
        description: str,
        steps: List[SQLExplanationWithUserCorrections],
    ) -> Dict[str, Any]:
        return {
            "results": {
                "description": description,
                "steps": steps,
            }
        }


## Start of Pipeline
@timer
@observe(capture_input=False)
def preprocess(
    description: str,
    steps: List[SQLExplanationWithUserCorrections],
    preprocesser: SQLRegenerationPreprocesser,
) -> dict[str, Any]:
    logger.debug(f"steps: {steps}")
    logger.debug(f"description: {description}")
    return preprocesser.run(
        description=description,
        steps=steps,
    )


@timer
@observe(capture_input=False)
def sql_regeneration_prompt(
    preprocess: Dict[str, Any],
    prompt_builder: PromptBuilder,
) -> dict:
    logger.debug(f"preprocess: {preprocess}")
    return prompt_builder.run(results=preprocess["results"])


@async_timer
@observe(as_type="generation", capture_input=False)
async def generate_sql_regeneration(
    sql_regeneration_prompt: dict,
    generator: Any,
) -> dict:
    logger.debug(
        f"sql_regeneration_prompt: {orjson.dumps(sql_regeneration_prompt, option=orjson.OPT_INDENT_2).decode()}"
    )
    return await generator.run(prompt=sql_regeneration_prompt.get("prompt"))


@async_timer
@observe(capture_input=False)
async def sql_regeneration_post_process(
    generate_sql_regeneration: dict,
    post_processor: SQLBreakdownGenPostProcessor,
    project_id: str | None = None,
) -> dict:
    logger.debug(
        f"generate_sql_regeneration: {orjson.dumps(generate_sql_regeneration, option=orjson.OPT_INDENT_2).decode()}"
    )
    return await post_processor.run(
        replies=generate_sql_regeneration.get("replies"),
        project_id=project_id,
    )


## End of Pipeline


class SQLRegeneration(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        engine: Engine,
    ):
        self._components = {
            "preprocesser": SQLRegenerationPreprocesser(),
            "prompt_builder": PromptBuilder(
                template=sql_regeneration_user_prompt_template
            ),
            "generator": llm_provider.get_generator(
                system_prompt=sql_regeneration_system_prompt
            ),
            "post_processor": SQLBreakdownGenPostProcessor(engine=engine),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def visualize(
        self,
        description: str,
        steps: List[SQLExplanationWithUserCorrections],
        project_id: str | None = None,
    ) -> None:
        destination = "outputs/pipelines/generation"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            ["sql_regeneration_post_process"],
            output_file_path=f"{destination}/sql_regeneration.dot",
            inputs={
                "description": description,
                "steps": steps,
                "project_id": project_id,
                **self._components,
            },
            show_legend=True,
            orient="LR",
        )

    @async_timer
    @observe(name="SQL-Regeneration Generation")
    async def run(
        self,
        description: str,
        steps: List[SQLExplanationWithUserCorrections],
        project_id: str | None = None,
    ):
        logger.info("SQL Regeneration Generation pipeline is running...")
        return await self._pipe.execute(
            ["sql_regeneration_post_process"],
            inputs={
                "description": description,
                "steps": steps,
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

    llm_provider, _, _, engine = init_providers(EngineConfig())
    pipeline = SQLRegeneration(
        llm_provider=llm_provider,
        engine=engine,
    )

    pipeline.visualize("This is a description", [])
    async_validate(lambda: pipeline.run("This is a description", []))

    langfuse_context.flush()
