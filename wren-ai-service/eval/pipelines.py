import asyncio
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

from eval import EvalSettings
from eval.metrics import (
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
from src.pipelines import generation, indexing, retrieval


def deploy_model(mdl: str, pipes: list) -> None:
    async def wrapper():
        tasks = [pipe.run(orjson.dumps(mdl).decode()) for pipe in pipes]
        await asyncio.gather(*tasks)

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
            "samples": query.get("samples", []),
            "type": "execution",
        }

        langfuse_context.update_current_trace(
            session_id=self._meta.get("session_id"),
            user_id=self._meta.get("user_id"),
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
            session_id=self._meta.get("session_id"),
            user_id=self._meta.get("user_id"),
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
        pipe_components: dict,
        settings: EvalSettings,
        **kwargs,
    ):
        super().__init__(meta)

        _db_schema_indexing = indexing.DBSchema(
            **pipe_components["db_schema_indexing"],
            column_batch_size=settings.column_indexing_batch_size,
        )
        _table_description_indexing = indexing.TableDescription(
            **pipe_components["table_description_indexing"],
        )
        deploy_model(mdl, [_db_schema_indexing, _table_description_indexing])

        self._retrieval = retrieval.Retrieval(
            **pipe_components["db_schema_retrieval"],
            table_retrieval_size=settings.table_retrieval_size,
            table_column_retrieval_size=settings.table_column_retrieval_size,
            allow_using_db_schemas_without_pruning=settings.allow_using_db_schemas_without_pruning,
        )

    async def _process(self, prediction: dict, **_) -> dict:
        result = await self._retrieval.run(query=prediction["input"])
        documents = result.get("construct_retrieval_results", {}).get(
            "retrieval_results", []
        )
        prediction["retrieval_context"] = extract_units(documents)

        return prediction

    async def __call__(self, query: str, **_):
        prediction = await self.process(query)

        return [prediction, await self.flat(prediction.copy())]

    @staticmethod
    def metrics(engine_info: dict) -> dict:
        return {
            "metrics": [
                ContextualRecallMetric(engine_info=engine_info),
                ContextualRelevancyMetric(),
                ContextualPrecisionMetric(),
            ]
        }


class GenerationPipeline(Eval):
    def __init__(
        self,
        meta: dict,
        mdl: dict,
        pipe_components: dict,
        **kwargs,
    ):
        super().__init__(meta)
        self._mdl = mdl
        self._generation = generation.SQLGeneration(
            **pipe_components["sql_generation"],
        )

        self._engine_info = engine_config(mdl, pipe_components)

    async def _flat(self, prediction: dict, actual: str) -> dict:
        prediction["actual_output"] = actual
        prediction["actual_output_units"] = await get_contexts_from_sql(
            sql=actual["sql"], **self._engine_info
        )

        return prediction

    async def _process(self, prediction: dict, document: list, **_) -> dict:
        documents = [Document.from_dict(doc).content for doc in document]
        actual_output = await self._generation.run(
            query=prediction["input"],
            contexts=documents,
            samples=prediction["samples"],
            has_calculated_field=prediction.get("has_calculated_field", False),
            has_metric=prediction.get("has_metric", False),
            sql_generation_reasoning=prediction.get("reasoning", ""),
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
    def metrics(engine_info: dict, enable_semantics_comparison: bool) -> dict:
        return {
            "metrics": [
                AccuracyMetric(
                    engine_info=engine_info,
                    enable_semantics_comparison=enable_semantics_comparison,
                ),
                AnswerRelevancyMetric(engine_info=engine_info),
                FaithfulnessMetric(engine_info=engine_info),
                # this is for spider dataset, rn we temporarily disable it
                # ExactMatchAccuracy(),
                # ExecutionAccuracy(),
            ],
            "post_metrics": [AccuracyMultiCandidateMetric()],
        }


class AskPipeline(Eval):
    def __init__(
        self,
        meta: dict,
        mdl: dict,
        pipe_components: dict,
        settings: EvalSettings,
        **kwargs,
    ):
        super().__init__(meta)

        _db_schema_indexing = indexing.DBSchema(
            **pipe_components["db_schema_indexing"],
            column_batch_size=settings.column_indexing_batch_size,
        )
        _table_description_indexing = indexing.TableDescription(
            **pipe_components["table_description_indexing"],
        )
        deploy_model(mdl, [_db_schema_indexing, _table_description_indexing])

        self._retrieval = retrieval.Retrieval(
            **pipe_components["db_schema_retrieval"],
            table_retrieval_size=settings.table_retrieval_size,
            table_column_retrieval_size=settings.table_column_retrieval_size,
            allow_using_db_schemas_without_pruning=settings.allow_using_db_schemas_without_pruning,
        )
        self._generation = generation.SQLGeneration(
            **pipe_components["sql_generation"],
        )

        self._engine_info = engine_config(mdl, pipe_components)

    async def _flat(self, prediction: dict, actual: str) -> dict:
        prediction["actual_output"] = actual
        prediction["actual_output_units"] = await get_contexts_from_sql(
            sql=actual["sql"], **self._engine_info
        )
        return prediction

    async def _process(self, prediction: dict, **_) -> dict:
        result = await self._retrieval.run(query=prediction["input"])
        _retrieval_result = result.get("construct_retrieval_results", {})

        documents = _retrieval_result.get("retrieval_results", [])
        has_calculated_field = _retrieval_result.get("has_calculated_field", False)
        has_metric = _retrieval_result.get("has_metric", False)
        actual_output = await self._generation.run(
            query=prediction["input"],
            contexts=documents,
            sql_samples=[],
            has_calculated_field=has_calculated_field,
            has_metric=has_metric,
            sql_generation_reasoning=prediction.get("reasoning", ""),
        )

        prediction["actual_output"] = actual_output
        prediction["retrieval_context"] = extract_units(documents)
        prediction["has_calculated_field"] = has_calculated_field
        prediction["has_metric"] = has_metric

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
    def metrics(engine_info: dict, enable_semantics_comparison: bool) -> dict:
        return {
            "metrics": [
                AccuracyMetric(
                    engine_info=engine_info,
                    enable_semantics_comparison=enable_semantics_comparison,
                ),
                AnswerRelevancyMetric(engine_info=engine_info),
                FaithfulnessMetric(engine_info=engine_info),
                ContextualRecallMetric(engine_info=engine_info),
                ContextualRelevancyMetric(),
                ContextualPrecisionMetric(),
                # this is for spider dataset, rn we temporarily disable it
                # ExactMatchAccuracy(),
                # ExecutionAccuracy(),
            ],
            "post_metrics": [AccuracyMultiCandidateMetric()],
        }


def init(
    name: Literal["retrieval", "generation", "ask"],
    meta: dict,
    mdl: dict,
    components: Dict[str, Any],
    settings: EvalSettings,
) -> Eval:
    args = {
        "meta": meta,
        "mdl": mdl,
        "pipe_components": components,
        "settings": settings,
    }

    match name:
        case "retrieval":
            return RetrievalPipeline(**args)
        case "generation":
            return GenerationPipeline(**args)
        case "ask":
            return AskPipeline(**args)
        case _:
            raise ValueError(f"Invalid pipeline name: {name}")


def metrics_initiator(
    pipeline: str,
    engine_info: dict,
    enable_semantics_comparison: bool = True,
) -> dict:
    match pipeline:
        case "retrieval":
            return RetrievalPipeline.metrics(engine_info)
        case "generation":
            return GenerationPipeline.metrics(engine_info, enable_semantics_comparison)
        case "ask":
            return AskPipeline.metrics(engine_info, enable_semantics_comparison)
