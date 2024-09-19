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
    AccuracyMultiCandidateMetric,
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
from src.pipelines.generation import sql_generation
from src.pipelines.indexing import indexing
from src.pipelines.retrieval import retrieval


def deploy_model(mdl: str, pipe: indexing.Indexing) -> None:
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
        columns.extend(parse_ddl(doc))
    return columns


class Eval:
    def __init__(self, meta: dict, candidate_size: int = 1, **_):
        self._meta = meta
        self._candidate_size = candidate_size
        self._batch_size = int(meta["batch_size"])
        self._batch_interval = int(meta["batch_interval"])

    @property
    def candidate_size(self):
        return self._candidate_size

    def predict(self, queries: list) -> List[Dict[str, Any]]:
        def split(queries: list, batch_size: int) -> list[list]:
            return [
                queries[i : i + batch_size] for i in range(0, len(queries), batch_size)
            ]

        async def wrapper(batch: list):
            tasks = [self(query) for query in batch]
            results = await tqdm_asyncio.gather(*tasks, desc="Generating Predictions")
            await asyncio.sleep(self._batch_interval)
            return [prediction for predictions in results for prediction in predictions]

        batches = [
            asyncio.run(wrapper(batch)) for batch in split(queries, self._batch_size)
        ]
        return [prediction for batch in batches for prediction in batch]

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
        llm_provider: LLMProvider,
        embedder_provider: EmbedderProvider,
        document_store_provider: DocumentStoreProvider,
        **kwargs,
    ):
        super().__init__(meta)

        document_store_provider.get_store(recreate_index=True)
        _indexing = indexing.Indexing(
            embedder_provider=embedder_provider,
            document_store_provider=document_store_provider,
        )
        deploy_model(mdl, _indexing)

        self._retrieval = retrieval.Retrieval(
            llm_provider=llm_provider,
            embedder_provider=embedder_provider,
            document_store_provider=document_store_provider,
            table_retrieval_size=meta["table_retrieval_size"],
            table_column_retrieval_size=meta["table_column_retrieval_size"],
        )

    async def _process(self, prediction: dict, **_) -> dict:
        result = await self._retrieval.run(query=prediction["input"])
        documents = result.get("construct_retrieval_results", [])
        prediction["retrieval_context"] = extract_units(documents)

        return prediction

    async def __call__(self, query: str, **_):
        prediction = await self.process(query)

        return [prediction, await self.flat(prediction.copy())]

    @staticmethod
    def mertics(config: dict) -> dict:
        return {
            "metrics": [
                ContextualRecallMetric(config),
                ContextualRelevancyMetric(),
                ContextualPrecisionMetric(),
            ]
        }


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
        self._generation = sql_generation.SQLGeneration(
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
        documents = [Document.from_dict(doc).content for doc in document]
        actual_output = await self._generation.run(
            query=prediction["input"],
            contexts=documents,
            exclude=[],
        )

        prediction["actual_output"] = actual_output
        prediction["retrieval_context"] = extract_units(documents)

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
    def mertics(config: dict, ibis_engine_config: dict) -> dict:
        return {
            "metrics": [
                AccuracyMetric(ibis_engine_config),
                AnswerRelevancyMetric(config),
                FaithfulnessMetric(config),
            ],
            "post_metrics": [AccuracyMultiCandidateMetric()],
        }


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
        super().__init__(meta, 3)

        document_store_provider.get_store(recreate_index=True)
        _indexing = indexing.Indexing(
            embedder_provider=embedder_provider,
            document_store_provider=document_store_provider,
        )
        deploy_model(mdl, _indexing)

        self._mdl = mdl
        self._retrieval = retrieval.Retrieval(
            llm_provider=llm_provider,
            embedder_provider=embedder_provider,
            document_store_provider=document_store_provider,
        )
        self._generation = sql_generation.SQLGeneration(
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
        documents = result.get("construct_retrieval_results", [])
        actual_output = await self._generation.run(
            query=prediction["input"],
            contexts=documents,
            exclude=[],
        )

        prediction["actual_output"] = actual_output
        prediction["retrieval_context"] = extract_units(documents)

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
    def mertics(config: dict, ibis_engine_config: dict) -> dict:
        return {
            "metrics": [
                AccuracyMetric(ibis_engine_config),
                AnswerRelevancyMetric(config),
                FaithfulnessMetric(config),
                ContextualRecallMetric(config),
                ContextualRelevancyMetric(),
                ContextualPrecisionMetric(),
            ],
            "post_metrics": [AccuracyMultiCandidateMetric()],
        }


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


def metrics_initiator(pipeline: str, mdl: dict) -> dict:
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
        "timeout": int(os.getenv("WREN_IBIS_TIMEOUT"))
        if os.getenv("WREN_IBIS_TIMEOUT")
        else 10,
        "limit": 10,
    }

    match pipeline:
        case "retrieval":
            return RetrievalPipeline.mertics(config)
        case "generation":
            return GenerationPipeline.mertics(config, ibis_engine_config)
        case "ask":
            return AskPipeline.mertics(config, ibis_engine_config)
