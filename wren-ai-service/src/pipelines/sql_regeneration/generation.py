import logging
from typing import Any, Dict, List, Optional

import orjson
from haystack import Pipeline, component
from haystack.components.builders.prompt_builder import PromptBuilder

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.engine import clean_generation_result
from src.pipelines.sql_regeneration.components.prompts import (
    description_regeneration_system_prompt,
    sql_regeneration_system_prompt,
)
from src.utils import init_providers
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

### OUTPUT STRUCTURE ###
[
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

### INPUT ###

{% for result in results %}
    {{ result }}
{% endfor %}

Generate modified results according to the OUTPUT STRUCTURE in JSON format:

{
    "results": <OUTPUT_STRUCTURE>
}

Think step by step
"""


description_regeneration_user_prompt_template = """
### OUTPUT STRUCTURE ###

{
    "description": "<modified_description_string>"
}

### INPUT ###

description: "<original_description_string>"
steps:
{% for step in steps %}
    {{ step }}
{% endfor %}


Generate modified description according to the OUTPUT STRUCTURE in JSON format
Think step by step
"""


@component
class StepsWithUserCorrectionsFilter:
    @component.output_types(
        results=Dict[str, Any],
    )
    def run(self, steps: List[SQLExplanationWithUserCorrections]) -> Dict[str, Any]:
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
class SQLReGenerationByStepPostProcessor:
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
        modified_steps = orjson.loads(replies[0])["results"]
        new_steps = [
            {
                "sql": clean_generation_result(step.sql),
                "summary": step.summary,
                "cte_name": step.cte_name,
            }
            for step in original_steps
        ]
        for modified_step in modified_steps:
            new_steps[modified_step["index"]] = {
                "sql": clean_generation_result(modified_step.get("sql", "")),
                "summary": modified_step.get("summary", ""),
                "cte_name": modified_step.get("cte_name", ""),
            }

        return {"description": original_description, "steps": new_steps}


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
        return {
            "results": {
                "description": orjson.loads(replies[0]).get("description", ""),
                "steps": steps,
            }
        }


class Generation(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
    ):
        self._pipeline = Pipeline()
        self._pipeline.add_component(
            "steps_with_user_corrections_filter",
            StepsWithUserCorrectionsFilter(),
        )
        self._pipeline.add_component(
            "sql_regeneration_by_step_prompt_builder",
            PromptBuilder(template=sql_regeneration_user_prompt_template),
        )
        self._pipeline.add_component(
            "sql_regeneration_by_step_generator",
            llm_provider.get_generator(system_prompt=sql_regeneration_system_prompt),
        )
        self._pipeline.add_component(
            "sql_regeneration_by_step_post_processor",
            SQLReGenerationByStepPostProcessor(),
        )
        self._pipeline.add_component(
            "description_regeneration_prompt_builder",
            PromptBuilder(template=description_regeneration_user_prompt_template),
        )
        self._pipeline.add_component(
            "description_regeneration_generator",
            llm_provider.get_generator(
                system_prompt=description_regeneration_system_prompt
            ),
        )
        self._pipeline.add_component(
            "description_regeneration_post_processor",
            DescriptionRegenerationPostProcessor(),
        )

        self._pipeline.connect(
            "steps_with_user_corrections_filter.results",
            "sql_regeneration_by_step_prompt_builder",
        )
        self._pipeline.connect(
            "sql_regeneration_by_step_prompt_builder.prompt",
            "sql_regeneration_by_step_generator.prompt",
        )
        self._pipeline.connect(
            "sql_regeneration_by_step_generator.replies",
            "sql_regeneration_by_step_post_processor.replies",
        )
        self._pipeline.connect(
            "sql_regeneration_by_step_post_processor",
            "description_regeneration_prompt_builder",
        )
        self._pipeline.connect(
            "description_regeneration_prompt_builder.prompt",
            "description_regeneration_generator.prompt",
        )
        self._pipeline.connect(
            "sql_regeneration_by_step_post_processor.steps",
            "description_regeneration_post_processor.steps",
        )
        self._pipeline.connect(
            "description_regeneration_generator.replies",
            "description_regeneration_post_processor.replies",
        )

        super().__init__(self._pipeline)

    def run(
        self,
        description: str,
        steps: List[SQLExplanationWithUserCorrections],
        include_outputs_from: Optional[List[str]] = None,
    ):
        logger.info("SQL Regeneration Generation pipeline is running...")
        return self._pipeline.run(
            {
                "steps_with_user_corrections_filter": {
                    "steps": steps,
                },
                "sql_regeneration_by_step_post_processor": {
                    "original_description": description,
                    "original_steps": steps,
                },
            },
            include_outputs_from=(
                set(include_outputs_from) if include_outputs_from else None
            ),
        )


if __name__ == "__main__":
    from src.utils import load_env_vars

    load_env_vars()

    llm_provider, _ = init_providers()
    generation_pipeline = Generation(
        llm_provider=llm_provider,
    )
