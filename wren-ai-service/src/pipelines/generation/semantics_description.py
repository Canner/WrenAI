import logging
import sys
from typing import Any

import orjson
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.common import clean_up_new_lines
from src.pipelines.indexing import clean_display_name
from src.utils import trace_cost

logger = logging.getLogger("wren-ai-service")


system_prompt = """
Generate high-quality semantic descriptions for selected data models and their columns.

Requirements:
1. Return valid JSON that matches the provided schema.
2. Return every input model exactly once and every input column exactly once.
3. Preserve every model and column `name` exactly as provided.
4. Put each generated description in `properties.description`.
5. Make descriptions business-friendly, concise, factual, and useful for text-to-SQL retrieval.
6. Ground descriptions only in the user prompt, model and column names, aliases, data types, existing descriptions, and provided schema context.
7. Make each column description specific to that column. Do not reuse the same wording across columns in the same model.
8. Do not invent unsupported tables, columns, relationships, metrics, or business concepts.
9. Do not use generic boilerplate or copy the technical name as the whole description.
"""

user_prompt_template = """
### Input:
User's prompt: {{ user_prompt }}
Picked models: {{ picked_models }}
Localization Language: {{ language }}

Write semantic descriptions for every picked model and every column.
For each model, describe the real-world records represented and the analytical questions it can support.
For each column, describe the business meaning and analytical use of that exact field.
Keep every description grounded in the picked model metadata and user prompt.
"""


## Start of Pipeline
@observe(capture_input=False)
def picked_models(mdl: dict, selected_models: list[str]) -> list[dict]:
    def relation_filter(column: dict) -> bool:
        return "relationship" not in column

    def _properties(payload: dict) -> dict:
        properties = payload.get("properties")
        return properties if isinstance(properties, dict) else {}

    def _text(value) -> str:
        return "" if value is None else str(value)

    def column_formatter(columns: list[dict]) -> list[dict]:
        return [
            {
                "name": column.get("name", ""),
                "type": column.get("type", ""),
                "properties": {
                    "description": _text(
                        _properties(column).get("description", "")
                    ),
                    "alias": clean_display_name(
                        _text(_properties(column).get("displayName", ""))
                    ),
                },
            }
            for column in columns or []
            if relation_filter(column)
        ]

    def extract(model: dict) -> dict:
        return {
            "name": model.get("name", ""),
            "columns": column_formatter(model.get("columns", [])),
            "properties": {
                "description": _text(_properties(model).get("description", "")),
                "alias": clean_display_name(
                    _text(_properties(model).get("displayName", ""))
                ),
            },
        }

    return [
        extract(model)
        for model in mdl.get("models", [])
        if model.get("name", "") in selected_models
    ]


@observe(capture_input=False)
def prompt(
    picked_models: list[dict],
    user_prompt: str,
    prompt_builder: PromptBuilder,
    language: str,
) -> dict:
    _prompt = prompt_builder.run(
        picked_models=picked_models,
        user_prompt=user_prompt,
        language=language,
    )
    return {"prompt": clean_up_new_lines(_prompt.get("prompt"))}


@observe(as_type="generation", capture_input=False)
@trace_cost
async def generate(prompt: dict, generator: Any, generator_name: str) -> dict:
    return await generator(prompt=prompt.get("prompt")), generator_name


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
            raise ValueError(
                "Semantics description LLM returned malformed JSON. "
                "The response may have been truncated; reduce the selected "
                "schema size or increase the configured output token limit."
            ) from e

    replies = generate.get("replies") or []
    if not replies:
        return {}

    reply = replies[0]  # Expecting only one reply
    normalized = wrapper(reply)

    return {
        model["name"]: model
        for model in normalized.get("models", [])
        if isinstance(model, dict) and model.get("name")
    }


@observe(capture_input=False)
def output(normalize: dict, picked_models: list[dict]) -> dict:
    def _filter(enriched: list[dict], columns: list[dict]) -> list[dict]:
        valid_columns = [col["name"] for col in columns]

        return [col for col in enriched if col["name"] in valid_columns]

    models = {model["name"]: model for model in picked_models}

    return {
        name: {
            **data,
            "columns": _filter(data.get("columns", []), models[name]["columns"]),
        }
        for name, data in normalize.items()
        if name in models
    }


## End of Pipeline
class ModelProperties(BaseModel):
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


SEMANTICS_DESCRIPTION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "semantic_description",
            "schema": SemanticResult.model_json_schema(),
        },
    }
}


class SemanticsDescription(BasicPipeline):
    def __init__(self, llm_provider: LLMProvider, **_):
        self._components = {
            "prompt_builder": PromptBuilder(template=user_prompt_template),
            "generator": llm_provider.get_generator(
                system_prompt=system_prompt,
                generation_kwargs=SEMANTICS_DESCRIPTION_MODEL_KWARGS,
            ),
            "generator_name": llm_provider.get_model(),
        }
        self._final = "output"

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Semantics Description Generation")
    async def run(
        self,
        user_prompt: str,
        selected_models: list[str],
        mdl: dict,
        language: str = "en",
    ) -> dict:
        logger.info("Semantics Description Generation pipeline is running...")
        return await self._pipe.execute(
            [self._final],
            inputs={
                "user_prompt": user_prompt,
                "selected_models": selected_models,
                "mdl": mdl,
                "language": language,
                **self._components,
            },
        )
