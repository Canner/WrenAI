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
from src.utils import trace_cost

logger = logging.getLogger("wren-ai-service")


system_prompt = """
You are an expert in data analysis and SQL query generation. Given a data model specification, optionally a user's recommendation request, a source result context, preview metadata, and a list of categories, your task is to generate insightful, specific follow-up questions that can be answered using the provided data model.

### JSON Output Structure

Output all questions in the following JSON format:

```json
{
    "questions": [
        {
            "label": "<short CTA shown in UI>",
            "prompt": "<full prompt to place in composer>",
            "question": "<canonical question used for validation>",
            "category": "<one of: drill_down, compare, trend, distribution, ranking, chart_followup, chart_refine, related_question>",
            "interaction_mode": "draft_to_composer",
            "suggested_intent": "<ASK or CHART>"
        },
        ...
    ]
}
```

### Guidelines for Generating Questions

1. **If Categories Are Provided:**

   - **Randomly select categories** from the list and ensure no single category dominates the output.
   - Ensure a balanced distribution of questions across all provided categories.
   - For each generated question, **randomize the category selection** to avoid a fixed order.

2. **Incorporate Diverse Analysis Techniques:**

   - Use a mix of the following analysis techniques for each category:
     - **Drill-down:** Delve into detailed levels of data.
     - **Roll-up:** Aggregate data to higher levels.
     - **Slice and Dice:** Analyze data from different perspectives.
     - **Trend Analysis:** Identify patterns or changes over time.
     - **Comparative Analysis:** Compare segments, groups, or time periods.

3. **If a User Question or Source Result Is Provided:**

   - Generate questions that are closely related to the user's recommendation request and the source result context, ensuring that the new questions build upon or provide deeper insights into the original query/result.
   - Prioritize follow-ups that drill deeper into the source result before jumping to unrelated exploration.
   - If preview metadata is available, prefer using the surfaced dimensions / measures instead of generic wording.
   - If the source response is a chart, generate questions that refine the chart or ask for a related chart only when that improves the current artifact.
   - If the source response is a table with chartable measures and dimensions, include at least one chart-oriented suggestion.
   - Use **random category selection** to introduce diverse perspectives while maintaining a focus on the current analytic context.
   - Apply the analysis techniques above to enhance the relevance and depth of the generated questions.

4. **If No User Question is Provided:**

   - Ensure questions cover different aspects of the data model.
   - Randomly distribute questions across all categories to ensure variety.

5. **General Guidelines for All Questions:**
   - Ensure questions can be answered using the data model.
   - Mix simple and complex questions.
   - Avoid open-ended questions - each should have a definite answer.
   - Incorporate time-based analysis where relevant.
   - Combine multiple analysis techniques when appropriate for deeper insights.
   - `label`, `prompt`, and `question` should usually be identical unless a shorter CTA is clearly better.
   - `interaction_mode` should default to `draft_to_composer`.
   - Use `suggested_intent = "CHART"` only when the user would clearly benefit from generating a visualization next.

### Categories of Questions
Use these canonical categories:

1. `drill_down`
2. `compare`
3. `trend`
4. `distribution`
5. `ranking`
6. `chart_followup`
7. `chart_refine`
8. `related_question`

---

### Additional Instructions for Randomization

- **Randomize Category Order:**  
  Ensure that categories are selected in a random order for each question generation session.

- **Avoid Repetition:**  
  Ensure the same category doesn't dominate the list by limiting the number of questions from any single category unless specified otherwise.

- **Diversity of Analysis:**  
  Combine different analysis techniques (drill-down, roll-up, etc.) within the selected categories for richer insights.

- **Shuffle Categories:**  
  If possible, shuffle the list of categories internally before generating questions to ensure varied selection.


"""

