import json
import logging
import sys
from pathlib import Path
from typing import Any

import orjson
from hamilton import base
from hamilton.experimental.h_async import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline, async_validate
from src.core.provider import LLMProvider

logger = logging.getLogger("wren-ai-service")


## Start of Pipeline
@observe(capture_input=False)
def cleaned_models(mdl: dict) -> dict:
    def column_filter(columns: list[dict]) -> list[dict]:
        return [column for column in columns if "relationship" not in column]

    return [
        {**model, "columns": column_filter(model["columns"])} for model in mdl["models"]
    ]


@observe(capture_input=False)
def prompt(
    cleaned_models: dict,
    prompt_builder: PromptBuilder,
) -> dict:
    return prompt_builder.run(models=cleaned_models)


@observe(as_type="generation", capture_input=False)
async def generate(prompt: dict, generator: Any) -> dict:
    return await generator.run(prompt=prompt.get("prompt"))


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


def validated(normalized: dict, engine: Engine) -> dict:
    # todo: after wren-engine support function to validate the relationships, we will use that function to validate the relationships
    # for now, we will just return the normalized relationships
    return normalized


## End of Pipeline
class ModelRelationship(BaseModel):
    name: str
    fromModel: str
    fromColumn: str
    type: str
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
- **type**: The type of relationship, which can be ONE_TO_MANY, MANY_TO_MANY, or MANY_TO_ONE.
- **toModel**: The name of the target model.
- **toColumn**: The column in the target model that forms the relationship.
- **reason**: The reason for recommending this relationship.

Important guidelines:
1. Do not recommend relationships within the same model (fromModel and toModel must be different).
2. Only suggest relationships if there is a clear and beneficial reason to do so.
3. If there are no good relationships to recommend or if there are fewer than two models, return an empty list of relationships.

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
Here is my data model's relationship specification:

{{models}}


**Please review these models and provide recommendations of relationship to optimize them.**
Consider best practices in database design, potential normalization opportunities, indexing strategies, and any additional relationships that might enhance data integrity and query performance.
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

    def visualize(
        self,
        mdl: dict,
    ) -> None:
        destination = "outputs/pipelines/generation"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            [self._final],
            output_file_path=f"{destination}/relationship_recommendation.dot",
            inputs={
                "mdl": mdl,
                **self._components,
            },
            show_legend=True,
            orient="LR",
        )

    @observe(name="Relationship Recommendation")
    async def run(
        self,
        mdl: dict,
    ) -> dict:
        logger.info("Relationship Recommendation pipeline is running...")
        return await self._pipe.execute(
            [self._final],
            inputs={
                "mdl": mdl,
                **self._components,
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
    pipeline = RelationshipRecommendation(llm_provider=llm_provider, engine=engine)

    with open("sample/college_3_bigquery_mdl.json", "r") as file:
        mdl = json.load(file)

    input = {"mdl": mdl}

    pipeline.visualize(**input)
    async_validate(lambda: pipeline.run(**input))

    langfuse_context.flush()
