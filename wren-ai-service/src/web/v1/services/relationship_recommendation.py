import asyncio
import logging
import math
import re
from typing import Dict, Literal, Optional

import orjson
from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import BaseRequest, MetadataTraceable

logger = logging.getLogger("wren-ai-service")


_IDENTIFIER_TOKEN_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9]*")


def _identifier_terms(value: str | None) -> set[str]:
    if not value:
        return set()

    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", str(value))
    spaced = spaced.replace("_", " ").replace("-", " ").replace(".", " ")
    terms: set[str] = set()
    for token in _IDENTIFIER_TOKEN_PATTERN.findall(spaced):
        normalized = token.lower()
        terms.add(normalized)
        if normalized.endswith("ies") and len(normalized) > 4:
            terms.add(f"{normalized[:-3]}y")
        elif normalized.endswith("s") and len(normalized) > 3:
            terms.add(normalized[:-1])

    return terms


def _column_names(model: dict) -> set[str]:
    return {
        column.get("name")
        for column in model.get("columns", []) or []
        if isinstance(column, dict) and column.get("name") and not column.get("relationship")
    }


def _primary_key(model: dict) -> str:
    primary_key = model.get("primaryKey")
    if primary_key:
        return primary_key

    names = _column_names(model)
    for candidate in ["id", f"{model.get('name', '')}_id"]:
        if candidate in names:
            return candidate

    return ""


def _relationship_name(from_model: str, to_model: str) -> str:
    raw_name = f"{from_model}_{to_model}"
    normalized = re.sub(r"[^A-Za-z0-9_]+", "_", raw_name).strip("_")
    return normalized[:120] or "generated_relationship"


def _relationship_reason(from_model: str, from_column: str, to_model: str) -> str:
    return (
        f"Records in {from_model} can be analyzed with related records in "
        f"{to_model} through {from_column}."
    )


def _deterministic_relationship_candidates(mdl: dict) -> dict:
    models = [
        model
        for model in mdl.get("models", []) or []
        if isinstance(model, dict) and model.get("name")
    ]
    model_columns = {model["name"]: _column_names(model) for model in models}
    primary_keys = {
        model["name"]: _primary_key(model)
        for model in models
        if _primary_key(model) in model_columns.get(model["name"], set())
    }
    existing_pairs = {
        (
            relationship.get("fromModel"),
            relationship.get("fromColumn"),
            relationship.get("toModel"),
            relationship.get("toColumn"),
        )
        for relationship in mdl.get("relationships", []) or []
        if isinstance(relationship, dict)
    }

    relationships = []
    seen = set()
    for source_model in models:
        source_name = source_model["name"]
        for source_column in model_columns.get(source_name, set()):
            source_column_terms = _identifier_terms(source_column)
            if not source_column_terms:
                continue

            for target_model in models:
                target_name = target_model["name"]
                if source_name == target_name:
                    continue

                target_pk = primary_keys.get(target_name)
                if not target_pk:
                    continue

                target_terms = _identifier_terms(target_name)
                target_pk_terms = _identifier_terms(target_pk)
                if not (
                    source_column == target_pk
                    and target_terms & _identifier_terms(source_name)
                ) and not (
                    target_terms
                    and target_terms.issubset(source_column_terms | target_pk_terms)
                    and target_pk_terms & source_column_terms
                ):
                    continue

                key = (source_name, source_column, target_name, target_pk)
                if key in existing_pairs or key in seen:
                    continue

                seen.add(key)
                relationships.append(
                    {
                        "name": _relationship_name(source_name, target_name),
                        "fromModel": source_name,
                        "fromColumn": source_column,
                        "type": "MANY_TO_ONE",
                        "toModel": target_name,
                        "toColumn": target_pk,
                        "reason": _relationship_reason(
                            source_name, source_column, target_name
                        ),
                    }
                )

    return {"relationships": relationships}


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
        max_generation_timeout_seconds: int = 90,
        max_llm_models: int = 80,
    ):
        self._pipelines = pipelines
        self._cache: Dict[str, RelationshipRecommendation.Resource] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )
        self._generation_timeout_seconds = generation_timeout_seconds
        self._max_generation_timeout_seconds = max_generation_timeout_seconds
        self._max_llm_models = max_llm_models

    def _request_timeout_seconds(self, mdl: dict) -> int:
        model_count = len(mdl.get("models", []) or [])
        waves = max(1, math.ceil(model_count / 20))
        return min(
            self._generation_timeout_seconds * waves,
            self._max_generation_timeout_seconds,
        )

    def _should_use_llm(self, mdl: dict) -> bool:
        model_count = len(mdl.get("models", []) or [])
        return model_count <= self._max_llm_models

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
            request_timeout_seconds = self._request_timeout_seconds(mdl_dict)

            if not self._should_use_llm(mdl_dict):
                response = _deterministic_relationship_candidates(mdl_dict)
                logger.info(
                    "Relationship recommendation skipped LLM for large MDL. "
                    "model_count=%s, fallback_count=%s",
                    len(mdl_dict.get("models", []) or []),
                    len(response.get("relationships", [])),
                )
            else:
                try:
                    logger.info(
                        "Calling configured LLM for relationship recommendations. "
                        "timeout_seconds=%s",
                        request_timeout_seconds,
                    )
                    resp = await asyncio.wait_for(
                        self._pipelines["relationship_recommendation"].run(**input),
                        timeout=request_timeout_seconds,
                    )
                    response = resp.get("validated")
                    if response is None:
                        raise ValueError(
                            "Relationship recommendation pipeline returned no "
                            "validated response"
                        )
                except (asyncio.TimeoutError, TimeoutError, ValueError) as e:
                    response = _deterministic_relationship_candidates(mdl_dict)
                    logger.warning(
                        "Relationship recommendation LLM path failed; using "
                        "metadata-grounded fallback. error=%s, fallback_count=%s",
                        str(e),
                        len(response.get("relationships", [])),
                    )

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
