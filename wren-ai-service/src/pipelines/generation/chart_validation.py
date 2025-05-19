import asyncio
import base64
import logging
import sys
from typing import Any

import orjson
import vl_convert as vlc
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider

logger = logging.getLogger("wren-ai-service")


chart_validation_system_prompt = """
### TASK ###

You are a chart validation expert. You will be given a chart image. You will need to validate if the content of the chart is empty or not.
If the content of the chart is empty, you will need to return False as the value of the "valid" field; otherwise, you will need to return True.

### OUTPUT ###

You will need to return a JSON object with the following schema:

{
    "valid": bool
}
"""


chart_validation_user_prompt_template = """
Please check the chart image and decide if the content of the chart is empty or not.
"""


## Start of Pipeline
@observe()
async def preprocess_chart_schema(chart_schema: dict) -> str:
    # Convert Vega-Lite to PNG in a separate thread since it's CPU-bound
    png_bytes = await asyncio.to_thread(
        vlc.vegalite_to_png, vl_spec=chart_schema, vl_version="v5.15"
    )
    # Base64 encode and decode to UTF-8 string
    b64_str = base64.b64encode(png_bytes).decode("utf-8")
    # Prepend the data URL header
    data_url = f"data:image/png;base64,{b64_str}"
    return data_url


@observe(capture_input=False)
def prompt(
    prompt_builder: PromptBuilder,
) -> dict:
    return prompt_builder.run()


@observe(as_type="generation", capture_input=False)
async def validate_chart(
    prompt: dict, preprocess_chart_schema: str, generator: Any
) -> dict:
    return await generator(
        prompt=prompt.get("prompt"), image_url=preprocess_chart_schema
    )


@observe(capture_input=False)
def post_process(
    validate_chart: dict,
) -> dict:
    return orjson.loads(validate_chart.get("replies")[0])


## End of Pipeline


class ChartValidationResults(BaseModel):
    valid: bool


CHART_GENERATION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "chart_validation_schema",
            "schema": ChartValidationResults.model_json_schema(),
        },
    }
}


class ChartValidation(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **kwargs,
    ):
        self._components = {
            "prompt_builder": PromptBuilder(
                template=chart_validation_user_prompt_template
            ),
            "generator": llm_provider.get_generator(
                system_prompt=chart_validation_system_prompt,
                generation_kwargs=CHART_GENERATION_MODEL_KWARGS,
            ),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Chart Validation")
    async def run(
        self,
        chart_schema: dict,
    ) -> dict:
        logger.info("Chart Validation pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "chart_schema": chart_schema,
                **self._components,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        ChartValidation,
        "chart_validation",
        query="show me the dataset",
        sql="",
        data={},
        language="English",
    )
