import logging
import sys
from datetime import datetime
from typing import Any, Optional

import orjson
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider

logger = logging.getLogger("wren-ai-service")

_system_prompt = """
### TASK

You are an expert at rephrasing questions to be more clear and specific while maintaining the original intent. You have access to the database schema which helps you understand the available data and relationships.

### INSTRUCTIONS

1. Read the user's question and understand the core intent
2. Review the provided database schema to understand available data
3. Rephrase the question to be more clear and specific, using proper table and column names from the schema where relevant
4. Ensure the rephrased question aligns with the actual data structure
5. Maintain the original meaning and requirements
6. Use natural, conversational language
7. Keep the rephrased question concise
8. Avoid referencing tables or columns that don't exist in the schema

### OUTPUT FORMAT

Return the rephrased question as a simple string that accurately reflects both the user's intent and the database structure.
"""

_user_prompt = """
### Input
Original question: {{ question }}
Language: {{ language }}
Current date: {{ current_date }}
Contexts: {{ contexts }}

Please rephrase this question to be clearer while keeping the same meaning.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    question: str,
    contexts: list[str],
    language: str,
    current_date: str,
    prompt_builder: PromptBuilder,
) -> dict:
    return prompt_builder.run(
        question=question,
        contexts=contexts,
        language=language,
        current_date=current_date,
    )


@observe(as_type="generation", capture_input=False)
async def generate(prompt: dict, generator: Any) -> dict:
    return await generator(prompt=prompt.get("prompt"))


@observe(capture_input=False)
def normalized(generate: dict) -> dict:
    def wrapper(text: str) -> list:
        text = text.replace("\n", " ")
        text = " ".join(text.split())
        try:
            text_list = orjson.loads(text.strip())
            return text_list
        except orjson.JSONDecodeError as e:
            logger.error(f"Error decoding JSON: {e}")
            return []  # Return an empty list if JSON decoding fails

    reply = generate.get("replies")[0]  # Expecting only one reply
    normalized = wrapper(reply)

    return normalized


@observe(capture_input=False)
def output(normalized: dict) -> str:
    return normalized.get("question", "")


## End of Pipeline
class Question(BaseModel):
    question: str


QUESTION_REPHRASING_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "question_rephrasing",
            "schema": Question.model_json_schema(),
        },
    }
}


class QuestionRephrasing(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **kwargs,
    ):
        self._components = {
            "prompt_builder": PromptBuilder(template=_user_prompt),
            "generator": llm_provider.get_generator(
                system_prompt=_system_prompt,
                generation_kwargs=QUESTION_REPHRASING_MODEL_KWARGS,
            ),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Question Rephrasing")
    async def run(
        self,
        question: str,
        contexts: list[str] = [],
        language: str = "English",
        current_date: str = datetime.now().strftime("%Y-%m-%d %A %H:%M:%S"),
        project_id: Optional[str] = None,
    ) -> dict:
        logger.info(
            f"Project ID: {project_id}, Question rephrasing pipeline is running..."
        )
        return await self._pipe.execute(
            ["output"],
            inputs={
                "question": question,
                "language": language,
                "contexts": contexts,
                "current_date": current_date,
                **self._components,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        QuestionRephrasing,
        "question_rephrasing",
        question="What is the total revenue for the year 2024?",
        contexts=[],
    )
