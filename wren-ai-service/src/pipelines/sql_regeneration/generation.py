import logging
import sys
from typing import Any, Dict, List, Optional

import orjson
from hamilton import base
from hamilton.experimental.h_async import AsyncDriver
from haystack import component
from haystack.components.builders.prompt_builder import PromptBuilder

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.sql_regeneration.components.prompts import (
    sql_regeneration_system_prompt,
)
from src.utils import async_timer, init_providers, timer
from src.web.v1.services.sql_regeneration import (
    SQLExplanationWithUserCorrections,
)

logger = logging.getLogger("wren-ai-service")


sql_regeneration_user_prompt_template = """
### TASK ###

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


### INPUT ###

{{ results }}

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
Think step by step
"""


@component
class SQLRegenerationRreprocesser:
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


@component
class SQLRegenerationPostProcessor:
    @component.output_types(
        description=str,
        steps=List[str],
    )
    def run(
        self,
        replies: List[str],
    ) -> Dict[str, Any]:
        try:
            return {"results": orjson.loads(replies[0])}
        except Exception as e:
            logger.exception(f"Error in SQLRegenerationPostProcessor: {e}")
            return {"results": None}


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
    description: str,
    steps: List[SQLExplanationWithUserCorrections],
    sql_regeneration_preprocesser: SQLRegenerationRreprocesser,
) -> dict[str, Any]:
    logger.debug(f"steps: {steps}")
    logger.debug(f"description: {description}")
    return sql_regeneration_preprocesser.run(
        description=description,
        steps=steps,
    )


@timer
def sql_regeneration_prompt(
    preprocess: Dict[str, Any],
    sql_regeneration_prompt_builder: PromptBuilder,
) -> dict:
    logger.debug(f"preprocess: {preprocess}")
    return sql_regeneration_prompt_builder.run(results=preprocess["results"])


@async_timer
async def sql_regeneration_generate(
    sql_regeneration_prompt: dict,
    sql_regeneration_generator: Any,
) -> dict:
    logger.debug(f"sql_regeneration_prompt: {sql_regeneration_prompt}")
    return await sql_regeneration_generator.run(
        prompt=sql_regeneration_prompt.get("prompt")
    )


@timer
def sql_regeneration_post_process(
    sql_regeneration_generate: dict,
    sql_regeneration_post_processor: SQLRegenerationPostProcessor,
) -> dict:
    logger.debug(f"sql_regeneration_generate: {sql_regeneration_generate}")
    return sql_regeneration_post_processor.run(
        replies=sql_regeneration_generate.get("replies"),
    )


## End of Pipeline


class Generation(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
    ):
        self.sql_regeneration_preprocesser = SQLRegenerationRreprocesser()
        self.sql_regeneration_prompt_builder = PromptBuilder(
            template=sql_regeneration_user_prompt_template
        )
        self.sql_regeneration_generator = llm_provider.get_generator(
            system_prompt=sql_regeneration_system_prompt
        )
        self.sql_regeneration_post_processor = SQLRegenerationPostProcessor()

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
            ["sql_regeneration_post_process"],
            inputs={
                "description": description,
                "steps": steps,
                "sql_regeneration_preprocesser": self.sql_regeneration_preprocesser,
                "sql_regeneration_prompt_builder": self.sql_regeneration_prompt_builder,
                "sql_regeneration_generator": self.sql_regeneration_generator,
                "sql_regeneration_post_processor": self.sql_regeneration_post_processor,
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