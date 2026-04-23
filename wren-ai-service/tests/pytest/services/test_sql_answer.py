import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.pipelines.generation.sql_answer import SQLAnswer
from src.web.v1.services.sql_answer import (
    SqlAnswerRequest,
    SqlAnswerResultRequest,
    SqlAnswerService,
)


class FakeStreamingChunk:
    def __init__(self, content: str | None, *, finished: bool = False):
        self.content = content
        self.meta = {"finish_reason": "stop" if finished else None}


class FakeLLMProvider:
    def get_generator(self, system_prompt=None, streaming_callback=None):
        async def _generator(prompt: str, query_id: str):
            streaming_callback(
                FakeStreamingChunk("第一段"),
                query_id,
            )
            await asyncio.sleep(0)
            streaming_callback(
                FakeStreamingChunk("第二段", finished=True),
                query_id,
            )
            return {"replies": ["done"]}

        return _generator

    def get_model(self):
        return "fake-model"


class FakeAnswerPipeline(SimpleNamespace):
    def __init__(self):
        self._content: dict[str, str] = {}
        super().__init__(run=AsyncMock(side_effect=self._run))

    async def _run(self, **kwargs):
        await asyncio.sleep(0)
        self._content[kwargs["query_id"]] = "finalized answer"
        return {}

    def get_buffered_content(self, query_id: str):
        return self._content.get(query_id)


@pytest.mark.asyncio
async def test_sql_answer_pipeline_supports_multiple_stream_consumers():
    pipeline = SQLAnswer(llm_provider=FakeLLMProvider())

    async def collect_chunks():
        chunks = []
        async for chunk in pipeline.get_streaming_results("query-1"):
            chunks.append(chunk)
        return "".join(chunks)

    consumer_a = asyncio.create_task(collect_chunks())
    consumer_b = asyncio.create_task(collect_chunks())

    await pipeline.run(
        query="问题",
        sql="select 1",
        sql_data={"columns": ["value"], "data": [[1]]},
        language="Simplified Chinese",
        current_time="2026-04-22T00:00:00Z",
        query_id="query-1",
    )

    content_a, content_b = await asyncio.gather(consumer_a, consumer_b)

    assert content_a == "第一段第二段"
    assert content_b == "第一段第二段"
    assert pipeline.get_buffered_content("query-1") == "第一段第二段"


@pytest.mark.asyncio
async def test_sql_answer_service_exposes_content_after_background_generation():
    preprocess_sql_data = SimpleNamespace(
        run=lambda **kwargs: {
            "preprocess": {
                "sql_data": {"columns": ["value"], "data": [[1]]},
                "num_rows_used_in_llm": 1,
            }
        }
    )
    sql_answer_pipeline = FakeAnswerPipeline()
    service = SqlAnswerService(
        pipelines={
            "preprocess_sql_data": preprocess_sql_data,
            "sql_answer": sql_answer_pipeline,
        }
    )
    request = SqlAnswerRequest.model_validate(
        {
            "query": "问题",
            "sql": "select 1",
            "sql_data": {"columns": ["value"], "data": [[1]]},
            "configurations": {"language": "Simplified Chinese"},
            "runtime_scope_id": "scope-1",
        }
    )
    request.query_id = "query-2"

    await service.sql_answer(request)

    for _ in range(20):
        result = service.get_sql_answer_result(
            SqlAnswerResultRequest(query_id="query-2")
        )
        if result.content == "finalized answer":
            break
        await asyncio.sleep(0)

    result = service.get_sql_answer_result(
        SqlAnswerResultRequest(query_id="query-2")
    )

    assert result.status == "succeeded"
    assert result.content == "finalized answer"
    assert result.num_rows_used_in_llm == 1
    assert sql_answer_pipeline.run.await_count == 1
