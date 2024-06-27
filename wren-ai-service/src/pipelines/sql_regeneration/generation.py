import logging
import sys
from typing import Any, Dict, List, Optional

import orjson
from hamilton import base
from hamilton.experimental.h_async import AsyncDriver
from haystack import component
from haystack.components.builders.prompt_builder import PromptBuilder

from src.core.engine import clean_generation_result
from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.sql_regeneration.components.prompts import (
    description_regeneration_system_prompt,
    sql_regeneration_system_prompt,
)
from src.utils import async_timer, init_providers, timer
from src.web.v1.services.sql_regeneration import (
    SQLExplanationWithUserCorrections,
)

logger = logging.getLogger("wren-ai-service")


sql_regeneration_user_prompt_template = """
### TASK ###

Given each step of the SQL query, SQL summary, cte name and a list of user corrections, 
your job is to regenerate the corresponding SQL query, SQL summary and cte given the user corrections.

### INPUT STRUCTURE ###

{
    "index": <step_index>,
    "step": {
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
}


### INPUT ###

{% for result in results %}
    {{ result }}
{% endfor %}

### OUTPUT STRUCTURE ###

Generate modified results according to the following in JSON format:

{
    "results": [
        {
            "index": <step_index>,
            "summary": "<modified_sql_summary_string>",
            "sql": "<modified_sql_string>",
            "cte_name": "<modified_cte_name_string>"
        },
        {
            "index": <step_index>,
            "summary": "<modified_sql_summary_string>",
            "sql": "<modified_sql_string>",
            "cte_name": "<modified_cte_name_string>"
        },
        ...
    ]
}

Think step by step
"""


description_regeneration_user_prompt_template = """
### INPUT ###

description: {{ description }}
steps:
{% for step in steps %}
    {{ step }}
{% endfor %}

### OUTPUT STRUCTURE ###

{
    "description": "<modified_description_string>"
}

Generate modified description according to the OUTPUT STRUCTURE in JSON format
Think step by step
"""


@component
class StepsWithUserCorrectionsFilter:
    @component.output_types(
        results=List[Dict[str, Any]],
    )
    def run(
        self, steps: List[SQLExplanationWithUserCorrections]
    ) -> Dict[str, List[Dict]]:
        return {
            "results": list(
                map(
                    lambda step: {
                        "index": step["index"],
                        "step": step["step"].model_dump_json(),
                    },
                    filter(
                        lambda step: step["step"].corrections,
                        [{"index": i, "step": step} for i, step in enumerate(steps)],
                    ),
                )
            )
        }


@component
class SQLRegenerationByStepPostProcessor:
    @component.output_types(
        description=str,
        steps=List[str],
    )
    def run(
        self,
        replies: List[str],
        original_description: str,
        original_steps: List[str],
    ) -> Dict[str, Any]:
        try:
            modified_steps = orjson.loads(replies[0]).get("results", [])
            new_steps = [
                {
                    "sql": clean_generation_result(step.sql),
                    "summary": step.summary,
                    "cte_name": step.cte_name,
                }
                for step in original_steps
            ]
            if new_steps:
                for modified_step in modified_steps:
                    new_steps[modified_step["index"]] = {
                        "sql": clean_generation_result(modified_step.get("sql", "")),
                        "summary": modified_step.get("summary", ""),
                        "cte_name": modified_step.get("cte_name", ""),
                    }

            return {"description": original_description, "steps": new_steps}
        except Exception as e:
            logger.exception(f"Error in SQLRegenerationByStepPostProcessor: {e}")
            return {"description": original_description, "steps": original_steps}


@component
class DescriptionRegenerationPostProcessor:
    @component.output_types(
        results=Optional[Dict[str, Any]],
    )
    def run(
        self,
        replies: List[str],
        steps: List[str],
    ) -> Dict[str, Any]:
        try:
            return {
                "results": {
                    "description": orjson.loads(replies[0]).get("description", ""),
                    "steps": steps,
                }
            }
        except Exception as e:
            logger.exception(f"Error in DescriptionRegenerationPostProcessor: {e}")
            return {"results": None}


## Start of Pipeline
@timer
def preprocess(
    steps: List[SQLExplanationWithUserCorrections],
    steps_with_user_corrections_filter: StepsWithUserCorrectionsFilter,
) -> dict[str, Any]:
    logger.debug(f"steps: {steps}")
    return steps_with_user_corrections_filter.run(steps)["results"]


@timer
def sql_regeneration_by_step_prompt(
    preprocess: Dict[str, Any],
    sql_regeneration_by_step_prompt_builder: PromptBuilder,
) -> dict:
    logger.debug(f"preprocess: {preprocess}")
    return sql_regeneration_by_step_prompt_builder.run(results=preprocess)


