import logging
from typing import Any, Dict, Optional

import orjson
import pandas as pd
from haystack import component
from jsonschema.exceptions import ValidationError
from pydantic import BaseModel

logger = logging.getLogger("wren-ai-service")


def load_custom_theme() -> Dict[str, Any]:
    with open("src/pipelines/generation/utils/theme_powerbi.json", "r") as f:
        return orjson.loads(f.read())


@component
class ChartDataPreprocessor:
    @component.output_types(
        sample_data=list[dict],
        sample_column_values=dict[str, Any],
    )
    def run(
        self,
        data: Dict[str, Any],
        sample_data_count: int = 15,
        sample_column_size: int = 5,
    ):
        columns = [
            column.get("name", "") if isinstance(column, dict) else column
            for column in data.get("columns", [])
        ]
        data = data.get("data", [])

        df = pd.DataFrame(data, columns=columns)
        sample_column_values = {
            col: list(df[col].unique())[:sample_column_size] for col in df.columns
        }

        if len(df) > sample_data_count:
            sample_data = df.sample(n=sample_data_count).to_dict(orient="records")
        else:
            sample_data = df.to_dict(orient="records")

        return {
            "raw_data": df.to_dict(orient="records"),
            "sample_data": sample_data,
            "sample_column_values": sample_column_values,
        }


@component
class ChartSchemaPreprocessor:
    @component.output_types(
        chart_schema=dict[str, Any],
    )
    def run(self, chart_schema: dict[str, Any]):
        del chart_schema["config"]
        return chart_schema


@component
class ChartGenerationPostProcessor:
    @component.output_types(
        results=Dict[str, Any],
    )
    def run(
        self,
        replies: str,
        sample_data: list[dict],
        custom_theme: Optional[dict[str, Any]] = None,
    ):
        try:
            generation_result = orjson.loads(replies[0])
            reasoning = generation_result.get("reasoning", "")
            chart_type = generation_result.get("chart_type", "")
            if chart_schema := generation_result.get("chart_schema", {}):
                # sometimes the chart_schema is still in string format
                if isinstance(chart_schema, str):
                    chart_schema = orjson.loads(chart_schema)

                chart_schema[
                    "$schema"
                ] = "https://vega.github.io/schema/vega-lite/v5.json"
                chart_schema["data"] = {"values": sample_data}

                if custom_theme:
                    chart_schema["config"] = custom_theme

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


class ChartGenerationResults(BaseModel):
    reasoning: str
    chart_schema: dict[str, Any]
    chart_type: Optional[str] = ""  # deprecated


CHART_GENERATION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "chart_generation_results",
            "schema": ChartGenerationResults.model_json_schema(),
        },
    }
}
