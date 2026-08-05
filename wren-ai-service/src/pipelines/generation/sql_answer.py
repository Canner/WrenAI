import asyncio
import logging
import sys
from html import escape
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

_MAX_ROWS_IN_DETERMINISTIC_ANSWER = 10

sql_to_answer_system_prompt = """
### TASK

You are a data analyst that great at answering non-technical user's questions based on the data, sql so that even non technical users can easily understand.
Please answer the user's question in concise and clear manner in Markdown format.

### INSTRUCTIONS

1. Read the user's question and understand the user's intention.
2. Read the sql and understand the data.
3. Make sure the answer is aimed for non-technical users, so don't mention any technical terms such as SQL syntax.
4. Generate a concise and clear answer in string format to answerthe user's question based on the data and sql.
5. If answer is in list format, only list top few examples, and tell users there are more results omitted.
6. Answer must be in the same language user specified.
7. Do not include ```markdown or ``` in the answer.
8. If the user provides a custom instruction, it should be followed strictly and you should use it to change the style of response.
9. Use only the columns and result rows provided in Data. Do not invent, duplicate, reorder, aggregate, rank, or label rows unless that operation is directly represented by the provided SQL result.
10. If the Data has aggregate rows, summarize those exact aggregate rows instead of describing them as separate top examples.
11. If the Data is empty, state that no matching records were returned.
12. Data rows are records already mapped by column name. Answer from the record values; do not describe the underlying data structure.

### OUTPUT FORMAT

Please provide your response in proper Markdown stringformat.
"""

sql_to_answer_user_prompt_template = """
### Inputs ###
User's question: {{ query }}
SQL: {{ sql }}
Data: 
columns: {{ sql_data.columns }}
result rows: {{ sql_data.row_records }}
Language: {{ language }}
Current Time: {{ current_time }}

Custom Instruction: {{ custom_instruction }}

Please think step by step and answer the user's question.
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

    def _enqueue_deterministic_answer(self, query_id: str, answer: str) -> None:
        if query_id not in self._user_queues:
            self._user_queues[query_id] = asyncio.Queue()

        self._user_queues[query_id].put_nowait(answer)
        self._user_queues[query_id].put_nowait("<DONE>")

    def _build_deterministic_answer(self, query: str, sql_data: dict) -> str:
        row_records = sql_data.get("row_records") or _build_row_records(sql_data)
        columns = _column_names(sql_data)
        if not row_records:
            return "No matching records were returned for this question."

        visible_rows = row_records[:_MAX_ROWS_IN_DETERMINISTIC_ANSWER]
        prefix = _answer_prefix(query, row_records)
        table = _markdown_table(columns, visible_rows)
        suffix = ""
        if len(row_records) > len(visible_rows):
            suffix = (
                f"\n\nShowing {len(visible_rows)} of {len(row_records)} returned rows."
            )

        return f"{prefix}\n\n{table}{suffix}"

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
        deterministic_answer = self._build_deterministic_answer(query, sql_data or {})
        if query_id:
            self._enqueue_deterministic_answer(query_id, deterministic_answer)
            return {
                "generate_answer": (
                    {"replies": [deterministic_answer], "metadata": []},
                    self._components["generator_name"],
                )
            }

        return await self._pipe.execute(
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


def _column_names(sql_data: dict) -> list[str]:
    return [
        column.get("name", "") if isinstance(column, dict) else str(column)
        for column in sql_data.get("columns", []) or []
        if column
    ]


def _build_row_records(sql_data: dict) -> list[dict]:
    columns = _column_names(sql_data)
    rows = sql_data.get("data", []) or []
    records = []
    for row in rows:
        if isinstance(row, dict):
            records.append({column: row.get(column) for column in columns})
            continue
        if not isinstance(row, (list, tuple)):
            row = [row]
        records.append(
            {
                column: row[index] if index < len(row) else None
                for index, column in enumerate(columns)
            }
        )
    return records


def _answer_prefix(query: str, row_records: list[dict]) -> str:
    if len(row_records) == 1:
        return "I found 1 matching record."
    if _looks_analytical_result(row_records):
        return f"I found {len(row_records)} summarized results for this question."
    return f"I found {len(row_records)} matching records."


def _looks_analytical_result(row_records: list[dict]) -> bool:
    if not row_records:
        return False
    first_row = row_records[0]
    return any(isinstance(value, (int, float)) for value in first_row.values()) and len(
        first_row
    ) <= 4


def _markdown_table(columns: list[str], rows: list[dict]) -> str:
    if not columns and rows:
        columns = list(rows[0].keys())
    if not columns:
        return ""

    header = "| " + " | ".join(_format_cell(column) for column in columns) + " |"
    separator = "| " + " | ".join("---" for _ in columns) + " |"
    body = [
        "| "
        + " | ".join(_format_cell(row.get(column)) for column in columns)
        + " |"
        for row in rows
    ]
    return "\n".join([header, separator, *body])


def _format_cell(value: Any) -> str:
    if value is None:
        return ""
    return escape(str(value)).replace("|", "\\|")