@async_timer
async def sql_regeneration_by_step_generate(
    sql_regeneration_by_step_prompt: dict,
    sql_regeneration_by_step_generator: Any,
) -> dict:
    logger.debug(f"sql_regeneration_by_step_prompt: {sql_regeneration_by_step_prompt}")
    return await sql_regeneration_by_step_generator.run(
        prompt=sql_regeneration_by_step_prompt.get("prompt")
    )


@timer
def sql_regeneration_post_process(
    sql_regeneration_by_step_generate: dict,
    description: str,
    steps: List[SQLExplanationWithUserCorrections],
    sql_regeneration_by_step_post_processor: SQLRegenerationByStepPostProcessor,
) -> dict:
    logger.debug(
        f"sql_regeneration_by_step_generate: {sql_regeneration_by_step_generate}"
    )
    logger.debug(f"description: {description}")
    logger.debug(f"steps: {steps}")
    return sql_regeneration_by_step_post_processor.run(
        replies=sql_regeneration_by_step_generate.get("replies"),
        original_description=description,
        original_steps=steps,
    )


@timer
def description_regeneration_prompt(
    sql_regeneration_post_process: dict,
    description_regeneration_prompt_builder: PromptBuilder,
) -> dict:
    logger.debug(f"sql_regeneration_post_process: {sql_regeneration_post_process}")
    return description_regeneration_prompt_builder.run(
        description=sql_regeneration_post_process.get("description"),
        steps=sql_regeneration_post_process.get("steps"),
    )


@async_timer
async def description_regeneration_generate(
    description_regeneration_prompt: dict,
    description_regeneration_generator: Any,
) -> dict:
    logger.debug(f"description_regeneration_prompt: {description_regeneration_prompt}")
    return await description_regeneration_generator.run(
        prompt=description_regeneration_prompt.get("prompt")
    )


@timer
def description_regeneration_post_process(
    description_regeneration_generate: dict,
    sql_regeneration_post_process: dict,
    description_regeneration_post_processor: DescriptionRegenerationPostProcessor,
) -> dict:
    logger.debug(
        f"description_regeneration_generate: {description_regeneration_generate}"
    )
    logger.debug(f"sql_regeneration_post_process: {sql_regeneration_post_process}")
    return description_regeneration_post_processor.run(
        replies=description_regeneration_generate.get("replies"),
        steps=sql_regeneration_post_process.get("steps"),
    )


## End of Pipeline


class Generation(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
    ):
        self.steps_with_user_corrections_filter = StepsWithUserCorrectionsFilter()
        self.sql_regeneration_by_step_prompt_builder = PromptBuilder(
            template=sql_regeneration_user_prompt_template
        )
        self.sql_regeneration_by_step_generator = llm_provider.get_generator(
            system_prompt=sql_regeneration_system_prompt
        )
        self.sql_regeneration_by_step_post_processor = (
            SQLRegenerationByStepPostProcessor()
        )
        self.description_regeneration_prompt_builder = PromptBuilder(
            template=description_regeneration_user_prompt_template
        )
        self.description_regeneration_generator = llm_provider.get_generator(
            system_prompt=description_regeneration_system_prompt
        )
        self.description_regeneration_post_processor = (
            DescriptionRegenerationPostProcessor()
        )

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @async_timer
    async def run(
        self,
        description: str,
        steps: List[SQLExplanationWithUserCorrections],
    ):
        logger.info("SQL Regeneration Generation pipeline is running...")
        return await self._pipe.execute(
            ["description_regeneration_post_process"],
            inputs={
                "description": description,
                "steps": steps,
                "steps_with_user_corrections_filter": self.steps_with_user_corrections_filter,
                "sql_regeneration_by_step_prompt_builder": self.sql_regeneration_by_step_prompt_builder,
                "sql_regeneration_by_step_generator": self.sql_regeneration_by_step_generator,
                "sql_regeneration_by_step_post_processor": self.sql_regeneration_by_step_post_processor,
                "description_regeneration_prompt_builder": self.description_regeneration_prompt_builder,
                "description_regeneration_generator": self.description_regeneration_generator,
                "description_regeneration_post_processor": self.description_regeneration_post_processor,
            },
        )


if __name__ == "__main__":
    from src.core.pipeline import async_validate
    from src.utils import load_env_vars

    load_env_vars()

    llm_provider, _ = init_providers()
    pipeline = Generation(
        llm_provider=llm_provider,
    )

    async_validate(
        lambda: pipeline.run(
            "This is a description",
            [],
        )
    )
