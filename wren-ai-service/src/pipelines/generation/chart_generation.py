import logging
import sys
from typing import Any, Dict, Optional

import orjson
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
    chart_generation_instructions,
)

logger = logging.getLogger("wren-ai-service")

chart_generation_system_prompt = f"""
### TASK ###

You are a data analyst great at visualizing data using vega-lite! Given the user's question, SQL, sample data and sample column values, you need to generate vega-lite schema in JSON and provide suitable chart type.
Besides, you need to give a concise and easy-to-understand reasoning to describe why you provide such vega-lite schema based on the question, SQL, sample data and sample column values.

{chart_generation_instructions}

### OUTPUT FORMAT ###

Please provide your chain of thought reasoning, chart type and the vega-lite schema in JSON format.

{{
    "reasoning": <REASON_TO_CHOOSE_THE_SCHEMA_IN_STRING_FORMATTED_IN_LANGUAGE_PROVIDED_BY_USER>,
    "chart_type": "line" | "multi_line" | "bar" | "pie" | "grouped_bar" | "stacked_bar" | "area" | "",
    "chart_schema": <VEGA_LITE_JSON_SCHEMA>
}}
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
    vega_schema: Dict[str, Any],
    remove_data_from_chart_schema: bool,
    preprocess_data: dict,
    post_processor: ChartGenerationPostProcessor,
) -> dict:
    return post_processor.run(
        generate_chart.get("replies"),
        vega_schema,
        preprocess_data["sample_data"],
        remove_data_from_chart_schema,
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
        remove_data_from_chart_schema: Optional[bool] = True,
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
