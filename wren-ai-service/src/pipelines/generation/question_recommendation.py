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
    num_questions: int,
    num_categories: int,
    prompt_builder: PromptBuilder,
) -> dict:
    return prompt_builder.run(
        models=mdl["models"],
        previous_questions=previous_questions,
        language=language,
        num_questions=num_questions,
        num_categories=num_categories,
        current_date=datetime.now(),
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
You are an expert in data analysis and SQL query generation. Given a data model specification, optionally a user's question, and a specified number of question categories, your task is to generate insightful, specific questions that can be answered using the provided data model. Each question should be accompanied by a brief explanation of its relevance or importance.

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

1. Whether a user question is provided or not:
   - Incorporate diverse data analysis techniques such as:
     a. Drill-down: Ask questions that delve into more detailed levels of data.
     b. Roll-up: Generate questions that aggregate data to higher levels.
     c. Slice and dice: Create questions that analyze data from different perspectives or dimensions.
     d. Trend analysis: Formulate questions about patterns or changes over time.
     e. Comparative analysis: Develop questions that compare different segments or categories.

2. If a user question is provided:
   - Generate questions that are directly related to or expand upon the user's question.
   - Create questions that explore specific aspects or implications of the user's query.
   - Use the above techniques to generate deeper insights related to the user's question.
   - Consider adding time-based filters or durations to the questions, such as "in the last month", "over the past year", or "compared to the previous quarter".

3. If no user question is provided:
   - Generate questions that cover various specific aspects of the data model.
   - Focus on questions that highlight concrete relationships between different models.
   - Create questions that could provide specific, actionable insights or business intelligence.

4. Ensure that all generated questions can be answered using the provided data model.

5. Provide a mix of simple and complex questions to cater to different levels of data analysis, ranging from basic aggregations to multi-dimensional analyses.

6. The number of questions for each category generated should be exactly equal to the 'num_questions' parameter divided by the 'num_categories' parameter.

7. Avoid open-ended questions. Each question should be specific and have a definite answer based on the data model.

8. The number of question categories should be exactly equal to the 'num_categories' parameter. Assign each question to one of these categories.

9. When appropriate, include questions that combine multiple data analysis techniques to provide more comprehensive insights.

10. If applicable, incorporate time-based analysis in your questions, such as trends over time, comparisons between different time periods, or filtering data for specific time ranges.

Remember to tailor your questions to the specific models and relationships present in the provided data model. Always aim for questions that can be answered with concrete data points rather than subjective interpretations. Balance the distribution of questions across the specified number of categories while strictly adhering to the total number of questions requested. Strive to generate questions that offer diverse and deep insights into the data, encouraging a thorough exploration of the dataset using various data analysis techniques and time-based perspectives when relevant.
"""

# todo: fix Language is None, we expected default is English
user_prompt_template = """
Data Model Specification:
{{models}}

{% if previous_questions %}
Previous Questions: {{previous_questions}}
{% endif %}

Current Date: {{current_date}}
Language: {{language}}

Please generate {{num_questions}} insightful questions for {{num_categories}} categories based on the provided data model{% if user_question %} and the user's question{% endif %}.
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
        language: str = "English",
        num_questions: int = 5,
        num_categories: int = 1,
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
                "language": language,
                "num_questions": num_questions,
                "num_categories": num_categories,
            },
            show_legend=True,
            orient="LR",
        )

    @observe(name="Question Recommendation")
    async def run(
        self,
        mdl: dict,
        previous_questions: list[str] = [],
        language: str = "English",
        num_questions: int = 5,
        num_categories: int = 1,
    ) -> dict:
        logger.info("Question Recommendation pipeline is running...")
        return await self._pipe.execute(
            [self._final],
            inputs={
                "mdl": mdl,
                "previous_questions": previous_questions,
                "language": language,
                "num_questions": num_questions,
                "num_categories": num_categories,
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

    with open("sample/college_3_bigquery_mdl.json", "r") as file:
        mdl = json.load(file)

    input = {
        "mdl": mdl,
        "previous_questions": [],
        "language": "English",
        "num_questions": 5,
        "num_categories": 2,
    }

    # pipeline.visualize(**input)
    async_validate(lambda: pipeline.run(**input))

    langfuse_context.flush()
