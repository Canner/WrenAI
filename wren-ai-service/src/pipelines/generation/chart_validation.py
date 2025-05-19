import logging
import sys
from typing import Any, Dict, Optional

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.generation.utils.chart import (
    ChartDataPreprocessor,
    ChartGenerationPostProcessor,
    ChartGenerationResults,
)

logger = logging.getLogger("wren-ai-service")


chart_validation_system_prompt = """
"""


chart_validation_user_prompt_template = """
"""


## Start of Pipeline
@observe(capture_input=False)
def preprocess_data(
    data: Dict[str, Any],
    chart_data_preprocessor: ChartDataPreprocessor,
) -> dict:
    return chart_data_preprocessor.run(data)


@observe(capture_input=False)
def prompt(
    query: str,
    sql: str,
    preprocess_data: dict,
    language: str,
    prompt_builder: PromptBuilder,
) -> dict:
    sample_data = preprocess_data.get("sample_data")
    sample_column_values = preprocess_data.get("sample_column_values")

    return prompt_builder.run(
        query=query,
        sql=sql,
        sample_data=sample_data,
        sample_column_values=sample_column_values,
        language=language,
    )


@observe(as_type="generation", capture_input=False)
async def generate_chart(prompt: dict, generator: Any) -> dict:
    return await generator(prompt=prompt.get("prompt"))


@observe(capture_input=False)
def post_process(
    generate_chart: dict,
    remove_data_from_chart_schema: bool,
    preprocess_data: dict,
    data_provided: bool,
    post_processor: ChartGenerationPostProcessor,
) -> dict:
    return post_processor.run(
        generate_chart.get("replies"),
        preprocess_data["raw_data"]
        if data_provided
        else preprocess_data["sample_data"],
        remove_data_from_chart_schema=remove_data_from_chart_schema,
    )


## End of Pipeline
CHART_GENERATION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "chart_generation_schema",
            "schema": ChartGenerationResults.model_json_schema(),
        },
    }
}


class ChartValidation(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **kwargs,
    ):
        self._components = {
            "prompt_builder": PromptBuilder(
                template=chart_validation_user_prompt_template
            ),
            "generator": llm_provider.get_generator(
                system_prompt=chart_validation_system_prompt,
                generation_kwargs=CHART_GENERATION_MODEL_KWARGS,
            ),
            "chart_data_preprocessor": ChartDataPreprocessor(),
            "post_processor": ChartGenerationPostProcessor(),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Chart Generation")
    async def run(
        self,
        query: str,
        sql: str,
        data: dict,
        language: str,
        remove_data_from_chart_schema: Optional[bool] = True,
        data_provided: Optional[bool] = False,
    ) -> dict:
        logger.info("Chart Generation pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "sql": sql,
                "data": data,
                "language": language,
                "remove_data_from_chart_schema": remove_data_from_chart_schema,
                "data_provided": data_provided,
                **self._components,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        ChartValidation,
        "chart_validation",
        query="show me the dataset",
        sql="",
        data={},
        language="English",
    )
