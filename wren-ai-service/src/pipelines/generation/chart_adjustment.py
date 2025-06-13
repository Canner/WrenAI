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
    CHART_GENERATION_GENERAL_INSTRUCTIONS,
    CHART_GENERATION_MODEL_KWARGS,
    SAMPLE_VEGA_LITE_SCHEMA_EXAMPLES,
    ChartDataPreprocessor,
    ChartGenerationPostProcessor,
    ChartSchemaPreprocessor,
    load_chart_theme,
)
from src.utils import trace_cost

logger = logging.getLogger("wren-ai-service")


chart_adjustment_system_prompt = f"""
### TASK ###

You are a data analyst great at generating data visualization using vega-lite! Given the user's question, SQL, sample data, sample column values, original vega-lite schema and adjustment command, 
you need to generate the vega-lite schema in JSON format that follows the adjustment command and respects the original vega-lite schema.
Besides, you need to give a concise and easy-to-understand reasoning to describe why you provide such vega-lite schema based on the question, SQL, sample data, sample column values, original vega-lite schema and adjustment command.

### INSTRUCTIONS ###

{CHART_GENERATION_GENERAL_INSTRUCTIONS}
- You need to generate the vega-lite schema that follows the adjustment command and respects the original vega-lite schema; don't change any aspect of the original vega-lite schema if that aspect is not included in the adjustment command.
- If you think the adjustment command is not suitable for the data, you can return an empty string for the schema and give reasoning to explain why.
- If the user provides an image, you need to use the image as reference to generate a chart schema that follows user's adjustment command.
- The language of the reasoning should be the same as the language provided by the user.

### VEGA-LITE SCHEMA EXAMPLES ###

{SAMPLE_VEGA_LITE_SCHEMA_EXAMPLES}

### OUTPUT FORMAT ###

Please provide your chain of thought reasoning, and the vega-lite schema in JSON format.

{{
    "reasoning": <REASON_TO_CHOOSE_THE_SCHEMA_IN_STRING_FORMATTED_IN_LANGUAGE_PROVIDED_BY_USER>,
    "chart_schema": <VEGA_LITE_JSON_SCHEMA>
}}
"""


chart_adjustment_user_prompt_template = """
### INPUT ###
Original Question: {{ query }}
Original SQL: {{ sql }}
Original Vega-Lite Schema: {{ chart_schema }}
Sample Data: {{ sample_data }}
Sample Column Values: {{ sample_column_values }}
Language: {{ language }}

Adjustment Command: {{ adjustment_command }}

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
def preprocess_chart_schema(
    chart_schema: dict,
    chart_schema_preprocessor: ChartSchemaPreprocessor,
) -> dict:
    return chart_schema_preprocessor.run(chart_schema)


@observe(capture_input=False)
def prompt(
    query: str,
    sql: str,
    adjustment_command: str,
    preprocess_chart_schema: dict,
    preprocess_data: dict,
    language: str,
    prompt_builder: PromptBuilder,
) -> dict:
    sample_data = preprocess_data.get("sample_data")
    sample_column_values = preprocess_data.get("sample_column_values")

    return prompt_builder.run(
        query=query,
        sql=sql,
        adjustment_command=adjustment_command,
        chart_schema=preprocess_chart_schema,
        sample_data=sample_data,
        sample_column_values=sample_column_values,
        language=language,
    )


@observe(as_type="generation", capture_input=False)
@trace_cost
async def generate_chart_adjustment(
    prompt: dict,
    image_url: str,
    generator: Any,
) -> dict:
    return await generator(prompt=prompt.get("prompt"), image_url=image_url)


@observe(capture_input=False)
def post_process(
    generate_chart_adjustment: dict,
    preprocess_data: dict,
    data_provided: bool,
    chart_theme: dict[str, Any],
    post_processor: ChartGenerationPostProcessor,
) -> dict:
    return post_processor.run(
        generate_chart_adjustment.get("replies"),
        (
            preprocess_data["raw_data"]
            if data_provided
            else preprocess_data["sample_data"]
        ),
        chart_theme=chart_theme,
    )


## End of Pipeline


class ChartAdjustment(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **kwargs,
    ):
        self._components = {
            "prompt_builder": PromptBuilder(
                template=chart_adjustment_user_prompt_template
            ),
            "generator": llm_provider.get_generator(
                system_prompt=chart_adjustment_system_prompt,
                generation_kwargs=CHART_GENERATION_MODEL_KWARGS,
            ),
            "chart_data_preprocessor": ChartDataPreprocessor(),
            "chart_schema_preprocessor": ChartSchemaPreprocessor(),
            "post_processor": ChartGenerationPostProcessor(),
        }

        self._configs = {
            "chart_theme": load_chart_theme(),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Chart Adjustment")
    async def run(
        self,
        query: str,
        sql: str,
        adjustment_command: str,
        chart_schema: dict,
        data: dict,
        language: str,
        data_provided: bool = False,
        image_url: str = "",
    ) -> dict:
        logger.info("Chart Adjustment pipeline is running...")

        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "sql": sql,
                "adjustment_command": adjustment_command,
                "chart_schema": chart_schema,
                "data": data,
                "language": language,
                "data_provided": data_provided,
                "image_url": image_url,
                **self._components,
                **self._configs,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        ChartAdjustment,
        "chart_adjustment",
        query="show me the dataset",
        sql="",
        adjustment_command="",
        chart_schema={},
        # data={},
        language="English",
    )
