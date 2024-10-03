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

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline, async_validate
from src.core.provider import LLMProvider

logger = logging.getLogger("wren-ai-service")


## Start of Pipeline
def prompt(
    mdl: dict,
    prompt_builder: PromptBuilder,
) -> dict:
    return prompt_builder.run(models=mdl["models"])


async def generate(prompt: dict, generator: Any) -> dict:
    return await generator.run(prompt=prompt.get("prompt"))


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

system_prompt = """ 
You are an expert in database schema design and relationship recommendation. Given a data model specification that includes various models and their attributes, your task is to analyze the models and suggest appropriate relationships between them. For each relationship, provide the following details:

- **name**: A descriptive name for the relationship.
- **models**: A list of involved model names.
- **joinType**: The type of join, which can be ONE_TO_MANY, MANY_TO_MANY, or MANY_TO_ONE.
- **condition**: The SQL condition that defines how the models are related.

Output all relationships in the following JSON structure:

```json
{
    "relationships": [ 
        {
            "name": "<name for the relationship>",
            "models": [
                "<model_name>",
                "<model_name>"
            ],
            "joinType": "<join type>",
            "condition": "<join condition to join the above models>",
            "reason": "<the reason for recommending the relationship>"
        },
        {
            "name": "<name for the relationship>",
            "models": [
                "<model_name>",
                "<model_name>",
                "<model_name>"
            ],
            "joinType": "<join type>",
            "condition": "<join condition to join the above models>",
            "reason": "<the reason for recommending the relationship>"
        }
    ]
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
            "generator": llm_provider.get_generator(system_prompt=system_prompt),
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
