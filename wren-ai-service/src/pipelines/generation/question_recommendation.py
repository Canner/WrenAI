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

from src.core.pipeline import BasicPipeline, async_validate
from src.core.provider import LLMProvider

logger = logging.getLogger("wren-ai-service")

# todo: deeper insight, drill down, and other analysis approaches to generate questions
# todo: classify questions into categories
# todo: add few shot examples to the prompt for better quality
# todo: validate the question can be used to generate a valid sql query
# todo: might be able to use the the ask pipeline to generate the sql query, thus we need to create a service for that


## Start of Pipeline
def prompt(
    mdl: dict,
    user_question: str,
    num_questions: int,
    prompt_builder: PromptBuilder,
) -> dict:
    return prompt_builder.run(
        models=mdl["models"], user_question=user_question, num_questions=num_questions
    )


async def generate(prompt: dict, generator: Any) -> dict:
    return await generator.run(prompt=prompt.get("prompt"))


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


## End of Pipeline
class Question(BaseModel):
    question: str
    explanation: str
    category: str


class QuestionResult(BaseModel):
    questions: list[Question]


QUESTION_RECOMMENDATION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "question_recommendation",
            "schema": QuestionResult.model_json_schema(),
        },
    }
}

system_prompt = """
You are an expert in data analysis and SQL query generation. Given a data model specification and optionally a user's question, your task is to generate insightful, specific questions that can be answered using the provided data model. Each question should be accompanied by a brief explanation of its relevance or importance.

Output all questions in the following JSON structure:
{
    "questions": [
        {
            "question": "<generated question>",
            "explanation": "<brief explanation of the question's relevance or importance>",
            "category": "<category of the question>"
        },
        ...
    ]
}

When generating questions, consider the following guidelines:

1. If a user question is provided:
   - Generate questions that are directly related to or expand upon the user's question.
   - Create questions that explore specific aspects or implications of the user's query.

2. If no user question is provided:
   - Generate questions that cover various specific aspects of the data model.
   - Focus on questions that highlight concrete relationships between different models.
   - Create questions that could provide specific, actionable insights or business intelligence.

3. Ensure that all generated questions can be answered using the provided data model.

4. Provide a mix of simple and complex questions to cater to different levels of data analysis.

5. The number of questions generated should be controlled by the 'num_questions' parameter.

6. Avoid open-ended questions. Each question should be specific and have a definite answer based on the data model.

7. For each question, assign a category that best describes its focus (e.g., "Sales", "Customer Behavior", "Inventory", "Performance", etc.).

Remember to tailor your questions to the specific models and relationships present in the provided data model. Always aim for questions that can be answered with concrete data points rather than subjective interpretations.
"""

user_prompt_template = """
Data Model Specification:
{{models}}

{% if user_question %}
User's Question: {{user_question}}
{% endif %}

Please generate {{num_questions}} insightful questions based on the provided data model{% if user_question %} and the user's question{% endif %}.
"""


class QuestionRecommendation(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **_,
    ):
        self._components = {
            "prompt_builder": PromptBuilder(template=user_prompt_template),
            "generator": llm_provider.get_generator(
                system_prompt=system_prompt,
                generation_kwargs=QUESTION_RECOMMENDATION_MODEL_KWARGS,
            ),
        }

        self._final = "normalized"

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def visualize(
        self,
        mdl: dict,
        user_question: str = "",
        num_questions: int = 5,
    ) -> None:
        destination = "outputs/pipelines/generation"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            [self._final],
            output_file_path=f"{destination}/question_recommendation.dot",
            inputs={
                "mdl": mdl,
                "user_question": user_question,
                "num_questions": num_questions,
                **self._components,
            },
            show_legend=True,
            orient="LR",
        )

    @observe(name="Question Recommendation")
    async def run(
        self,
        mdl: dict,
        user_question: str = "",
        num_questions: int = 5,
    ) -> dict:
        logger.info("Question Recommendation pipeline is running...")
        return await self._pipe.execute(
            [self._final],
            inputs={
                "mdl": mdl,
                "user_question": user_question,
                "num_questions": num_questions,
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

    llm_provider, _, _, _ = init_providers(EngineConfig())
    pipeline = QuestionRecommendation(llm_provider=llm_provider)

    with open("sample/music_duckdb_mdl.json", "r") as file:
        mdl = json.load(file)

    input = {
        "mdl": mdl,
        "user_question": "What is the average GPA of students in each department?",
        "num_questions": 9,
    }

    # pipeline.visualize(**input)
    async_validate(lambda: pipeline.run(**input))

    langfuse_context.flush()
