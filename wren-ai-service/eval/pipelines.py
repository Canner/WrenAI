import asyncio
import re
import sys
from abc import abstractmethod
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Literal

import orjson
from haystack import Document
from langfuse.decorators import langfuse_context, observe
from tqdm.asyncio import tqdm_asyncio

from src.core.pipeline import PipelineComponent

sys.path.append(f"{Path().parent.resolve()}")

from eval import WREN_ENGINE_API_URL, EvalSettings
from eval.metrics import (
    AccuracyMetric,
    AnswerRelevancyMetric,
    ContextualPrecisionMetric,
    ContextualRecallMetric,
    ContextualRelevancyMetric,
    ExactMatchAccuracy,
    ExecutionAccuracy,
    FaithfulnessMetric,
    QuestionToReasoningJudge,
    ReasoningToSqlJudge,
    SqlSemanticsJudge,
)
from eval.utils import (
    engine_config,
    trace_metadata,
)
from src.pipelines import generation, indexing, retrieval


def deploy_model(mdl: str, pipes: list) -> None:
    async def wrapper():
        tasks = [pipe.run(orjson.dumps(mdl).decode()) for pipe in pipes]
        await asyncio.gather(*tasks)

    asyncio.run(wrapper())


def extract_units(ddls: list[str]) -> list:
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

    for ddl in ddls:
        columns.extend(parse_ddl(ddl))

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

    @observe(name="Prediction Process", capture_input=False)
    async def process(self, params: dict) -> dict:
        prediction = {
            "trace_id": langfuse_context.get_current_trace_id(),
            "trace_url": langfuse_context.get_current_trace_url(),
            "input": params["question"],
            "actual_output": {},
            "expected_output": params["sql"],
            "retrieval_context": [],
            "context": params["context"],
            "samples": params.get("samples", []),
            "instructions": params.get("instructions", []),
            "type": "execution",
            "reasoning": "",
            "elapsed_time": 0,
        }

        langfuse_context.update_current_trace(
            session_id=self._meta.get("session_id"),
            user_id=self._meta.get("user_id"),
            metadata=trace_metadata(self._meta, type=prediction["type"]),
        )

        start_time = datetime.now()
        returned = await self._process(prediction, **params)
        returned["elapsed_time"] = (datetime.now() - start_time).total_seconds()

        return returned


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

        self._retrieval = retrieval.DbSchemaRetrieval(
            **pipe_components["db_schema_retrieval"],
            table_retrieval_size=settings.table_retrieval_size,
            table_column_retrieval_size=settings.table_column_retrieval_size,
        )

    async def _process(self, params: dict, **_) -> dict:
        result = await self._retrieval.run(query=params["input"])
        documents = result.get("construct_retrieval_results", {}).get(
            "retrieval_results", []
        )
        table_ddls = [document.get("table_ddl") for document in documents]
        params["retrieval_context"] = extract_units(table_ddls)

        return params

    async def __call__(self, params: dict, **_):
        prediction = await self.process(params)

        return [prediction]

    @staticmethod
    def metrics(engine_info: dict) -> dict:
        wren_engine_info = engine_info.copy()
        wren_engine_info["api_endpoint"] = WREN_ENGINE_API_URL

        return {
            "metrics": [
                ContextualRecallMetric(engine_info=wren_engine_info),
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
        settings: EvalSettings,
        **kwargs,
    ):
        super().__init__(meta)
        self._mdl = mdl
        self._generation = generation.SQLGeneration(
            **pipe_components["sql_generation"],
        )

        self._sql_functions_retrieval = retrieval.SqlFunctions(
            **pipe_components["sql_functions_retrieval"],
        )

        self._allow_sql_samples = settings.allow_sql_samples
        self._allow_instructions = settings.allow_instructions
        self._allow_sql_functions = settings.allow_sql_functions
        self._engine_info = engine_config(
            mdl, pipe_components, settings.eval_data_db_path
        )

    def _get_instructions(self, params: dict) -> list:
        if self._allow_instructions:
            return [
                {"instruction": instruction}
                for instruction in params.get("instructions", [])
            ]
        return []

    def _get_samples(self, params: dict) -> list:
        if self._allow_sql_samples:
            return params.get("samples", [])
        return []

    async def _process(self, params: dict, document: list, **_) -> dict:
        documents = [Document.from_dict(doc).content for doc in document]
        table_ddls = [document.get("table_ddl") for document in documents]

        instructions = self._get_instructions(params)
        samples = self._get_samples(params)

        if self._allow_sql_functions:
            sql_functions = await self._sql_functions_retrieval.run()
        else:
            sql_functions = []

        actual_output = await self._generation.run(
            query=params["input"],
            contexts=table_ddls,
            sql_samples=samples,
            has_calculated_field=params.get("has_calculated_field", False),
            has_metric=params.get("has_metric", False),
            sql_generation_reasoning=params.get("reasoning", ""),
            instructions=instructions,
            sql_functions=sql_functions,
        )

        params["actual_output"] = actual_output
        params["retrieval_context"] = extract_units(table_ddls)

        return params

    async def __call__(self, params: dict, **_):
        return [await self.process(params)]

    @staticmethod
    def metrics(
        engine_info: dict,
        enable_semantics_comparison: bool,
        component: PipelineComponent,
    ) -> dict:
        wren_engine_info = engine_info.copy()
        wren_engine_info["api_endpoint"] = WREN_ENGINE_API_URL

        return {
            "metrics": [
                AccuracyMetric(
                    engine_info=engine_info,
                    enable_semantics_comparison=enable_semantics_comparison,
                ),
                AnswerRelevancyMetric(engine_info=wren_engine_info),
                FaithfulnessMetric(engine_info=wren_engine_info),
                ExactMatchAccuracy(),
                ExecutionAccuracy(),
                QuestionToReasoningJudge(**component),
                ReasoningToSqlJudge(**component),
                SqlSemanticsJudge(**component),
            ],
            "post_metrics": [],
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

        self._retrieval = retrieval.DbSchemaRetrieval(
            **pipe_components["db_schema_retrieval"],
            table_retrieval_size=settings.table_retrieval_size,
            table_column_retrieval_size=settings.table_column_retrieval_size,
        )
        self._sql_reasoner = generation.SQLGenerationReasoning(
            **pipe_components["sql_generation_reasoning"],
        )
        self._sql_functions_retrieval = retrieval.SqlFunctions(
            **pipe_components["sql_functions_retrieval"],
        )
        self._generation = generation.SQLGeneration(
            **pipe_components["sql_generation"],
        )
        self._allow_sql_samples = settings.allow_sql_samples
        self._allow_instructions = settings.allow_instructions
        self._allow_sql_generation_reasoning = settings.allow_sql_generation_reasoning
        self._allow_sql_functions = settings.allow_sql_functions
        self._engine_info = engine_config(
            mdl, pipe_components, settings.eval_data_db_path
        )

    def _get_instructions(self, params: dict) -> list:
        if self._allow_instructions:
            return [
                {"instruction": instruction}
                for instruction in params.get("instructions", [])
            ]
        return []

    def _get_samples(self, params: dict) -> list:
        if self._allow_sql_samples:
            return params.get("samples", [])
        return []

    async def _process(self, params: dict, **_) -> dict:
        result = await self._retrieval.run(query=params["input"])
        _retrieval_result = result.get("construct_retrieval_results", {})

        documents = _retrieval_result.get("retrieval_results", [])
        table_ddls = [document.get("table_ddl") for document in documents]
        has_calculated_field = _retrieval_result.get("has_calculated_field", False)
        has_metric = _retrieval_result.get("has_metric", False)

        instructions = self._get_instructions(params)
        samples = self._get_samples(params)

        if self._allow_sql_generation_reasoning:
            _reasoning = await self._sql_reasoner.run(
                query=params["input"],
                contexts=documents,
                sql_samples=samples,
            )
            reasoning = _reasoning.get("post_process", {})
        else:
            reasoning = ""

        if self._allow_sql_functions:
            sql_functions = await self._sql_functions_retrieval.run()
        else:
            sql_functions = []

        actual_output = await self._generation.run(
            query=params["input"],
            contexts=table_ddls,
            sql_samples=samples,
            has_calculated_field=has_calculated_field,
            has_metric=has_metric,
            sql_generation_reasoning=reasoning,
            instructions=instructions,
            sql_functions=sql_functions,
        )

        params["actual_output"] = actual_output
        params["retrieval_context"] = extract_units(table_ddls)
        params["has_calculated_field"] = has_calculated_field
        params["has_metric"] = has_metric
        params["reasoning"] = reasoning

        return params

    async def __call__(self, params: dict, **_):
        return [await self.process(params)]

    @staticmethod
    def metrics(
        engine_info: dict,
        enable_semantics_comparison: bool,
        component: PipelineComponent,
    ) -> dict:
        wren_engine_info = engine_info.copy()
        wren_engine_info["api_endpoint"] = WREN_ENGINE_API_URL

        return {
            "metrics": [
                AccuracyMetric(
                    engine_info=engine_info,
                    enable_semantics_comparison=enable_semantics_comparison,
                ),
                AnswerRelevancyMetric(engine_info=wren_engine_info),
                FaithfulnessMetric(engine_info=wren_engine_info),
                ContextualRecallMetric(engine_info=wren_engine_info),
                ContextualRelevancyMetric(),
                ContextualPrecisionMetric(),
                ExactMatchAccuracy(),
                ExecutionAccuracy(),
                QuestionToReasoningJudge(**component),
                ReasoningToSqlJudge(**component),
                SqlSemanticsJudge(**component),
            ],
            "post_metrics": [],
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
    dataset: dict,
    pipe_components: dict[str, PipelineComponent],
    enable_semantics_comparison: bool = True,
    settings: EvalSettings = EvalSettings(),
) -> dict:
    engine_info = engine_config(
        dataset["mdl"],
        pipe_components,
        settings.eval_data_db_path,
    )
    component = pipe_components["evaluation"]
    match pipeline:
        case "retrieval":
            return RetrievalPipeline.metrics(engine_info)
        case "generation":
            return GenerationPipeline.metrics(
                engine_info, enable_semantics_comparison, component
            )
        case "ask":
            return AskPipeline.metrics(
                engine_info, enable_semantics_comparison, component
            )
