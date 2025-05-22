import logging
import sys
from typing import Any, Dict

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.generation.utils.chart import (
    CHART_GENERATION_MODEL_KWARGS,
    ChartDataPreprocessor,
    ChartGenerationPostProcessor,
    load_custom_theme,
)

logger = logging.getLogger("wren-ai-service")


chart_generation_system_prompt = """
### TASK ###

You are a data analyst great at generating data visualization using vega-lite! Given the user's question, SQL, sample data and sample column values, you need to think about the best chart type and generate correspondingvega-lite schema in JSON format.
Besides, you need to give a concise and easy-to-understand reasoning to describe why you provide such vega-lite schema based on the question, SQL, sample data and sample column values.

### INSTRUCTIONS ###

- Please generate the vega-lite schema using the v5 specification.
- Please omit the "data" field while generating the vega-lite schema.
- Please omit the "$schema" field while generating the vega-lite schema.
- Please omit the "description" field while generating the vega-lite schema.
- Please remember to add the "title" field to the vega-lite schema.
- Please remember to add the legend to the vega-lite schema.
- The language of the reasoning should be the same as the language provided by the user.

### OUTPUT FORMAT ###

Please provide your chain of thought reasoning, and the vega-lite schema in JSON format.

{
    "reasoning": <REASON_TO_CHOOSE_THE_SCHEMA_IN_STRING_FORMATTED_IN_LANGUAGE_PROVIDED_BY_USER>,
    "chart_schema": <VEGA_LITE_JSON_SCHEMA>
}
"""


chart_generation_user_prompt_template = """
### INPUT ###
Question: {{ query }}
SQL: {{ sql }}
Sample Data: {{ sample_data }}
Sample Column Values: {{ sample_column_values }}
Language: {{ language }}

Please think step by step
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
    preprocess_data: dict,
    data_provided: bool,
    custom_theme: dict[str, Any],
    post_processor: ChartGenerationPostProcessor,
) -> dict:
    return post_processor.run(
        generate_chart.get("replies"),
        (
            preprocess_data["raw_data"]
            if data_provided
            else preprocess_data["sample_data"]
        ),
        custom_theme=custom_theme,
    )


## End of Pipeline


class ChartGeneration(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **kwargs,
    ):
        self._components = {
            "prompt_builder": PromptBuilder(
                template=chart_generation_user_prompt_template
            ),
            "generator": llm_provider.get_generator(
                system_prompt=chart_generation_system_prompt,
                generation_kwargs=CHART_GENERATION_MODEL_KWARGS,
            ),
            "chart_data_preprocessor": ChartDataPreprocessor(),
            "post_processor": ChartGenerationPostProcessor(),
        }

        self._configs = {
            "custom_theme": load_custom_theme(),
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
        data_provided: bool = False,
    ) -> dict:
        logger.info("Chart Generation pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "sql": sql,
                "data": data,
                "language": language,
                "data_provided": data_provided,
                **self._components,
                **self._configs,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        ChartGeneration,
        "chart_generation",
        query="show me the dataset",
        sql="",
        data={},
        language="English",
    )
