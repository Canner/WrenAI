import asyncio
import logging
import sys
from typing import Any, Optional

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.generation.utils.sql import (
    construct_instructions,
)
from src.web.v1.services import Configuration
from src.web.v1.services.ask import AskHistory

logger = logging.getLogger("wren-ai-service")


sql_generation_reasoning_system_prompt = """
### TASK ###
You are a helpful data analyst who is great at thinking deeply and reasoning about the user's question and the database schema, and you provide a step-by-step reasoning plan in order to answer the user's question.

### INSTRUCTIONS ###
1. Think deeply and reason about the user's question and the database schema, and should consider the user's query history.
2. Give a step by step reasoning plan in order to answer user's question.
3. The reasoning plan should be in the language same as the language user provided in the input.
4. Make sure to consider the current time provided in the input if the user's question is related to the date/time.
5. Don't include SQL in the reasoning plan.
6. Each step in the reasoning plan must start with a number, a title(in bold format in markdown), and a reasoning for the step.
7. If SQL SAMPLES are provided, make sure to consider them in the reasoning plan.
8. If INSTRUCTIONS section is provided, please follow them strictly.
9. Do not include ```markdown or ``` in the answer.
10. A table name in the reasoning plan must be in this format: `table: <table_name>`.
11. A column name in the reasoning plan must be in this format: `column: <table_name>.<column_name>`.

### FINAL ANSWER FORMAT ###
The final answer must be a reasoning plan in plain Markdown string format
"""

sql_generation_reasoning_user_prompt_template = """
### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document }}
{% endfor %}

{% if sql_samples %}
### SQL SAMPLES ###
{% for sql_sample in sql_samples %}
Question:
{{sql_sample.question}}
SQL:
{{sql_sample.sql}}
{% endfor %}
{% endif %}

{% if instructions %}
### INSTRUCTIONS ###
{{ instructions }}
{% endif %}

### User's QUERY HISTORY ###
{% for history in histories %}
User's Question:
{{ history.question }}
Assistant's Response:
{{ history.sql }}
{% endfor %}

### QUESTION ###
User's Question: {{ query }}
Current Time: {{ current_time }}
Language: {{ language }}

Let's think step by step.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    query: str,
    documents: list[str],
    histories: list[AskHistory],
    sql_samples: list[dict],
    instructions: list[dict],
    prompt_builder: PromptBuilder,
    configuration: Configuration | None = Configuration(),
) -> dict:
    return prompt_builder.run(
        query=query,
        documents=documents,
        histories=histories,
        sql_samples=sql_samples,
        instructions=construct_instructions(
            configuration=configuration,
            instructions=instructions,
        ),
        current_time=configuration.show_current_time(),
        language=configuration.language,
    )


@observe(as_type="generation", capture_input=False)
async def generate_sql_reasoning(prompt: dict, generator: Any, query_id: str) -> dict:
    return await generator(
        prompt=prompt.get("prompt"),
        query_id=query_id,
    )


@observe()
def post_process(
    generate_sql_reasoning: dict,
) -> dict:
    return generate_sql_reasoning.get("replies")[0]


## End of Pipeline


class FollowUpSQLGenerationReasoning(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **kwargs,
    ):
        self._user_queues = {}
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=sql_generation_reasoning_system_prompt,
                streaming_callback=self._streaming_callback,
            ),
            "prompt_builder": PromptBuilder(
                template=sql_generation_reasoning_user_prompt_template
            ),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def _streaming_callback(self, chunk, query_id):
        if query_id not in self._user_queues:
            self._user_queues[query_id] = asyncio.Queue()

        # Put the chunk content into the user's queue
        asyncio.create_task(self._user_queues[query_id].put(chunk.content))
        if chunk.meta.get("finish_reason"):
            asyncio.create_task(self._user_queues[query_id].put("<DONE>"))

    async def get_streaming_results(self, query_id):
        async def _get_streaming_results(query_id):
            return await self._user_queues[query_id].get()

        if query_id not in self._user_queues:
            self._user_queues[query_id] = asyncio.Queue()

        while True:
            try:
                # Wait for an item from the user's queue
                self._streaming_results = await asyncio.wait_for(
                    _get_streaming_results(query_id), timeout=120
                )
                if (
                    self._streaming_results == "<DONE>"
                ):  # Check for end-of-stream signal
                    del self._user_queues[query_id]
                    break
                if self._streaming_results:  # Check if there are results to yield
                    yield self._streaming_results
                    self._streaming_results = ""  # Clear after yielding
            except TimeoutError:
                break

    @observe(name="FollowupSQL Generation Reasoning")
    async def run(
        self,
        query: str,
        contexts: list[str],
        histories: list[AskHistory],
        sql_samples: Optional[list[dict]] = None,
        instructions: Optional[list[dict]] = None,
        configuration: Configuration = Configuration(),
        query_id: Optional[str] = None,
    ):
        logger.info("Followup SQL Generation Reasoning pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "documents": contexts,
                "histories": histories,
                "sql_samples": sql_samples or [],
                "instructions": instructions or [],
                "configuration": configuration,
                "query_id": query_id,
                **self._components,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        FollowUpSQLGenerationReasoning,
        "followup_sql_generation_reasoning",
        query="this is a test query",
        histories=[],
        contexts=[],
    )
