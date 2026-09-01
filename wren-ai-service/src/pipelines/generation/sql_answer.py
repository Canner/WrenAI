import asyncio
import logging
import sys
import time
from typing import Any, Optional

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.common import clean_up_new_lines
from src.utils import trace_cost
from src.web.v1.services import Configuration

logger = logging.getLogger("wren-ai-service")

sql_to_answer_system_prompt = """
### TASK

You are a data analyst answering a user's question using only the provided SQL result data.
Answer clearly for a non-technical user in Markdown.

### INSTRUCTIONS

1. Use only the provided Data columns, row records, and rows. Do not invent values, totals, categories, dates, examples, or analysis outputs.
2. Treat row records as the clearest representation of the result because each value is paired with its column name.
3. Do not write code, Python, pseudo-code, SQL, code fences, implementation steps, or phrases such as "running the above code".
4. Do not mention SQL syntax, table names, or database internals unless the user explicitly asks for them.
5. If no rows are provided, say that no matching rows were returned.
6. If rows are detailed records, summarize the visible records directly. If rows are aggregates, answer using the aggregate values.
7. If the answer is a list, keep it concise and use only examples present in the provided data.
8. Answer must be in the same language user specified.
9. If the user provides a custom instruction, follow it strictly for the response style unless it conflicts with these data-grounding rules.

### OUTPUT FORMAT

Return only the user-facing answer as a Markdown string.
"""

sql_to_answer_user_prompt_template = """
### Inputs ###
User's question: {{ query }}
SQL: {{ sql }}
Data: 
columns: {{ sql_data.columns }}
row records: {{ sql_data.row_records }}
rows: {{ sql_data.data }}
Language: {{ language }}
Current Time: {{ current_time }}

Custom Instruction: {{ custom_instruction }}

Answer directly from the provided row records and rows.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    query: str,
    sql: str,
    sql_data: dict,
    language: str,
    current_time: str,
    custom_instruction: str,
    prompt_builder: PromptBuilder,
) -> dict:
    _prompt = prompt_builder.run(
        query=query,
        sql=sql,
        sql_data=sql_data,
        language=language,
        current_time=current_time,
        custom_instruction=custom_instruction,
    )
    return {"prompt": clean_up_new_lines(_prompt.get("prompt"))}


@observe(as_type="generation", capture_input=False)
@trace_cost
async def generate_answer(
    prompt: dict, generator: Any, query_id: str, generator_name: str
) -> dict:
    return await generator(
        prompt=prompt.get("prompt"), query_id=query_id
    ), generator_name


## End of Pipeline


class SQLAnswer(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **kwargs,
    ):
        self._user_queues = {}
        self._components = {
            "prompt_builder": PromptBuilder(
                template=sql_to_answer_user_prompt_template
            ),
            "generator": llm_provider.get_generator(
                system_prompt=sql_to_answer_system_prompt,
                streaming_callback=self._streaming_callback,
            ),
            "generator_name": llm_provider.get_model(),
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

    @observe(name="SQL Answer Generation")
    async def run(
        self,
        query: str,
        sql: str,
        sql_data: dict,
        language: str,
        current_time: str = Configuration().show_current_time(),
        query_id: Optional[str] = None,
        custom_instruction: Optional[str] = None,
    ) -> dict:
        logger.info("Sql_Answer Generation pipeline is running...")
        started_at = time.perf_counter()
        result = await self._pipe.execute(
            ["generate_answer"],
            inputs={
                "query": query,
                "sql": sql,
                "sql_data": sql_data,
                "language": language,
                "current_time": current_time,
                "query_id": query_id,
                "custom_instruction": custom_instruction or "",
                **self._components,
            },
        )
        logger.info(
            "Ask timing query_id=%s stage=answer_formatting elapsed_ms=%.1f",
            query_id or "",
            (time.perf_counter() - started_at) * 1000,
        )
        return result
