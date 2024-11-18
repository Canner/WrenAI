import logging
import sys
from pathlib import Path
from typing import Any, Dict

import orjson
import requests
from hamilton import base
from hamilton.experimental.h_async import AsyncDriver
from haystack import component
from haystack.components.builders.prompt_builder import PromptBuilder
from jsonschema import validate
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline, async_validate
from src.core.provider import LLMProvider
from src.pipelines.common import show_current_time
from src.utils import async_timer, timer
from src.web.v1.services.chart import ChartConfigurations

logger = logging.getLogger("wren-ai-service")

chart_generation_system_prompt = """
### TASK ###

You are a data analyst great at visualizing data using vega-lite! Given the data using the 'columns' formatted JSON from pandas.DataFrame APIs, 
you need to generate vega-lite schema in JSON and provide suitable chart; we will also give you the question and sql to understand the data.
Besides, you need to give a concise and easy-to-understand reasoning to describe why you provide such vega-lite schema.

### INSTRUCTIONS ###

- Please generate vega-lite schema using v5 version, which is https://vega.github.io/schema/vega-lite/v5.json
- Chart types: bar, line, area, pie, scatter, donut, stacked bar
- If you think the data is not suitable for visualization, you can return an empty string for the schema.
- Please use the language provided by the user to generate the chart.
- Please use the current time provided by the user to generate the chart.

### EXAMPLE ###

INPUT:
{
    "col 1": {
        "row 1": "a",
        "row 2": "c"
    },
    "col 2": {
        "row 1": "b",
        "row 2": "d"
    }
}

OUTPUT:
{
    "chain_of_thought_reasoning": 'The provided data has two columns, each containing two rows. This is a small dataset where each "row" has categorical values. The most straightforward way to visualize this would be with a table-like format or a simple bar chart to represent the categories in "col 1" and "col 2" against their respective "rows". Since there are no numerical values, we cannot plot continuous variables. Therefore, a bar chart would help display the categorical comparison between the values of "col 1" and "col 2."'
    "schema": {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "description": "A bar chart representing values from 'col 1' and 'col 2' for each row.",
        "data": {
            "values": [
            {"Row": "row 1", "col 1": "a", "col 2": "b"},
            {"Row": "row 2", "col 1": "c", "col 2": "d"}
            ]
        },
        "transform": [
            {
            "fold": ["col 1", "col 2"],
            "as": ["Column", "Value"]
            }
        ],
        "mark": "bar",
        "encoding": {
            "x": {"field": "Row", "type": "nominal", "title": "Rows"},
            "y": {"field": "Value", "type": "nominal", "title": "Values"},
            "color": {"field": "Column", "type": "nominal", "title": "Columns"}
        }
    }
}

### OUTPUT FORMAT ###

Please provide your chain of thought reasoning and the vega-lite schema in JSON format.

{
    "chain_of_thought_reasoning": <REASON_TO_CHOOSE_THE_SCHEMA_IN_STRING>
    "schema": <VEGA_LITE_JSON_SCHEMA>
}
"""

chart_generation_user_prompt_template = """
### INPUT ###
Question: {{ query }}
SQL: {{ sql }}
Data: {{ data }}
Current Time: {{ current_time }}
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
            if chart_schema := generation_result.get("schema", ""):
                validate(chart_schema, schema=vega_schema)
                return {"results": {"schema": chart_schema}}

            return {"results": {"schema": ""}}
        except Exception as e:
            logger.exception(f"Vega-lite schema is not valid: {e}")

            return {
                "results": {
                    "schema": "",
                }
            }


## Start of Pipeline
@timer
@observe(capture_input=False)
def prompt(
    query: str,
    sql: str,
    data: dict,
    language: str,
    timezone: ChartConfigurations.Timezone,
    prompt_builder: PromptBuilder,
) -> dict:
    logger.debug(f"data: {data['results']}")

    return prompt_builder.run(
        query=query,
        sql=sql,
        data=data["results"],
        language=language,
        current_time=show_current_time(timezone),
    )


@async_timer
@observe(as_type="generation", capture_input=False)
async def generate_chart(prompt: dict, generator: Any) -> dict:
    logger.debug(f"prompt: {orjson.dumps(prompt, option=orjson.OPT_INDENT_2).decode()}")

    return await generator.run(prompt=prompt.get("prompt"))


@timer
@observe(capture_input=False)
def post_process(
    generate_chart: dict,
    vega_schema: Dict[str, Any],
    post_processor: ChartGenerationPostProcessor,
) -> dict:
    logger.debug(
        f"generate_chart: {orjson.dumps(generate_chart, option=orjson.OPT_INDENT_2).decode()}"
    )

    return post_processor.run(generate_chart.get("replies"), vega_schema)


## End of Pipeline
class ChartGenerationResults(BaseModel):
    chain_of_thought_reasoning: str
    schema: dict


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
        timezone: ChartConfigurations.Timezone,
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
                "timezone": timezone,
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
        timezone: ChartConfigurations.Timezone,
    ) -> dict:
        logger.info("Chart Generation pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "sql": sql,
                "data": data,
                "language": language,
                "timezone": timezone,
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
