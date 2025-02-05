import logging
import sys
from typing import Any, Dict, List, Optional

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.generation.utils.sql import (
    SqlGenerationResult,
    SQLGenPostProcessor,
    construct_instructions,
    sql_generation_system_prompt,
)
from src.web.v1.services import Configuration
from src.web.v1.services.ask import AskHistory

logger = logging.getLogger("wren-ai-service")


text_to_sql_with_followup_user_prompt_template = """
### TASK ###
Given the following user's follow-up question and previous SQL query and summary,
generate one SQL query to best answer user's question.

### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document }}
{% endfor %}

{% if instructions %}
### INSTRUCTIONS ###
{{ instructions }}
{% endif %}

{% if sql_samples %}
### SQL SAMPLES ###
{% for sample in sql_samples %}
Summary:
{{sample.summary}}
SQL:
{{sample.sql}}
{% endfor %}
{% endif %}

### CONTEXT ###
Previous SQL Summary:
{% for summary in previous_query_summaries %}
    {{ summary }}
{% endfor %}
Previous SQL Query: {{ history.sql }}

### QUESTION ###
User's Follow-up Question: {{ query }}
Current Time: {{ current_time }}

### REASONING PLAN ###
{{ sql_generation_reasoning }}

Let's think step by step.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    query: str,
    documents: List[str],
    sql_generation_reasoning: str,
    history: AskHistory,
    configuration: Configuration,
    prompt_builder: PromptBuilder,
    sql_samples: List[Dict] | None = None,
    has_calculated_field: bool = False,
    has_metric: bool = False,
) -> dict:
    previous_query_summaries = [step.summary for step in history.steps if step.summary]

    return prompt_builder.run(
        query=query,
        documents=documents,
        sql_generation_reasoning=sql_generation_reasoning,
        history=history,
        previous_query_summaries=previous_query_summaries,
        instructions=construct_instructions(
            configuration,
            has_calculated_field,
            has_metric,
            sql_samples,
        ),
        current_time=configuration.show_current_time(),
        sql_samples=sql_samples,
    )


@observe(as_type="generation", capture_input=False)
async def generate_sql_in_followup(prompt: dict, generator: Any) -> dict:
    return await generator(prompt=prompt.get("prompt"))


@observe(capture_input=False)
async def post_process(
    generate_sql_in_followup: dict,
    post_processor: SQLGenPostProcessor,
    engine_timeout: float,
    project_id: str | None = None,
) -> dict:
    return await post_processor.run(
        generate_sql_in_followup.get("replies"),
        timeout=engine_timeout,
        project_id=project_id,
    )


## End of Pipeline


FOLLOWUP_SQL_GENERATION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "sql_generation_results",
            "schema": SqlGenerationResult.model_json_schema(),
        },
    }
}


class FollowUpSQLGeneration(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        engine: Engine,
        engine_timeout: Optional[float] = 30.0,
        **kwargs,
    ):
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=sql_generation_system_prompt,
                generation_kwargs=FOLLOWUP_SQL_GENERATION_MODEL_KWARGS,
            ),
            "prompt_builder": PromptBuilder(
                template=text_to_sql_with_followup_user_prompt_template
            ),
            "post_processor": SQLGenPostProcessor(engine=engine),
        }

        self._configs = {
            "engine_timeout": engine_timeout,
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Follow-Up SQL Generation")
    async def run(
        self,
        query: str,
        contexts: List[str],
        sql_generation_reasoning: str,
        history: AskHistory,
        configuration: Configuration = Configuration(),
        sql_samples: List[Dict] | None = None,
        project_id: str | None = None,
        has_calculated_field: bool = False,
        has_metric: bool = False,
    ):
        logger.info("Follow-Up SQL Generation pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "documents": contexts,
                "sql_generation_reasoning": sql_generation_reasoning,
                "history": history,
                "project_id": project_id,
                "configuration": configuration,
                "sql_samples": sql_samples,
                "has_calculated_field": has_calculated_field,
                "has_metric": has_metric,
                **self._components,
                **self._configs,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        FollowUpSQLGeneration,
        "followup_sql_generation",
        query="show me the dataset",
        contexts=[],
        history=AskHistory(sql="SELECT * FROM table", summary="Summary", steps=[]),
    )
