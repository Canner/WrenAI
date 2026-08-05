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
_GENERIC_IDENTIFIER_TERMS = {
    "code",
    "id",
    "identifier",
    "key",
    "no",
    "number",
}


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


def _term_abbreviations(terms: set[str]) -> set[str]:
    abbreviations: set[str] = set()
    for term in terms:
        if len(term) >= 3:
            abbreviations.add(term[:3])
        if len(term) >= 4:
            abbreviations.add(term[:4])
            for character in term[3:]:
                if character not in "aeiou":
                    abbreviations.add(f"{term[:3]}{character}")
                    break
            consonants = [character for character in term[2:] if character not in "aeiou"]
            if len(consonants) >= 2:
                abbreviations.add(f"{term[:2]}{''.join(consonants[:2])}")
    return abbreviations


def _column_names(model: dict) -> set[str]:
    return {
        column.get("name")
        for column in model.get("columns", []) or []
        if isinstance(column, dict) and column.get("name") and not column.get("relationship")
    }


def _column_map(model: dict) -> dict[str, dict]:
    return {
        column.get("name"): column
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


def _model_terms(model: dict) -> set[str]:
    properties = model.get("properties")
    properties = properties if isinstance(properties, dict) else {}
    base_terms = (
        _identifier_terms(model.get("name"))
        | _identifier_terms(properties.get("displayName"))
        | _identifier_terms(properties.get("description"))
    )
    return base_terms | _term_abbreviations(_non_generic_terms(base_terms))


def _column_terms(column_name: str, column: dict | None = None) -> set[str]:
    column = column or {}
    properties = column.get("properties")
    properties = properties if isinstance(properties, dict) else {}
    return (
        _identifier_terms(column_name)
        | _identifier_terms(properties.get("displayName"))
        | _identifier_terms(properties.get("description"))
    )


def _non_generic_terms(value: set[str]) -> set[str]:
    return value - _GENERIC_IDENTIFIER_TERMS


def _is_ordered_abbreviation(short_term: str, long_term: str) -> bool:
    if len(short_term) < 3 or len(short_term) > 6:
        return False
    if len(long_term) <= len(short_term):
        return False

    position = 0
    for character in long_term:
        if position < len(short_term) and character == short_term[position]:
            position += 1
    return position == len(short_term)


def _has_ordered_abbreviation_match(
    short_terms: set[str], long_terms: set[str]
) -> bool:
    return any(
        _is_ordered_abbreviation(short_term, long_term)
        for short_term in short_terms
        for long_term in long_terms
    )


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
    model_column_maps = {model["name"]: _column_map(model) for model in models}
    model_terms = {model["name"]: _model_terms(model) for model in models}
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
    scored_candidates = []
    seen = set()
    for source_model in models:
        source_name = source_model["name"]
        for source_column, source_column_payload in model_column_maps.get(
            source_name, {}
        ).items():
            source_column_terms = _column_terms(source_column, source_column_payload)
            if not source_column_terms:
                continue

            for target_model in models:
                target_name = target_model["name"]
                if source_name == target_name:
                    continue

                target_pk = primary_keys.get(target_name)
                if not target_pk:
                    continue

                target_pk_payload = model_column_maps.get(target_name, {}).get(
                    target_pk, {}
                )
                target_terms = model_terms.get(target_name, set())
                target_pk_terms = _column_terms(target_pk, target_pk_payload)
                source_model_terms = model_terms.get(source_name, set())
                source_specific_terms = _non_generic_terms(source_column_terms)
                target_specific_terms = _non_generic_terms(target_terms)
                target_pk_specific_terms = _non_generic_terms(target_pk_terms)

                score = 0
                if source_column == target_pk and (
                    source_specific_terms & target_specific_terms
                ):
                    score += 6
                if source_column.endswith(f"_{target_pk}"):
                    score += 8
                if target_specific_terms & source_column_terms:
                    score += 8
                if _has_ordered_abbreviation_match(
                    source_specific_terms, target_specific_terms
                ):
                    score += 8
                if target_pk_terms & source_column_terms:
                    score += 4
                if _non_generic_terms(source_model_terms) & target_terms:
                    score += 3
                if source_column.lower().endswith("_id") and target_pk.lower() == "id":
                    score += 2
                if (
                    source_column == target_pk
                    and not (source_specific_terms & target_specific_terms)
                    and not (source_specific_terms & target_pk_specific_terms)
                ):
                    score = 0

                if score < 8:
                    continue

                key = (source_name, source_column, target_name, target_pk)
                if key in existing_pairs or key in seen:
                    continue

                seen.add(key)
                relation_type = "ONE_TO_ONE" if source_column == _primary_key(
                    source_model
                ) else "MANY_TO_ONE"
                scored_candidates.append(
                    (
                        score,
                        {
                            "name": _relationship_name(source_name, target_name),
                            "fromModel": source_name,
                            "fromColumn": source_column,
                            "type": relation_type,
                            "toModel": target_name,
                            "toColumn": target_pk,
                            "reason": _relationship_reason(
                                source_name, source_column, target_name
                            ),
                        },
                    )
                )

    for _, relationship in sorted(
        scored_candidates,
        key=lambda item: (
            item[0],
            item[1]["fromModel"],
            item[1]["fromColumn"],
            item[1]["toModel"],
        ),
        reverse=True,
    ):
        relationships.append(relationship)

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
