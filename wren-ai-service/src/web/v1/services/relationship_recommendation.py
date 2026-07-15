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

    def _identifier_tokens(self, value: Any) -> list[str]:
        text = "" if value is None else str(value)
        text = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", text)
        return [
            self._normalize_identifier(token)
            for token in re.split(r"[^a-zA-Z0-9]+", text)
            if token
        ]

    def _model_aliases(self, model: dict) -> set[str]:
        aliases: set[str] = set()
        raw_values = [
            model.get("name"),
            model.get("properties", {}).get("displayName"),
            model.get("tableReference", {}).get("table"),
        ]

        for value in raw_values:
            normalized = self._normalize_identifier(value)
            if normalized:
                aliases.add(normalized)

            tokens = self._identifier_tokens(value)
            if tokens:
                aliases.add(tokens[-1])
                aliases.add("".join(tokens))

        return aliases

    def _model_columns(self, model: dict) -> list[dict]:
        return [
            column
            for column in model.get("columns", []) or []
            if column.get("name") and not column.get("relationship")
        ]

    def _humanize_identifier(self, value: Any) -> str:
        text = "" if value is None else str(value)
        text = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", text)
        text = re.sub(r"[_\-.]+", " ", text)
        text = re.sub(r"\b(id|pk|fk)\b", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s+", " ", text).strip()
        replacements = {
            "dept": "department",
            "emp": "employee",
            "org": "organization",
            "cust": "customer",
            "prod": "product",
            "dim": "dimension",
            "fact": "fact",
        }
        parts = [replacements.get(part.lower(), part) for part in text.split()]
        if len(parts) > 1 and parts[0].lower() in {
            "dbo",
            "public",
            "stage",
            "staging",
            "tbl",
        }:
            parts = parts[1:]
        if len(parts) > 1 and parts[0].lower() == "q":
            parts = parts[1:]
        text = " ".join(parts)
        return text.lower() if text else "record"

    def _singularize_label(self, label: str) -> str:
        if label.endswith("ies") and len(label) > 3:
            return f"{label[:-3]}y"
        if label.endswith(("ses", "xes", "zes", "ches", "shes")):
            return label[:-2]
        if (
            label.endswith("s")
            and not label.endswith(("ss", "us", "is", "sales", "series"))
        ):
            return label[:-1]
        return label

    def _model_label(self, model: dict) -> str:
        properties = model.get("properties") or {}
        return self._singularize_label(
            self._humanize_identifier(
                properties.get("displayName")
                or model.get("tableReference", {}).get("table")
                or model.get("name")
            )
        )

    def _pluralize_label(self, label: str) -> str:
        if label.endswith("y") and label[-2:] not in {"ay", "ey", "iy", "oy", "uy"}:
            return f"{label[:-1]}ies"
        if label.endswith(("s", "x", "z", "ch", "sh")):
            return f"{label}es"
        return f"{label}s"

    def _relationship_description(
        self,
        from_model: dict,
        to_model: dict,
        relationship_type: str,
    ) -> str:
        from_label = self._model_label(from_model)
        to_label = self._model_label(to_model)
        from_plural = self._pluralize_label(from_label)
        to_plural = self._pluralize_label(to_label)

        if relationship_type == "ONE_TO_ONE":
            return (
                f"Each {from_label} is linked to one matching {to_label}, "
                "connecting details that describe the same business record."
            )
        if relationship_type == "ONE_TO_MANY":
            return (
                f"Each {from_label} can be associated with multiple {to_plural}, "
                f"supporting analysis of {to_plural} by {from_label}."
            )
        return (
            f"Each {from_label} belongs to one {to_label}, "
            f"so {from_plural} can be grouped and analyzed by {to_label}."
        )

    def _description_is_meaningful(self, value: Any) -> bool:
        if not isinstance(value, str):
            return False

        text = value.strip()
        if len(text) < 24:
            return False

        technical_patterns = [
            r"\bappears to reference\b",
            r"\breferences\b",
            r"\bforeign key\b",
            r"\bprimary key\b",
            r"\w+\.\w+",
        ]
        return not any(
            re.search(pattern, text, flags=re.IGNORECASE)
            for pattern in technical_patterns
        )

    def _ensure_relationship_descriptions(self, response: dict, mdl: dict) -> dict:
        relationships = response.get("relationships")
        if not isinstance(relationships, list):
            return response

        models_by_name = {
            model.get("name"): model
            for model in mdl.get("models", []) or []
            if model.get("name")
        }
        normalized_relationships = []
        for relationship in relationships:
            if not isinstance(relationship, dict):
                continue

            from_model = models_by_name.get(relationship.get("fromModel"))
            to_model = models_by_name.get(relationship.get("toModel"))
            if not from_model or not to_model:
                normalized_relationships.append(relationship)
                continue

            reason = relationship.get("reason")
            if not self._description_is_meaningful(reason):
                relationship = {
                    **relationship,
                    "reason": self._relationship_description(
                        from_model, to_model, relationship.get("type", "MANY_TO_ONE")
                    ),
                }

            normalized_relationships.append(relationship)

        return {**response, "relationships": normalized_relationships}

    def _primary_key(self, model: dict) -> Optional[str]:
        primary_key = model.get("primaryKey")
        columns = self._model_columns(model)
        if primary_key and any(column.get("name") == primary_key for column in columns):
            return primary_key

        model_aliases = self._model_aliases(model)
        for column in columns:
            normalized_column = self._normalize_identifier(column.get("name"))
            if normalized_column == "id" or normalized_column in {
                f"{alias}id" for alias in model_aliases
            }:
                return column.get("name")

        return None

    def _column_is_primary_key(self, model: dict, column_name: str) -> bool:
        primary_key = self._primary_key(model)
        if primary_key and column_name == primary_key:
            return True

        return False

    def _fallback_relationship_type(
        self, from_model: dict, from_column: str, to_model: dict, to_column: str
    ) -> str:
        from_is_pk = self._column_is_primary_key(from_model, from_column)
        to_is_pk = self._column_is_primary_key(to_model, to_column)
        if from_is_pk and to_is_pk:
            return "ONE_TO_ONE"
        if from_is_pk and not to_is_pk:
            return "ONE_TO_MANY"
        return "MANY_TO_ONE"

    def _relationship_signature(
        self,
        from_model_name: str,
        from_column: str,
        to_model_name: str,
        to_column: str,
    ) -> tuple[str, str, str, str]:
        return (from_model_name, from_column, to_model_name, to_column)

    def _relationship_pair_signature(
        self,
        from_model_name: str,
        from_column: str,
        to_model_name: str,
        to_column: str,
    ) -> tuple[tuple[str, str], tuple[str, str]]:
        left = (from_model_name, from_column)
        right = (to_model_name, to_column)
        return tuple(sorted([left, right]))

    def _existing_relationship_signatures(
        self, mdl: dict
    ) -> tuple[
        set[tuple[str, str, str, str]], set[tuple[tuple[str, str], tuple[str, str]]]
    ]:
        direct_signatures = set()
        pair_signatures = set()

        for relationship in mdl.get("relationships", []) or []:
            models = relationship.get("models", []) or []
            condition = relationship.get("condition", "")
            if len(models) < 2 or not condition:
                continue

            match = re.match(
                r"\s*([^.=\s]+)\.([^.=\s]+)\s*=\s*([^.=\s]+)\.([^.=\s]+)\s*",
                condition,
            )
            if not match:
                continue

            left_model, left_column, right_model, right_column = match.groups()
            direct_signatures.add(
                self._relationship_signature(
                    left_model, left_column, right_model, right_column
                )
            )
            direct_signatures.add(
                self._relationship_signature(
                    right_model, right_column, left_model, left_column
                )
            )
            pair_signatures.add(
                self._relationship_pair_signature(
                    left_model, left_column, right_model, right_column
                )
            )

        return direct_signatures, pair_signatures

    def _fallback_relationships(self, mdl: dict) -> dict:
        models = mdl.get("models", []) or []
        existing, existing_pairs = self._existing_relationship_signatures(mdl)
        seen = set(existing)
        seen_pairs = set(existing_pairs)
        candidates = []

        model_lookup = {}
        primary_keys = {}
        for model in models:
            primary_keys[model.get("name")] = self._primary_key(model)
            for alias in self._model_aliases(model):
                model_lookup.setdefault(alias, model)

        def add_candidate(
            from_model: dict,
            from_column: str,
            to_model: dict,
            to_column: str,
        ):
            from_model_name = from_model.get("name")
            to_model_name = to_model.get("name")
            if not from_model_name or not to_model_name:
                return
            if from_model_name == to_model_name:
                return

            signature = self._relationship_signature(
                from_model_name, from_column, to_model_name, to_column
            )
            pair_signature = self._relationship_pair_signature(
                from_model_name, from_column, to_model_name, to_column
            )
            if signature in seen or pair_signature in seen_pairs:
                return

            relationship_type = self._fallback_relationship_type(
                from_model, from_column, to_model, to_column
            )
            reason = self._relationship_description(
                from_model, to_model, relationship_type
            )

            seen.add(signature)
            seen_pairs.add(pair_signature)
            candidates.append(
                {
                    "name": f"{from_model_name}_{to_model_name}",
                    "fromModel": from_model_name,
                    "fromColumn": from_column,
                    "type": relationship_type,
                    "toModel": to_model_name,
                    "toColumn": to_column,
                    "reason": reason,
                }
            )

        for from_model in models:
            from_model_name = from_model.get("name")
            if not from_model_name:
                continue

            for column in self._model_columns(from_model):
                from_column = column.get("name")
                normalized_column = self._normalize_identifier(from_column)
                target_keys = set()
                if normalized_column.endswith("id") and normalized_column != "id":
                    target_keys.add(normalized_column[:-2])

                for to_model in models:
                    to_model_name = to_model.get("name")
                    to_primary_key = primary_keys.get(to_model_name)
                    if (
                        to_model_name == from_model_name
                        or not to_primary_key
                        or not self._column_is_primary_key(to_model, to_primary_key)
                    ):
                        continue

                    to_primary_key_normalized = self._normalize_identifier(
                        to_primary_key
                    )
                    if (
                        normalized_column != "id"
                        and normalized_column == to_primary_key_normalized
                    ):
                        add_candidate(
                            to_model,
                            to_primary_key,
                            from_model,
                            from_column,
                        )

                for target_key in target_keys:
                    to_model = model_lookup.get(target_key)
                    if not to_model or to_model.get("name") == from_model_name:
                        continue

                    to_model_name = to_model.get("name")
                    to_column = primary_keys.get(to_model_name)
                    if not to_column:
                        continue

                    add_candidate(from_model, from_column, to_model, to_column)

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

            response = self._ensure_relationship_descriptions(response, mdl_dict)

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
