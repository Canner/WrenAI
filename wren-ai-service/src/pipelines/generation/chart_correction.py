import logging
import sys
from typing import Any

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.generation.utils.chart import (
    CHART_GENERATION_GENERAL_INSTRUCTIONS,
    CHART_GENERATION_MODEL_KWARGS,
    ChartGenerationPostProcessor,
    ChartSchemaPreprocessor,
    load_custom_theme,
)

logger = logging.getLogger("wren-ai-service")


chart_correction_system_prompt = f"""
### TASK ###
You are a vega-lite chart expert. You are given a chart schema, a query, and a SQL. You need to correct the chart schema to make it more accurate.

### INSTRUCTIONS ###

{CHART_GENERATION_GENERAL_INSTRUCTIONS}
- The content of the chart schema should be compatible to the SQL query that fulfills the user's query.

### OUTPUT FORMAT ###

Please provide the vega-lite schema in JSON format.

{{
    "chart_schema": <VEGA_LITE_JSON_SCHEMA>
}}
"""


chart_correction_user_prompt_template = """
### INPUT ###
Question: {{ query }}
SQL: {{ sql }}
Chart Schema: {{ chart_schema }}
Language: {{ language }}

Please think step by step
"""


## Start of Pipeline
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
    preprocess_chart_schema: dict,
    language: str,
    prompt_builder: PromptBuilder,
) -> dict:
    return prompt_builder.run(
        query=query,
        sql=sql,
        chart_schema=preprocess_chart_schema,
        language=language,
    )


@observe(as_type="generation", capture_input=False)
async def correct_chart(prompt: dict, generator: Any) -> dict:
    return await generator(prompt=prompt.get("prompt"))


@observe(capture_input=False)
def post_process(
    correct_chart: dict,
    custom_theme: dict[str, Any],
    sample_data: list[dict],
    post_processor: ChartGenerationPostProcessor,
) -> dict:
    return post_processor.run(
        correct_chart.get("replies"),
        sample_data,
        custom_theme=custom_theme,
    )


## End of Pipeline


class ChartCorrection(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **kwargs,
    ):
        self._components = {
            "prompt_builder": PromptBuilder(
                template=chart_correction_user_prompt_template
            ),
            "generator": llm_provider.get_generator(
                system_prompt=chart_correction_system_prompt,
                generation_kwargs=CHART_GENERATION_MODEL_KWARGS,
            ),
            "chart_schema_preprocessor": ChartSchemaPreprocessor(),
            "post_processor": ChartGenerationPostProcessor(),
        }

        self._configs = {
            "custom_theme": load_custom_theme(),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Chart Correction")
    async def run(
        self,
        query: str,
        sql: str,
        chart_schema: dict,
        language: str,
    ) -> dict:
        logger.info("Chart Correction pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "sql": sql,
                "chart_schema": chart_schema,
                "sample_data": chart_schema.get("data", {}).get("values", []),
                "language": language,
                **self._components,
                **self._configs,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        ChartCorrection,
        "chart_correction",
        query="",
        sql="",
        chart_schema={},
    )
