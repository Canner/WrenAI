import json
import logging
from typing import Any, Dict, List, Optional

from haystack import Pipeline, component
from haystack.components.builders.prompt_builder import PromptBuilder

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.sql_explanation.components.prompts import (
    sql_explanation_system_prompt,
)
from src.utils import init_providers, load_env_vars

load_env_vars()
logger = logging.getLogger("wren-ai-service")


sql_explanation_user_prompt_template = """
question: {{ question }}
sql query: {{ sql }}
sql query summary: {{ sql_summary }}
sql query analysis: {{ sql_analysis }}
full sql query: {{ full_sql }}

Let's think step by step.
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
            "sql_explanation_prompt_builder",
            PromptBuilder(template=sql_explanation_user_prompt_template),
        )
        self._pipeline.add_component(
            "sql_explanation_generator",
            llm_provider.get_generator(system_prompt=sql_explanation_system_prompt),
        )
        self._pipeline.add_component("post_processor", GenerationPostProcessor())

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
        include_outputs_from: List[str] | None = None,
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
            },
            include_outputs_from=(
                set(include_outputs_from) if include_outputs_from else None
            ),
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
