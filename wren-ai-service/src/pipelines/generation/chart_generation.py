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

logger = logging.getLogger("wren-ai-service")

chart_generation_system_prompt = f"""
### TASK ###

You are a data analyst great at visualizing data using vega-lite! Given the data using the 'columns' formatted JSON from pandas.DataFrame APIs, 
you need to generate vega-lite schema in JSON and provide suitable chart; we will also give you the question and sql to understand the data.
Besides, you need to give a concise and easy-to-understand reasoning to describe why you provide such vega-lite schema and a within 20 words description of the chart.

{chart_generation_instructions}

### OUTPUT FORMAT ###

Please provide your chain of thought reasoning and the vega-lite schema in JSON format.

{{
    "reasoning": <REASON_TO_CHOOSE_THE_SCHEMA_IN_STRING_FORMATTED_IN_LANGUAGE_PROVIDED_BY_USER>,
    "chart_schema": <VEGA_LITE_JSON_SCHEMA>
}}
"""

chart_generation_user_prompt_template = """
### INPUT ###
Question: {{ query }}
SQL: {{ sql }}
Sample Data: {{ sample_data }}
Language: {{ language }}

Please think step by step
"""


@component
class ChartGenerationPostProcessor:
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
                # sometimes the chart_schema is still in string format
                if isinstance(chart_schema, str):
                    chart_schema = orjson.loads(chart_schema)

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
@observe(capture_input=False)
def preprocess_data(
    data: Dict[str, Any], chart_data_preprocessor: ChartDataPreprocessor
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
    sample_data = preprocess_data["results"]["sample_data"]

    return prompt_builder.run(
        query=query,
        sql=sql,
        sample_data=sample_data,
        language=language,
    )


@observe(as_type="generation", capture_input=False)
async def generate_chart(prompt: dict, generator: Any) -> dict:
    return await generator(prompt=prompt.get("prompt"))


@observe(capture_input=False)
def post_process(
    generate_chart: dict,
    vega_schema: Dict[str, Any],
    post_processor: ChartGenerationPostProcessor,
) -> dict:
    return post_processor.run(generate_chart.get("replies"), vega_schema)


## End of Pipeline
class ChartGenerationResults(BaseModel):
    reasoning: str
    chart_schema: (
        LineChartSchema
        | BarChartSchema
        | PieChartSchema
        | GroupedBarChartSchema
        | StackedBarChartSchema
        | AreaChartSchema
    )


CHART_GENERATION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "chart_generation_schema",
            "schema": ChartGenerationResults.model_json_schema(),
        },
    }
}


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

        with open("src/pipelines/generation/utils/vega-lite-schema-v5.json", "r") as f:
            _vega_schema = orjson.loads(f.read())

        self._configs = {
            "vega_schema": _vega_schema,
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
    ) -> dict:
        logger.info("Chart Generation pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "sql": sql,
                "data": data,
                "language": language,
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
