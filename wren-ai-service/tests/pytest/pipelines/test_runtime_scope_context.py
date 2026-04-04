from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from haystack import Document

from src.pipelines.generation.followup_sql_generation import FollowUpSQLGeneration
from src.pipelines.generation.intent_classification import IntentClassification
from src.pipelines.generation.sql_correction import SQLCorrection
from src.pipelines.generation.sql_generation import SQLGeneration
from src.pipelines.generation.sql_regeneration import SQLRegeneration
from src.pipelines.generation.utils.sql import SQLGenPostProcessor
from src.pipelines.retrieval.db_schema_retrieval import DbSchemaRetrieval
from src.pipelines.retrieval.historical_question_retrieval import (
    HistoricalQuestionRetrieval,
)
from src.pipelines.retrieval.instructions import Instructions
from src.pipelines.retrieval.sql_executor import SQLExecutor
from src.pipelines.retrieval.sql_pairs_retrieval import SqlPairsRetrieval
from src.pipelines.retrieval.sql_functions import SqlFunctions
from src.pipelines.retrieval.sql_knowledge import SqlKnowledges


def _metadata_retriever(data_source: str = "postgres") -> SimpleNamespace:
    return SimpleNamespace(
        run=AsyncMock(
            return_value={
                "documents": [Document(content="metadata", meta={"data_source": data_source})]
            }
        )
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("pipeline_cls", "run_kwargs"),
    [
        (
            SqlFunctions,
            {
                "project_id": " deploy-1 ",
            },
        ),
        (
            SqlKnowledges,
            {
                "project_id": " deploy-1 ",
            },
        ),
    ],
)
async def test_metadata_retrieval_pipelines_normalize_runtime_scope_and_data_source(
    pipeline_cls,
    run_kwargs,
):
    pipeline = pipeline_cls.__new__(pipeline_cls)
    pipeline._retriever = _metadata_retriever()
    pipeline._cache = {}
    pipeline._components = {}
    pipeline._pipe = SimpleNamespace(execute=AsyncMock(return_value={"cache": "cached"}))

    result = await pipeline.run(**run_kwargs)

    assert result == "cached"
    assert pipeline._pipe.execute.await_args.kwargs["inputs"]["project_id"] == "deploy-1"
    assert pipeline._pipe.execute.await_args.kwargs["inputs"]["data_source"] == "postgres"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("pipeline_cls", "run_kwargs"),
    [
        (
            SQLGeneration,
            {
                "query": "q",
                "contexts": ["ctx"],
                "project_id": " deploy-1 ",
                "use_dry_plan": True,
            },
        ),
        (
            SQLCorrection,
            {
                "contexts": ["ctx"],
                "invalid_generation_result": {"sql": "select 1", "error": "boom"},
                "project_id": " deploy-1 ",
                "use_dry_plan": True,
            },
        ),
        (
            FollowUpSQLGeneration,
            {
                "query": "q",
                "contexts": ["ctx"],
                "sql_generation_reasoning": "reason",
                "histories": [],
                "project_id": " deploy-1 ",
                "use_dry_plan": True,
            },
        ),
    ],
)
async def test_sql_pipelines_use_normalized_runtime_scope_for_dry_plan(
    pipeline_cls,
    run_kwargs,
):
    pipeline = pipeline_cls.__new__(pipeline_cls)
    pipeline._retriever = _metadata_retriever()
    pipeline._components = {}
    pipeline._pipe = SimpleNamespace(execute=AsyncMock(return_value={"ok": True}))

    await pipeline.run(**run_kwargs)

    inputs = pipeline._pipe.execute.await_args.kwargs["inputs"]
    assert inputs["project_id"] == "deploy-1"
    assert inputs["data_source"] == "postgres"


@pytest.mark.asyncio
async def test_sql_regeneration_normalizes_runtime_scope_before_post_process():
    pipeline = SQLRegeneration.__new__(SQLRegeneration)
    pipeline._components = {}
    pipeline._pipe = SimpleNamespace(execute=AsyncMock(return_value={"ok": True}))

    await pipeline.run(
        contexts=["ctx"],
        sql_generation_reasoning="reason",
        sql="select 1",
        project_id=" deploy-1 ",
    )

    assert (
        pipeline._pipe.execute.await_args.kwargs["inputs"]["project_id"] == "deploy-1"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("pipeline_cls", "run_kwargs"),
    [
        (
            HistoricalQuestionRetrieval,
            {
                "query": "q",
                "project_id": " deploy-1 ",
            },
        ),
        (
            Instructions,
            {
                "query": "q",
                "project_id": " deploy-1 ",
                "scope": "sql",
            },
        ),
        (
            SqlPairsRetrieval,
            {
                "query": "q",
                "project_id": " deploy-1 ",
            },
        ),
        (
            DbSchemaRetrieval,
            {
                "query": "q",
                "project_id": " deploy-1 ",
                "tables": ["orders"],
            },
        ),
        (
            IntentClassification,
            {
                "query": "q",
                "project_id": " deploy-1 ",
            },
        ),
        (
            SQLExecutor,
            {
                "sql": "select 1",
                "project_id": " deploy-1 ",
            },
        ),
    ],
)
async def test_pipeline_run_normalizes_runtime_scope_before_execute(
    pipeline_cls,
    run_kwargs,
):
    pipeline = pipeline_cls.__new__(pipeline_cls)
    pipeline._components = {}
    pipeline._configs = {}
    pipeline._pipe = SimpleNamespace(execute=AsyncMock(return_value={"ok": True}))

    await pipeline.run(**run_kwargs)

    assert pipeline._pipe.execute.await_args.kwargs["inputs"]["project_id"] == (
        "deploy-1"
    )


class _DummyClientSession:
    async def __aenter__(self):
        return object()

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.mark.asyncio
async def test_sql_gen_post_processor_normalizes_runtime_scope_before_engine_execute(
    monkeypatch,
):
    monkeypatch.setattr(
        "src.pipelines.generation.utils.sql.aiohttp.ClientSession",
        lambda: _DummyClientSession(),
    )

    engine = SimpleNamespace(
        execute_sql=AsyncMock(
            return_value=(True, [], {"correlation_id": "corr-1"})
        )
    )
    post_processor = SQLGenPostProcessor(engine=engine)

    await post_processor.run(
        replies=['{"sql":"select 1"}'],
        project_id=" deploy-1 ",
    )

    assert engine.execute_sql.await_args.kwargs["project_id"] == "deploy-1"
