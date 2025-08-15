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
from src.pipelines.common import clean_up_new_lines
from src.utils import trace_cost
from src.web.v1.services.ask import AskHistory

logger = logging.getLogger("wren-ai-service")


misleading_assistance_system_prompt = """
### TASK ###
You are a helpful assistant that can help users understand their data better. Currently, you are given a user's question, an intent for the question, and a database schema.
Your goal is to help guide user understand its data better and suggest few better questions to ask based on the intent for the question and the database schema.

### INSTRUCTIONS ###

- Answer must be in the same language user specified in the Language section of the `### INPUT ###` section.
- There should be proper line breaks, whitespace, and Markdown formatting(headers, lists, tables, etc.) in your response.
- MUST NOT add SQL code in your response.
- MUST consider database schema when suggesting better questions.
- The maximum response length is 100 words.
- If the user provides a custom instruction, it should be followed strictly and you should use it to change the style of response.

### OUTPUT FORMAT ###
Please provide your response in proper Markdown format without ```markdown``` tags.
"""

misleading_assistance_user_prompt_template = """
### DATABASE SCHEMA ###
{% for db_schema in db_schemas %}
    {{ db_schema }}
{% endfor %}

{% if histories %}
### PREVIOUS QUESTIONS ###
{% for history in histories %}
    {{ history.question }}
{% endfor %}
{% endif %}

### INPUT ###
User's question: {{query}}
Intent for user's question: {{intent_reasoning}}
Language: {{language}}

Custom Instruction: {{ custom_instruction }}

Please think step by step
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    query: str,
    intent_reasoning: str,
    db_schemas: list[str],
    language: str,
    histories: list[AskHistory],
    prompt_builder: PromptBuilder,
    custom_instruction: str,
) -> dict:
    _prompt = prompt_builder.run(
        query=query,
        intent_reasoning=intent_reasoning,
        histories=histories,
        db_schemas=db_schemas,
        language=language,
        custom_instruction=custom_instruction,
    )
    return {"prompt": clean_up_new_lines(_prompt.get("prompt"))}


@observe(as_type="generation", capture_input=False)
@trace_cost
async def misleading_assistance(
    prompt: dict, generator: Any, query_id: str, generator_name: str
) -> dict:
    return await generator(
        prompt=prompt.get("prompt"),
        query_id=query_id,
    ), generator_name


## End of Pipeline


class MisleadingAssistance(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **kwargs,
    ):
        self._user_queues = {}
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=misleading_assistance_system_prompt,
                streaming_callback=self._streaming_callback,
            ),
            "generator_name": llm_provider.get_model(),
            "prompt_builder": PromptBuilder(
                template=misleading_assistance_user_prompt_template
            ),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def _streaming_callback(self, chunk, query_id):
        if query_id not in self._user_queues:
            self._user_queues[
                query_id
            ] = asyncio.Queue()  # Create a new queue for the user if it doesn't exist
        # Put the chunk content into the user's queue
        asyncio.create_task(self._user_queues[query_id].put(chunk.content))
        if chunk.meta.get("finish_reason"):
            asyncio.create_task(self._user_queues[query_id].put("<DONE>"))

    async def get_streaming_results(self, query_id):
        async def _get_streaming_results(query_id):
            return await self._user_queues[query_id].get()

        if query_id not in self._user_queues:
            self._user_queues[
                query_id
            ] = asyncio.Queue()  # Ensure the user's queue exists
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

    @observe(name="Misleading Assistance")
    async def run(
        self,
        query: str,
        intent_reasoning: str,
        db_schemas: list[str],
        language: str,
        query_id: Optional[str] = None,
        histories: Optional[list[AskHistory]] = None,
        custom_instruction: Optional[str] = None,
    ):
        logger.info("Misleading Assistance pipeline is running...")
        return await self._pipe.execute(
            ["misleading_assistance"],
            inputs={
                "query": query,
                "intent_reasoning": intent_reasoning,
                "db_schemas": db_schemas,
                "language": language,
                "query_id": query_id or "",
                "histories": histories or [],
                "custom_instruction": custom_instruction or "",
                **self._components,
            },
        )
