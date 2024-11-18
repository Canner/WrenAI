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
- Chart types: Bar chart, Line chart, Area chart, Pie chart, Scatter plot chart, Donut chart, Grouped bar chart
- You can only use the chart types provided in the instructions
- If you think the data is not suitable for visualization, you can return an empty string for the schema
- Please use the language provided by the user to generate the chart
- Please use the current time provided by the user to generate the chart
- In order to generate the grouped bar chart, you need to follow the given instructions:
    - Disable Stacking: Add "stack": null to the y-encoding.
    - Use xOffset: Introduce xOffset for subcategories to group bars.

### GUIDELINES TO PLOT CHART ###

1. Understanding Your Data Types
- Nominal (Categorical): Names or labels without a specific order (e.g., types of fruits, countries).
- Ordinal: Categorical data with a meaningful order but no fixed intervals (e.g., rankings, satisfaction levels).
- Quantitative: Numerical values representing counts or measurements (e.g., sales figures, temperatures).
- Temporal: Date or time data (e.g., timestamps, dates).
2. Chart Types and When to Use Them
- Bar Chart
    - Use When: Comparing quantities across different categories.
    - Data Requirements:
        - One categorical variable (x-axis).
        - One quantitative variable (y-axis).
    - Example: Comparing sales numbers for different product categories.
- Grouped Bar Chart
    - Use When: Comparing sub-categories within main categories.
    - Data Requirements:
        - Two categorical variables (x-axis grouped by one, color-coded by another).
        - One quantitative variable (y-axis).
        - Example: Sales numbers for different products across various regions.
- Line Chart
    - Use When: Displaying trends over continuous data, especially time.
    - Data Requirements:
        - One temporal or ordinal variable (x-axis).
        - One quantitative variable (y-axis).
    - Example: Tracking monthly revenue over a year.
- Area Chart
    - Use When: Similar to line charts but emphasizing the volume of change over time.
    - Data Requirements:
        - Same as Line Chart.
    - Example: Visualizing cumulative rainfall over months.
- Pie Chart / Donut Chart
    - Use When: Showing parts of a whole as percentages.
    - Data Requirements:
        - One categorical variable.
        - One quantitative variable representing proportions.
    - Example: Market share distribution among companies.
- Scatter Plot Chart
    - Use When: Exploring relationships or correlations between two quantitative variables.
    - Data Requirements:
        - Two quantitative variables (x-axis and y-axis).
        - Optional third variable for size or color encoding.
    - Example: Correlating advertising spend with sales revenue.
- Guidelines for Selecting Chart Types
    - Single Quantitative Variable
        - Histogram: Distribution of data.
        - Use When: Understanding the frequency of data within certain ranges.
    - Categorical vs. Quantitative
        - Bar Chart or Pie Chart: Comparing categories.
        - Use When: Highlighting differences between groups.
    - Temporal vs. Quantitative
        - Line Chart or Area Chart: Trends over time.
        - Use When: Showing how data changes at regular intervals.
    - Two Quantitative Variables
        - Scatter Plot: Relationship analysis.
        - Use When: Identifying correlations or patterns.
    - Multiple Categorical Variables
        - Grouped Bar Chart: Complex comparisons.
        - Use When: Comparing sub-groups within main categories.
    
### EXAMPLES ###

1. Comparing Sales Across Regions
- Chart Type: Bar Chart.
- Vega-Lite Spec:
{
    "mark": "bar",
    "encoding": {
        "x": {"field": "Region", "type": "nominal"},
        "y": {"field": "Sales", "type": "quantitative"}
    }
}
2. Sales Trends Over Time
- Chart Type: Line Chart.
- Vega-Lite Spec:
{
    "mark": "line",
    "encoding": {
        "x": {"field": "Date", "type": "temporal"},
        "y": {"field": "Sales", "type": "quantitative"}
    }
}
3. Market Share Distribution
- Chart Type: Donut Chart.
- Vega-Lite Spec:
{
    "mark": {"type": "arc", "innerRadius": 50},
    "encoding": {
        "theta": {"field": "Market Share", "type": "quantitative"},
        "color": {"field": "Company", "type": "nominal"}
    }
}

### OUTPUT FORMAT ###

Please provide your chain of thought reasoning and the vega-lite schema in JSON format.

{
    "reasoning": <REASON_TO_CHOOSE_THE_SCHEMA_IN_STRING>
    "schema": <VEGA_LITE_JSON_SCHEMA>
}
"""

chart_generation_user_prompt_template = """
### INPUT ###
Question: {{ query }}
SQL: {{ sql }}
Sample Data: {{ sample_data }}
Sample Data Statistics: {{ sample_data_statistics }}
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
                return {
                    "results": {
                        "schema": chart_schema,
                        "reasoning": generation_result.get("reasoning", ""),
                    }
                }

            return {"results": {"schema": "", "reasoning": ""}}
        except Exception as e:
            logger.exception(f"Vega-lite schema is not valid: {e}")

            return {
                "results": {
                    "schema": "",
                    "reasoning": "",
                }
            }


@component
class ChartDataPreprocessor:
    @component.output_types(
        results=Dict[str, Any],
    )
    def run(self, data: Dict[str, Any]):
        sample_data_statistics = {
            column["name"]: set() for column in data["results"]["columns"]
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
    timezone: ChartConfigurations.Timezone,
    prompt_builder: PromptBuilder,
) -> dict:
    sample_data = preprocess_data["results"]["sample_data"]
    sample_data_statistics = preprocess_data["results"]["sample_data_statistics"]

    logger.debug(f"query: {query}")
    logger.debug(f"sql: {sql}")
    logger.debug(f"sample data: {sample_data}")
    logger.debug(f"sample data statistics: {sample_data_statistics}")
    logger.debug(f"language: {language}")
    logger.debug(f"timezone: {timezone}")

    return prompt_builder.run(
        query=query,
        sql=sql,
        sample_data=sample_data,
        sample_data_statistics=sample_data_statistics,
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
    reasoning: str
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
