import json
import logging
from typing import Any, Dict, List, Optional

from haystack import Pipeline, component
from haystack.components.builders.prompt_builder import PromptBuilder

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.sql_regeneration.components.prompts import (
    sql_regeneration_system_prompt,
)
from src.utils import init_providers, load_env_vars
from src.web.v1.services.sql_regeneration import Correction

load_env_vars()
logger = logging.getLogger("wren-ai-service")


sql_regeneration_user_prompt_template = """
{% for correction in corrections %}
    {{ correction }}
{% endfor %}

return json object
{}
"""


@component
class GenerationPostProcessor:
    @component.output_types(
        results=Optional[Dict[str, Any]],
    )
    def run(self, replies: List[str]) -> Dict[str, Any]:
        return {"results": json.loads(replies[0])}


class Generation(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
    ):
        self._pipeline = Pipeline()
        self._pipeline.add_component(
            "sql_regeneration_prompt_builder",
            PromptBuilder(template=sql_regeneration_user_prompt_template),
        )
        self._pipeline.add_component(
            "sql_regeneration_generator",
            llm_provider.get_generator(system_prompt=sql_regeneration_system_prompt),
        )
        self._pipeline.add_component("post_processor", GenerationPostProcessor())

        self._pipeline.connect(
            "sql_regeneration_prompt_builder.prompt",
            "sql_regeneration_generator.prompt",
        )
        self._pipeline.connect(
            "sql_regeneration_generator.replies", "post_processor.replies"
        )

        super().__init__(self._pipeline)

    def run(
        self,
        corrections: List[Correction],
        include_outputs_from: List[str] | None = None,
    ):
        logger.info("SQL Regeneration Generation pipeline is running...")
        return self._pipeline.run(
            {
                "sql_regeneration_prompt_builder": {
                    "corrections": corrections,
                },
            },
            include_outputs_from=include_outputs_from,
        )


if __name__ == "__main__":
    llm_provider, _ = init_providers()
    generation_pipeline = Generation(
        llm_provider=llm_provider,
    )

    print("generating generation_pipeline.jpg to outputs/pipelines/sql_regeneration...")
    generation_pipeline.draw(
        "./outputs/pipelines/sql_regeneration/generation_pipeline.jpg"
    )
