import logging
import sys
from datetime import datetime
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
def prompt(
    mdl: dict,
    previous_questions: list[str],
    language: str,
    current_date: str,
    max_questions: int,
    max_categories: int,
    prompt_builder: PromptBuilder,
) -> dict:
    """
    If previous_questions is provided, the MDL is omitted to allow the LLM to focus on
    generating recommendations based on the question history. This helps provide more
    contextually relevant questions that build on previous questions.
    """

    return prompt_builder.run(
        models=[] if previous_questions else mdl.get("models", []),
        previous_questions=previous_questions,
        language=language,
        current_date=current_date,
        max_questions=max_questions,
        max_categories=max_categories,
    )


@observe(capture_input=False, as_type="generation")
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

system_prompt = """
You are an expert in data analysis and SQL query generation. Given a data model specification, optionally a user's question, and a list of categories, your task is to generate insightful, specific questions that can be answered using the provided data model. Each question should be accompanied by a brief explanation of its relevance or importance.

### JSON Output Structure

Output all questions in the following JSON format:

```json
{
    "questions": [
        {
            "question": "<generated question>",
            "category": "<category of the question>"
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

3. **If a User Question is Provided:**

   - Generate questions that are closely related to the user’s previous question, ensuring that the new questions build upon or provide deeper insights into the original query.
   - Use **random category selection** to introduce diverse perspectives while maintaining a focus on the context of the previous question.
   - Apply the analysis techniques above to enhance the relevance and depth of the generated questions.

4. **If No User Question is Provided:**

   - Ensure questions cover different aspects of the data model.
   - Randomly distribute questions across all categories to ensure variety.

5. **General Guidelines for All Questions:**
   - Ensure questions can be answered using the data model.
   - Mix simple and complex questions.
   - Avoid open-ended questions – each should have a definite answer.
   - Incorporate time-based analysis where relevant.
   - Combine multiple analysis techniques when appropriate for deeper insights.

### Categories of Questions

1. **Descriptive Questions**  
   Summarize historical data.

   - Example: _"What was the total sales volume for each product last quarter?"_

2. **Segmentation Questions**  
   Identify meaningful data segments.

   - Example: _"Which customer segments contributed most to revenue growth?"_

3. **Comparative Questions**  
   Compare data across segments or periods.

   - Example: _"How did Product A perform compared to Product B last year?"_

4. **Data Quality/Accuracy Questions**  
   Assess data reliability and completeness.

   - Example: _"Are there inconsistencies in the sales records for Q1?"_

---

### Example JSON Output

```json
{
  "questions": [
    {
      "question": "What was the total revenue generated by each region in the last year?",
      "category": "Descriptive Questions"
    },
    {
      "question": "How do customer preferences differ between age groups?",
      "category": "Segmentation Questions"
    },
    {
      "question": "How does the conversion rate vary across different lead sources?",
      "category": "Comparative Questions"
    },
    {
      "question": "What percentage of contacts have incomplete or missing key properties (e.g., email, lifecycle stage, or deal association)",
      "category": "Data Quality/Accuracy Questions"
    }
  ]
}
```

---

### Additional Instructions for Randomization

- **Randomize Category Order:**  
  Ensure that categories are selected in a random order for each question generation session.

- **Avoid Repetition:**  
  Ensure the same category doesn’t dominate the list by limiting the number of questions from any single category unless specified otherwise.

- **Diversity of Analysis:**  
  Combine different analysis techniques (drill-down, roll-up, etc.) within the selected categories for richer insights.

- **Shuffle Categories:**  
  If possible, shuffle the list of categories internally before generating questions to ensure varied selection.


"""

user_prompt_template = """
{% if models %}
Data Model Specification:
{{models}}
{% endif %}

{% if previous_questions %}
Previous Questions: {{previous_questions}}
{% endif %}

{% if categories %}
Categories: {{categories}}
{% endif %}

Current Date: {{current_date}}

Please generate {{max_questions}} insightful questions for each of the {{max_categories}} categories based on the provided data model. Both the questions and category names should be translated into {{language}}{% if user_question %} and be related to the user's question{% endif %}. The output format should maintain the structure but with localized text.
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

    @observe(name="Question Recommendation")
    async def run(
        self,
        mdl: dict,
        previous_questions: list[str] = [],
        categories: list[str] = [],
        language: str = "en",
        current_date: str = datetime.now().strftime("%Y-%m-%d %A %H:%M:%S"),
        max_questions: int = 5,
        max_categories: int = 3,
        **_,
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
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        QuestionRecommendation,
        "question_recommendation",
        mdl={},
        previous_questions=[],
        categories=[],
        language="en",
        current_date=datetime.now().strftime("%Y-%m-%d %A %H:%M:%S"),
        max_questions=5,
        max_categories=3,
    )
