import asyncio
import logging
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
    ):
        self._pipelines = pipelines
        self._cache: Dict[str, self.Resource] = TTLCache(maxsize=maxsize, ttl=ttl)

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
        self, mdl_dict: dict, request: GenerateRequest, chunk_size: int = 50
    ) -> list[dict]:
        template = {
            "user_prompt": request.user_prompt,
            "language": request.configurations.language,
        }

        chunks = [
            {
                **model,
                "columns": model["columns"][i : i + chunk_size],
            }
            for model in mdl_dict["models"]
            if model["name"] in request.selected_models
            for i in range(0, len(model["columns"]), chunk_size)
        ]

        return [
            {
                **template,
                "mdl": {"models": [chunk]},
                "selected_models": [chunk["name"]],
            }
            for chunk in chunks
        ]

    def _description(self, payload: dict) -> str:
        properties = payload.get("properties")
        if not isinstance(properties, dict):
            properties = {}
        value = payload.get("description") or properties.get("description", "")
        return "" if value is None else str(value).strip()

    def _validate_chunk_output(self, chunk: dict, output: dict) -> dict:
        if not isinstance(output, dict):
            raise ValueError("Semantics description pipeline returned invalid output")

        selected_models = set(chunk.get("selected_models", []))
        models = {
            model.get("name"): model
            for model in chunk.get("mdl", {}).get("models", [])
            if model.get("name") in selected_models
        }

        for model_name, model in models.items():
            generated_model = output.get(model_name)
            if not isinstance(generated_model, dict):
                raise ValueError(
                    f"Semantics description output omitted selected model: {model_name}"
                )

            if not self._description(generated_model):
                raise ValueError(
                    "Semantics description output omitted description for model: "
                    f"{model_name}"
                )

            generated_columns = {
                column.get("name"): column
                for column in generated_model.get("columns", [])
                if isinstance(column, dict) and column.get("name")
            }

            for column in model.get("columns", []):
                if not isinstance(column, dict):
                    continue

                column_name = column.get("name", "")
                generated_column = generated_columns.get(column_name)
                if not generated_column:
                    raise ValueError(
                        "Semantics description output omitted selected column: "
                        f"{model_name}.{column_name}"
                    )

                if not self._description(generated_column):
                    raise ValueError(
                        "Semantics description output omitted description for column: "
                        f"{model_name}.{column_name}"
                    )

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
        message = str(error)
        return (
            "malformed JSON" in message
            or "omitted selected model" in message
            or "omitted description for model" in message
            or "omitted selected column" in message
            or "omitted description for column" in message
        )

    async def _generate_chunk(self, chunk: dict) -> dict:
        resp = await self._pipelines["semantics_description"].run(**chunk)
        output = resp.get("output") or {}
        return self._validate_chunk_output(chunk, output)

    async def _generate_chunk_with_retry_splitting(self, chunk: dict) -> list[dict]:
        try:
            return [await self._generate_chunk(chunk)]
        except ValueError as e:
            split_chunks = self._split_chunk(chunk)
            if not split_chunks or not self._is_retryable_chunk_error(e):
                raise

            model_name = chunk.get("selected_models", [""])[0]
            logger.warning(
                "Retrying semantics description for model %s with smaller "
                "column chunks after incomplete or malformed response.",
                model_name,
            )
            outputs: list[dict] = []
            for split_chunk in split_chunks:
                outputs.extend(
                    await self._generate_chunk_with_retry_splitting(split_chunk)
                )
            return outputs

    def _merge_output(self, request_id: str, output: dict):
        current = self[request_id]
        current.response = current.response or {}

        for key in output.keys():
            if key not in current.response:
                current.response[key] = output[key]
                continue

            current.response[key]["columns"].extend(output[key]["columns"])

    async def _generate_task(self, request_id: str, chunk: dict):
        outputs = await self._generate_chunk_with_retry_splitting(chunk)
        for output in outputs:
            self._merge_output(request_id, output)

    @observe(name="Generate Semantics Description")
    @trace_metadata
    async def generate(self, request: GenerateRequest, **kwargs) -> Resource:
        logger.info("Generate Semantics Description pipeline is running...")
        trace_id = kwargs.get("trace_id")

        try:
            mdl_dict = orjson.loads(request.mdl)

            chunks = self._chunking(mdl_dict, request)
            tasks = [self._generate_task(request.id, chunk) for chunk in chunks]

            await asyncio.gather(*tasks)

            self[request.id].status = "finished"
            self[request.id].trace_id = trace_id
            self[request.id].request_from = request.request_from
        except orjson.JSONDecodeError as e:
            self._handle_exception(
                request.id,
                f"Failed to parse MDL: {str(e)}",
                code="MDL_PARSE_ERROR",
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
