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

MAX_UI_WAIT_SECONDS = 180
SEMANTICS_STATUS_TTL_BUFFER_SECONDS = 300
SEMANTICS_MODEL_CHUNK_SIZE = 1000
SEMANTICS_MAX_CONCURRENT_LLM_CALLS = 6


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
        self._generation_timeout_seconds = min(
            generation_timeout_seconds,
            MAX_UI_WAIT_SECONDS - 30,
        )
        self._cache: Dict[str, self.Resource] = TTLCache(
            maxsize=maxsize,
            ttl=max(
                ttl,
                self._generation_timeout_seconds + SEMANTICS_STATUS_TTL_BUFFER_SECONDS,
            ),
        )

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

    def _humanize_name(self, name: str) -> str:
        return " ".join(
            token
            for token in re.sub(
                r"(?<=[a-z0-9])(?=[A-Z])",
                " ",
                name.replace(".", " ").replace("_", " "),
            ).split()
            if token.lower() not in {"dbo", "public"}
        ) or name

    def _name_tokens(self, name: str) -> set[str]:
        return {
            token.lower()
            for token in self._humanize_name(name).split()
            if token and token.lower() not in {"x", "stage", "load", "tbl", "table"}
        }

    def _table_context(self, model: dict[str, Any]) -> set[str]:
        tokens = self._name_tokens(self._text(model.get("name", "")))
        for column in model.get("columns", []) or []:
            tokens.update(self._name_tokens(self._text(column.get("name", ""))))
        return tokens

    def _fallback_model_description(self, model: dict[str, Any]) -> str:
        context = self._table_context(model)
        if context & {"sales", "revenue", "order", "orders", "customer", "product"}:
            return (
                "Captures commercial activity and related business dimensions for "
                "sales reporting, performance analysis, and customer or product insights."
            )
        if context & {"invoice", "payment", "price", "cost", "amount", "finance"}:
            return (
                "Captures financial transactions and monetary measures used for "
                "reconciliation, reporting, and performance analysis."
            )
        if context & {"employee", "user", "person", "salesperson", "owner", "manager"}:
            return (
                "Captures people and ownership attributes used to assign responsibility, "
                "segment activity, and analyze performance."
            )
        return (
            "Captures operational business records used for reporting, filtering, "
            "trend analysis, and answering analytical questions."
        )

    def _fallback_column_description(
        self,
        model: dict[str, Any],
        column: dict[str, Any],
    ) -> str:
        column_name = self._text(column.get("name", ""))
        data_type = self._text(column.get("type", "")).lower()
        tokens = self._name_tokens(column_name)
        context = self._table_context(model)

        if tokens & {"division", "bu", "business", "unit", "department"}:
            return "Organizational segment used to group records for ownership, reporting, and performance comparison."
        if tokens & {"company", "entity", "organization", "org"}:
            return "Legal or business entity associated with the record for company-level reporting and filtering."
        if tokens & {"market", "region", "territory", "country", "state", "city", "location"}:
            return "Geographic or market segment used to analyze activity by area and compare regional performance."
        if tokens & {"product", "prod", "sku", "item", "material"}:
            return "Product or item classification used to analyze sales, demand, and business activity by offering."
        if tokens & {"type", "category", "class", "segment", "group"}:
            return "Business classification used to segment records into meaningful reporting categories."
        if tokens & {"customer", "client", "account"}:
            return "Customer or account reference used to connect activity to the buyer or business relationship."
        if tokens & {"salesperson", "seller", "rep", "owner", "manager", "person"}:
            return "Responsible person or role associated with the record for ownership and performance analysis."
        if tokens & {"status", "stage", "state"}:
            return "Current business state used to track workflow progress, completion, or operational condition."
        if tokens & {"date", "time", "day", "month", "year", "period", "created", "updated"}:
            return "Time period used to sequence records, filter activity, and analyze trends over time."
        if tokens & {"amount", "sales", "revenue", "cost", "price", "value", "total", "net", "gross"}:
            return "Monetary measure used to calculate financial results, compare performance, and summarize business activity."
        if tokens & {"quantity", "qty", "count", "units", "volume"}:
            return "Quantity measure used to count activity, summarize volume, and compare operational scale."
        if tokens & {"rate", "ratio", "percent", "percentage", "margin"}:
            return "Calculated rate or percentage used to compare efficiency, contribution, or relative performance."
        if tokens & {"id", "key", "code", "number", "no"}:
            return "Identifier used to distinguish records and join this data with related business information."
        if "date" in data_type or "time" in data_type:
            return "Timestamp or calendar value used for time-based filtering, sequencing, and trend analysis."
        if any(type_name in data_type for type_name in ("int", "float", "double", "decimal", "numeric", "number")):
            return "Numeric business measure used for aggregation, comparison, and analytical calculations."
        if context & {"sales", "order", "customer", "product"}:
            return "Business attribute used to filter and explain commercial activity in reporting and analysis."
        return "Business attribute used to categorize, filter, and explain records in analytical questions."

    def _is_low_quality_description(self, description: str, name: str) -> bool:
        normalized = " ".join(description.lower().split())
        if not normalized:
            return True

        name_text = self._humanize_name(name).lower()
        low_quality_patterns = (
            "stores the",
            "value used to describe or analyze",
            "contains business records for",
            "represents ",
            "field from",
        )
        if any(pattern in normalized for pattern in low_quality_patterns):
            return True
        return normalized in {name.lower(), name_text}

    def _fallback_output(self, chunk: dict[str, Any]) -> dict[str, Any]:
        output: dict[str, Any] = {}
        for model in chunk.get("mdl", {}).get("models", []):
            model_name = self._text(model.get("name", ""))
            if not model_name:
                continue

            model_properties = self._properties(model)
            model_description = self._text(model_properties.get("description", ""))
            if self._is_low_quality_description(model_description, model_name):
                model_description = self._fallback_model_description(model)

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
                if self._is_low_quality_description(column_description, column_name):
                    column_description = self._fallback_column_description(
                        model,
                        column,
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

    def _complete_output_with_fallback(
        self,
        output: dict[str, Any],
        chunk: dict[str, Any],
    ) -> dict[str, Any]:
        fallback = self._fallback_output(chunk)
        completed = dict(output)

        for model_name, fallback_model in fallback.items():
            model_output = completed.get(model_name)
            if not isinstance(model_output, dict):
                completed[model_name] = fallback_model
                continue

            properties = model_output.get("properties")
            if not isinstance(properties, dict):
                properties = {}
                model_output["properties"] = properties
            if self._is_low_quality_description(
                self._text(properties.get("description", "")),
                model_name,
            ):
                properties["description"] = self._text(
                    model_output.get("description")
                ) or fallback_model["properties"]["description"]
                if self._is_low_quality_description(
                    properties["description"],
                    model_name,
                ):
                    properties["description"] = fallback_model["properties"][
                        "description"
                    ]

            output_columns = {
                column.get("name"): column
                for column in model_output.get("columns", [])
                if isinstance(column, dict) and column.get("name")
            }
            for fallback_column in fallback_model.get("columns", []):
                column_name = fallback_column.get("name")
                output_column = output_columns.get(column_name)
                if not output_column:
                    model_output.setdefault("columns", []).append(fallback_column)
                    continue

                column_properties = output_column.get("properties")
                if not isinstance(column_properties, dict):
                    column_properties = {}
                    output_column["properties"] = column_properties
                if self._is_low_quality_description(
                    self._text(column_properties.get("description", "")),
                    column_name,
                ):
                    column_properties["description"] = self._text(
                        output_column.get("description")
                    ) or fallback_column["properties"]["description"]
                    if self._is_low_quality_description(
                        column_properties["description"],
                        column_name,
                    ):
                        column_properties["description"] = fallback_column[
                            "properties"
                        ]["description"]

        return completed

    def _chunking(
        self,
        mdl_dict: dict,
        request: GenerateRequest,
        chunk_size: int = SEMANTICS_MODEL_CHUNK_SIZE,
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
            else:
                output = self._complete_output_with_fallback(output, chunk)
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

    async def _generate_task_with_semaphore(
        self,
        semaphore: asyncio.Semaphore,
        request_id: str,
        chunk: dict,
    ):
        async with semaphore:
            await self._generate_task(request_id, chunk)

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
            semaphore = asyncio.Semaphore(SEMANTICS_MAX_CONCURRENT_LLM_CALLS)
            await asyncio.gather(
                *[
                    self._generate_task_with_semaphore(
                        semaphore,
                        request.id,
                        chunk,
                    )
                    for chunk in chunks
                ]
            )

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