user_prompt_template = """

{% if previous_questions %}
Previous Questions: {{previous_questions}}
{% endif %}

{% if user_question %}
User Recommendation Request: {{user_question}}
{% endif %}

{% if source_question %}
Source Question: {{source_question}}
{% endif %}

{% if source_answer %}
Source Answer Summary: {{source_answer}}
{% endif %}

{% if source_sql %}
Source SQL:
{{source_sql}}
{% endif %}

{% if source_chart_type %}
Source Chart Type: {{source_chart_type}}
{% endif %}

{% if source_chart_title %}
Source Chart Title: {{source_chart_title}}
{% endif %}

{% if source_chart_encodings %}
Source Chart Encodings: {{source_chart_encodings}}
{% endif %}

{% if source_preview_row_count %}
Source Preview Row Count: {{source_preview_row_count}}
{% endif %}

{% if source_preview_column_count %}
Source Preview Column Count: {{source_preview_column_count}}
{% endif %}

{% if source_preview_columns %}
Source Preview Columns: {{source_preview_columns}}
{% endif %}

{% if source_dimension_columns %}
Source Dimension Columns: {{source_dimension_columns}}
{% endif %}

{% if source_measure_columns %}
Source Measure Columns: {{source_measure_columns}}
{% endif %}

{% if source_intent_lineage %}
Recent Intent Lineage: {{source_intent_lineage}}
{% endif %}

{% if source_response_kind %}
Source Response Kind: {{source_response_kind}}
{% endif %}

{% if categories %}
Categories: {{categories}}
{% endif %}

{% if documents %}
### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document }}
{% endfor %}
{% endif %}

Please generate {{max_questions}} insightful questions for each of the {{max_categories}} categories based on the provided data model. Both the questions and category names should be translated into {{language}}{% if user_question %} and be related to the user's question{% endif %}. The output format should maintain the structure but with localized text.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    previous_questions: list[str],
    documents: list,
    language: str,
    max_questions: int,
    max_categories: int,
    prompt_builder: PromptBuilder,
    user_question: str | None = None,
    source_question: str | None = None,
    source_answer: str | None = None,
    source_sql: str | None = None,
    source_chart_type: str | None = None,
    source_chart_title: str | None = None,
    source_chart_encodings: list[str] | None = None,
    source_dimension_columns: list[str] | None = None,
    source_intent_lineage: list[str] | None = None,
    source_measure_columns: list[str] | None = None,
    source_preview_column_count: int | None = None,
    source_preview_columns: list[dict] | None = None,
    source_preview_row_count: int | None = None,
    source_response_kind: str | None = None,
) -> dict:
    """
    If previous_questions is provided, the MDL is omitted to allow the LLM to focus on
    generating recommendations based on the question history. This helps provide more
    contextually relevant questions that build on previous questions.
    """

    _prompt = prompt_builder.run(
        documents=documents,
        previous_questions=previous_questions,
        user_question=user_question,
        source_question=source_question,
        source_answer=source_answer,
        source_sql=source_sql,
        source_chart_type=source_chart_type,
        source_chart_title=source_chart_title,
        source_chart_encodings=source_chart_encodings,
        source_dimension_columns=source_dimension_columns,
        source_intent_lineage=source_intent_lineage,
        source_measure_columns=source_measure_columns,
        source_preview_column_count=source_preview_column_count,
        source_preview_columns=source_preview_columns,
        source_preview_row_count=source_preview_row_count,
        source_response_kind=source_response_kind,
        language=language,
        max_questions=max_questions,
        max_categories=max_categories,
    )
    return {"prompt": clean_up_new_lines(_prompt.get("prompt"))}


@observe(as_type="generation", capture_input=False)
@trace_cost
async def generate(prompt: dict, generator: Any, generator_name: str) -> dict:
    return await generator(prompt=prompt.get("prompt")), generator_name


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
            "generator_name": llm_provider.get_model(),
        }

        self._final = "normalized"

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Question Recommendation")
    async def run(
        self,
        contexts: list[str],
        previous_questions: list[str] = [],
        user_question: str | None = None,
        source_question: str | None = None,
        source_answer: str | None = None,
        source_sql: str | None = None,
        source_chart_type: str | None = None,
        source_response_kind: str | None = None,
        categories: list[str] = [],
        language: str = "en",
        max_questions: int = 5,
        max_categories: int = 3,
        **_,
    ) -> dict:
        logger.info("Question Recommendation pipeline is running...")
        return await self._pipe.execute(
            [self._final],
            inputs={
                "documents": contexts,
                "previous_questions": previous_questions,
                "user_question": user_question,
                "source_question": source_question,
                "source_answer": source_answer,
                "source_sql": source_sql,
                "source_chart_type": source_chart_type,
                "source_response_kind": source_response_kind,
                "categories": categories,
                "language": language,
                "max_questions": max_questions,
                "max_categories": max_categories,
                **self._components,
            },
        )
