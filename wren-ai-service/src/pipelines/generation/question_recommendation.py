import json
import logging
import sys
from datetime import datetime
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


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    mdl: dict,
    previous_questions: list[str],
    language: str,
    current_date: str,
    max_questions: int,
    max_categories: int,
    prompt_builder: PromptBuilder,
) -> dict:
    return prompt_builder.run(
        models=mdl["models"],
        previous_questions=previous_questions,
        language=language,
        current_date=current_date,
        max_questions=max_questions,
        max_categories=max_categories,
    )


@observe(capture_input=False, as_type="generation")
async def generate(prompt: dict, generator: Any) -> dict:
    return await generator.run(prompt=prompt.get("prompt"))


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
You are an expert in data analysis and SQL query generation. Given a data model specification, optionally a user's question, and a list of categories, your task is to generate insightful, specific questions that can be answered using the provided data model. Each question should be accompanied by a brief explanation of its relevance or importance.

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

1. If categories are provided:
   - Generate questions specifically for each provided category
   - Ensure questions align well with the category's focus area
   - Distribute questions evenly across all provided categories
   - Make sure each question clearly relates to its assigned category

2. For each category, incorporate diverse data analysis techniques such as:
   a. Drill-down: Ask questions that delve into more detailed levels of data
   b. Roll-up: Generate questions that aggregate data to higher levels
   c. Slice and dice: Create questions that analyze data from different perspectives
   d. Trend analysis: Formulate questions about patterns or changes over time
   e. Comparative analysis: Develop questions that compare different segments

3. If a user question is provided:
   - Generate questions that are directly related to or expand upon the user's question
   - Create questions that explore specific aspects or implications of the user's query
   - Use the above techniques to generate deeper insights related to the user's question
   - Consider adding time-based filters or durations to the questions

4. If no user question is provided:
   - Generate questions that cover various specific aspects of the data model
   - Focus on questions that highlight concrete relationships between different models
   - Create questions that could provide specific, actionable insights

5. General guidelines for all questions:
   - Ensure all questions can be answered using the provided data model
   - Provide a mix of simple and complex questions
   - Avoid open-ended questions - each should have a definite answer
   - Include time-based analysis where relevant
   - Focus on concrete data points rather than subjective interpretations
   - Combine multiple analysis techniques when appropriate for deeper insights

Remember to:
- Strictly use only the provided categories when they are given
- Generate the exact number of questions requested per category
- Ensure questions are specific and answerable from the data model
- Balance complexity across questions while maintaining relevance to each category
- Use time-based perspectives when they add value to the analysis
"""

user_prompt_template = """
Data Model Specification:
{{models}}

{% if previous_questions %}
Previous Questions: {{previous_questions}}
{% endif %}

{% if categories %}
Categories: {{categories}}
{% endif %}

Current Date: {{current_date}}
Language: {{language}}

Please generate {{max_questions}} insightful questions for each of the {{max_categories}} categories based on the provided data model{% if user_question %} and the user's question{% endif %}.
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
        previous_questions: list[str] = [],
        categories: list[str] = [],
        language: str = "English",
        current_date: str = datetime.now(),
        max_questions: int = 5,
        max_categories: int = 3,
    ) -> None:
        destination = "outputs/pipelines/generation"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            [self._final],
            output_file_path=f"{destination}/question_recommendation.dot",
            inputs={
                "mdl": mdl,
                "previous_questions": previous_questions,
                "categories": categories,
                "language": language,
                "current_date": current_date,
                "max_questions": max_questions,
                "max_categories": max_categories,
            },
            show_legend=True,
            orient="LR",
        )

    @observe(name="Question Recommendation")
    async def run(
        self,
        mdl: dict,
        previous_questions: list[str] = [],
        categories: list[str] = [],
        language: str = "English",
        current_date: str = datetime.now(),
        max_questions: int = 5,
        max_categories: int = 3,
    ) -> dict:
        logger.info("Question Recommendation pipeline is running...")
        return await self._pipe.execute(
            [self._final],
            inputs={
                "mdl": mdl,
                "previous_questions": previous_questions,
                "categories": categories,
                "language": language,
                "current_date": current_date,
                "max_questions": max_questions,
                "max_categories": max_categories,
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

    with open("sample/ecommerce_duckdb_mdl.json", "r") as file:
        mdl = json.load(file)

    input = {
        "mdl": mdl,
        "previous_questions": [],
        "categories": ["Customer Insights", "Product Performance"],
        "language": "English",
        "max_questions": 5,
        "max_categories": 2,
    }

    # pipeline.visualize(**input)
    async_validate(lambda: pipeline.run(**input))

    langfuse_context.flush()
