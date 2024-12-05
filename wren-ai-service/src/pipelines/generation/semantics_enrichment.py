import logging
import sys
from pathlib import Path
from typing import Any

import orjson
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider

logger = logging.getLogger("wren-ai-service")


## Start of Pipeline
@observe(capture_input=False)
def picked_models(mdl: dict) -> list[dict]:
    def relation_filter(column: dict) -> bool:
        return "relationship" not in column

    def column_formatter(columns: list[dict]) -> list[dict]:
        return [
            {
                "name": column["name"],
                "type": column["type"],
                "properties": {
                    "alias": column["properties"].get("displayName", ""),
                    "description": column["properties"].get("description", ""),
                },
            }
            for column in columns
            if relation_filter(column)
        ]

    def extract(model: dict) -> dict:
        prop = model["properties"]
        return {
            "name": model["name"],
            "columns": column_formatter(model["columns"]),
            "properties": {
                "alias": prop.get("displayName", ""),
                "description": prop.get("description", ""),
            },
        }

    return [extract(model) for model in mdl.get("models", [])]


@observe(capture_input=False)
def prompt(
    picked_models: list[dict],
    user_prompt: str,
    prompt_builder: PromptBuilder,
    language: str,
) -> dict:
    return prompt_builder.run(
        picked_models=picked_models,
        user_prompt=user_prompt,
        language=language,
    )


@observe(as_type="generation", capture_input=False)
async def generate(prompt: dict, generator: Any) -> dict:
    return await generator(prompt=prompt.get("prompt"))


@observe(capture_input=False)
def normalize(generate: dict) -> dict:
    def wrapper(text: str) -> str:
        text = text.replace("\n", " ")
        text = " ".join(text.split())
        # Convert the normalized text to a dictionary
        try:
            text_dict = orjson.loads(text.strip())
            return text_dict
        except orjson.JSONDecodeError as e:
            logger.error(f"Error decoding JSON: {e}")
            return {"models": []}  # Return an empty list if JSON decoding fails

    reply = generate.get("replies")[0]  # Expecting only one reply
    normalized = wrapper(reply)

    return {model["name"]: model for model in normalized["models"]}


## End of Pipeline
class ModelProperties(BaseModel):
    alias: str
    description: str


class ModelColumns(BaseModel):
    name: str
    properties: ModelProperties


class SemanticModel(BaseModel):
    name: str
    columns: list[ModelColumns]
    properties: ModelProperties


class SemanticResult(BaseModel):
    models: list[SemanticModel]


semantics_enrichment_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "semantics_enrichment",
            "schema": SemanticResult.model_json_schema(),
        },
    }
}

system_prompt = """
You are a data model expert. Your task is to enrich a JSON data model with descriptive metadata.

Input Format:
[{
    'name': 'model',
    'columns': [{'name': 'column', 'type': 'type', 'properties': {'alias': 'alias', 'description': 'description'}}],
    'properties': {'alias': 'alias', 'description': 'description'}
}]

For each model and column, you will:
1. Add a clear, concise alias that serves as a business-friendly name
2. Add a detailed description explaining its purpose and usage

Guidelines:
- Descriptions should be clear, concise and business-focused
- Aliases should be intuitive and user-friendly
- Use the user's context to inform the descriptions
- Maintain technical accuracy while being accessible to non-technical users

Output Format:
{
    "models": [{
        "name": "model",
        "columns": [{
            "name": "column",
            "properties": {
                "alias": "User-friendly column name",
                "description": "Clear explanation of column purpose"
            }
        }],
        "properties": {
            "alias": "User-friendly model name", 
            "description": "Clear explanation of model purpose"
        }
    }]
}

Example:
Input model "orders" with column "created_at" might become:
{
    "name": "created_at",
    "properties": {
        "alias": "Order Creation Date",
        "description": "Timestamp when the order was first created in the system"
    }
}

Focus on providing business value through clear, accurate descriptions while maintaining JSON structure integrity.
"""

user_prompt_template = """
### Input:
User's prompt: {{ user_prompt }}
Picked models: {{ picked_models }}
Localization Language: {{ language }}

Please provide a brief description and alias for the model and each column based on the user's prompt.
"""


class SemanticsEnrichment(BasicPipeline):
    def __init__(self, llm_provider: LLMProvider, **_):
        self._components = {
            "prompt_builder": PromptBuilder(template=user_prompt_template),
            "generator": llm_provider.get_generator(
                system_prompt=system_prompt,
                generation_kwargs=semantics_enrichment_KWARGS,
            ),
        }
        self._final = "normalize"

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def visualize(
        self,
        user_prompt: str,
        mdl: dict,
        language: str = "en",
    ) -> None:
        destination = "outputs/pipelines/generation"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            [self._final],
            output_file_path=f"{destination}/semantics_enrichment.dot",
            inputs={
                "user_prompt": user_prompt,
                "mdl": mdl,
                "language": language,
                **self._components,
            },
            show_legend=True,
            orient="LR",
        )

    @observe(name="Semantics Enrichment")
    async def run(
        self,
        user_prompt: str,
        mdl: dict,
        language: str = "en",
    ) -> dict:
        return await self._pipe.execute(
            [self._final],
            inputs={
                "user_prompt": user_prompt,
                "mdl": mdl,
                "language": language,
                **self._components,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        SemanticsEnrichment,
        "semantics_enrichment",
        user_prompt="Track student enrollments, grades, and GPA calculations to monitor academic performance and identify areas for student support",
        mdl={},
        language="en",
    )
