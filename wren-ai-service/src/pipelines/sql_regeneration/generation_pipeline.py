import logging
from typing import List

from haystack import Pipeline

from src.core.llm_provider import LLMProvider
from src.core.pipeline import BasicPipeline
from src.pipelines.sql_regeneration.components.post_processors import (
    init_generation_post_processor,
)
from src.pipelines.sql_regeneration.components.prompts import (
    init_sql_regeneration_prompt_builder,
    sql_regeneration_system_prompt,
)
from src.utils import init_providers, load_env_vars
from src.web.v1.services.sql_regeneration import Correction

load_env_vars()
logger = logging.getLogger("wren-ai-service")


class Generation(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
    ):
        self._pipeline = Pipeline()
        self._pipeline.add_component(
            "sql_regeneration_prompt_builder",
            init_sql_regeneration_prompt_builder(),
        )
        self._pipeline.add_component(
            "sql_regeneration_generator",
            llm_provider.get_generator(system_prompt=sql_regeneration_system_prompt),
        )
        self._pipeline.add_component("post_processor", init_generation_post_processor())

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
    ):
        logger.info("SQL Regeneration Generation pipeline is running...")
        return self._pipeline.run(
            {
                "sql_regeneration_prompt_builder": {},
            }
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
