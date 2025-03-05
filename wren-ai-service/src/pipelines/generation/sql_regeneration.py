import logging
import sys
from typing import Any, Dict, List

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack import component
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.generation.utils.sql import SQLBreakdownGenPostProcessor
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
@observe(capture_input=False)
def preprocess(
    description: str,
    steps: List[SQLExplanationWithUserCorrections],
    preprocesser: SQLRegenerationPreprocesser,
) -> dict[str, Any]:
    return preprocesser.run(
        description=description,
        steps=steps,
    )


@observe(capture_input=False)
def sql_regeneration_prompt(
    preprocess: Dict[str, Any],
    prompt_builder: PromptBuilder,
) -> dict:
    return prompt_builder.run(results=preprocess["results"])


@observe(as_type="generation", capture_input=False)
async def generate_sql_regeneration(
    sql_regeneration_prompt: dict,
    generator: Any,
) -> dict:
    return await generator(prompt=sql_regeneration_prompt.get("prompt"))


@observe(capture_input=False)
async def sql_regeneration_post_process(
    generate_sql_regeneration: dict,
    post_processor: SQLBreakdownGenPostProcessor,
    project_id: str | None = None,
) -> dict:
    return await post_processor.run(
        replies=generate_sql_regeneration.get("replies"),
        project_id=project_id,
    )


## End of Pipeline


class StepResult(BaseModel):
    sql: str
    summary: str
    cte_name: str


class RegenerationResults(BaseModel):
    description: str
    steps: list[StepResult]


SQL_REGENERATION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "regeneration_results",
            "schema": RegenerationResults.model_json_schema(),
        },
    }
}


class SQLRegeneration(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        engine: Engine,
        **kwargs,
    ):
        self._components = {
            "preprocesser": SQLRegenerationPreprocesser(),
            "prompt_builder": PromptBuilder(
                template=sql_regeneration_user_prompt_template
            ),
            "generator": llm_provider.get_generator(
                system_prompt=sql_regeneration_system_prompt,
                generation_kwargs=SQL_REGENERATION_MODEL_KWARGS,
            ),
            "post_processor": SQLBreakdownGenPostProcessor(engine=engine),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

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
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        SQLRegeneration,
        "sql_regeneration",
        description="This is a description",
        steps=[],
    )
