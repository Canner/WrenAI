import asyncio
import os
import re
import sys
from abc import abstractmethod
from pathlib import Path
from typing import Any, Dict, List, Literal

import orjson
from haystack import Document
from langfuse.decorators import langfuse_context, observe
from tqdm.asyncio import tqdm_asyncio

sys.path.append(f"{Path().parent.resolve()}")

from eval.metrics.column import (
    AccuracyMetric,
    AnswerRelevancyMetric,
    ContextualPrecisionMetric,
    ContextualRecallMetric,
    ContextualRelevancyMetric,
    FaithfulnessMetric,
)
from eval.utils import (
    engine_config,
    get_contexts_from_sql,
    trace_metadata,
)
from src.core.engine import Engine
from src.core.provider import DocumentStoreProvider, EmbedderProvider, LLMProvider
from src.pipelines.ask import generation, retrieval
from src.pipelines.indexing import indexing


def deploy_model(mdl: str, pipe) -> None:
    async def wrapper():
        await pipe.run(orjson.dumps(mdl).decode())

    asyncio.run(wrapper())


def extract_units(docs: list) -> list:
    def parse_ddl(ddl: str) -> list:
        """
        Parses a DDL statement and returns a list of column definitions in the format table_name.column_name, excluding foreign keys.

        Args:
            ddl (str): The DDL statement to parse.

        Returns:
            list: A list of column definitions in the format table_name.column_name.
        """
        # Regex to extract table name
        table_name_match = re.search(r"CREATE TABLE (\w+)", ddl, re.IGNORECASE)
        table_name = table_name_match.group(1) if table_name_match else None

        # Split the DDL into lines
        lines = ddl.splitlines()
        # Define a regex pattern to match foreign key constraints and comments
        foreign_key_pattern = re.compile(r"^\s*FOREIGN KEY", re.IGNORECASE)
        comment_pattern = re.compile(r"^\s*--|/\*|\*/")

        # Filter out lines that define foreign keys or are comments
        columns = [
            line.strip()
            for line in lines
            if not foreign_key_pattern.match(line)
            and not comment_pattern.match(line)
            and line.strip()
        ]

        # Extract column names and format with table name as prefix
        if table_name:
            columns = [
                f"{table_name}.{line.split()[0]}"
                for line in columns
                if line and line.split()[0] != "CREATE" and line.split()[0] != ");"
            ]

        return columns

    columns = []
    for doc in docs:
        columns.extend(parse_ddl(doc["content"]))
    return columns


class Eval:
    def __init__(self, meta: dict, candidate_size: int = 1, **_):
        self._meta = meta
        self._candidate_size = candidate_size

    @property
    def candidate_size(self):
        return self._candidate_size

    def predict(self, queries: list) -> List[Dict[str, Any]]:
        async def wrapper():
            tasks = [self(query) for query in queries]
            results = await tqdm_asyncio.gather(*tasks, desc="Generating Predictions")
            return [prediction for predictions in results for prediction in predictions]

        return asyncio.run(wrapper())

    @abstractmethod
    def _process(self, prediction: dict, **_) -> dict:
        ...

    async def _flat(self, prediction: dict, **_) -> dict:
        """
        No operation function to be overridden by subclasses,if needed.
        """
        return prediction

    @observe(name="Prediction Process", capture_input=False)
    async def process(self, query: dict) -> dict:
        prediction = {
            "trace_id": langfuse_context.get_current_trace_id(),
            "trace_url": langfuse_context.get_current_trace_url(),
            "input": query["question"],
            "actual_output": {},
            "expected_output": query["sql"],
            "retrieval_context": [],
            "context": query["context"],
            "type": "execution",
        }

        langfuse_context.update_current_trace(
            session_id=self._meta["session_id"],
            user_id=self._meta["user_id"],
            metadata=trace_metadata(self._meta, type=prediction["type"]),
        )

        return await self._process(prediction, **query)

    @observe(capture_input=False)
    async def flat(self, prediction: dict, **kwargs) -> dict:
        prediction["source_trace_id"] = prediction["trace_id"]
        prediction["source_trace_url"] = prediction["trace_url"]
        prediction["trace_id"] = langfuse_context.get_current_trace_id()
        prediction["trace_url"] = langfuse_context.get_current_trace_url()
        prediction["type"] = "shallow"

        langfuse_context.update_current_trace(
            name=f"Prediction Process - Shallow Trace for {prediction['input']} ",
            session_id=self._meta["session_id"],
            user_id=self._meta["user_id"],
            metadata={
                **trace_metadata(self._meta, type=prediction["type"]),
                "source_trace_id": prediction["source_trace_id"],
                "source_trace_url": prediction["source_trace_url"],
            },
        )

        return await self._flat(prediction, **kwargs)


class RetrievalPipeline(Eval):
    def __init__(
        self,
        meta: dict,
        mdl: dict,
        embedder_provider: EmbedderProvider,
        document_store_provider: DocumentStoreProvider,
        **kwargs,
    ):
        document_store_provider.get_store(recreate_index=True)
        _indexing = indexing.Indexing(
            embedder_provider=embedder_provider,
            document_store_provider=document_store_provider,
        )
        deploy_model(mdl, _indexing)

        super().__init__(meta)
        self._retrieval = retrieval.Retrieval(
            embedder_provider=embedder_provider,
            document_store_provider=document_store_provider,
        )

    async def _process(self, prediction: dict, **_) -> dict:
        result = await self._retrieval.run(query=prediction["input"])
        documents = result.get("retrieval", {}).get("documents", [])

        prediction["retrieval_context"] = extract_units(
            [doc.to_dict() for doc in documents]
        )

        return prediction

    async def __call__(self, query: str, **_):
        prediction = await self.process(query)

        return [prediction, await self.flat(prediction.copy())]

    @staticmethod
    def mertics(config: dict):
        return [
            ContextualRecallMetric(config),
            ContextualRelevancyMetric(),
            ContextualPrecisionMetric(),
        ]


