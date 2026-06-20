import asyncio
import logging
import re
from typing import Dict, List, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import AliasChoices, BaseModel, Field

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import BaseRequest, SSEEvent

logger = logging.getLogger("wren-ai-service")


async def _return_value(value):
    return value


class AskHistory(BaseModel):
    sql: str
    question: str


# POST /v1/asks
class AskRequest(BaseRequest):
    query: str
    # don't recommend to use id as a field name, but it's used in the older version of API spec
    # so we need to support as a choice, and will remove it in the future
    mdl_hash: Optional[str] = Field(validation_alias=AliasChoices("mdl_hash", "id"))
    histories: Optional[list[AskHistory]] = Field(default_factory=list)
    ignore_sql_generation_reasoning: bool = False
    enable_column_pruning: bool = False
    use_dry_plan: bool = False
    allow_dry_plan_fallback: bool = True
    custom_instruction: Optional[str] = None


class AskResponse(BaseModel):
    query_id: str


# PATCH /v1/asks/{query_id}
class StopAskRequest(BaseRequest):
    status: Literal["stopped"]


class StopAskResponse(BaseModel):
    query_id: str


# GET /v1/asks/{query_id}/result
class AskResult(BaseModel):
    sql: str
    type: Literal["llm", "view"] = "llm"
    viewId: Optional[str] = None


class AskError(BaseModel):
    code: Literal["NO_RELEVANT_DATA", "NO_RELEVANT_SQL", "OTHERS"]
    message: str


class AskResultRequest(BaseModel):
    query_id: str


class _AskResultResponse(BaseModel):
    status: Literal[
        "understanding",
        "searching",
        "planning",
        "generating",
        "correcting",
        "finished",
        "failed",
        "stopped",
    ]
    rephrased_question: Optional[str] = None
    intent_reasoning: Optional[str] = None
    sql_generation_reasoning: Optional[str] = None
    type: Optional[Literal["GENERAL", "TEXT_TO_SQL", "MISLEADING_QUERY"]] = None
    retrieved_tables: Optional[List[str]] = None
    response: Optional[List[AskResult]] = None
    invalid_sql: Optional[str] = None
    error: Optional[AskError] = None
    trace_id: Optional[str] = None
    is_followup: bool = False
    general_type: Optional[
        Literal["MISLEADING_QUERY", "DATA_ASSISTANCE", "USER_GUIDE"]
    ] = None


class AskResultResponse(_AskResultResponse):
    is_followup: Optional[bool] = Field(False, exclude=True)
    general_type: Optional[
        Literal["MISLEADING_QUERY", "DATA_ASSISTANCE", "USER_GUIDE"]
    ] = Field(None, exclude=True)


