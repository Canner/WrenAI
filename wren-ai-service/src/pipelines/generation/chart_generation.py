import logging
import sys
from pathlib import Path
from typing import Any, Dict

import orjson
import requests
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack import component
from haystack.components.builders.prompt_builder import PromptBuilder
from jsonschema import validate
from jsonschema.exceptions import ValidationError
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline, async_validate
from src.core.provider import LLMProvider
from src.pipelines.common import chart_generation_instructions
from src.utils import async_timer, timer

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
Sample Data Statistics: {{ sample_data_statistics }}
Language: {{ language }}

Please think step by step
"""


@component
class ChartDataPreprocessor:
    @component.output_types(
        results=Dict[str, Any],
    )
    def run(self, data: Dict[str, Any]):
        sample_data_statistics = {
            column["name"] if isinstance(column, dict) else column: set()
            for column in data["results"]["columns"]
        }
        for row in data["results"]["data"]:
            for column, value in zip(sample_data_statistics.keys(), row):
                if len(sample_data_statistics[column]) < 10:
                    sample_data_statistics[column].add(value)

        sample_data = {
            "columns": data["results"]["columns"],
            "data": data["results"]["data"][:10],
        }

        return {
            "results": {
                "sample_data_statistics": sample_data_statistics,
                "sample_data": sample_data,
            }
        }


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
    preprocess_data: dict,
    language: str,
    prompt_builder: PromptBuilder,
) -> dict:
    sample_data = preprocess_data["results"]["sample_data"]
    sample_data_statistics = preprocess_data["results"]["sample_data_statistics"]

    return prompt_builder.run(
        query=query,
        sql=sql,
        sample_data=sample_data,
        sample_data_statistics=sample_data_statistics,
        language=language,
    )


@async_timer
@observe(as_type="generation", capture_input=False)
async def generate_chart(prompt: dict, generator: Any) -> dict:
    return await generator.run(prompt=prompt.get("prompt"))


@timer
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
    chart_schema: dict


CHART_GENERATION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "matched_schema",
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
        self._configs = {
            "vega_schema": requests.get(
                "https://vega.github.io/schema/vega-lite/v5.json"
            ).json(),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def visualize(
        self,
        query: str,
        sql: str,
        data: dict,
        language: str,
    ) -> None:
        destination = "outputs/pipelines/generation"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            ["post_process"],
            output_file_path=f"{destination}/chart_generation.dot",
            inputs={
                "query": query,
                "sql": sql,
                "data": data,
                "language": language,
                **self._components,
                **self._configs,
            },
            show_legend=True,
            orient="LR",
        )

    @async_timer
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
    from langfuse.decorators import langfuse_context

    from src.core.engine import EngineConfig
    from src.core.pipeline import async_validate
    from src.providers import init_providers
    from src.utils import init_langfuse, load_env_vars

    load_env_vars()
    init_langfuse()

    llm_provider, _, _, engine = init_providers(EngineConfig())
    pipeline = ChartGeneration(
        llm_provider=llm_provider,
    )

    pipeline.visualize(query="", sql="", data={})
    async_validate(lambda: pipeline.run(query="", sql="", data={}))

    langfuse_context.flush()