class GenerationPipeline(Eval):
    def __init__(
        self,
        meta: dict,
        mdl: dict,
        llm_provider: LLMProvider,
        engine: Engine,
        **kwargs,
    ):
        super().__init__(meta, 3)
        self._mdl = mdl
        self._generation = generation.Generation(
            llm_provider=llm_provider,
            engine=engine,
        )

    async def _flat(self, prediction: dict, actual: str) -> dict:
        prediction["actual_output"] = actual
        prediction["actual_output_units"] = await get_contexts_from_sql(
            sql=actual["sql"], **engine_config(self._mdl)
        )

        return prediction

    async def _process(self, prediction: dict, document: list, **_) -> dict:
        documents = [Document.from_dict(doc) for doc in document]
        actual_output = await self._generation.run(
            query=prediction["input"],
            contexts=documents,
            exclude=[],
        )

        prediction["actual_output"] = actual_output
        prediction["retrieval_context"] = extract_units(
            [doc.to_dict() for doc in documents]
        )

        return prediction

    async def __call__(self, query: str, **_):
        prediction = await self.process(query)
        valid_outputs = (
            prediction["actual_output"]
            .get("post_process", {})
            .get("valid_generation_results", [])
        )

        return [prediction] + [
            await self.flat(prediction.copy(), actual=actual)
            for actual in valid_outputs
        ]

    @staticmethod
    def mertics(config: dict, ibis_engine_config: dict):
        return [
            AccuracyMetric(ibis_engine_config),
            AnswerRelevancyMetric(config),
        ]


class AskPipeline(Eval):
    def __init__(
        self,
        meta: dict,
        mdl: dict,
        llm_provider: LLMProvider,
        embedder_provider: EmbedderProvider,
        document_store_provider: DocumentStoreProvider,
        engine: Engine,
        **kwargs,
    ):
        document_store_provider.get_store(recreate_index=True)
        _indexing = indexing.Indexing(
            embedder_provider=embedder_provider,
            document_store_provider=document_store_provider,
        )
        deploy_model(mdl, _indexing)
        super().__init__(meta, 3)

        self._mdl = mdl
        self._retrieval = retrieval.Retrieval(
            embedder_provider=embedder_provider,
            document_store_provider=document_store_provider,
        )
        self._generation = generation.Generation(
            llm_provider=llm_provider,
            engine=engine,
        )

    async def _flat(self, prediction: dict, actual: str) -> dict:
        prediction["actual_output"] = actual
        prediction["actual_output_units"] = await get_contexts_from_sql(
            sql=actual["sql"], **engine_config(self._mdl)
        )
        return prediction

    async def _process(self, prediction: dict, **_) -> dict:
        result = await self._retrieval.run(query=prediction["input"])
        documents = result.get("retrieval", {}).get("documents", [])
        actual_output = await self._generation.run(
            query=prediction["input"],
            contexts=documents,
            exclude=[],
        )

        prediction["actual_output"] = actual_output
        prediction["retrieval_context"] = extract_units(
            [doc.to_dict() for doc in documents]
        )

        return prediction

    async def __call__(self, query: str, **_):
        prediction = await self.process(query)
        valid_outputs = (
            prediction["actual_output"]
            .get("post_process", {})
            .get("valid_generation_results", [])
        )

        return [prediction] + [
            await self.flat(prediction.copy(), actual=actual)
            for actual in valid_outputs
        ]

    @staticmethod
    def mertics(config: dict, ibis_engine_config: dict):
        return [
            AccuracyMetric(ibis_engine_config),
            AnswerRelevancyMetric(config),
            FaithfulnessMetric(config),
            ContextualRecallMetric(config),
            ContextualRelevancyMetric(),
            ContextualPrecisionMetric(),
        ]


def init(
    name: Literal["retrieval", "generation", "ask"],
    meta: dict,
    mdl: dict,
    providers: Dict[str, Any],
) -> Eval:
    args = {"meta": meta, "mdl": mdl, **providers}
    match name:
        case "retrieval":
            return RetrievalPipeline(**args)
        case "generation":
            return GenerationPipeline(**args)
        case "ask":
            return AskPipeline(**args)
        case _:
            raise ValueError(f"Invalid pipeline name: {name}")


def metrics_initiator(pipeline: str, mdl: dict) -> list:
    config = engine_config(mdl)
    ibis_engine_config = {
        "api_endpoint": os.getenv("WREN_IBIS_ENDPOINT"),
        "data_source": "bigquery",
        "mdl_json": mdl,
        "connection_info": {
            "project_id": os.getenv("bigquery.project-id"),
            "dataset_id": os.getenv("bigquery.dataset-id"),
            "credentials": os.getenv("bigquery.credentials-key"),
        },
        "timeout": 10,
        "limit": 10,
    }

    match pipeline:
        case "retrieval":
            return RetrievalPipeline.mertics(config)
        case "generation":
            return GenerationPipeline.mertics(config, ibis_engine_config)
        case "ask":
            return AskPipeline.mertics(config, ibis_engine_config)
