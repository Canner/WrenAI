import asyncio
import logging
import math
from typing import Dict, Literal, Optional

import orjson
from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import BaseRequest, MetadataTraceable

logger = logging.getLogger("wren-ai-service")


class SemanticsDescription:
    class Resource(BaseModel, MetadataTraceable):
        class Error(BaseModel):
            code: Literal["OTHERS", "MDL_PARSE_ERROR", "RESOURCE_NOT_FOUND"]
            message: str

        id: str
        status: Literal["generating", "finished", "failed"] = "generating"
        response: Optional[dict] = None
        error: Optional[Error] = None
        trace_id: Optional[str] = None
        request_from: Literal["ui", "api"] = "ui"

    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
        generation_timeout_seconds: float = 120.0,
        max_models_per_batch: int = 1,
        max_columns_per_batch: int = 50,
        max_concurrent_tasks: int = 4,
    ):
        self._pipelines = pipelines
        self._cache: Dict[str, self.Resource] = TTLCache(maxsize=maxsize, ttl=ttl)
        self._generation_timeout_seconds = generation_timeout_seconds
        self._max_models_per_batch = max(1, max_models_per_batch)
        self._max_columns_per_batch = max(1, max_columns_per_batch)
        self._max_concurrent_tasks = max(1, max_concurrent_tasks)

    def _handle_exception(
        self,
        id: str,
        error_message: str,
        code: str = "OTHERS",
        trace_id: Optional[str] = None,
        request_from: Literal["ui", "api"] = "ui",
    ):
        self[id] = self.Resource(
            id=id,
            status="failed",
            error=self.Resource.Error(code=code, message=error_message),
            trace_id=trace_id,
            request_from=request_from,
        )
        logger.error(error_message)

    class GenerateRequest(BaseRequest):
        id: str
        selected_models: list[str]
        user_prompt: str
        mdl: str

    def _chunking(
        self,
        mdl_dict: dict,
        request: GenerateRequest,
        chunk_size: Optional[int] = None,
    ) -> list[dict]:
        chunk_size = chunk_size or self._max_models_per_batch
        template = {
            "user_prompt": request.user_prompt,
            "language": request.configurations.language,
        }

        selected_models = [
            model
            for model in mdl_dict.get("models", [])
            if model.get("name") in request.selected_models
        ]

        model_slices: list[tuple[str, dict, int]] = []
        for model in selected_models:
            model_name = model["name"]
            columns = model.get("columns", [])
            column_chunks = [
                columns[j : j + self._max_columns_per_batch]
                for j in range(0, len(columns), self._max_columns_per_batch)
            ] or [[]]

            for column_chunk in column_chunks:
                model_slices.append(
                    (
                        model_name,
                        {**model, "columns": column_chunk},
                        len(column_chunk),
                    )
                )

        chunks = []
        batch_models: list[dict] = []
        batch_model_names: set[str] = set()
        batch_column_count = 0

        def flush_batch():
            nonlocal batch_models, batch_model_names, batch_column_count
            if not batch_models:
                return
            chunks.append(
                {
                    **template,
                    "mdl": {"models": batch_models},
                    "selected_models": [model["name"] for model in batch_models],
                }
            )
            batch_models = []
            batch_model_names = set()
            batch_column_count = 0

        for model_name, model_slice, column_count in model_slices:
            would_exceed_models = len(batch_models) >= chunk_size
            would_exceed_columns = (
                batch_column_count > 0
                and batch_column_count + column_count > self._max_columns_per_batch
            )
            would_repeat_model = model_name in batch_model_names
            if would_exceed_models or would_exceed_columns or would_repeat_model:
                flush_batch()

            batch_models.append(model_slice)
            batch_model_names.add(model_name)
            batch_column_count += column_count

        flush_batch()

        return chunks

    async def _generate_task(self, chunk: dict) -> dict:
        resp = await self._pipelines["semantics_description"].run(**chunk)
        output = resp.get("output") or {}
        if not isinstance(output, dict):
            raise ValueError("Semantics description pipeline returned invalid output")
        return output

    def _chunk_columns(self, chunk: dict) -> list[dict]:
        models = chunk.get("mdl", {}).get("models", [])
        if not models:
            return []
        return models[0].get("columns", []) or []

    def _split_chunk(self, chunk: dict) -> list[dict]:
        columns = self._chunk_columns(chunk)
        if len(columns) <= 1:
            return []

        split_at = max(1, len(columns) // 2)
        model = chunk["mdl"]["models"][0]
        return [
            {
                **chunk,
                "mdl": {"models": [{**model, "columns": column_chunk}]},
            }
            for column_chunk in (columns[:split_at], columns[split_at:])
            if column_chunk
        ]

    def _is_retryable_chunk_error(self, error: Exception) -> bool:
        return "malformed JSON" in str(error)

    async def _generate_task_with_retry_splitting(self, chunk: dict) -> list[dict]:
        try:
            return [await self._generate_task(chunk)]
        except ValueError as e:
            split_chunks = self._split_chunk(chunk)
            if not split_chunks or not self._is_retryable_chunk_error(e):
                raise

            model_name = chunk.get("selected_models", [""])[0]
            logger.warning(
                "Retrying semantics description for model %s with smaller "
                "column chunks after malformed JSON response.",
                model_name,
            )
            outputs: list[dict] = []
            for split_chunk in split_chunks:
                outputs.extend(
                    await self._generate_task_with_retry_splitting(split_chunk)
                )
            return outputs

    async def _generate_chunks(self, chunks: list[dict]) -> list[dict]:
        semaphore = asyncio.Semaphore(self._max_concurrent_tasks)

        async def _bounded_generate(chunk: dict) -> list[dict]:
            async with semaphore:
                return await self._generate_task_with_retry_splitting(chunk)

        output_groups = await asyncio.gather(
            *[_bounded_generate(chunk) for chunk in chunks]
        )
        return [output for group in output_groups for output in group]

    def _request_timeout_seconds(self, chunk_count: int) -> int:
        waves = max(1, math.ceil(chunk_count / self._max_concurrent_tasks))
        return self._generation_timeout_seconds * waves

    def _merge_outputs(
        self, mdl_dict: dict, selected_models: list[str], outputs: list[dict]
    ) -> dict:
        def properties(payload: dict) -> dict:
            value = payload.get("properties")
            return value if isinstance(value, dict) else {}

        def description(payload: dict) -> str:
            value = payload.get("description") or properties(payload).get(
                "description", ""
            )
            return "" if value is None else str(value).strip()

        def normalized_description(value: str) -> str:
            return " ".join(value.casefold().split())

        generated_by_model: dict[str, dict] = {}
        for output in outputs:
            for model_name, model_data in output.items():
                if not isinstance(model_data, dict):
                    continue

                generated = generated_by_model.setdefault(
                    model_name,
                    {
                        "name": model_name,
                        "columns": [],
                        "properties": {},
                    },
                )
                if not description(generated) and description(model_data):
                    generated["properties"] = {
                        **properties(generated),
                        "description": description(model_data),
                    }
                generated.setdefault("columns", [])
                generated["columns"].extend(model_data.get("columns", []))

        response: dict = {}
        for model in mdl_dict.get("models", []):
            model_name = model.get("name")
            if model_name not in selected_models:
                continue

            generated_model = generated_by_model.get(model_name, {})

            model_description = description(generated_model)

            generated_columns: dict[str, dict] = {}
            for column in generated_model.get("columns", []):
                if not isinstance(column, dict):
                    continue

                column_name = column.get("name")
                if not column_name:
                    continue

                if column_name in generated_columns:
                    logger.warning(
                        "Semantics description output duplicated column: %s.%s",
                        model_name,
                        column_name,
                    )
                    continue

                generated_columns[column_name] = column

            columns = []
            used_generated_descriptions: dict[str, str] = {}
            for column in model.get("columns", []):
                if not isinstance(column, dict):
                    continue

                column_name = column.get("name", "")
                generated_column = generated_columns.get(column_name)
                original_description = description(column)
                generated_description = (
                    description(generated_column) if generated_column else ""
                )
                normalized_generated_description = normalized_description(
                    generated_description
                )
                is_repeated_generated_description = (
                    generated_description
                    and normalized_generated_description in used_generated_descriptions
                    and used_generated_descriptions[normalized_generated_description]
                    != column_name
                )
                if is_repeated_generated_description and original_description:
                    logger.warning(
                        "Semantics description output reused description for columns: %s.%s and %s.%s",
                        model_name,
                        used_generated_descriptions[normalized_generated_description],
                        model_name,
                        column_name,
                    )
                    column_description = original_description
                else:
                    column_description = generated_description or original_description
                    if generated_description:
                        used_generated_descriptions.setdefault(
                            normalized_generated_description, column_name
                        )

                if not column_description:
                    logger.warning(
                        "Semantics description output omitted description for column: %s.%s",
                        model_name,
                        column_name,
                    )
                    continue

                columns.append(
                    {
                        "name": column_name,
                        "type": column.get("type", ""),
                        "properties": {
                            "description": column_description,
                        },
                    }
                )

            if not model_description:
                model_description = description(model)
            if not model_description and not columns:
                logger.warning(
                    "Semantics description output omitted selected model: %s",
                    model_name,
                )
                continue

            response[model_name] = {
                "name": model_name,
                "columns": columns,
                "properties": {
                    "description": model_description,
                },
            }

        return response

    @observe(name="Generate Semantics Description")
    @trace_metadata
    async def generate(self, request: GenerateRequest, **kwargs) -> Resource:
        logger.info("Generate Semantics Description pipeline is running...")
        trace_id = kwargs.get("trace_id")
        request_timeout_seconds = self._generation_timeout_seconds

        try:
            mdl_dict = orjson.loads(request.mdl)

            chunks = self._chunking(mdl_dict, request)
            if not chunks:
                raise ValueError(
                    "No selected models matched the current semantic model metadata"
                )
            request_timeout_seconds = self._request_timeout_seconds(len(chunks))
            outputs = await asyncio.wait_for(
                self._generate_chunks(chunks),
                timeout=request_timeout_seconds,
            )

            self[request.id] = self.Resource(
                id=request.id,
                status="finished",
                response=self._merge_outputs(
                    mdl_dict, request.selected_models, list(outputs)
                ),
                trace_id=trace_id,
                request_from=request.request_from,
            )
        except orjson.JSONDecodeError as e:
            self._handle_exception(
                request.id,
                f"Failed to parse MDL: {str(e)}",
                code="MDL_PARSE_ERROR",
                trace_id=trace_id,
                request_from=request.request_from,
            )
        except asyncio.TimeoutError:
            self._handle_exception(
                request.id,
                "Semantics description generation timed out after "
                f"{request_timeout_seconds} seconds",
                trace_id=trace_id,
                request_from=request.request_from,
            )
        except Exception as e:
            self._handle_exception(
                request.id,
                f"An error occurred during semantics description generation: {str(e)}",
                trace_id=trace_id,
                request_from=request.request_from,
            )

        return self[request.id].with_metadata()

    def __getitem__(self, id: str) -> Resource:
        response = self._cache.get(id)

        if response is None:
            message = f"Semantics Description Resource with ID '{id}' not found."
            logger.exception(message)
            return self.Resource(
                id=id,
                status="failed",
                error=self.Resource.Error(code="RESOURCE_NOT_FOUND", message=message),
            )

        return response

    def __setitem__(self, id: str, value: Resource):
        self._cache[id] = value