class AskService:
    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        allow_intent_classification: bool = True,
        allow_sql_generation_reasoning: bool = True,
        allow_sql_functions_retrieval: bool = True,
        allow_sql_diagnosis: bool = True,
        allow_sql_knowledge_retrieval: bool = True,
        enable_column_pruning: bool = False,
        max_sql_correction_retries: int = 3,
        pipeline_timeout_seconds: int = 90,
        schema_retrieval_timeout_seconds: int = 180,
        max_histories: int = 5,
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._ask_results: Dict[str, AskResultResponse] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )
        self._general_streaming_results: Dict[str, str] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )
        self._allow_sql_generation_reasoning = allow_sql_generation_reasoning
        self._allow_sql_functions_retrieval = allow_sql_functions_retrieval
        self._allow_intent_classification = allow_intent_classification
        self._allow_sql_diagnosis = allow_sql_diagnosis
        self._allow_sql_knowledge_retrieval = allow_sql_knowledge_retrieval
        self._enable_column_pruning = enable_column_pruning
        self._pipeline_timeout_seconds = pipeline_timeout_seconds
        self._schema_retrieval_timeout_seconds = schema_retrieval_timeout_seconds
        self._max_histories = max_histories
        self._max_sql_correction_retries = max_sql_correction_retries

    def _is_stopped(self, query_id: str, container: dict):
        if (
            result := container.get(query_id)
        ) is not None and result.status == "stopped":
            return True

        return False

    def _is_greeting_query(self, query: str) -> bool:
        normalized = re.sub(r"\s+", " ", (query or "").strip().lower())
        greeting_patterns = {
            "hi",
            "hello",
            "hey",
            "hii",
            "hola",
            "good morning",
            "good afternoon",
            "good evening",
            "how are you",
            "thanks",
            "thank you",
        }
        return normalized in greeting_patterns

    def _is_data_analysis_query(self, query: str) -> bool:
        normalized = re.sub(r"\s+", " ", (query or "").strip().lower())
        if not normalized:
            return False

        analysis_terms = {
            "amount",
            "average",
            "avg",
            "bar chart",
            "bottom",
            "chart",
            "common",
            "compare",
            "count",
            "cost",
            "customer",
            "customers",
            "dashboard",
            "debug",
            "failure",
            "fastest growing",
            "growth",
            "group",
            "grouped",
            "invoice",
            "invoices",
            "margin",
            "monthly",
            "order",
            "orders",
            "pcb",
            "performance",
            "profit",
            "quarter",
            "quantity",
            "rank",
            "ranking",
            "repair",
            "resolved",
            "revenue",
            "sale",
            "sales",
            "sales person",
            "sales rep",
            "salesperson",
            "sla",
            "top",
            "trend",
            "turnaround",
            "value",
            "volume",
            "year",
            "yearly",
        }
        return any(term in normalized for term in analysis_terms)

    def _rewrite_query_for_text_to_sql(self, query: str) -> str:
        normalized = re.sub(r"\s+", " ", (query or "").strip().lower())
        if not normalized:
            return query

        guidance: list[str] = []

        if any(
            term in normalized
            for term in ("chart", "bar chart", "line chart", "pie chart", "graph")
        ):
            guidance.append(
                "Return SQL only for the aggregated dataset required to build the requested chart."
            )

        if any(
            term in normalized
            for term in (
                "failure category",
                "failure categories",
                "common failure",
                "common failures",
                "failure code",
                "top 10",
                "most common",
            )
        ):
            guidance.append(
                "Use an exposed failure category, failure name, or failure code field from the schema and return that dimension with a count metric."
            )

        if any(
            term in normalized
            for term in ("monthly", "last 12 months", "last month", "trend", "volume")
        ):
            guidance.append(
                "Use a real timestamp column from the schema and aggregate results by calendar month when a monthly trend is requested."
            )

        if not guidance:
            return query

        return f"{query}\n\nSQL generation guidance:\n- " + "\n- ".join(guidance)

    def _schema_contains(
        self,
        table_ddls: list[str],
        pattern: str,
        table_names: Optional[list[str]] = None,
    ) -> bool:
        schema_text = "\n".join(table_ddls or [])
        if table_names:
            schema_text += "\n" + "\n".join(table_names)
        return bool(re.search(pattern, schema_text, flags=re.IGNORECASE))

    def _schema_has_table_column(
        self,
        table_ddls: list[str],
        table_name: str,
        column_name: str,
        table_names: Optional[list[str]] = None,
    ) -> bool:
        table_pattern = rf"\b{re.escape(table_name)}\b"
        column_pattern = rf"\b{re.escape(column_name)}\b"

        for ddl in table_ddls or []:
            if re.search(table_pattern, ddl, flags=re.IGNORECASE) and re.search(
                column_pattern, ddl, flags=re.IGNORECASE
            ):
                return True

        return False

    def _extract_schema_column_names(self, table_ddls: list[str]) -> list[str]:
        column_names: list[str] = []
        non_column_prefixes = (
            "create ",
            "constraint ",
            "foreign ",
            "primary ",
            "unique ",
            "index ",
            ")",
            "/*",
            "--",
        )

        for ddl in table_ddls:
            for line in ddl.splitlines():
                stripped = line.strip().rstrip(",")
                if not stripped:
                    continue
                if stripped.lower().startswith(non_column_prefixes):
                    continue

                column_match = re.match(
                    r'(?:"(?P<quoted>[^"]+)"|\[(?P<bracketed>[^\]]+)\]|'
                    r"`(?P<backticked>[^`]+)`|(?P<bare>[A-Za-z_][A-Za-z0-9_]*))\s+",
                    stripped,
                )
                if not column_match:
                    continue

                column_name = next(
                    value for value in column_match.groupdict().values() if value
                )
                column_names.append(column_name.lower())

        return column_names

    def _extract_requested_top_n(self, query: str, default_value: int = 10) -> int:
        if match := re.search(r"\btop\s+(\d+)\b", query or "", flags=re.IGNORECASE):
            return max(1, min(int(match.group(1)), 100))
        return default_value

    def _build_manufacturing_throughput_sql(
        self,
        query: str,
        table_ddls: list[str],
        table_names: Optional[list[str]] = None,
    ) -> str | None:
        normalized = re.sub(r"\s+", " ", (query or "").strip().lower())
        if not normalized:
            return None

        wants_throughput = "throughput" in normalized or (
            "repair" in normalized and "volume" in normalized
        )
        wants_unit_breakdown = any(
            term in normalized
            for term in (
                "manufacturing unit",
                "manufacturing units",
                "business unit",
                "business units",
                "different unit",
                "different units",
            )
        )

        if not (wants_throughput and wants_unit_breakdown):
            return None

        has_debug_entries = self._schema_contains(
            table_ddls, r"\bdbo_DebugEntries\b", table_names=table_names
        )
        has_business_unit = self._schema_contains(
            table_ddls, r"\bBusinessUnit\b", table_names=table_names
        )
        if not (has_debug_entries and has_business_unit):
            return None

        timestamp_column = None
        for candidate in ("DateIn", "FailedAt"):
            if self._schema_contains(
                table_ddls, rf"\b{candidate}\b", table_names=table_names
            ):
                timestamp_column = candidate
                break

        if timestamp_column and any(
            term in normalized for term in ("trend", "monthly", "over time")
        ):
            timestamp_expression = f'"dbo_DebugEntries"."{timestamp_column}"'
            return (
                'SELECT "dbo_DebugEntries"."BusinessUnit" AS "unit_name", '
                f'DATEPART(YEAR, {timestamp_expression}) AS "year", '
                f'DATEPART(MONTH, {timestamp_expression}) AS "month", '
                'COUNT(*) AS "throughput" '
                'FROM "dbo_DebugEntries" '
                'WHERE "dbo_DebugEntries"."BusinessUnit" IS NOT NULL '
                f'AND {timestamp_expression} IS NOT NULL '
                'GROUP BY "dbo_DebugEntries"."BusinessUnit", '
                f'DATEPART(YEAR, {timestamp_expression}), '
                f'DATEPART(MONTH, {timestamp_expression}) '
                'ORDER BY "unit_name" ASC, "year" ASC, "month" ASC'
            )

        return (
            'SELECT "dbo_DebugEntries"."BusinessUnit" AS "unit_name", '
            'COUNT(*) AS "throughput" '
            'FROM "dbo_DebugEntries" '
            'WHERE "dbo_DebugEntries"."BusinessUnit" IS NOT NULL '
            'GROUP BY "dbo_DebugEntries"."BusinessUnit" '
            'ORDER BY "throughput" DESC'
        )

    def _build_repair_failure_count_sql(
        self,
        query: str,
        table_ddls: list[str],
        table_names: Optional[list[str]] = None,
    ) -> str | None:
        normalized = re.sub(r"\s+", " ", (query or "").strip().lower())
        if not normalized:
            return None

        wants_failure_counts = (
            "failure" in normalized
            and any(
                term in normalized
                for term in (
                    "count",
                    "counts",
                    "category",
                    "code",
                    "grouped",
                    "common",
                    "most common",
                    "top",
                )
            )
            and any(term in normalized for term in ("repair", "bar chart", "chart"))
        )
        if not wants_failure_counts:
            return None

        top_n = self._extract_requested_top_n(query)

        has_debug_fix_route = all(
            (
                self._schema_has_table_column(
                    table_ddls,
                    "dbo_DebugEntries",
                    "DebugEntryId",
                    table_names=table_names,
                ),
                self._schema_has_table_column(
                    table_ddls,
                    "dbo_DebugFixLogs",
                    "DebugEntryId",
                    table_names=table_names,
                ),
                self._schema_has_table_column(
                    table_ddls,
                    "dbo_DebugFixLogs",
                    "FixId",
                    table_names=table_names,
                ),
                self._schema_has_table_column(
                    table_ddls,
                    "dbo_DebugFixes",
                    "Id",
                    table_names=table_names,
                ),
                self._schema_has_table_column(
                    table_ddls,
                    "dbo_DebugFixes",
                    "Description",
                    table_names=table_names,
                ),
            )
        )
        if has_debug_fix_route:
            return (
                'SELECT "dbo_DebugFixes"."Description" AS "failure_category", '
                'COUNT(*) AS "repair_count" '
                'FROM "dbo_DebugEntries" '
                'JOIN "dbo_DebugFixLogs" '
                'ON "dbo_DebugEntries"."DebugEntryId" = "dbo_DebugFixLogs"."DebugEntryId" '
                'JOIN "dbo_DebugFixes" '
                'ON "dbo_DebugFixLogs"."FixId" = "dbo_DebugFixes"."Id" '
                'WHERE "dbo_DebugFixes"."Description" IS NOT NULL '
                'GROUP BY "dbo_DebugFixes"."Description" '
                'ORDER BY "repair_count" DESC '
                f"LIMIT {top_n}"
            )

        has_debug_entries = self._schema_contains(
            table_ddls, r"\bdbo_DebugEntries\b", table_names=table_names
        )
        has_failure_patterns = self._schema_contains(
            table_ddls, r"\bdbo_failure_patterns\b", table_names=table_names
        )
        has_failure_sys = self._schema_contains(
            table_ddls, r"\bFailureSys\b", table_names=table_names
        )
        has_debug_entry_id = self._schema_contains(
            table_ddls, r"\bDebugEntryId\b", table_names=table_names
        )
        has_pattern_id = self._schema_contains(
            table_ddls, r"\bid\b", table_names=table_names
        )
        has_pattern_category = self._schema_contains(
            table_ddls, r"\bcategory\b", table_names=table_names
        )
        has_pattern_name = self._schema_contains(
            table_ddls, r"\bname\b", table_names=table_names
        )

        if (
            has_debug_entries
            and has_failure_patterns
            and has_failure_sys
            and has_debug_entry_id
            and has_pattern_id
            and (has_pattern_category or has_pattern_name)
        ):
            dimension_column = (
                "category"
                if ("category" in normalized and has_pattern_category)
                else ("name" if has_pattern_name else "category")
            )
            return (
                f'SELECT "dbo_failure_patterns"."{dimension_column}" AS "failure_category", '
                f'COUNT("dbo_DebugEntries"."DebugEntryId") AS "repair_count" '
                f'FROM "dbo_DebugEntries" '
                f'JOIN "dbo_failure_patterns" '
                f'ON "dbo_DebugEntries"."FailureSys" = "dbo_failure_patterns"."id" '
                f'WHERE "dbo_failure_patterns"."{dimension_column}" IS NOT NULL '
                f'GROUP BY "dbo_failure_patterns"."{dimension_column}" '
                f'ORDER BY "repair_count" DESC '
                f'LIMIT {top_n}'
            )

        has_repair_logs = self._schema_has_table_column(
            table_ddls,
            "dbo_repair_logs",
            "failure_code",
            table_names=table_names,
        )
        if has_repair_logs:
            return (
                f'SELECT "dbo_repair_logs"."failure_code" AS "failure_category", '
                f'COUNT(*) AS "repair_count" '
                f'FROM "dbo_repair_logs" '
                f'WHERE "dbo_repair_logs"."failure_code" IS NOT NULL '
                f'GROUP BY "dbo_repair_logs"."failure_code" '
                f'ORDER BY "repair_count" DESC '
                f'LIMIT {top_n}'
            )

        return None

    def _build_repair_sla_compliance_sql(
        self,
        query: str,
        table_ddls: list[str],
        table_names: Optional[list[str]] = None,
    ) -> str | None:
        normalized = re.sub(r"\s+", " ", (query or "").strip().lower())
        if not normalized:
            return None

        wants_sla = "sla" in normalized and any(
            term in normalized
            for term in ("compliance", "dashboard", "chart", "repair", "repairs")
        )
        if not wants_sla:
            return None

        has_repair_status = self._schema_has_table_column(
            table_ddls,
            "dbo_repair_logs",
            "status",
            table_names=table_names,
        )
        if has_repair_status:
            return (
                'SELECT "dbo_repair_logs"."status" AS "sla_status", '
                'COUNT(*) AS "repair_count" '
                'FROM "dbo_repair_logs" '
                'WHERE "dbo_repair_logs"."status" IS NOT NULL '
                'GROUP BY "dbo_repair_logs"."status" '
                'ORDER BY "repair_count" DESC'
            )

        return None

    def _build_monthly_repair_volume_sql(
        self,
        query: str,
        table_ddls: list[str],
        table_names: Optional[list[str]] = None,
    ) -> str | None:
        normalized = re.sub(r"\s+", " ", (query or "").strip().lower())
        if not normalized:
            return None

        wants_monthly_repairs = (
            "repair" in normalized
            and any(
                term in normalized
                for term in ("monthly", "last 12 months", "trend", "volume")
            )
        )
        if not wants_monthly_repairs:
            return None

        has_repair_created_at = self._schema_has_table_column(
            table_ddls,
            "dbo_repair_logs",
            "created_at",
            table_names=table_names,
        )
        if has_repair_created_at:
            return (
                'SELECT DATEPART(YEAR, "dbo_repair_logs"."created_at") AS "year", '
                'DATEPART(MONTH, "dbo_repair_logs"."created_at") AS "month", '
                'COUNT(*) AS "repair_count" '
                'FROM "dbo_repair_logs" '
                'WHERE "dbo_repair_logs"."created_at" IS NOT NULL '
                'GROUP BY DATEPART(YEAR, "dbo_repair_logs"."created_at"), '
                'DATEPART(MONTH, "dbo_repair_logs"."created_at") '
                'ORDER BY DATEPART(YEAR, "dbo_repair_logs"."created_at") ASC, '
                'DATEPART(MONTH, "dbo_repair_logs"."created_at") ASC'
            )

        return None

    def _is_direct_heuristic_sql_query(self, query: str) -> bool:
        normalized = re.sub(r"\s+", " ", (query or "").strip().lower())
        if not normalized:
            return False

        asks_manufacturing_throughput = (
            "throughput" in normalized
            and any(term in normalized for term in ("manufacturing", "unit", "units"))
        )
        asks_failure_counts = (
            "failure" in normalized
            and any(
                term in normalized
                for term in ("count", "counts", "common", "most common", "top")
            )
            and any(
                term in normalized
                for term in ("pcb", "repair", "bar chart", "chart", "category")
            )
        )
        asks_sla_compliance = "sla" in normalized and any(
            term in normalized
            for term in ("compliance", "dashboard", "chart", "repair", "repairs")
        )
        asks_monthly_repairs = (
            "repair" in normalized
            and any(
                term in normalized
                for term in ("monthly", "last 12 months", "trend", "volume")
            )
        )
        return (
            asks_manufacturing_throughput
            or asks_failure_counts
            or asks_sla_compliance
            or asks_monthly_repairs
        )

    def _build_heuristic_text_to_sql_fallback(
        self,
        query: str,
        table_ddls: list[str],
        table_names: Optional[list[str]] = None,
    ) -> str | None:
        normalized = re.sub(r"\s+", " ", (query or "").strip().lower())
        if not normalized:
            return None

        if throughput_sql := self._build_manufacturing_throughput_sql(
            query, table_ddls, table_names=table_names
        ):
            return throughput_sql

        if repair_failure_count_sql := self._build_repair_failure_count_sql(
            query, table_ddls, table_names=table_names
        ):
            return repair_failure_count_sql

        if repair_sla_sql := self._build_repair_sla_compliance_sql(
            query, table_ddls, table_names=table_names
        ):
            return repair_sla_sql

        if monthly_repair_volume_sql := self._build_monthly_repair_volume_sql(
            query, table_ddls, table_names=table_names
        ):
            return monthly_repair_volume_sql

        wants_chart = any(
            term in normalized for term in ("chart", "bar chart", "line chart", "graph")
        )
        wants_failure_counts = any(
            term in normalized
            for term in (
                "failure",
                "failure category",
                "failure code",
                "common pcb failures",
                "common failures",
                "most common",
                "top 10",
                "top ten",
            )
        )
        wants_monthly_repairs = (
            "repair" in normalized
            and any(
                term in normalized
                for term in ("monthly", "last 12 months", "trend", "volume")
            )
        )

        if wants_failure_counts and wants_chart:
            top_n = self._extract_requested_top_n(query)
            has_pattern_failure_sys = self._schema_contains(
                table_ddls, r"\bFailuresys\b", table_names=table_names
            )
            has_pattern_occurrences = self._schema_contains(
                table_ddls, r"\boccurrences\b", table_names=table_names
            )
            has_debug_entries = self._schema_contains(
                table_ddls, r"\bdbo_DebugEntries\b", table_names=table_names
            )
            has_failure_patterns = self._schema_contains(
                table_ddls, r"\bdbo_failure_patterns\b", table_names=table_names
            )
            has_failure_sys = self._schema_contains(
                table_ddls, r"\bFailureSys\b", table_names=table_names
            )
            has_debug_entry_id = self._schema_contains(
                table_ddls, r"\bDebugEntryId\b", table_names=table_names
            )
            has_pattern_id = self._schema_contains(
                table_ddls, r"\bid\b", table_names=table_names
            )
            has_pattern_category = self._schema_contains(
                table_ddls, r"\bcategory\b", table_names=table_names
            )
            has_pattern_name = self._schema_contains(
                table_ddls, r"\bname\b", table_names=table_names
            )

            if has_failure_patterns and has_pattern_failure_sys and has_pattern_occurrences:
                return (
                    f'SELECT "dbo_failure_patterns"."Failuresys" AS "failure_category", '
                    f'"dbo_failure_patterns"."occurrences" AS "repair_count" '
                    f'FROM "dbo_failure_patterns" '
                    f'WHERE "dbo_failure_patterns"."Failuresys" IS NOT NULL '
                    f'AND "dbo_failure_patterns"."occurrences" IS NOT NULL '
                    f'ORDER BY "dbo_failure_patterns"."occurrences" DESC '
                    f'LIMIT {top_n}'
                )

            if has_failure_patterns and has_pattern_failure_sys:
                return (
                    f'SELECT "dbo_failure_patterns"."Failuresys" AS "failure_category", '
                    f'COUNT(*) AS "repair_count" '
                    f'FROM "dbo_failure_patterns" '
                    f'WHERE "dbo_failure_patterns"."Failuresys" IS NOT NULL '
                    f'GROUP BY "dbo_failure_patterns"."Failuresys" '
                    f'ORDER BY "repair_count" DESC '
                    f'LIMIT {top_n}'
                )

            if (
                has_debug_entries
                and has_failure_patterns
                and has_failure_sys
                and has_debug_entry_id
                and has_pattern_id
            ):
                dimension_column = (
                    "category"
                    if ("category" in normalized and has_pattern_category)
                    else ("name" if has_pattern_name else "category")
                )
                if dimension_column == "category" and not has_pattern_category:
                    dimension_column = "name"

                return (
                    f'SELECT "dbo_failure_patterns"."{dimension_column}" AS "failure_category", '
                    f'COUNT("dbo_DebugEntries"."DebugEntryId") AS "repair_count" '
                    f'FROM "dbo_DebugEntries" '
                    f'JOIN "dbo_failure_patterns" '
                    f'ON "dbo_DebugEntries"."FailureSys" = "dbo_failure_patterns"."id" '
                    f'WHERE "dbo_failure_patterns"."{dimension_column}" IS NOT NULL '
                    f'GROUP BY "dbo_failure_patterns"."{dimension_column}" '
                    f'ORDER BY "repair_count" DESC '
                    f'LIMIT {top_n}'
                )

            has_repair_logs = self._schema_contains(
                table_ddls, r"\bdbo_repair_logs\b", table_names=table_names
            )
            has_failure_code = self._schema_contains(
                table_ddls, r"\bfailure_code\b", table_names=table_names
            )
            if has_repair_logs and has_failure_code:
                return (
                    f'SELECT "dbo_repair_logs"."failure_code" AS "failure_category", '
                    f'COUNT(*) AS "repair_count" '
                    f'FROM "dbo_repair_logs" '
                    f'WHERE "dbo_repair_logs"."failure_code" IS NOT NULL '
                    f'GROUP BY "dbo_repair_logs"."failure_code" '
                    f'ORDER BY "repair_count" DESC '
                    f'LIMIT {top_n}'
                )

        if wants_failure_counts and wants_chart:
            top_n = self._extract_requested_top_n(query)
            return (
                f'SELECT "dbo_failure_patterns"."Failuresys" AS "failure_category", '
                f'COUNT(*) AS "repair_count" '
                f'FROM "dbo_failure_patterns" '
                f'WHERE "dbo_failure_patterns"."Failuresys" IS NOT NULL '
                f'GROUP BY "dbo_failure_patterns"."Failuresys" '
                f'ORDER BY "repair_count" DESC '
                f'LIMIT {top_n}'
            )

        return None

    def _is_schema_grounded_query(
        self, query: str, db_schemas: Optional[list[str]] = None
    ) -> bool:
        normalized = re.sub(r"\s+", " ", (query or "").strip().lower())
        if not normalized:
            return False

        explicit_schema_terms = (
            "table",
            "column",
            "schema",
            "dataset",
            "dbo.",
            "select ",
            " from ",
            " join ",
            " where ",
            " group by ",
            " order by ",
        )
        if any(term in normalized for term in explicit_schema_terms):
            return True

        identifier_tokens = re.findall(r"[a-zA-Z_][a-zA-Z0-9_\.]*", normalized)
        if any("." in token for token in identifier_tokens):
            return True

        for schema in db_schemas or []:
            schema_text = schema.lower()
            table_matches = re.findall(
                r"create\s+table\s+([a-zA-Z0-9_\.\"]+)", schema_text
            )
            column_matches = re.findall(r"\n\s*\"?([a-zA-Z_][a-zA-Z0-9_]*)\"?\s+", schema_text)
            candidates = {
                token.strip('"')
                for token in table_matches + column_matches
                if token and len(token.strip('"')) > 2
            }
            if any(candidate in normalized for candidate in candidates):
                return True

        return False

    def _get_unqueryable_metric_message(
        self, query: str, table_ddls: list[str]
    ) -> str | None:
        normalized_query = re.sub(r"\s+", " ", (query or "").strip().lower())
        normalized_schema = re.sub(r"\s+", " ", " ".join(table_ddls).lower())
        schema_column_names = self._extract_schema_column_names(table_ddls)

        if not normalized_query:
            return None

        repair_cost_terms = (
            "repair cost",
            "repair_cost",
            "repaircost",
            "cost",
            "cost impact",
            "cost_impact",
        )
        if any(term in normalized_query for term in repair_cost_terms):
            cost_field_patterns = (
                r"\brepair[_ ]?cost\b",
                r"\bcost[_ ]?impact\b",
                r"\bcost[_ ]?amount\b",
                r"\btotal[_ ]?cost\b",
                r"\bunit[_ ]?cost\b",
                r"\bcost\b",
                r"\bamount\b",
            )
            has_cost_field = any(
                re.search(pattern, column_name)
                for pattern in cost_field_patterns
                for column_name in schema_column_names
            )

            if not has_cost_field:
                return (
                    "The schema does not expose repair cost as a queryable "
                    "column. The MSSQL Wren/Ibis runtime cannot extract cost "
                    "from generic JSON/text fields such as data. Add repair "
                    "cost as a first-class column or calculated field, then "
                    "ask again."
                )

        first_pass_yield_terms = (
            "first pass yield",
            "first-pass yield",
            "first_pass_yield",
            "fpy",
        )
        if not any(term in normalized_query for term in first_pass_yield_terms):
            return None

        required_field_patterns = (
            r"\bfirst[_ ]?pass[_ ]?yield\b",
            r"\bfpy\b",
            r"\battempt\b",
            r"\battempt[_ ]?number\b",
            r"\bfirst[_ ]?attempt\b",
            r"\bpass[_ ]?fail\b",
            r"\byield\b",
        )
        has_required_field = any(
            re.search(pattern, normalized_schema)
            for pattern in required_field_patterns
        )

        if has_required_field:
            return None

        return (
            "The schema does not expose first-pass yield, attempt number, "
            "first-attempt result, or pass/fail fields as queryable columns. "
            "I cannot calculate First Pass Yield from only generic JSON/text "
            "fields such as data. Add those fields as first-class columns or "
            "calculated fields, then ask again."
        )

    async def _run_with_timeout(
        self,
        label: str,
        coroutine,
        timeout_seconds: Optional[int] = None,
    ):
        timeout = timeout_seconds or self._pipeline_timeout_seconds
        try:
            return await asyncio.wait_for(
                coroutine,
                timeout=timeout,
            )
        except TimeoutError as exc:
            raise TimeoutError(f"{label} timed out after {timeout} seconds") from exc

    def _build_greeting_response(self, query: str) -> str:
        return (
            f"Hi. I can help with questions about your active datasource and Wren AI.\n\n"
            f"Try a data question like:\n"
            f"- Show monthly trends for the last 12 months\n"
            f"- Compare totals by category\n"
            f"- Which records occur most often?\n\n"
            f"If you want, ask a database question directly instead of `{query}`."
        )

    def _extract_pipeline_reply(self, result: dict, key: str) -> str:
        payload = result.get(key)
        if isinstance(payload, tuple):
            payload = payload[0]

        if isinstance(payload, dict):
            replies = payload.get("replies") or []
            if replies and isinstance(replies[0], str):
                return replies[0]

        return ""

    def _extract_retrieval_documents(self, retrieval_result: dict) -> list[dict]:
        construct_result = retrieval_result.get("construct_retrieval_results", {})
        documents = construct_result.get("retrieval_results", [])
        if not isinstance(documents, list):
            logger.warning("Schema retrieval returned invalid document payload")
            return []

        valid_documents = []
        for document in documents:
            if not isinstance(document, dict):
                logger.warning("Ignoring malformed retrieval document: %s", document)
                continue
            if not document.get("table_name") and not document.get("table_ddl"):
                logger.warning("Ignoring retrieval document without table metadata")
                continue
            valid_documents.append(document)

        return valid_documents

    def _extract_retrieval_metadata(
        self, retrieval_result: dict
    ) -> tuple[list[dict], list[str], list[str]]:
        documents = self._extract_retrieval_documents(retrieval_result)
        table_names = [
            table_name
            for document in documents
            if isinstance(table_name := document.get("table_name"), str)
            and table_name.strip()
        ]
        table_ddls = [
            table_ddl
            for document in documents
            if isinstance(table_ddl := document.get("table_ddl"), str)
            and table_ddl.strip()
        ]
        return documents, table_names, table_ddls

    def _is_valid_select_sql(self, sql: Optional[str]) -> bool:
        if not isinstance(sql, str):
            return False

        normalized = re.sub(r"\s+", " ", sql.strip())
        if not normalized:
            return False

        return bool(re.match(r"^(?:WITH|SELECT)\b", normalized, flags=re.IGNORECASE))

    def _build_ask_result_from_sql(self, sql: Optional[str]) -> Optional[AskResult]:
        if not self._is_valid_select_sql(sql):
            return None
        return AskResult(sql=sql.strip(), type="llm")

    def _build_failed_text_to_sql_response(
        self,
        trace_id: Optional[str],
        message: str,
        *,
        rephrased_question: Optional[str] = None,
        intent_reasoning: Optional[str] = None,
        retrieved_tables: Optional[list[str]] = None,
        sql_generation_reasoning: Optional[str] = None,
        invalid_sql: Optional[str] = None,
        is_followup: bool = False,
        code: Literal["NO_RELEVANT_DATA", "NO_RELEVANT_SQL", "OTHERS"] = "NO_RELEVANT_SQL",
    ) -> AskResultResponse:
        return AskResultResponse(
            status="failed",
            type="TEXT_TO_SQL",
            error=AskError(code=code, message=message),
            rephrased_question=rephrased_question,
            intent_reasoning=intent_reasoning,
            retrieved_tables=retrieved_tables,
            sql_generation_reasoning=sql_generation_reasoning,
            invalid_sql=invalid_sql,
            trace_id=trace_id,
            is_followup=is_followup,
        )

    @observe(name="Ask Question")
    @trace_metadata
    async def ask(
        self,
        ask_request: AskRequest,
        **kwargs,
    ):
        trace_id = kwargs.get("trace_id")
        results = {
            "ask_result": {},
            "metadata": {
                "type": "",
                "error_type": "",
                "error_message": "",
                "request_from": ask_request.request_from,
            },
        }

        query_id = ask_request.query_id
        if not query_id:
            raise ValueError("query_id is required for ask service execution")

        user_query = (ask_request.query or "").strip()
        if not user_query:
            self._ask_results[query_id] = self._build_failed_text_to_sql_response(
                trace_id,
                "Question is required",
                code="OTHERS",
            )
            results["metadata"]["error_type"] = "OTHERS"
            results["metadata"]["error_message"] = "Question is required"
            results["metadata"]["type"] = "TEXT_TO_SQL"
            return results

        logger.info(f"Ask pipeline started for query_id: {query_id}")
        histories = ask_request.histories[: self._max_histories][
            ::-1
        ]  # reverse the order of histories
        rephrased_question = None
        intent_reasoning = None
        sql_generation_reasoning = None
        sql_samples = []
        instructions = []
        api_results = []
        table_names = []
        error_message = None
        invalid_sql = None
        allow_sql_generation_reasoning = (
            self._allow_sql_generation_reasoning
            and not ask_request.ignore_sql_generation_reasoning
        )
        enable_column_pruning = (
            self._enable_column_pruning or ask_request.enable_column_pruning
        )
        allow_sql_functions_retrieval = self._allow_sql_functions_retrieval
        allow_sql_diagnosis = self._allow_sql_diagnosis
        allow_sql_knowledge_retrieval = self._allow_sql_knowledge_retrieval
        max_sql_correction_retries = self._max_sql_correction_retries
        current_sql_correction_retries = 0
        use_dry_plan = ask_request.use_dry_plan
        allow_dry_plan_fallback = ask_request.allow_dry_plan_fallback
        sql_knowledge = None

        try:
            sql_user_query = user_query

            # ask status can be understanding, searching, generating, finished, failed, stopped
            # we will need to handle business logic for each status
            if not self._is_stopped(query_id, self._ask_results):
                self._ask_results[query_id] = AskResultResponse(
                    status="understanding",
                    trace_id=trace_id,
                    is_followup=True if histories else False,
                )

                if self._is_greeting_query(user_query):
                    self._general_streaming_results[query_id] = (
                        self._build_greeting_response(user_query)
                    )

                    self._ask_results[query_id] = AskResultResponse(
                        status="finished",
                        type="GENERAL",
                        trace_id=trace_id,
                        is_followup=True if histories else False,
                        general_type="USER_GUIDE",
                    )
                    results["metadata"]["type"] = "GENERAL"
                    return results

                if self._is_direct_heuristic_sql_query(user_query):
                    self._ask_results[query_id] = AskResultResponse(
                        status="searching",
                        type="TEXT_TO_SQL",
                        trace_id=trace_id,
                        is_followup=True if histories else False,
                    )
                    retrieval_result = await self._run_with_timeout(
                        "Schema retrieval",
                        self._pipelines["db_schema_retrieval"].run(
                            query=user_query,
                            histories=histories,
                            project_id=ask_request.project_id,
                            enable_column_pruning=False,
                        ),
                    )
                    documents, table_names, table_ddls = (
                        self._extract_retrieval_metadata(retrieval_result)
                    )
                    logger.info(
                        "Retrieved tables for direct heuristic query_id %s: %s",
                        query_id,
                        table_names,
                    )

                    if heuristic_sql := self._build_heuristic_text_to_sql_fallback(
                        user_query, table_ddls, table_names=table_names
                    ):
                        logger.info(
                            "Using direct heuristic text-to-sql fallback for query_id %s: %s",
                            query_id,
                            user_query,
                        )
                        if ask_result := self._build_ask_result_from_sql(
                            heuristic_sql
                        ):
                            api_results = [ask_result]
                            if not self._is_stopped(query_id, self._ask_results):
                                self._ask_results[query_id] = AskResultResponse(
                                    status="finished",
                                    type="TEXT_TO_SQL",
                                    response=api_results,
                                    rephrased_question=user_query,
                                    retrieved_tables=table_names,
                                    trace_id=trace_id,
                                    is_followup=True if histories else False,
                                )
                            results["ask_result"] = api_results
                            results["metadata"]["type"] = "TEXT_TO_SQL"
                            return results
                        invalid_sql = heuristic_sql
                        error_message = "Heuristic SQL fallback did not produce a valid SELECT statement."

                historical_question = await self._run_with_timeout(
                    "Historical question retrieval",
                    self._pipelines["historical_question"].run(
                        query=user_query,
                        project_id=ask_request.project_id,
                    ),
                )

                # we only return top 1 result
                historical_question_result = historical_question.get(
                    "formatted_output", {}
                ).get("documents", [])[:1]

                valid_historical_results = []
                for result in historical_question_result:
                    sql_statement = result.get("statement")
                    if not self._is_valid_select_sql(sql_statement):
                        logger.warning(
                            "Ignoring historical question without valid SQL for query_id %s",
                            query_id,
                        )
                        continue
                    valid_historical_results.append(
                        AskResult(
                            **{
                                "sql": sql_statement.strip(),
                                "type": "view" if result.get("viewId") else "llm",
                                "viewId": result.get("viewId"),
                            }
                        )
                    )

                if valid_historical_results:
                    api_results = valid_historical_results
                    sql_generation_reasoning = ""
                else:
                    original_user_query = user_query
                    # Run both pipeline operations concurrently
                    sql_samples_task, instructions_task = await self._run_with_timeout(
                        "SQL pair and instruction retrieval",
                        asyncio.gather(
                            self._pipelines["sql_pairs_retrieval"].run(
                                query=user_query,
                                project_id=ask_request.project_id,
                            ),
                            self._pipelines["instructions_retrieval"].run(
                                query=user_query,
                                project_id=ask_request.project_id,
                                scope="sql",
                            ),
                        ),
                    )

                    # Extract results from completed tasks
                    sql_samples = sql_samples_task["formatted_output"].get(
                        "documents", []
                    )
                    instructions = instructions_task["formatted_output"].get(
                        "documents", []
                    )

                    if self._allow_intent_classification:
                        try:
                            intent_classification_result = (
                                await self._run_with_timeout(
                                    "Intent classification",
                                    self._pipelines["intent_classification"].run(
                                        query=user_query,
                                        histories=histories,
                                        sql_samples=sql_samples,
                                        instructions=instructions,
                                        project_id=ask_request.project_id,
                                        configuration=ask_request.configurations,
                                    ),
                                )
                            ).get("post_process", {})
                        except TimeoutError as exc:
                            logger.warning(
                                "Intent classification timed out; continuing with TEXT_TO_SQL. query_id=%s project_id=%s error=%s",
                                query_id,
                                ask_request.project_id,
                                exc,
                            )
                            intent_classification_result = {
                                "intent": "TEXT_TO_SQL",
                                "rephrased_question": user_query,
                                "reasoning": "Intent classification timed out; using SQL generation.",
                                "db_schemas": [],
                            }
                        intent = intent_classification_result.get("intent")
                        rephrased_question = intent_classification_result.get(
                            "rephrased_question"
                        )
                        intent_reasoning = intent_classification_result.get("reasoning")
                        retrieved_db_schemas = intent_classification_result.get(
                            "db_schemas"
                        ) or []
                        is_original_analytics_query = self._is_data_analysis_query(
                            original_user_query
                        )
                        is_schema_grounded_query = self._is_schema_grounded_query(
                            original_user_query, retrieved_db_schemas
                        ) or self._is_schema_grounded_query(
                            rephrased_question or "", retrieved_db_schemas
                        )

                        if intent in {"GENERAL", "MISLEADING_QUERY", "USER_GUIDE"} and (
                            is_original_analytics_query
                            or is_schema_grounded_query
                            or self._is_data_analysis_query(rephrased_question or "")
                        ):
                            logger.info(
                                "Overriding intent %s to TEXT_TO_SQL for schema/data query: %s",
                                intent,
                                user_query,
                            )
                            intent = "TEXT_TO_SQL"

                        if is_original_analytics_query:
                            if rephrased_question and rephrased_question != user_query:
                                logger.info(
                                    "Ignoring rephrased analytics query from intent classification. original=%s rephrased=%s",
                                    original_user_query,
                                    rephrased_question,
                                )
                            user_query = original_user_query
                            rephrased_question = original_user_query
                        elif rephrased_question:
                            user_query = rephrased_question

                        sql_user_query = (
                            self._rewrite_query_for_text_to_sql(user_query)
                            if self._is_data_analysis_query(user_query)
                            else user_query
                        )

                        if intent == "MISLEADING_QUERY":
                            general_result = await self._run_with_timeout(
                                "Misleading assistance",
                                self._pipelines["misleading_assistance"].run(
                                    query=user_query,
                                    histories=histories,
                                    db_schemas=intent_classification_result.get(
                                        "db_schemas"
                                    ),
                                    language=ask_request.configurations.language,
                                    custom_instruction=ask_request.custom_instruction,
                                ),
                            )
                            self._general_streaming_results[query_id] = (
                                self._extract_pipeline_reply(
                                    general_result, "misleading_assistance"
                                )
                            )

                            self._ask_results[query_id] = AskResultResponse(
                                status="finished",
                                type="MISLEADING_QUERY",
                                rephrased_question=rephrased_question,
                                intent_reasoning=intent_reasoning,
                                trace_id=trace_id,
                                is_followup=True if histories else False,
                                general_type="MISLEADING_QUERY",
                            )
                            results["metadata"]["type"] = "MISLEADING_QUERY"
                            return results
                        elif intent == "GENERAL":
                            general_result = await self._run_with_timeout(
                                "Data assistance",
                                self._pipelines["data_assistance"].run(
                                    query=user_query,
                                    histories=histories,
                                    db_schemas=intent_classification_result.get(
                                        "db_schemas"
                                    ),
                                    language=ask_request.configurations.language,
                                    custom_instruction=ask_request.custom_instruction,
                                ),
                            )
                            self._general_streaming_results[query_id] = (
                                self._extract_pipeline_reply(
                                    general_result, "data_assistance"
                                )
                            )

                            self._ask_results[query_id] = AskResultResponse(
                                status="finished",
                                type="GENERAL",
                                rephrased_question=rephrased_question,
                                intent_reasoning=intent_reasoning,
                                trace_id=trace_id,
                                is_followup=True if histories else False,
                                general_type="DATA_ASSISTANCE",
                            )
                            results["metadata"]["type"] = "GENERAL"
                            return results
                        elif intent == "USER_GUIDE":
                            general_result = await self._run_with_timeout(
                                "User guide assistance",
                                self._pipelines["user_guide_assistance"].run(
                                    query=user_query,
                                    language=ask_request.configurations.language,
                                    custom_instruction=ask_request.custom_instruction,
                                ),
                            )
                            self._general_streaming_results[query_id] = (
                                self._extract_pipeline_reply(
                                    general_result, "user_guide_assistance"
                                )
                            )

                            self._ask_results[query_id] = AskResultResponse(
                                status="finished",
                                type="GENERAL",
                                rephrased_question=rephrased_question,
                                intent_reasoning=intent_reasoning,
                                trace_id=trace_id,
                                is_followup=True if histories else False,
                                general_type="USER_GUIDE",
                            )
                            results["metadata"]["type"] = "GENERAL"
                            return results
                        else:
                            self._ask_results[query_id] = AskResultResponse(
                                status="understanding",
                                type="TEXT_TO_SQL",
                                rephrased_question=rephrased_question,
                                intent_reasoning=intent_reasoning,
                                trace_id=trace_id,
                                is_followup=True if histories else False,
                            )
            if not self._is_stopped(query_id, self._ask_results) and not api_results:
                self._ask_results[query_id] = AskResultResponse(
                    status="searching",
                    type="TEXT_TO_SQL",
                    rephrased_question=rephrased_question,
                    intent_reasoning=intent_reasoning,
                    trace_id=trace_id,
                    is_followup=True if histories else False,
                )

                retrieval_result = await self._run_with_timeout(
                    "Schema retrieval",
                    self._pipelines["db_schema_retrieval"].run(
                        query=sql_user_query,
                        histories=histories,
                        project_id=ask_request.project_id,
                        enable_column_pruning=(
                            enable_column_pruning
                            and not self._is_data_analysis_query(user_query)
                        ),
                    ),
                    timeout_seconds=self._schema_retrieval_timeout_seconds,
                )
                _retrieval_result = retrieval_result.get(
                    "construct_retrieval_results", {}
                )
                documents, table_names, table_ddls = (
                    self._extract_retrieval_metadata(retrieval_result)
                )
                logger.info(
                    "Retrieved tables for query_id %s: %s", query_id, table_names
                )

                if unqueryable_metric_message := self._get_unqueryable_metric_message(
                    user_query, table_ddls
                ):
                    logger.info(
                        "ask pipeline - NO_RELEVANT_SQL due to unqueryable metric: %s",
                        user_query,
                    )
                    if not self._is_stopped(query_id, self._ask_results):
                        self._ask_results[query_id] = AskResultResponse(
                            status="failed",
                            type="TEXT_TO_SQL",
                            error=AskError(
                                code="NO_RELEVANT_SQL",
                                message=unqueryable_metric_message,
                            ),
                            rephrased_question=rephrased_question,
                            intent_reasoning=intent_reasoning,
                            retrieved_tables=table_names,
                            trace_id=trace_id,
                            is_followup=True if histories else False,
                        )
                    results["metadata"]["error_type"] = "NO_RELEVANT_SQL"
                    results["metadata"]["error_message"] = unqueryable_metric_message
                    results["metadata"]["type"] = "TEXT_TO_SQL"
                    return results

                if not documents:
                    if heuristic_sql := self._build_heuristic_text_to_sql_fallback(
                        user_query, table_ddls, table_names=table_names
                    ):
                        logger.info(
                            "Using heuristic text-to-sql fallback before retrieval failure for query_id %s: %s",
                            query_id,
                            user_query,
                        )
                        ask_result = self._build_ask_result_from_sql(heuristic_sql)
                        if not ask_result:
                            invalid_sql = heuristic_sql
                            error_message = "Heuristic SQL fallback did not produce a valid SELECT statement."
                            if not self._is_stopped(query_id, self._ask_results):
                                self._ask_results[query_id] = (
                                    self._build_failed_text_to_sql_response(
                                        trace_id,
                                        error_message,
                                        rephrased_question=rephrased_question,
                                        intent_reasoning=intent_reasoning,
                                        retrieved_tables=table_names,
                                        invalid_sql=invalid_sql,
                                        is_followup=True if histories else False,
                                    )
                                )
                            results["metadata"]["error_type"] = "NO_RELEVANT_SQL"
                            results["metadata"]["error_message"] = error_message
                            results["metadata"]["type"] = "TEXT_TO_SQL"
                            return results
                        api_results = [ask_result]
                        if not self._is_stopped(query_id, self._ask_results):
                            self._ask_results[query_id] = AskResultResponse(
                                status="finished",
                                type="TEXT_TO_SQL",
                                response=api_results,
                                rephrased_question=rephrased_question,
                                intent_reasoning=intent_reasoning,
                                retrieved_tables=table_names,
                                trace_id=trace_id,
                                is_followup=True if histories else False,
                            )
                        results["ask_result"] = api_results
                        results["metadata"]["type"] = "TEXT_TO_SQL"
                        return results

                    logger.exception(f"ask pipeline - NO_RELEVANT_DATA: {user_query}")
                    if not self._is_stopped(query_id, self._ask_results):
                        self._ask_results[query_id] = AskResultResponse(
                            status="failed",
                            type="TEXT_TO_SQL",
                            error=AskError(
                                code="NO_RELEVANT_DATA",
                                message="No relevant data",
                            ),
                            rephrased_question=rephrased_question,
                            intent_reasoning=intent_reasoning,
                            trace_id=trace_id,
                            is_followup=True if histories else False,
                        )
                    results["metadata"]["error_type"] = "NO_RELEVANT_DATA"
                    results["metadata"]["type"] = "TEXT_TO_SQL"
                    return results

            if (
                not self._is_stopped(query_id, self._ask_results)
                and not api_results
                and allow_sql_generation_reasoning
            ):
                self._ask_results[query_id] = AskResultResponse(
                    status="planning",
                    type="TEXT_TO_SQL",
                    rephrased_question=rephrased_question,
                    intent_reasoning=intent_reasoning,
                    retrieved_tables=table_names,
                    trace_id=trace_id,
                    is_followup=True if histories else False,
                )

                if histories:
                    try:
                        sql_generation_reasoning = (
                            await self._run_with_timeout(
                                "Follow-up SQL generation reasoning",
                                self._pipelines[
                                    "followup_sql_generation_reasoning"
                                ].run(
                                    query=sql_user_query,
                                    contexts=table_ddls,
                                    histories=histories,
                                    sql_samples=sql_samples,
                                    instructions=instructions,
                                    configuration=ask_request.configurations,
                                    query_id=query_id,
                                ),
                            )
                        ).get("post_process", {})
                    except Exception as reasoning_error:
                        logger.warning(
                            "Follow-up SQL generation reasoning failed for query_id %s; continuing without reasoning: %s",
                            query_id,
                            reasoning_error,
                        )
                        sql_generation_reasoning = ""
                else:
                    try:
                        sql_generation_reasoning = (
                            await self._run_with_timeout(
                                "SQL generation reasoning",
                                self._pipelines["sql_generation_reasoning"].run(
                                    query=sql_user_query,
                                    contexts=table_ddls,
                                    sql_samples=sql_samples,
                                    instructions=instructions,
                                    configuration=ask_request.configurations,
                                    query_id=query_id,
                                ),
                            )
                        ).get("post_process", {})
                    except Exception as reasoning_error:
                        logger.warning(
                            "SQL generation reasoning failed for query_id %s; continuing without reasoning: %s",
                            query_id,
                            reasoning_error,
                        )
                        sql_generation_reasoning = ""

                self._ask_results[query_id] = AskResultResponse(
                    status="planning",
                    type="TEXT_TO_SQL",
                    rephrased_question=rephrased_question,
                    intent_reasoning=intent_reasoning,
                    retrieved_tables=table_names,
                    sql_generation_reasoning=sql_generation_reasoning,
                    trace_id=trace_id,
                    is_followup=True if histories else False,
                )

            if not self._is_stopped(query_id, self._ask_results) and not api_results:
                self._ask_results[query_id] = AskResultResponse(
                    status="generating",
                    type="TEXT_TO_SQL",
                    rephrased_question=rephrased_question,
                    intent_reasoning=intent_reasoning,
                    retrieved_tables=table_names,
                    sql_generation_reasoning=sql_generation_reasoning,
                    trace_id=trace_id,
                    is_followup=True if histories else False,
                )

                sql_functions, sql_knowledge = await self._run_with_timeout(
                    "SQL helper retrieval",
                    asyncio.gather(
                        (
                            self._pipelines["sql_functions_retrieval"].run(
                                project_id=ask_request.project_id,
                            )
                            if allow_sql_functions_retrieval
                            else _return_value([])
                        ),
                        (
                            self._pipelines["sql_knowledge_retrieval"].run(
                                project_id=ask_request.project_id,
                            )
                            if allow_sql_knowledge_retrieval
                            else _return_value(None)
                        ),
                    ),
                )

                has_calculated_field = _retrieval_result.get(
                    "has_calculated_field", False
                )
                has_metric = _retrieval_result.get("has_metric", False)
                has_json_field = _retrieval_result.get("has_json_field", False)

                if histories:
                    text_to_sql_generation_results = await self._run_with_timeout(
                        "Follow-up SQL generation",
                        self._pipelines["followup_sql_generation"].run(
                            query=sql_user_query,
                            contexts=table_ddls,
                            sql_generation_reasoning=sql_generation_reasoning,
                            histories=histories,
                            project_id=ask_request.project_id,
                            sql_samples=sql_samples,
                            instructions=instructions,
                            has_calculated_field=has_calculated_field,
                            has_metric=has_metric,
                            has_json_field=has_json_field,
                            sql_functions=sql_functions,
                            use_dry_plan=use_dry_plan,
                            allow_dry_plan_fallback=allow_dry_plan_fallback,
                            sql_knowledge=sql_knowledge,
                        ),
                    )
                else:
                    text_to_sql_generation_results = await self._run_with_timeout(
                        "SQL generation",
                        self._pipelines["sql_generation"].run(
                            query=sql_user_query,
                            contexts=table_ddls,
                            sql_generation_reasoning=sql_generation_reasoning,
                            project_id=ask_request.project_id,
                            sql_samples=sql_samples,
                            instructions=instructions,
                            has_calculated_field=has_calculated_field,
                            has_metric=has_metric,
                            has_json_field=has_json_field,
                            sql_functions=sql_functions,
                            use_dry_plan=use_dry_plan,
                            allow_dry_plan_fallback=allow_dry_plan_fallback,
                            sql_knowledge=sql_knowledge,
                        ),
                    )

                if sql_valid_result := text_to_sql_generation_results["post_process"][
                    "valid_generation_result"
                ]:
                    if ask_result := self._build_ask_result_from_sql(
                        sql_valid_result.get("sql")
                    ):
                        api_results = [ask_result]
                    else:
                        invalid_sql = sql_valid_result.get("sql")
                        error_message = (
                            "SQL generation did not produce a valid SELECT statement."
                        )
                elif failed_dry_run_result := text_to_sql_generation_results[
                    "post_process"
                ]["invalid_generation_result"]:
                    while current_sql_correction_retries < max_sql_correction_retries:
                        if failed_dry_run_result["type"] in {
                            "TIME_OUT",
                            "UNSUPPORTED_SQL",
                        }:
                            invalid_sql = failed_dry_run_result.get("sql", invalid_sql)
                            error_message = failed_dry_run_result.get(
                                "error", error_message
                            )
                            break

                        original_sql = failed_dry_run_result["original_sql"]
                        invalid_sql = failed_dry_run_result["sql"]
                        error_message = failed_dry_run_result["error"]
                        sql_diagnosis_reasoning = None
                        current_sql_correction_retries += 1

                        self._ask_results[query_id] = AskResultResponse(
                            status="correcting",
                            type="TEXT_TO_SQL",
                            rephrased_question=rephrased_question,
                            intent_reasoning=intent_reasoning,
                            retrieved_tables=table_names,
                            sql_generation_reasoning=sql_generation_reasoning,
                            trace_id=trace_id,
                            is_followup=True if histories else False,
                        )

                        if allow_sql_diagnosis:
                            sql_diagnosis_results = await self._run_with_timeout(
                                "SQL diagnosis",
                                self._pipelines["sql_diagnosis"].run(
                                    contexts=table_ddls,
                                    original_sql=original_sql,
                                    invalid_sql=invalid_sql,
                                    error_message=error_message,
                                    language=ask_request.configurations.language,
                                ),
                            )
                            sql_diagnosis_reasoning = sql_diagnosis_results[
                                "post_process"
                            ].get("reasoning")

                        correction_error_message = error_message
                        if sql_diagnosis_reasoning:
                            correction_error_message = (
                                f"{error_message}\nDiagnosis: {sql_diagnosis_reasoning}"
                            )

                        sql_correction_results = await self._run_with_timeout(
                            "SQL correction",
                            self._pipelines["sql_correction"].run(
                                contexts=table_ddls,
                                instructions=instructions,
                                invalid_generation_result={
                                    "original_sql": original_sql,
                                    "sql": invalid_sql,
                                    "error": correction_error_message,
                                },
                                project_id=ask_request.project_id,
                                use_dry_plan=use_dry_plan,
                                allow_dry_plan_fallback=allow_dry_plan_fallback,
                                sql_functions=sql_functions,
                                sql_knowledge=sql_knowledge,
                                query=sql_user_query,
                            ),
                        )

                        if valid_generation_result := sql_correction_results[
                            "post_process"
                        ]["valid_generation_result"]:
                            if ask_result := self._build_ask_result_from_sql(
                                valid_generation_result.get("sql")
                            ):
                                api_results = [ask_result]
                                break
                            invalid_sql = valid_generation_result.get("sql")
                            error_message = (
                                "SQL correction did not produce a valid SELECT statement."
                            )

                        failed_dry_run_result = sql_correction_results["post_process"][
                            "invalid_generation_result"
                        ]
                        invalid_sql = failed_dry_run_result.get("sql", invalid_sql)
                        error_message = failed_dry_run_result.get(
                            "error", error_message
                        )

            if api_results:
                if not self._is_stopped(query_id, self._ask_results):
                    self._ask_results[query_id] = AskResultResponse(
                        status="finished",
                        type="TEXT_TO_SQL",
                        response=api_results,
                        rephrased_question=rephrased_question,
                        intent_reasoning=intent_reasoning,
                        retrieved_tables=table_names,
                        sql_generation_reasoning=sql_generation_reasoning,
                        trace_id=trace_id,
                        is_followup=True if histories else False,
                    )
                results["ask_result"] = api_results
                results["metadata"]["type"] = "TEXT_TO_SQL"
            else:
                if heuristic_sql := self._build_heuristic_text_to_sql_fallback(
                    user_query, table_ddls, table_names=table_names
                ):
                    logger.info(
                        "Using heuristic text-to-sql fallback for query_id %s: %s",
                        query_id,
                        user_query,
                    )
                    ask_result = self._build_ask_result_from_sql(heuristic_sql)
                    if not ask_result:
                        invalid_sql = heuristic_sql
                        error_message = "Heuristic SQL fallback did not produce a valid SELECT statement."
                    else:
                        api_results = [ask_result]
                        if not self._is_stopped(query_id, self._ask_results):
                            self._ask_results[query_id] = AskResultResponse(
                                status="finished",
                                type="TEXT_TO_SQL",
                                response=api_results,
                                rephrased_question=rephrased_question,
                                intent_reasoning=intent_reasoning,
                                retrieved_tables=table_names,
                                sql_generation_reasoning=sql_generation_reasoning,
                                trace_id=trace_id,
                                is_followup=True if histories else False,
                            )
                        results["ask_result"] = api_results
                        results["metadata"]["type"] = "TEXT_TO_SQL"
                        return results

                logger.exception(f"ask pipeline - NO_RELEVANT_SQL: {user_query}")
                if not self._is_stopped(query_id, self._ask_results):
                    self._ask_results[query_id] = AskResultResponse(
                        status="failed",
                        type="TEXT_TO_SQL",
                        error=AskError(
                            code="NO_RELEVANT_SQL",
                            message=error_message or "No relevant SQL",
                        ),
                        rephrased_question=rephrased_question,
                        intent_reasoning=intent_reasoning,
                        retrieved_tables=table_names,
                        sql_generation_reasoning=sql_generation_reasoning,
                        invalid_sql=invalid_sql,
                        trace_id=trace_id,
                        is_followup=True if histories else False,
                    )
                results["metadata"]["error_type"] = "NO_RELEVANT_SQL"
                results["metadata"]["error_message"] = error_message
                results["metadata"]["type"] = "TEXT_TO_SQL"

            return results
        except Exception as e:
            logger.exception(f"ask pipeline - OTHERS: {e}")

            self._ask_results[query_id] = AskResultResponse(
                status="failed",
                type="TEXT_TO_SQL",
                error=AskError(
                    code="OTHERS",
                    message=str(e),
                ),
                trace_id=trace_id,
                is_followup=True if histories else False,
            )

            results["metadata"]["error_type"] = "OTHERS"
            results["metadata"]["error_message"] = str(e)
            results["metadata"]["type"] = "TEXT_TO_SQL"
            return results

    def stop_ask(
        self,
        stop_ask_request: StopAskRequest,
    ):
        self._ask_results[stop_ask_request.query_id] = AskResultResponse(
            status="stopped",
        )

    def get_ask_result(
        self,
        ask_result_request: AskResultRequest,
    ) -> AskResultResponse:
        if (result := self._ask_results.get(ask_result_request.query_id)) is None:
            logger.exception(
                f"ask pipeline - OTHERS: {ask_result_request.query_id} is not found"
            )
            return AskResultResponse(
                status="failed",
                type="TEXT_TO_SQL",
                error=AskError(
                    code="OTHERS",
                    message=f"{ask_result_request.query_id} is not found",
                ),
            )

        return result

    async def get_ask_streaming_result(
        self,
        query_id: str,
    ):
        if general_response := self._general_streaming_results.get(query_id):
            event = SSEEvent(
                data=SSEEvent.SSEEventMessage(message=general_response),
            )
            yield event.serialize()
            return

        if self._ask_results.get(query_id):
            _pipeline_name = ""
            if self._ask_results.get(query_id).type == "GENERAL":
                if self._ask_results.get(query_id).general_type == "USER_GUIDE":
                    _pipeline_name = "user_guide_assistance"
                elif self._ask_results.get(query_id).general_type == "DATA_ASSISTANCE":
                    _pipeline_name = "data_assistance"
                elif self._ask_results.get(query_id).general_type == "MISLEADING_QUERY":
                    _pipeline_name = "misleading_assistance"
            elif self._ask_results.get(query_id).status == "planning":
                if self._ask_results.get(query_id).is_followup:
                    _pipeline_name = "followup_sql_generation_reasoning"
                else:
                    _pipeline_name = "sql_generation_reasoning"

            if _pipeline_name:
                async for chunk in self._pipelines[
                    _pipeline_name
                ].get_streaming_results(query_id):
                    event = SSEEvent(
                        data=SSEEvent.SSEEventMessage(message=chunk),
                    )
                    yield event.serialize()
