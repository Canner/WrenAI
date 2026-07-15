import asyncio
import logging
from typing import Any, Dict, Literal, Optional

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
        generation_timeout_seconds: int = 90,
    ):
        self._pipelines = pipelines
        self._cache: Dict[str, self.Resource] = TTLCache(maxsize=maxsize, ttl=ttl)
        self._generation_timeout_seconds = generation_timeout_seconds

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

    def _properties(self, payload: dict[str, Any]) -> dict[str, Any]:
        properties = payload.get("properties")
        return properties if isinstance(properties, dict) else {}

    def _text(self, value: Any) -> str:
        return "" if value is None else str(value)

    def _fallback_output(self, chunk: dict[str, Any]) -> dict[str, Any]:
        output: dict[str, Any] = {}
        for model in chunk.get("mdl", {}).get("models", []):
            model_name = self._text(model.get("name", ""))
            if not model_name:
                continue

            model_properties = self._properties(model)
            model_description = self._text(model_properties.get("description", ""))
            if not model_description:
                model_description = (
                    f"Represents {model_name.replace('_', ' ')} records in this dataset."
                )

            columns = []
            for column in model.get("columns", []) or []:
                if column.get("relationship"):
                    continue
                column_name = self._text(column.get("name", ""))
                if not column_name:
                    continue
                column_properties = self._properties(column)
                column_description = self._text(
                    column_properties.get("description", "")
                )
                if not column_description:
                    column_description = (
                        f"{column_name.replace('_', ' ')} field from {model_name}."
                    )
                columns.append(
                    {
                        "name": column_name,
                        "type": self._text(column.get("type", "")),
                        "properties": {"description": column_description},
                    }
                )

            output[model_name] = {
                "name": model_name,
                "columns": columns,
                "properties": {"description": model_description},
            }
        return output

    def _chunking(
        self, mdl_dict: dict, request: GenerateRequest, chunk_size: int = 50
    ) -> list[dict]:
        template = {
            "user_prompt": request.user_prompt,
            "language": request.configurations.language,
        }

        chunks: list[dict[str, Any]] = []
        selected_models = set(request.selected_models)
        current_models: list[dict[str, Any]] = []
        current_column_count = 0

        def _flush_current_models():
            nonlocal current_models, current_column_count
            if not current_models:
                return
            chunks.append({"models": current_models})
            current_models = []
            current_column_count = 0

        def _append_model(model: dict[str, Any]):
            nonlocal current_models, current_column_count
            column_count = len(model.get("columns") or [])
            if current_models and current_column_count + column_count > chunk_size:
                _flush_current_models()
            current_models.append(model)
            current_column_count += column_count

        for model in mdl_dict.get("models", []):
            model_name = model.get("name")
            if model_name not in selected_models:
                continue

            columns = model.get("columns") or []
            if not columns:
                _append_model({**model, "columns": []})
                continue

            for i in range(0, len(columns), chunk_size):
                _append_model({**model, "columns": columns[i : i + chunk_size]})

        _flush_current_models()

        return [
            {
                **template,
                "mdl": chunk,
                "selected_models": [model["name"] for model in chunk["models"]],
            }
            for chunk in chunks
        ]

    async def _generate_task(self, request_id: str, chunk: dict):
        try:
            logger.info(
                "Calling configured LLM for semantics descriptions. "
                "models=%s timeout_seconds=%s",
                chunk.get("selected_models", []),
                self._generation_timeout_seconds,
            )
            resp = await asyncio.wait_for(
                self._pipelines["semantics_description"].run(**chunk),
                timeout=self._generation_timeout_seconds,
            )
            output = resp.get("output")
            if not output:
                logger.warning(
                    "Configured LLM returned empty semantics output; "
                    "returning metadata-based fallback descriptions."
                )
                output = self._fallback_output(chunk)
        except TimeoutError:
            logger.warning(
                "Semantics description LLM call timed out after %s seconds; "
                "returning metadata-based fallback descriptions.",
                self._generation_timeout_seconds,
            )
            output = self._fallback_output(chunk)

        if not isinstance(output, dict):
            raise ValueError("Semantics description pipeline returned no output")

        current = self[request_id]
        current.response = current.response or {}

        for key in output.keys():
            if key not in current.response:
                current.response[key] = output[key]
                continue

            current.response[key].setdefault("columns", [])
            current.response[key]["columns"].extend(output[key].get("columns", []))

    @observe(name="Generate Semantics Description")
    @trace_metadata
    async def generate(self, request: GenerateRequest, **kwargs) -> Resource:
        logger.info("Generate Semantics Description pipeline is running...")
        trace_id = kwargs.get("trace_id")

        try:
            mdl_dict = orjson.loads(request.mdl)

            chunks = self._chunking(mdl_dict, request)
            if not chunks:
                raise ValueError(
                    "No selected models matched the current semantic model metadata"
                )
            for chunk in chunks:
                await self._generate_task(request.id, chunk)

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
