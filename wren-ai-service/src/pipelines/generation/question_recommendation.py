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
You are an expert in data analysis and SQL query generation. Given a data model specification, optionally a user's question, and a list of categories, your task is to generate insightful, specific questions that can be answered using the provided data model.

### Grounding Rules

- The DATABASE SCHEMA is the only source for answerable business concepts.
- Generate questions only from tables, views, metrics, columns, measures, dimensions, calculated fields, and relationships that are present in DATABASE SCHEMA.
- Use aliases, descriptions, and comments only to understand meaning. Do not introduce nouns, measures, dimensions, periods, or entities that are not supported by the schema.
- If the same business concept appears in multiple modeled datasets, generate questions that can use each relevant modeled dataset, provided the schema exposes the needed fields.
- If a question would require fields from multiple datasets, generate it only when DATABASE SCHEMA provides either a relationship path, a view, a metric, or compatible fields that can be combined as separate rows.
- Do not use generic analytics examples, common business templates, or prior wording as a source of answerable concepts unless the concept is represented in DATABASE SCHEMA.

### JSON Output Structure

Output all questions in the following JSON format:

```json
{
    "questions": [
        {
            "question": "schema-grounded question text",
            "category": "question category"
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

   - Generate questions that are closely related to the user's previous question, ensuring that the new questions build upon or provide deeper insights into the original query.
   - Use **random category selection** to introduce diverse perspectives while maintaining a focus on the context of the previous question.
   - Apply the analysis techniques above to enhance the relevance and depth of the generated questions.
   - Keep only the parts of the previous question that are supported by DATABASE SCHEMA.

4. **If No User Question is Provided:**

   - Ensure questions cover different aspects of the data model.
   - Randomly distribute questions across all categories to ensure variety.

5. **General Guidelines for All Questions:**
   - Ensure questions can be answered using the data model.
   - Mix simple and complex questions.
   - Avoid open-ended questions - each should have a definite answer.
   - Incorporate time-based analysis only when DATABASE SCHEMA exposes relevant time fields.
   - Combine multiple analysis techniques when DATABASE SCHEMA supports the required fields and relationships.

### Categories of Questions

1. **Descriptive Questions**  
   Summarize historical data.

2. **Segmentation Questions**  
   Identify meaningful data segments.

3. **Comparative Questions**  
   Compare data across segments or periods.

4. **Data Quality/Accuracy Questions**  
   Assess data reliability and completeness.

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

{% if categories %}
Categories: {{categories}}
{% endif %}

{% if documents %}
### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document }}
{% endfor %}
{% endif %}

Please generate {{max_questions}} insightful questions for each of the {{max_categories}} categories based only on the provided data model. Both the questions and category names should be translated into {{language}}{% if user_question %} and be related to the user's question{% endif %}. The output format should maintain the structure but with localized text.
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
) -> dict:
    """
    If previous_questions is provided, the MDL is omitted to allow the LLM to focus on
    generating recommendations based on the question history. This helps provide more
    contextually relevant questions that build on previous questions.
    """

    _prompt = prompt_builder.run(
        documents=documents,
        previous_questions=previous_questions,
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
                "categories": categories,
                "language": language,
                "max_questions": max_questions,
                "max_categories": max_categories,
                **self._components,
            },
        )
