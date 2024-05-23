import logging
from typing import List

import orjson
from haystack import Pipeline, component
from haystack.components.builders.prompt_builder import PromptBuilder

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.utils import init_providers, timer

logger = logging.getLogger("wren-ai-service")


query_preprocess_user_prompt_template = """
### TASK ###
Based on the user's input below, classify whether the query is not random words.
Provide your classification as 'Yes' or 'No'. Yes if you think the query is not random words, and No if you think the query is random words.

### FINAL ANSWER FORMAT ###
The final answer must be the JSON format like following:

{
    "result": "yes" or "no"
}

### INPUT ###
{{ query }}

Let's think step by step.
"""


@component
class QueryUnderstandingPostProcessor:
    @component.output_types(
        is_valid_query=bool,
    )
    def run(self, replies: List[str]):
        try:
            result = orjson.loads(replies[0])["result"]

            if result == "yes":
                return {
                    "is_valid_query": True,
                }

            return {
                "is_valid_query": False,
            }
        except Exception as e:
            logger.error(f"Error in QueryUnderstandingPostProcessor: {e}")

            return {
                "is_valid_query": True,
            }


class QueryUnderstanding(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
    ):
        self._pipeline = Pipeline()
        self._pipeline.add_component(
            "query_preprocess_prompt_builder",
            PromptBuilder(template=query_preprocess_user_prompt_template),
        )
        self._pipeline.add_component(
            "query_preprocessor",
            llm_provider.get_generator(),
        )
        self._pipeline.add_component(
            "post_processor",
            QueryUnderstandingPostProcessor(),
        )
        self._pipeline.connect(
            "query_preprocess_prompt_builder.prompt", "query_preprocessor.prompt"
        )
        self._pipeline.connect("query_preprocessor.replies", "post_processor.replies")

        super().__init__(self._pipeline)

    @timer
    def run(
        self,
        query: str,
        include_outputs_from: List[str] | None = None,
    ):
        logger.info("Ask QueryUnderstanding pipeline is running...")
        return self._pipeline.run(
            {
                "query_preprocess_prompt_builder": {
                    "query": query,
                },
            },
            include_outputs_from=(
                set(include_outputs_from) if include_outputs_from else None
            ),
        )


if __name__ == "__main__":
    llm_provider, _ = init_providers()
    query_understanding_pipeline = QueryUnderstanding(
        llm_provider=llm_provider,
    )

    print("generating query_understanding_pipeline.jpg to outputs/pipelines/ask...")
    query_understanding_pipeline.draw(
        "./outputs/pipelines/ask/query_understanding_pipeline.jpg"
    )
