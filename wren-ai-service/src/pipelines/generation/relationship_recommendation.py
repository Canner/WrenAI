import logging
import sys
from enum import Enum
from typing import Any

import orjson
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider

logger = logging.getLogger("wren-ai-service")


## Start of Pipeline
@observe(capture_input=False)
def cleaned_models(mdl: dict) -> dict:
    def column_filter(columns: list[dict]) -> list[dict]:
        return [column for column in columns if "relationship" not in column]

    return [
        {**model, "columns": column_filter(model.get("columns", []))}
        for model in mdl.get("models", [])
    ]


@observe(capture_input=False)
def prompt(
    cleaned_models: dict,
    prompt_builder: PromptBuilder,
    language: str,
) -> dict:
    return prompt_builder.run(models=cleaned_models, language=language)


@observe(as_type="generation", capture_input=False)
async def generate(prompt: dict, generator: Any) -> dict:
    return await generator(prompt=prompt.get("prompt"))


@observe(capture_input=False)
def normalized(generate: dict) -> dict:
    def wrapper(text: str) -> str:
        text = text.replace("\n", " ")
        text = " ".join(text.split())
        # Convert the normalized text to a dictionary
        try:
            text_dict = orjson.loads(text.strip())
            return text_dict
        except orjson.JSONDecodeError as e:
            logger.error(f"Error decoding JSON: {e}")
            return {}  # Return an empty dictionary if JSON decoding fails

    reply = generate.get("replies")[0]  # Expecting only one reply
    normalized = wrapper(reply)

    return normalized


@observe(capture_input=False)
def validated(normalized: dict, engine: Engine) -> dict:
    relationships = normalized.get("relationships", [])

    validated_relationships = [
        relationship
        for relationship in relationships
        if RelationType.is_include(relationship.get("type"))
    ]

    # todo: after wren-engine support function to validate the relationships, we will use that function to validate the relationships
    # for now, we will just return the normalized relationships

    return {"relationships": validated_relationships}


## End of Pipeline
class RelationType(Enum):
    MANY_TO_ONE = "MANY_TO_ONE"
    ONE_TO_MANY = "ONE_TO_MANY"
    ONE_TO_ONE = "ONE_TO_ONE"

    @classmethod
    def is_include(cls, value: str) -> bool:
        return value in cls._value2member_map_


class ModelRelationship(BaseModel):
    name: str
    fromModel: str
    fromColumn: str
    type: RelationType
    toModel: str
    toColumn: str
    reason: str


class RelationshipResult(BaseModel):
    relationships: list[ModelRelationship]


RELATIONSHIP_RECOMMENDATION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "semantic_description",
            "schema": RelationshipResult.model_json_schema(),
        },
    }
}
system_prompt = """
You are an expert in database schema design and relationship recommendation. Given a data model specification that includes various models and their attributes, your task is to analyze the models and suggest appropriate relationships between them, but only if there are clear and beneficial relationships to recommend. For each valid relationship, provide the following details:

- **name**: A descriptive name for the relationship.
- **fromModel**: The name of the source model.
- **fromColumn**: The column in the source model that forms the relationship.
- **type**: The type of relationship, which can be "MANY_TO_ONE", "ONE_TO_MANY" or "ONE_TO_ONE" only.
- **toModel**: The name of the target model.
- **toColumn**: The column in the target model that forms the relationship.
- **reason**: The reason for recommending this relationship.

Important guidelines:
1. Do not recommend relationships within the same model (fromModel and toModel must be different).
2. Only suggest relationships if there is a clear and beneficial reason to do so.
3. If there are no good relationships to recommend or if there are fewer than two models, return an empty list of relationships.
4. Use "MANY_TO_ONE" and "ONE_TO_MANY" instead of "MANY_TO_MANY" relationships.

Output all relationships in the following JSON structure:

{
    "relationships": [
        {
            "name": "<name_for_the_relationship>",
            "fromModel": "<model_name>",
            "fromColumn": "<column_name>",
            "type": "<relationship_type>",
            "toModel": "<model_name>",
            "toColumn": "<column_name>",
            "reason": "<reason_for_this_relationship>"
        }
        ...
    ]
}

If no relationships are recommended, return:

{
    "relationships": []
}
"""

user_prompt_template = """
Here is the relationship specification for my data model:

{{models}}

**Please analyze these models and suggest optimizations for their relationships.**
Take into account best practices in database design, opportunities for normalization, indexing strategies, and any additional relationships that could improve data integrity and enhance query performance.

Use this for the relationship name and reason based on the localization language: {{language}}
"""


class RelationshipRecommendation(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        engine: Engine,
        **_,
    ):
        self._components = {
            "prompt_builder": PromptBuilder(template=user_prompt_template),
            "generator": llm_provider.get_generator(
                system_prompt=system_prompt,
                generation_kwargs=RELATIONSHIP_RECOMMENDATION_MODEL_KWARGS,
            ),
            "engine": engine,
        }

        self._final = "validated"

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Relationship Recommendation")
    async def run(
        self,
        mdl: dict,
        language: str = "English",
    ) -> dict:
        logger.info("Relationship Recommendation pipeline is running...")
        return await self._pipe.execute(
            [self._final],
            inputs={
                "mdl": mdl,
                "language": language,
                **self._components,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        RelationshipRecommendation,
        "relationship_recommendation",
        mdl={},
        language="English",
    )
