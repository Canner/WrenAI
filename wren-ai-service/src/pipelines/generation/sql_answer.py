import asyncio
import logging
import sys
from dataclasses import dataclass, field
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


@dataclass
class SQLAnswerStreamState:
    chunks: list[str] = field(default_factory=list)
    done: bool = False
    condition: asyncio.Condition = field(default_factory=asyncio.Condition)

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

### OUTPUT FORMAT

Please provide your response in proper Markdown stringformat.
"""

sql_to_answer_user_prompt_template = """
### Inputs ###
User's question: {{ query }}
SQL: {{ sql }}
Data: 
columns: {{ sql_data.columns }}
rows: {{ sql_data.data }}
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
        self._stream_states: dict[str, SQLAnswerStreamState] = {}
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

    def _ensure_stream_state(self, query_id: str) -> SQLAnswerStreamState:
        if query_id not in self._stream_states:
            self._stream_states[query_id] = SQLAnswerStreamState()
        return self._stream_states[query_id]

    async def _append_chunk(self, query_id: str, content: Optional[str]):
        if not content:
            return

        stream_state = self._ensure_stream_state(query_id)
        async with stream_state.condition:
            stream_state.chunks.append(content)
            stream_state.condition.notify_all()

    async def _mark_done(self, query_id: str):
        stream_state = self._ensure_stream_state(query_id)
        async with stream_state.condition:
            stream_state.done = True
            stream_state.condition.notify_all()

        asyncio.create_task(self._cleanup_stream_state(query_id))

    async def _cleanup_stream_state(self, query_id: str, delay_seconds: int = 300):
        await asyncio.sleep(delay_seconds)
        self._stream_states.pop(query_id, None)

    def _streaming_callback(self, chunk, query_id):
        self._ensure_stream_state(query_id)
        asyncio.create_task(self._append_chunk(query_id, chunk.content))
        if chunk.meta.get("finish_reason"):
            asyncio.create_task(self._mark_done(query_id))

    async def get_streaming_results(self, query_id):
        stream_state = self._ensure_stream_state(query_id)
        chunk_index = 0

        while True:
            try:
                async with stream_state.condition:
                    while (
                        chunk_index >= len(stream_state.chunks) and not stream_state.done
                    ):
                        await asyncio.wait_for(stream_state.condition.wait(), timeout=120)

                    pending_chunks = stream_state.chunks[chunk_index:]
                    chunk_index = len(stream_state.chunks)
                    is_done = stream_state.done

                for pending_chunk in pending_chunks:
                    if pending_chunk:
                        yield pending_chunk

                if is_done:
                    break
            except TimeoutError:
                break

    def get_buffered_content(self, query_id: str) -> Optional[str]:
        stream_state = self._stream_states.get(query_id)
        if stream_state is None:
            return None

        return "".join(stream_state.chunks)

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
