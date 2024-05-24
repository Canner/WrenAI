import logging

from haystack import Pipeline

from src.core.llm_provider import LLMProvider
from src.core.pipeline import BasicPipeline
from src.pipelines.sql_explanation.components.post_processors import (
    init_generation_post_processor,
)
from src.pipelines.sql_explanation.components.prompts import (
    init_sql_explanation_prompt_builder,
    sql_explanation_system_prompt,
)
from src.utils import init_providers, load_env_vars

load_env_vars()
logger = logging.getLogger("wren-ai-service")


class Generation(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
    ):
        self._pipeline = Pipeline()
        self._pipeline.add_component(
            "sql_explanation_prompt_builder",
            init_sql_explanation_prompt_builder(),
        )
        self._pipeline.add_component(
            "sql_explanation_generator",
            llm_provider.get_generator(system_prompt=sql_explanation_system_prompt),
        )
        self._pipeline.add_component("post_processor", init_generation_post_processor())

        self._pipeline.connect(
            "sql_explanation_prompt_builder.prompt", "sql_explanation_generator.prompt"
        )
        self._pipeline.connect(
            "sql_explanation_generator.replies", "post_processor.replies"
        )

        super().__init__(self._pipeline)

    def run(
        self,
        question: str,
        sql: str,
        sql_analysis: dict,
        sql_summary: str,
        full_sql: str,
    ):
        logger.info("SQL Explanation Generation pipeline is running...")
        return self._pipeline.run(
            {
                "sql_explanation_prompt_builder": {
                    "question": question,
                    "sql": sql,
                    "sql_analysis": sql_analysis,
                    "sql_summary": sql_summary,
                    "full_sql": full_sql,
                },
            }
        )


if __name__ == "__main__":
    llm_provider, _ = init_providers()
    generation_pipeline = Generation(
        llm_provider=llm_provider,
    )

    print("generating generation_pipeline.jpg to outputs/pipelines/sql_explanation...")
    generation_pipeline.draw(
        "./outputs/pipelines/sql_explanation/generation_pipeline.jpg"
    )
