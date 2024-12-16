import logging
import sys
from pathlib import Path
from typing import Any, Dict

import orjson
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack import component
from haystack.components.builders.prompt_builder import PromptBuilder
from jsonschema import validate
from jsonschema.exceptions import ValidationError
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.generation.utils.chart import (
    AreaChartSchema,
    BarChartSchema,
    ChartDataPreprocessor,
    GroupedBarChartSchema,
    LineChartSchema,
    PieChartSchema,
    StackedBarChartSchema,
    chart_generation_instructions,
)
from src.utils import async_timer, timer
from src.web.v1.services.chart_adjustment import ChartAdjustmentOption

logger = logging.getLogger("wren-ai-service")

chart_adjustment_system_prompt = f"""
### TASK ###

You are a data analyst great at visualizing data using vega-lite! Given the data using the 'columns' formatted JSON from pandas.DataFrame APIs,
original question, SQL query, vega-lite schema and the adjustment options, you need to regenerate vega-lite schema in JSON and provide suitable chart according to the adjustment options;
Besides, you need to give a concise and easy-to-understand reasoning to describe why you provide such vega-lite schema.

{chart_generation_instructions}
- If you think the adjustment options are not suitable for the data, you can return an empty string for the schema and give reasoning to explain why.

### OUTPUT FORMAT ###

Please provide your chain of thought reasoning and the vega-lite schema in JSON format.

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
Language: {{ language }}

Adjustment Options:
- Chart Type: {{ adjustment_option.chart_type }}
{% if adjustment_option.x_axis %}
- X Axis: {{ adjustment_option.x_axis }}
{% endif %}
{% if adjustment_option.y_axis %}
- Y Axis: {{ adjustment_option.y_axis }}
{% endif %}
{% if adjustment_option.x_offset %}
- X Offset: {{ adjustment_option.x_offset }}
{% endif %}
{% if adjustment_option.color %}
- Color: {{ adjustment_option.color }}
{% endif %}
{% if adjustment_option.theta %}
- Theta: {{ adjustment_option.theta }}
{% endif %}

Please think step by step
"""


@component
class ChartAdjustmentPostProcessor:
    @component.output_types(
        results=Dict[str, Any],
    )
    def run(
        self,
        replies: str,
        vega_schema: Dict[str, Any],
    ):
        try:
            generation_result = orjson.loads(replies[0])
            reasoning = generation_result.get("reasoning", "")
            if chart_schema := generation_result.get("chart_schema", {}):
                validate(chart_schema, schema=vega_schema)
                chart_schema["data"]["values"] = []
                return {
                    "results": {
                        "chart_schema": chart_schema,
                        "reasoning": reasoning,
                    }
                }

            return {
                "results": {
                    "chart_schema": {},
                    "reasoning": reasoning,
                }
            }
        except ValidationError as e:
            logger.exception(f"Vega-lite schema is not valid: {e}")

            return {
                "results": {
                    "chart_schema": {},
                    "reasoning": "",
                }
            }
        except Exception as e:
            logger.exception(f"JSON deserialization failed: {e}")

            return {
                "results": {
                    "chart_schema": {},
                    "reasoning": "",
                }
            }


## Start of Pipeline
@timer
@observe(capture_input=False)
def preprocess_data(
    data: Dict[str, Any], chart_data_preprocessor: ChartDataPreprocessor
) -> dict:
    return chart_data_preprocessor.run(data)


@timer
@observe(capture_input=False)
def prompt(
    query: str,
    sql: str,
    adjustment_option: ChartAdjustmentOption,
    chart_schema: dict,
    preprocess_data: dict,
    language: str,
    prompt_builder: PromptBuilder,
) -> dict:
    sample_data = preprocess_data["results"]["sample_data"]

    return prompt_builder.run(
        query=query,
        sql=sql,
        adjustment_option=adjustment_option,
        chart_schema=chart_schema,
        sample_data=sample_data,
        language=language,
    )


@async_timer
@observe(as_type="generation", capture_input=False)
async def generate_chart_adjustment(prompt: dict, generator: Any) -> dict:
    return await generator.run(prompt=prompt.get("prompt"))


@timer
@observe(capture_input=False)
def post_process(
    generate_chart_adjustment: dict,
    vega_schema: Dict[str, Any],
    post_processor: ChartAdjustmentPostProcessor,
) -> dict:
    return post_processor.run(generate_chart_adjustment.get("replies"), vega_schema)


## End of Pipeline
class ChartAdjustmentResults(BaseModel):
    reasoning: str
    chart_schema: (
        LineChartSchema
        | BarChartSchema
        | PieChartSchema
        | GroupedBarChartSchema
        | StackedBarChartSchema
        | AreaChartSchema
    )


CHART_ADJUSTMENT_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "chart_adjustment_results",
            "schema": ChartAdjustmentResults.model_json_schema(),
        },
    }
}


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
                generation_kwargs=CHART_ADJUSTMENT_MODEL_KWARGS,
            ),
            "chart_data_preprocessor": ChartDataPreprocessor(),
            "post_processor": ChartAdjustmentPostProcessor(),
        }

        with open("src/pipelines/generation/utils/vega-lite-schema-v5.json", "r") as f:
            _vega_schema = orjson.loads(f.read())

        self._configs = {
            "vega_schema": _vega_schema,
        }
        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def visualize(
        self,
        query: str,
        sql: str,
        adjustment_option: ChartAdjustmentOption,
        chart_schema: dict,
        data: dict,
        language: str,
    ) -> None:
        destination = "outputs/pipelines/generation"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            ["post_process"],
            output_file_path=f"{destination}/chart_adjustment.dot",
            inputs={
                "query": query,
                "sql": sql,
                "adjustment_option": adjustment_option,
                "chart_schema": chart_schema,
                "data": data,
                "language": language,
                **self._components,
                **self._configs,
            },
            show_legend=True,
            orient="LR",
        )

    @async_timer
    @observe(name="Chart Adjustment")
    async def run(
        self,
        query: str,
        sql: str,
        adjustment_option: ChartAdjustmentOption,
        chart_schema: dict,
        data: dict,
        language: str,
    ) -> dict:
        logger.info("Chart Adjustment pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "sql": sql,
                "adjustment_option": adjustment_option,
                "chart_schema": chart_schema,
                "data": data,
                "language": language,
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
        adjustment_option=ChartAdjustmentOption(),
        chart_schema={},
        data={},
        language="English",
    )
