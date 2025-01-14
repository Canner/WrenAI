import logging
import sys
from typing import Any, Dict

import orjson
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack import component
from haystack.components.builders.prompt_builder import PromptBuilder
from jsonschema import validate
from jsonschema.exceptions import ValidationError
from langfuse.decorators import observe

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.generation.utils.chart import (
    ChartDataPreprocessor,
    ChartGenerationResults,
    chart_generation_instructions,
)
from src.web.v1.services.chart_adjustment import ChartAdjustmentOption

logger = logging.getLogger("wren-ai-service")

chart_adjustment_system_prompt = f"""
### TASK ###

You are a data analyst great at visualizing data using vega-lite! Given the user's question, SQL, data, vega-lite schema and adjustment options, 
you need to re-generate vega-lite schema in JSON and provide suitable chart type.
Besides, you need to give a concise and easy-to-understand reasoning within 20 words to describe why you provide such vega-lite schema.

{chart_generation_instructions}
- If you think the adjustment options are not suitable for the data, you can return an empty string for the schema and chart type and give reasoning to explain why.

### OUTPUT FORMAT ###

Please provide your chain of thought reasoning, chart type and the vega-lite schema in JSON format.

{{
    "reasoning": <REASON_TO_CHOOSE_THE_SCHEMA_IN_STRING_FORMATTED_IN_LANGUAGE_PROVIDED_BY_USER>,
    "chart_type": "line" | "multi_line" | "bar" | "pie" | "grouped_bar" | "stacked_bar" | "area" | "",
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
{% if adjustment_option.chart_type != "pie" %}
{% if adjustment_option.x_axis %}
- X Axis: {{ adjustment_option.x_axis }}
{% endif %}
{% if adjustment_option.y_axis %}
- Y Axis: {{ adjustment_option.y_axis }}
{% endif %}
{% endif %}
{% if adjustment_option.x_offset and adjustment_option.chart_type == "grouped_bar" %}
- X Offset: {{ adjustment_option.x_offset }}
{% endif %}
{% if adjustment_option.color and adjustment_option.chart_type != "area" %}
- Color: {{ adjustment_option.color }}
{% endif %}
{% if adjustment_option.theta and adjustment_option.chart_type == "pie" %}
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
            chart_type = generation_result.get("chart_type", "")
            if chart_schema := generation_result.get("chart_schema", {}):
                # sometimes the chart_schema is still in string format
                if isinstance(chart_schema, str):
                    chart_schema = orjson.loads(chart_schema)

                validate(chart_schema, schema=vega_schema)
                chart_schema["data"]["values"] = []
                return {
                    "results": {
                        "chart_schema": chart_schema,
                        "reasoning": reasoning,
                        "chart_type": chart_type,
                    }
                }

            return {
                "results": {
                    "chart_schema": {},
                    "reasoning": reasoning,
                    "chart_type": chart_type,
                }
            }
        except ValidationError as e:
            logger.exception(f"Vega-lite schema is not valid: {e}")

            return {
                "results": {
                    "chart_schema": {},
                    "reasoning": "",
                    "chart_type": "",
                }
            }
        except Exception as e:
            logger.exception(f"JSON deserialization failed: {e}")

            return {
                "results": {
                    "chart_schema": {},
                    "reasoning": "",
                    "chart_type": "",
                }
            }


## Start of Pipeline
@observe(capture_input=False)
def preprocess_data(
    data: Dict[str, Any], chart_data_preprocessor: ChartDataPreprocessor
) -> dict:
    return chart_data_preprocessor.run(data)


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


@observe(as_type="generation", capture_input=False)
async def generate_chart_adjustment(prompt: dict, generator: Any) -> dict:
    return await generator(prompt=prompt.get("prompt"))


@observe(capture_input=False)
def post_process(
    generate_chart_adjustment: dict,
    vega_schema: Dict[str, Any],
    post_processor: ChartAdjustmentPostProcessor,
) -> dict:
    return post_processor.run(generate_chart_adjustment.get("replies"), vega_schema)


## End of Pipeline
CHART_ADJUSTMENT_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "chart_adjustment_results",
            "schema": ChartGenerationResults.model_json_schema(),
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
