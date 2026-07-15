import asyncio
import logging
import re
from typing import Any, Dict, Literal, Optional

import orjson
from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import BaseRequest, MetadataTraceable

logger = logging.getLogger("wren-ai-service")


class RelationshipRecommendation:
    class Input(BaseRequest):
        id: str
        mdl: str

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
        generation_timeout_seconds: int = 45,
    ):
        self._pipelines = pipelines
        self._cache: Dict[str, RelationshipRecommendation.Resource] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )
        self._generation_timeout_seconds = generation_timeout_seconds

    def _normalize_identifier(self, value: Any) -> str:
        text = "" if value is None else str(value)
        text = re.sub(r"[^a-zA-Z0-9]", "", text).lower()
        return text[:-1] if text.endswith("s") else text

    def _fallback_relationships(self, mdl: dict) -> dict:
        models = mdl.get("models", []) or []
        existing = {
            (
                relationship.get("models", [None, None])[0],
                relationship.get("condition", ""),
                relationship.get("joinType", ""),
            )
            for relationship in mdl.get("relationships", []) or []
        }
        candidates = []

        model_lookup = {
            self._normalize_identifier(model.get("name")): model for model in models
        }

        for from_model in models:
            from_model_name = from_model.get("name")
            if not from_model_name:
                continue

            for column in from_model.get("columns", []) or []:
                if column.get("relationship"):
                    continue

                from_column = column.get("name")
                if not from_column:
                    continue

                normalized_column = self._normalize_identifier(from_column)
                if not normalized_column.endswith("id") or normalized_column == "id":
                    continue

                target_key = normalized_column[:-2]
                to_model = model_lookup.get(target_key)
                if not to_model or to_model.get("name") == from_model_name:
                    continue

                to_model_name = to_model.get("name")
                to_columns = to_model.get("columns", []) or []
                primary_key = to_model.get("primaryKey")
                to_column = next(
                    (
                        item.get("name")
                        for item in to_columns
                        if item.get("name") == primary_key
                    ),
                    None,
                )
                to_column = to_column or next(
                    (
                        item.get("name")
                        for item in to_columns
                        if self._normalize_identifier(item.get("name")) == "id"
                    ),
                    None,
                )
                if not to_column:
                    continue

                signature = (
                    from_model_name,
                    f"{from_model_name}.{from_column} = {to_model_name}.{to_column}",
                    "MANY_TO_ONE",
                )
                if signature in existing:
                    continue

                candidates.append(
                    {
                        "name": f"{from_model_name}_{to_model_name}",
                        "fromModel": from_model_name,
                        "fromColumn": from_column,
                        "type": "MANY_TO_ONE",
                        "toModel": to_model_name,
                        "toColumn": to_column,
                        "reason": (
                            f"{from_model_name}.{from_column} appears to reference "
                            f"{to_model_name}.{to_column}."
                        ),
                    }
                )

        return {"relationships": candidates}

    def _handle_exception(
        self,
        input: Input,
        error_message: str,
        code: str = "OTHERS",
        trace_id: Optional[str] = None,
        request_from: Literal["ui", "api"] = "ui",
    ):
        self._cache[input.id] = self.Resource(
            id=input.id,
            status="failed",
            error=self.Resource.Error(code=code, message=error_message),
            trace_id=trace_id,
            request_from=request_from,
        )
        logger.error(error_message)

    @observe(name="Generate Relationship Recommendation")
    @trace_metadata
    async def recommend(self, request: Input, **kwargs) -> Resource:
        logger.info("Generate Relationship Recommendation pipeline is running...")
        trace_id = kwargs.get("trace_id")

        try:
            mdl_dict = orjson.loads(request.mdl)

            input = {
                "mdl": mdl_dict,
                "language": request.configurations.language,
            }

            try:
                logger.info(
                    "Calling configured LLM for relationship recommendations. "
                    "timeout_seconds=%s",
                    self._generation_timeout_seconds,
                )
                resp = await asyncio.wait_for(
                    self._pipelines["relationship_recommendation"].run(**input),
                    timeout=self._generation_timeout_seconds,
                )
                response = resp.get("validated")
                if not response or (
                    "relationships" in response and not response.get("relationships")
                ):
                    logger.warning(
                        "Configured LLM returned empty relationship recommendations; "
                        "returning metadata-based fallback relationships."
                    )
                    response = self._fallback_relationships(mdl_dict)
            except TimeoutError:
                logger.warning(
                    "Relationship recommendation LLM call timed out after %s seconds; "
                    "returning metadata-based fallback relationships.",
                    self._generation_timeout_seconds,
                )
                response = self._fallback_relationships(mdl_dict)

            self._cache[request.id] = self.Resource(
                id=request.id,
                status="finished",
                response=response,
                trace_id=trace_id,
                request_from=request.request_from,
            )
        except orjson.JSONDecodeError as e:
            self._handle_exception(
                request,
                f"Failed to parse MDL: {str(e)}",
                code="MDL_PARSE_ERROR",
                trace_id=trace_id,
                request_from=request.request_from,
            )
        except Exception as e:
            self._handle_exception(
                request,
                f"An error occurred during relationship recommendation generation: {str(e)}",
                trace_id=trace_id,
                request_from=request.request_from,
            )

        return self._cache[request.id].with_metadata()

    def __getitem__(self, id: str) -> Resource:
        response = self._cache.get(id)

        if response is None:
            message = f"Relationship Recommendation Resource with ID '{id}' not found."
            logger.exception(message)
            return self.Resource(
                id=id,
                status="failed",
                error=self.Resource.Error(code="RESOURCE_NOT_FOUND", message=message),
            )

        return response

    def __setitem__(self, id: str, value: Resource):
        self._cache[id] = value
