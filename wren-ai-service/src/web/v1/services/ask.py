import asyncio
import logging
import re
from typing import Any, Dict, List, Literal, Optional

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
            if not isinstance(ddl, str):
                continue
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
                column_names.append(str(column_name).lower())

        return column_names

    def _parse_schema_tables(self, table_ddls: list[str]) -> list[dict[str, Any]]:
        tables: list[dict[str, Any]] = []
        for ddl in table_ddls or []:
            if not isinstance(ddl, str):
                continue
            table_match = re.search(
                r'\bCREATE\s+TABLE\s+(?:"(?P<quoted>[^"]+)"|'
                r"\[(?P<bracketed>[^\]]+)\]|`(?P<backticked>[^`]+)`|"
                r"(?P<bare>[A-Za-z_][A-Za-z0-9_.$]*))\s*\(",
                ddl,
                flags=re.IGNORECASE,
            )
            if not table_match:
                continue

            table_name = next(
                (value for value in table_match.groupdict().values() if value),
                None,
            )
            if not table_name:
                continue
            body_start = table_match.end()
            depth = 1
            body_end = body_start
            while body_end < len(ddl) and depth > 0:
                if ddl[body_end] == "(":
                    depth += 1
                elif ddl[body_end] == ")":
                    depth -= 1
                body_end += 1

            columns: list[dict[str, str]] = []
            for line in ddl[body_start : body_end - 1].splitlines():
                stripped = line.strip().rstrip(",")
                if not stripped or stripped.startswith(("--", "/*")):
                    continue
                if re.match(
                    r"^(?:PRIMARY|FOREIGN|CONSTRAINT|UNIQUE|KEY)\b",
                    stripped,
                    flags=re.IGNORECASE,
                ):
                    continue

                column_match = re.match(
                    r'(?:"(?P<quoted>[^"]+)"|\[(?P<bracketed>[^\]]+)\]|'
                    r"`(?P<backticked>[^`]+)`|(?P<bare>[A-Za-z_][A-Za-z0-9_$]*))"
                    r"\s+(?P<type>[A-Za-z0-9_(),]+)",
                    stripped,
                )
                if column_match:
                    column_name = next(
                        (value
                        for key, value in column_match.groupdict().items()
                        if key != "type" and value
                        ),
                        None,
                    )
                    if not column_name:
                        continue
                    column_type = column_match.group("type") or ""
                    columns.append(
                        {
                            "name": str(column_name),
                            "type": str(column_type).lower(),
                        }
                    )

            tables.append({"name": table_name, "columns": columns})

        return tables

    def _is_numeric_schema_type(self, column_type: str) -> bool:
        return bool(
            re.search(
                r"\b(?:int|integer|bigint|smallint|tinyint|decimal|numeric|float|double|"
                r"real|money|number)\b",
                column_type,
                flags=re.IGNORECASE,
            )
        )

    def _is_temporal_schema_type(self, column_type: str) -> bool:
        return bool(
            re.search(
                r"\b(?:date|time|timestamp|datetime|smalldatetime)\b",
                column_type,
                flags=re.IGNORECASE,
            )
        )

    def _is_text_schema_type(self, column_type: str) -> bool:
        return bool(
            re.search(
                r"\b(?:char|text|string|varchar|nvarchar|uuid|guid|json)\b",
                column_type,
                flags=re.IGNORECASE,
            )
        )

    def _find_schema_column(
        self,
        table: dict[str, Any],
        candidates: tuple[str, ...],
        numeric: bool | None = None,
        temporal: bool | None = None,
    ) -> str | None:
        normalized_candidates = [
            re.sub(r"[^a-z0-9]", "", str(candidate).lower())
            for candidate in candidates
            if candidate is not None
        ]
        if not normalized_candidates:
            return None
        scored: list[tuple[int, str]] = []
        for column in table.get("columns", []):
            column_name = column.get("name")
            if not column_name:
                continue
            column_name = str(column_name)
            normalized_column = re.sub(r"[^a-z0-9]", "", column_name.lower())
            column_type = str(column.get("type") or "")
            if numeric is True and not self._is_numeric_schema_type(column_type):
                continue
            if temporal is True and not self._is_temporal_schema_type(column_type):
                continue

            for candidate in normalized_candidates:
                if normalized_column == candidate:
                    scored.append((100, column_name))
                elif candidate and candidate in normalized_column:
                    scored.append((60 + len(candidate), column_name))
                elif normalized_column and normalized_column in candidate:
                    scored.append((40 + len(normalized_column), column_name))

        if not scored:
            return None

        return sorted(scored, reverse=True)[0][1]

    def _find_first_schema_column(
        self,
        table: dict[str, Any],
        candidates: tuple[str, ...],
        *,
        avoid: set[str] | None = None,
    ) -> str | None:
        avoid = {str(column).lower() for column in avoid or set()}
        for candidate_group in candidates:
            column = self._find_schema_column(table, (candidate_group,))
            if column and column.lower() not in avoid:
                return column
        return None

    def _quote_sql_identifier(self, identifier: str) -> str:
        return f'"{identifier.replace(chr(34), chr(34) + chr(34))}"'

    def _build_explicit_table_preview_sql(
        self, query: str, table_ddls: list[str]
    ) -> tuple[str, str] | None:
        normalized_query = re.sub(r"\s+", " ", (query or "").strip())
        if not normalized_query:
            return None

        if not re.search(
            r"\b(?:first|top|sample|preview|show|list)\b",
            normalized_query,
            flags=re.IGNORECASE,
        ):
            return None
        if not re.search(
            r"\b(?:rows?|records?|data)\b", normalized_query, flags=re.IGNORECASE
        ):
            return None

        tables = self._parse_schema_tables(table_ddls)
        if not tables:
            return None

        normalized_query_key = re.sub(r"[^a-z0-9]", "", normalized_query.lower())
        scored_tables: list[tuple[int, str]] = []
        for table in tables:
            table_name = table.get("name")
            if not table_name:
                continue
            table_name = str(table_name)
            normalized_table = re.sub(r"[^a-z0-9]", "", table_name.lower())
            if not normalized_table:
                continue
            if normalized_table in normalized_query_key:
                scored_tables.append((100 + len(normalized_table), table_name))
                continue

            table_without_schema = re.split(r"[.$]", table_name)[-1]
            normalized_short_name = re.sub(
                r"[^a-z0-9]", "", table_without_schema.lower()
            )
            if normalized_short_name and normalized_short_name in normalized_query_key:
                scored_tables.append((80 + len(normalized_short_name), table_name))

        if not scored_tables:
            return None

        _, table_name = sorted(scored_tables, reverse=True)[0]
        limit = self._extract_requested_top_n(query, default_value=10)
        return (
            f"SELECT TOP {limit} * FROM {self._quote_sql_identifier(table_name)}",
            table_name,
        )

    def _extract_explicit_table_names_from_query(self, query: str) -> list[str]:
        table_names: list[str] = []
        for match in re.finditer(
            r"\b(?:from|table|model)\s+([A-Za-z_][A-Za-z0-9_.$]*)",
            query or "",
            flags=re.IGNORECASE,
        ):
            table_name = match.group(1).strip(".,;:()[]{}")
            if table_name and table_name not in table_names:
                table_names.append(table_name)
        return table_names

    def _build_direct_orders_sales_sql(self, query: str) -> str | None:
        normalized = re.sub(r"\s+", " ", (query or "").strip().lower())
        if not normalized:
            return None

        is_sales_or_orders_query = any(
            term in normalized
            for term in (
                "sales",
                "sale",
                "order",
                "orders",
                "new order",
                "new orders",
                "market",
                "salesperson",
                "sales person",
            )
        )
        if not is_sales_or_orders_query:
            return None

        table_ref = '"dbo_tblSales"'
        limit = self._extract_requested_top_n(query, default_value=10)

        if (
            ("salesperson" in normalized or "sales person" in normalized)
            and ("order count" in normalized or "orders" in normalized or "count" in normalized)
        ):
            return (
                f'SELECT TOP {limit} {table_ref}."SalesPerson" AS "SalesPerson", '
                f'COUNT(*) AS "OrderCount" '
                f"FROM {table_ref} "
                f'WHERE {table_ref}."SalesPerson" IS NOT NULL '
                f'GROUP BY {table_ref}."SalesPerson" '
                f"ORDER BY COUNT(*) DESC"
            )

        if "top" in normalized and "new order" in normalized:
            date_filter = ""
            if re.search(r"\b2026[\s-]*q1\b", normalized):
                date_filter = (
                    f'WHERE {table_ref}."OrdDate" >= \'2026-01-01 00:00:00\' '
                    f'AND {table_ref}."OrdDate" < \'2026-04-01 00:00:00\' '
                )
            return (
                f'SELECT TOP {limit} {table_ref}."BU" AS "BU", '
                f'{table_ref}."Market" AS "Market", '
                f'{table_ref}."Customer" AS "Customer", '
                f'{table_ref}."ProdName" AS "ProdName", '
                f'{table_ref}."SalesValue" AS "SalesValue" '
                f"FROM {table_ref} "
                f"{date_filter}"
                f'ORDER BY {table_ref}."SalesValue" DESC'
            )

        if (
            "market" in normalized
            and "growth" in normalized
            and any(term in normalized for term in ("last year", "previous year"))
        ):
            return (
                f'SELECT {table_ref}."Market" AS "Market", '
                f"SUM(CASE WHEN {table_ref}.\"OrdDate\" >= '2026-01-01 00:00:00' "
                f"AND {table_ref}.\"OrdDate\" < '2026-07-01 00:00:00' "
                f'THEN {table_ref}."SalesValue" ELSE 0 END) AS "CurrentPeriodSales", '
                f"SUM(CASE WHEN {table_ref}.\"OrdDate\" >= '2025-01-01 00:00:00' "
                f"AND {table_ref}.\"OrdDate\" < '2025-07-01 00:00:00' "
                f'THEN {table_ref}."SalesValue" ELSE 0 END) AS "PreviousPeriodSales", '
                f"SUM(CASE WHEN {table_ref}.\"OrdDate\" >= '2026-01-01 00:00:00' "
                f"AND {table_ref}.\"OrdDate\" < '2026-07-01 00:00:00' "
                f'THEN {table_ref}."SalesValue" ELSE 0 END) - '
                f"SUM(CASE WHEN {table_ref}.\"OrdDate\" >= '2025-01-01 00:00:00' "
                f"AND {table_ref}.\"OrdDate\" < '2025-07-01 00:00:00' "
                f'THEN {table_ref}."SalesValue" ELSE 0 END) AS "SalesGrowth" '
                f"FROM {table_ref} "
                f'WHERE {table_ref}."Market" IS NOT NULL '
                f'GROUP BY {table_ref}."Market" '
                f'ORDER BY "SalesGrowth" DESC'
            )

        if (
            "distribution" in normalized
            and "sales" in normalized
            and ("market" in normalized or "by market" in normalized)
        ):
            return (
                f'SELECT {table_ref}."Market" AS "Market", '
                f'SUM({table_ref}."SalesValue") AS "TotalSalesValue" '
                f"FROM {table_ref} "
                f'WHERE {table_ref}."Market" IS NOT NULL '
                f'GROUP BY {table_ref}."Market" '
                f'ORDER BY SUM({table_ref}."SalesValue") DESC'
            )

        return None

    def _extract_explicit_table_column_reference(
        self, query: str
    ) -> tuple[str, str] | None:
        normalized_query = query or ""
        reference_match = re.search(
            r"\b(?P<schema>[A-Za-z_][A-Za-z0-9_]*)[._]"
            r"(?P<table>[A-Za-z_][A-Za-z0-9_]*)[._]"
            r"(?P<column>[A-Za-z_][A-Za-z0-9_]*)\b",
            normalized_query,
        )
        if not reference_match:
            return None

        schema = reference_match.group("schema")
        table = reference_match.group("table")
        column = reference_match.group("column")
        table_name = f"{schema}_{table}"
        return table_name, column

    def _build_explicit_group_count_sql(self, query: str) -> str | None:
        normalized_query = re.sub(r"\s+", " ", (query or "").strip().lower())
        if not normalized_query:
            return None

        if not any(
            term in normalized_query
            for term in (
                "group by",
                "grouped by",
                "by ",
                "pie chart",
                "donut chart",
                "bar chart",
                "count",
                "counts",
            )
        ):
            return None

        explicit_reference = self._extract_explicit_table_column_reference(query)
        if not explicit_reference:
            return None

        table_name, column = explicit_reference
        table_ref = self._quote_sql_identifier(table_name)
        column_ref = f"{table_ref}.{self._quote_sql_identifier(column)}"
        return (
            f"SELECT {column_ref} AS {self._quote_sql_identifier(column)}, "
            f'COUNT(*) AS "RecordCount" '
            f"FROM {table_ref} "
            f"GROUP BY {column_ref} "
            f"ORDER BY COUNT(*) DESC"
        )

    def _build_date_filter(self, table_name: str, date_column: str, query: str) -> str:
        date_ref = (
            f"{self._quote_sql_identifier(table_name)}."
            f"{self._quote_sql_identifier(date_column)}"
        )
        normalized_query = (query or "").lower()
        if "this year" in normalized_query or "current year" in normalized_query:
            return (
                f" WHERE {date_ref} >= '2026-01-01 00:00:00' "
                f"AND {date_ref} < '2027-01-01 00:00:00'"
            )
        year_match = re.search(r"\b(20\d{2})\b", normalized_query)
        if year_match:
            year = int(year_match.group(1))
            return (
                f" WHERE {date_ref} >= '{year}-01-01 00:00:00' "
                f"AND {date_ref} < '{year + 1}-01-01 00:00:00'"
            )
        return ""

    def _select_best_analytics_table(
        self,
        tables: list[dict[str, Any]],
        required_dimensions: list[tuple[str, ...]],
        measure_candidates: tuple[str, ...],
        wants_date: bool = False,
    ) -> tuple[dict[str, Any], list[str], str | None, str | None] | None:
        scored: list[
            tuple[int, dict[str, Any], list[str], str | None, str | None]
        ] = []
        for table in tables:
            dimensions = [
                self._find_schema_column(table, candidates)
                for candidates in required_dimensions
            ]
            if any(dimension is None for dimension in dimensions):
                continue

            measure = self._find_schema_column(
                table, measure_candidates, numeric=True
            )
            date_column = self._find_schema_column(
                table,
                (
                    "OrdDate",
                    "InvDate",
                    "OrderDate",
                    "NewOrderDate",
                    "Date",
                    "CreatedAt",
                    "created_at",
                ),
                temporal=True,
            )
            if wants_date and not date_column:
                continue

            score = 10 * len([dimension for dimension in dimensions if dimension])
            if measure:
                score += 8
            if date_column:
                score += 4
            table_name = str(table.get("name") or "").lower()
            if not table_name:
                continue
            if "sales" in table_name:
                score += 5
            if "stage" in table_name:
                score -= 8

            scored.append((score, table, dimensions, measure, date_column))

        if not scored:
            return None

        _, table, dimensions, measure, date_column = sorted(
            scored, key=lambda item: item[0], reverse=True
        )[0]
        return (
            table,
            [dimension for dimension in dimensions if dimension],
            measure,
            date_column,
        )

    def _build_schema_grounded_analytics_sql(
        self, query: str, table_ddls: list[str]
    ) -> str | None:
        normalized_query = re.sub(r"\s+", " ", (query or "").strip().lower())
        if not normalized_query:
            return None

        tables = self._parse_schema_tables(table_ddls)
        if not tables:
            return None

        compact_query = re.sub(r"[^a-z0-9]", "", normalized_query)

        if operational_sql := self._build_schema_grounded_operational_sql(
            query, tables
        ):
            return operational_sql

        if conversion_sql := self._build_order_invoice_conversion_sql(
            query, tables
        ):
            return conversion_sql

        if yoy_sql := self._build_yoy_sales_change_sql(query, tables):
            return yoy_sql

        if contribution_sql := self._build_contribution_sql(query, tables):
            return contribution_sql

        wants_monthly_count = (
            "monthly" in normalized_query
            and any(term in normalized_query for term in ("count", "volume"))
            and any(term in normalized_query for term in ("order", "orders"))
        )
        if wants_monthly_count:
            date_candidates = (
                ("InvDate", "InvoiceDate", "Invoice Date")
                if "invdate" in compact_query or "invoice" in normalized_query
                else (
                    "OrdDate",
                    "OrderDate",
                    "NewOrderDate",
                    "InvDate",
                    "InvoiceDate",
                    "Date",
                )
            )
            scored_tables: list[tuple[int, dict[str, Any], str]] = []
            for table in tables:
                date_column = self._find_schema_column(
                    table, date_candidates, temporal=True
                )
                if not date_column:
                    continue
                table_name = str(table.get("name") or "")
                score = 10
                if "sales" in table_name.lower() or "order" in table_name.lower():
                    score += 5
                if self._find_schema_column(
                    table, ("OrdNo", "OrderNo", "OrderId", "InvoiceNo")
                ):
                    score += 3
                scored_tables.append((score, table, date_column))

            if scored_tables:
                _, table, date_column = sorted(
                    scored_tables, key=lambda item: item[0], reverse=True
                )[0]
                table_name = table.get("name")
                if table_name and date_column:
                    table_name = str(table_name)
                    table_ref = self._quote_sql_identifier(table_name)
                    date_ref = (
                        f"{table_ref}.{self._quote_sql_identifier(date_column)}"
                    )
                    return (
                        f"SELECT DATEPART(YEAR, {date_ref}) AS \"year\", "
                        f"DATEPART(MONTH, {date_ref}) AS \"month\", "
                        f'COUNT(*) AS "OrderCount" '
                        f"FROM {table_ref}"
                        f"{self._build_date_filter(table_name, date_column, query)} "
                        f"GROUP BY DATEPART(YEAR, {date_ref}), "
                        f"DATEPART(MONTH, {date_ref}) "
                        f"ORDER BY DATEPART(YEAR, {date_ref}), "
                        f"DATEPART(MONTH, {date_ref})"
                    )

        dimension_candidates: list[tuple[str, ...]] = []
        if "salesperson" in normalized_query or "sales person" in normalized_query:
            dimension_candidates.append(("SalesPerson", "Sales Rep", "SalesRep"))
        if "business unit" in normalized_query or "bu" in normalized_query:
            dimension_candidates.append(("BusinessUnit", "Business Unit", "BU"))
        if "market" in normalized_query:
            dimension_candidates.append(("Market", "MarketType"))
        if "division" in normalized_query:
            dimension_candidates.append(("Division",))
        if (
            "product type" in normalized_query
            or "prodtype" in normalized_query
            or "producttype" in compact_query
            or "prodtype" in compact_query
        ):
            dimension_candidates.append(("ProdType", "ProductType", "Product Type"))
        elif "product" in normalized_query:
            dimension_candidates.append(
                ("ProdName", "Product", "ProductName", "Item", "ProdCode")
            )
        if "customer" in normalized_query:
            dimension_candidates.append(("Customer", "CustName", "CustNo"))

        if not dimension_candidates:
            return None

        measure_candidates = (
            "NewOrderValue",
            "NewOrdersValue",
            "InvoiceValue",
            "InvoiceAmount",
            "OrderValue",
            "SalesValue",
            "FXSalesValue",
            "Revenue",
            "Amount",
            "Value",
            "Cost",
            "Qty",
            "Quantity",
        )
        if "invoice" in normalized_query:
            measure_candidates = (
                "InvoiceValue",
                "InvoiceAmount",
                "SalesValue",
                "FXSalesValue",
                "Value",
                "Amount",
            )
        wants_trend = "trend" in normalized_query or "line chart" in normalized_query
        wants_top = bool(re.search(r"\btop\s+\d+\b", normalized_query))
        wants_detail_rows = (
            wants_top
            and ("new order" in normalized_query or "orders" in normalized_query)
            and any(term in normalized_query for term in ("including", "include"))
        )
        wants_date = wants_trend or "this year" in normalized_query or bool(
            re.search(r"\b20\d{2}\b", normalized_query)
        )

        selected = self._select_best_analytics_table(
            tables,
            dimension_candidates,
            measure_candidates,
            wants_date=wants_date,
        )
        if not selected:
            return None

        table, dimensions, measure, date_column = selected
        table_name = table.get("name")
        if not table_name:
            return None
        table_name = str(table_name)
        table_ref = self._quote_sql_identifier(table_name)
        dimension_refs = [
            f"{table_ref}.{self._quote_sql_identifier(dimension)}"
            for dimension in dimensions
        ]

        if wants_detail_rows:
            if not measure:
                return None
            metric_ref = f"{table_ref}.{self._quote_sql_identifier(measure)}"
            limit_match = re.search(r"\btop\s+(\d+)\b", normalized_query)
            limit = int(limit_match.group(1)) if limit_match else 20
            select_parts = [
                f"{dimension_ref} AS {self._quote_sql_identifier(dimensions[index])}"
                for index, dimension_ref in enumerate(dimension_refs)
            ]
            select_parts.append(
                f"{metric_ref} AS {self._quote_sql_identifier(measure)}"
            )
            date_filter = (
                self._build_date_filter(table_name, date_column, query)
                if date_column
                else ""
            )
            return (
                f"SELECT TOP {limit} {', '.join(select_parts)} "
                f"FROM {table_ref}{date_filter} "
                f"ORDER BY {metric_ref} DESC"
            )

        if wants_trend and date_column:
            date_ref = f"{table_ref}.{self._quote_sql_identifier(date_column)}"
            metric_expr = (
                f"SUM({table_ref}.{self._quote_sql_identifier(measure)})"
                if measure
                else "COUNT(*)"
            )
            metric_alias = f"Total{measure}" if measure else "OrderCount"
            select_parts = [
                f"DATEPART(YEAR, {date_ref}) AS \"year\"",
                f"DATEPART(MONTH, {date_ref}) AS \"month\"",
                *[
                    f"{dimension_ref} AS {self._quote_sql_identifier(dimensions[index])}"
                    for index, dimension_ref in enumerate(dimension_refs)
                ],
                f"{metric_expr} AS {self._quote_sql_identifier(metric_alias)}",
            ]
            group_parts = [
                f"DATEPART(YEAR, {date_ref})",
                f"DATEPART(MONTH, {date_ref})",
                *dimension_refs,
            ]
            return (
                f"SELECT {', '.join(select_parts)} FROM {table_ref}"
                f"{self._build_date_filter(table_name, date_column, query)} "
                f"GROUP BY {', '.join(group_parts)} "
                f"ORDER BY DATEPART(YEAR, {date_ref}), "
                f"DATEPART(MONTH, {date_ref})"
            )

        metric_expr = (
            f"SUM({table_ref}.{self._quote_sql_identifier(measure)})"
            if measure
            else "COUNT(*)"
        )
        metric_alias = f"Total{measure}" if measure else "OrderCount"
        limit_match = re.search(r"\btop\s+(\d+)\b", normalized_query)
        limit = int(limit_match.group(1)) if limit_match else 10
        top_clause = f"TOP {limit} " if wants_top else ""
        date_filter = (
            self._build_date_filter(table_name, date_column, query)
            if date_column
            else ""
        )
        select_parts = [
            f"{dimension_ref} AS {self._quote_sql_identifier(dimensions[index])}"
            for index, dimension_ref in enumerate(dimension_refs)
        ]
        select_parts.append(
            f"{metric_expr} AS {self._quote_sql_identifier(metric_alias)}"
        )
        return (
            f"SELECT {top_clause}{', '.join(select_parts)} "
            f"FROM {table_ref}{date_filter} "
            f"GROUP BY {', '.join(dimension_refs)} "
            f"ORDER BY {metric_expr} DESC"
        )

    def _build_contribution_sql(
        self, query: str, tables: list[dict[str, Any]]
    ) -> str | None:
        normalized_query = re.sub(r"\s+", " ", (query or "").strip().lower())
        if not any(term in normalized_query for term in ("contribution", "pie chart")):
            return None

        compact_query = re.sub(r"[^a-z0-9]", "", normalized_query)
        dimension_candidates: tuple[str, ...] | None = None
        if (
            "product type" in normalized_query
            or "prodtype" in normalized_query
            or "producttype" in compact_query
            or "prodtype" in compact_query
        ):
            dimension_candidates = ("ProdType", "ProductType", "Product Type")
        elif "market" in normalized_query:
            dimension_candidates = ("Market", "MarketType")
        elif "division" in normalized_query:
            dimension_candidates = ("Division",)
        elif "customer" in normalized_query:
            dimension_candidates = ("Customer", "CustName", "CustNo")

        if not dimension_candidates:
            return None

        selected = self._select_best_analytics_table(
            tables,
            [dimension_candidates],
            (
                "SalesValue",
                "FXSalesValue",
                "OrderValue",
                "NewOrderValue",
                "Revenue",
                "Value",
                "Amount",
            ),
            wants_date=False,
        )
        if not selected:
            return None

        table, dimensions, measure, _date_column = selected
        table_name = table.get("name")
        if not (table_name and dimensions and measure):
            return None

        table_name = str(table_name)
        table_ref = self._quote_sql_identifier(table_name)
        dimension = dimensions[0]
        dimension_ref = f"{table_ref}.{self._quote_sql_identifier(dimension)}"
        metric_expr = f"SUM({table_ref}.{self._quote_sql_identifier(measure)})"
        return (
            f"SELECT {dimension_ref} AS {self._quote_sql_identifier(dimension)}, "
            f"{metric_expr} AS \"Total{measure}\" "
            f"FROM {table_ref} "
            f"GROUP BY {dimension_ref} "
            f"ORDER BY {metric_expr} DESC"
        )

    def _build_order_invoice_conversion_sql(
        self, query: str, tables: list[dict[str, Any]]
    ) -> str | None:
        normalized_query = re.sub(r"\s+", " ", (query or "").strip().lower())
        if not (
            "conversion" in normalized_query
            and "order" in normalized_query
            and "invoice" in normalized_query
        ):
            return None

        scored: list[tuple[int, dict[str, Any], str, str, str | None]] = []
        for table in tables:
            order_column = self._find_schema_column(
                table, ("OrdNo", "OrderNo", "OrderNumber", "NewOrderNo")
            )
            invoice_column = self._find_schema_column(
                table, ("InvoiceNo", "InvNo", "InvoiceNumber")
            )
            date_column = self._find_schema_column(
                table,
                ("OrdDate", "InvDate", "OrderDate", "InvoiceDate", "Date"),
                temporal=True,
            )
            if not (order_column and invoice_column):
                continue

            score = 20
            if date_column:
                score += 5
            if "sales" in str(table.get("name") or "").lower():
                score += 5
            scored.append((score, table, order_column, invoice_column, date_column))

        if not scored:
            return None

        _, table, order_column, invoice_column, date_column = sorted(
            scored, key=lambda item: item[0], reverse=True
        )[0]
        table_name = table.get("name")
        if not table_name:
            return None

        table_name = str(table_name)
        table_ref = self._quote_sql_identifier(table_name)
        order_ref = f"{table_ref}.{self._quote_sql_identifier(order_column)}"
        invoice_ref = f"{table_ref}.{self._quote_sql_identifier(invoice_column)}"
        date_column = date_column or order_column
        date_ref = f"{table_ref}.{self._quote_sql_identifier(date_column)}"
        return (
            f"SELECT DATEPART(YEAR, {date_ref}) AS \"year\", "
            f"DATEPART(MONTH, {date_ref}) AS \"month\", "
            f"COUNT(DISTINCT {order_ref}) AS \"OrderCount\", "
            f"COUNT(DISTINCT {invoice_ref}) AS \"InvoiceCount\", "
            f"(COUNT(DISTINCT {invoice_ref}) * 100.0 / "
            f"NULLIF(COUNT(DISTINCT {order_ref}), 0)) AS \"ConversionRate\" "
            f"FROM {table_ref} "
            f"WHERE {order_ref} IS NOT NULL "
            f"GROUP BY DATEPART(YEAR, {date_ref}), DATEPART(MONTH, {date_ref}) "
            f"ORDER BY DATEPART(YEAR, {date_ref}), DATEPART(MONTH, {date_ref})"
        )

    def _build_yoy_sales_change_sql(
        self, query: str, tables: list[dict[str, Any]]
    ) -> str | None:
        normalized_query = re.sub(r"\s+", " ", (query or "").strip().lower())
        if not any(term in normalized_query for term in ("yoy", "year over year")):
            return None

        required_dimensions: list[tuple[str, ...]] = []
        if "customer" in normalized_query:
            required_dimensions.append(("Customer", "CustName", "CustNo"))
        if "product" in normalized_query:
            required_dimensions.append(
                ("ProdName", "Product", "ProductName", "Item", "ProdCode")
            )
        if "market" in normalized_query:
            required_dimensions.append(("Market", "MarketType"))

        if not required_dimensions:
            return None

        selected = self._select_best_analytics_table(
            tables,
            required_dimensions,
            (
                "SalesValue",
                "FXSalesValue",
                "OrderValue",
                "NewOrderValue",
                "Revenue",
                "Value",
                "Amount",
            ),
            wants_date=False,
        )
        if not selected:
            return None

        table, dimensions, measure, date_column = selected
        table_name = table.get("name")
        if not (table_name and measure):
            return None

        year_column = self._find_schema_column(
            table, ("YearInd", "Year", "OrderYear", "InvoiceYear"), numeric=True
        )
        table_name = str(table_name)
        table_ref = self._quote_sql_identifier(table_name)
        if year_column:
            year_expr = f"{table_ref}.{self._quote_sql_identifier(year_column)}"
        elif date_column:
            year_expr = (
                f"DATEPART(YEAR, "
                f"{table_ref}.{self._quote_sql_identifier(date_column)})"
            )
        else:
            return None

        metric_expr = f"SUM({table_ref}.{self._quote_sql_identifier(measure)})"
        dimension_refs = [
            f"{table_ref}.{self._quote_sql_identifier(dimension)}"
            for dimension in dimensions
        ]
        select_parts = [
            f"{year_expr} AS \"year\"",
            *[
                f"{dimension_ref} AS {self._quote_sql_identifier(dimensions[index])}"
                for index, dimension_ref in enumerate(dimension_refs)
            ],
            f"{metric_expr} AS \"Total{measure}\"",
        ]
        group_parts = [year_expr, *dimension_refs]
        return (
            f"SELECT {', '.join(select_parts)} "
            f"FROM {table_ref} "
            f"GROUP BY {', '.join(group_parts)} "
            f"ORDER BY {year_expr}, {metric_expr} DESC"
        )

    def _extract_requested_top_n(self, query: str, default_value: int = 10) -> int:
        if match := re.search(r"\btop\s+(\d+)\b", query or "", flags=re.IGNORECASE):
            return max(1, min(int(match.group(1)), 100))
        if match := re.search(
            r"\b(?:first|limit)\s+(\d+)\b", query or "", flags=re.IGNORECASE
        ):
            return max(1, min(int(match.group(1)), 100))
        if match := re.search(r"\b(\d+)\s+rows?\b", query or "", flags=re.IGNORECASE):
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

    def _build_audit_log_activity_sql(
        self,
        query: str,
        table_ddls: list[str],
        table_names: Optional[list[str]] = None,
    ) -> str | None:
        normalized = re.sub(r"\s+", " ", (query or "").strip().lower())
        if not normalized:
            return None

        if not (
            "audit" in normalized
            and "log" in normalized
            and any(term in normalized for term in ("activity", "over time", "trend"))
        ):
            return None

        table_name = "dbo_audit_log"
        timestamp_column = "created_at"
        if not self._schema_has_table_column(
            table_ddls,
            table_name,
            timestamp_column,
            table_names=table_names,
        ):
            return None

        dimension_column = None
        condition_candidates = (
            "is_name_condition",
            "name",
            "action",
            "entity_type",
        )
        activity_candidates = (
            "action",
            "entity_type",
            "actor_name",
            "actor_user_id",
            "name",
        )
        candidates = (
            condition_candidates
            if "condition" in normalized
            else activity_candidates
        )
        for candidate in candidates:
            if self._schema_has_table_column(
                table_ddls,
                table_name,
                candidate,
                table_names=table_names,
            ):
                dimension_column = candidate
                break

        if not dimension_column:
            return None

        timestamp_expression = f'"{table_name}"."{timestamp_column}"'
        dimension_expression = f'"{table_name}"."{dimension_column}"'
        return (
            f"SELECT DATEPART(YEAR, {timestamp_expression}) AS \"year\", "
            f"DATEPART(MONTH, {timestamp_expression}) AS \"month\", "
            f"{dimension_expression} AS \"{dimension_column}\", "
            f'COUNT(*) AS "activity_count" '
            f'FROM "{table_name}" '
            f"WHERE {timestamp_expression} IS NOT NULL "
            f"AND {dimension_expression} IS NOT NULL "
            f"GROUP BY DATEPART(YEAR, {timestamp_expression}), "
            f"DATEPART(MONTH, {timestamp_expression}), "
            f"{dimension_expression} "
            f"ORDER BY DATEPART(YEAR, {timestamp_expression}), "
            f"DATEPART(MONTH, {timestamp_expression}), "
            f'"activity_count" DESC'
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
    def _build_schema_grounded_operational_sql(
        self, query: str, tables: list[dict[str, Any]]
    ) -> str | None:
        normalized_query = re.sub(r"\s+", " ", (query or "").strip().lower())
        if not normalized_query:
            return None

        operational_terms = (
            "ticket",
            "repair",
            "failure",
            "component",
            "board",
            "throughput",
            "manufacturing",
            "unit",
            "knowledge",
            "article",
            "source",
            "category",
            "priority",
            "status",
            "open",
            "closed",
            "aging",
            "volume",
            "count",
        )
        if not any(term in normalized_query for term in operational_terms):
            return None

        scored_tables: list[tuple[int, dict[str, Any]]] = []
        for table in tables:
            table_name = str(table.get("name") or "")
            normalized_table = table_name.lower()
            score = 0
            if any(
                token in normalized_table
                for token in ("ticket", "repair", "debug", "knowledge", "article")
            ):
                score += 10
            if "ticket" in normalized_query and "ticket" in normalized_table:
                score += 8
            if "knowledge" in normalized_query and "knowledge" in normalized_table:
                score += 8
            if "article" in normalized_query and "article" in normalized_table:
                score += 5
            if "repair" in normalized_query and "repair" in normalized_table:
                score += 5
            if self._find_schema_column(
                table,
                ("created_at", "updated_at", "DateIn", "DateOut", "created", "date"),
                temporal=True,
            ):
                score += 3
            if score:
                scored_tables.append((score, table))

        if not scored_tables:
            return None

        table = sorted(scored_tables, key=lambda item: item[0], reverse=True)[0][1]
        table_name = str(table.get("name") or "")
        if not table_name:
            return None

        table_ref = self._quote_sql_identifier(table_name)
        date_column = self._find_schema_column(
            table,
            (
                "created_at",
                "created",
                "DateIn",
                "RepairDate",
                "updated_at",
                "DateOut",
                "updated",
                "date",
            ),
            temporal=True,
        )

        dimension_candidates: list[tuple[str, ...]] = []
        if "manufacturing" in normalized_query or "unit" in normalized_query:
            dimension_candidates.append(
                (
                    "manufacturing_unit",
                    "manufacturing unit",
                    "unit",
                    "assignee_user_id",
                    "created_by_user_id",
                    "org_id",
                    "status",
                )
            )
        if "component" in normalized_query:
            dimension_candidates.append(
                ("component", "component_type", "board_type", "title", "status")
            )
        if "board" in normalized_query:
            dimension_candidates.append(("board_type", "board", "title", "status"))
        if "category" in normalized_query:
            dimension_candidates.append(("category", "subcategory", "status", "priority"))
        if "source" in normalized_query:
            dimension_candidates.append(("source", "author", "category", "status"))
        if "priority" in normalized_query:
            dimension_candidates.append(("priority", "status"))
        if (
            "status" in normalized_query
            or "open" in normalized_query
            or "closed" in normalized_query
        ):
            dimension_candidates.append(("status", "priority"))
        if "assignee" in normalized_query:
            dimension_candidates.append(("assignee_user_id", "created_by_user_id"))

        dimensions: list[str] = []
        for candidates in dimension_candidates:
            dimension = self._find_schema_column(table, candidates)
            if dimension and dimension not in dimensions:
                dimensions.append(dimension)

        if not dimensions:
            fallback_dimension = self._find_first_schema_column(
                table,
                (
                    "status",
                    "priority",
                    "category",
                    "subcategory",
                    "author",
                    "assignee_user_id",
                    "created_by_user_id",
                    "org_id",
                    "title",
                ),
            )
            if fallback_dimension:
                dimensions.append(fallback_dimension)

        wants_trend = any(
            term in normalized_query
            for term in ("trend", "monthly", "month", "line chart", "over time")
        )
        wants_top = bool(re.search(r"\btop\s+\d+\b", normalized_query))
        limit_match = re.search(r"\btop\s+(\d+)\b", normalized_query)
        limit = int(limit_match.group(1)) if limit_match else 10

        if wants_trend and date_column:
            date_ref = f"{table_ref}.{self._quote_sql_identifier(date_column)}"
            select_parts = [
                f"DATEPART(YEAR, {date_ref}) AS \"year\"",
                f"DATEPART(MONTH, {date_ref}) AS \"month\"",
            ]
            group_parts = [
                f"DATEPART(YEAR, {date_ref})",
                f"DATEPART(MONTH, {date_ref})",
            ]
            for dimension in dimensions[:2]:
                dimension_ref = f"{table_ref}.{self._quote_sql_identifier(dimension)}"
                select_parts.append(
                    f"{dimension_ref} AS {self._quote_sql_identifier(dimension)}"
                )
                group_parts.append(dimension_ref)
            select_parts.append('COUNT(*) AS "RecordCount"')
            return (
                f"SELECT {', '.join(select_parts)} "
                f"FROM {table_ref} "
                f"GROUP BY {', '.join(group_parts)} "
                f"ORDER BY DATEPART(YEAR, {date_ref}), "
                f"DATEPART(MONTH, {date_ref})"
            )

        if dimensions:
            top_clause = f"TOP {limit} " if wants_top else ""
            dimension_refs = [
                f"{table_ref}.{self._quote_sql_identifier(dimension)}"
                for dimension in dimensions[:2]
            ]
            select_parts = [
                f"{dimension_ref} AS {self._quote_sql_identifier(dimensions[index])}"
                for index, dimension_ref in enumerate(dimension_refs)
            ]
            select_parts.append('COUNT(*) AS "RecordCount"')
            return (
                f"SELECT {top_clause}{', '.join(select_parts)} "
                f"FROM {table_ref} "
                f"GROUP BY {', '.join(dimension_refs)} "
                f"ORDER BY COUNT(*) DESC"
            )

        return f'SELECT COUNT(*) AS "RecordCount" FROM {table_ref}'

    def _get_unqueryable_metric_message(
        self, query: str, table_ddls: list[str]
    ) -> str | None:
        normalized_query = re.sub(r"\s+", " ", (query or "").strip().lower())
        normalized_schema = re.sub(
            r"\s+",
            " ",
            " ".join(ddl for ddl in table_ddls if isinstance(ddl, str)).lower(),
        )
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

    def _build_schema_grounded_sales_sql(
        self, query: str, table_ddls: list[str]
    ) -> str | None:
        normalized_query = re.sub(r"\s+", " ", (query or "").strip().lower())
        normalized_schema = "\n".join(
            ddl for ddl in table_ddls or [] if isinstance(ddl, str)
        ).lower()
        if not normalized_query or not normalized_schema:
            return None

        asks_for_salesperson_performance = (
            any(
                term in normalized_query
                for term in (
                    "salesperson performance",
                    "sales person performance",
                    "sales rep performance",
                    "salesperson ranking",
                    "sales person ranking",
                    "sales rep ranking",
                )
            )
            or (
                "salesperson" in normalized_query
                and any(term in normalized_query for term in ("performance", "ranking"))
            )
        )
        if not asks_for_salesperson_performance:
            return self._build_schema_grounded_analytics_sql(query, table_ddls)

        required_schema_terms = (
            "create table dbo_tblsales",
            "salesperson",
            "salesvalue",
        )
        if not all(term in normalized_schema for term in required_schema_terms):
            return None

        limit = 20 if re.search(r"\btop\s+20\b", normalized_query) else 10
        return (
            f'SELECT TOP {limit} '
            f'"dbo_tblSales"."SalesPerson" AS "SalesPerson", '
            f'SUM("dbo_tblSales"."SalesValue") AS "TotalSalesValue" '
            f'FROM "dbo_tblSales" '
            f'WHERE "dbo_tblSales"."SalesPerson" IS NOT NULL '
            f'GROUP BY "dbo_tblSales"."SalesPerson" '
            f'ORDER BY SUM("dbo_tblSales"."SalesValue") DESC'
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

    def _build_validated_ask_result_from_sql(
        self,
        sql: Optional[str],
        table_ddls: list[str],
    ) -> Optional[AskResult]:
        ask_result = self._build_ask_result_from_sql(sql)
        if not ask_result:
            return None

        schema_tables = self._parse_schema_tables(table_ddls)
        valid_tables = {
            str(table.get("name") or "").lower(): table
            for table in schema_tables
            if table.get("name")
        }
        valid_table_suffixes = {
            table_name.split(".")[-1].lower(): table
            for table_name, table in valid_tables.items()
        }

        table_reference_pattern = re.compile(
            r'\b(?:FROM|JOIN)\s+(?:"(?P<quoted>[^"]+)"|'
            r"\[(?P<bracketed>[^\]]+)\]|(?P<bare>[A-Za-z_][A-Za-z0-9_.$]*))",
            flags=re.IGNORECASE,
        )
        referenced_tables = [
            next(value for value in match.groupdict().values() if value)
            for match in table_reference_pattern.finditer(ask_result.sql)
        ]
        invalid_tables = [
            table
            for table in referenced_tables
            if table.lower() not in valid_tables
            and table.lower().split(".")[-1] not in valid_table_suffixes
        ]

        columns_by_table = {
            table_name: {
                str(column.get("name") or "").lower()
                for column in table.get("columns", [])
                if column.get("name")
            }
            for table_name, table in valid_tables.items()
        }
        columns_by_table.update(
            {
                table_name.split(".")[-1].lower(): columns
                for table_name, columns in columns_by_table.items()
            }
        )

        qualified_column_pattern = re.compile(
            r'(?:"(?P<table_quoted>[^"]+)"|\[(?P<table_bracketed>[^\]]+)\]|'
            r"(?P<table_bare>[A-Za-z_][A-Za-z0-9_.$]*))\s*\.\s*"
            r'(?:"(?P<column_quoted>[^"]+)"|\[(?P<column_bracketed>[^\]]+)\]|'
            r"(?P<column_bare>[A-Za-z_][A-Za-z0-9_$]*))",
            flags=re.IGNORECASE,
        )
        invalid_columns = []
        for match in qualified_column_pattern.finditer(ask_result.sql):
            table_reference = (
                match.group("table_quoted")
                or match.group("table_bracketed")
                or match.group("table_bare")
                or ""
            )
            column_reference = (
                match.group("column_quoted")
                or match.group("column_bracketed")
                or match.group("column_bare")
                or ""
            )
            table_key = table_reference.lower()
            column_key = column_reference.lower()
            table_columns = columns_by_table.get(table_key) or columns_by_table.get(
                table_key.split(".")[-1]
            )
            if table_columns is not None and column_key not in table_columns:
                invalid_columns.append(f"{table_reference}.{column_reference}")

        if invalid_tables or invalid_columns:
            logger.warning(
                "Ignoring heuristic SQL because it is not valid for active schema. "
                "invalid_tables=%s invalid_columns=%s sql=%s",
                invalid_tables,
                invalid_columns,
                ask_result.sql,
            )
            return None

        return ask_result

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

                if direct_orders_sales_sql := self._build_direct_orders_sales_sql(
                    user_query
                ):
                    api_results = [
                        AskResult(
                            **{
                                "sql": direct_orders_sales_sql,
                                "type": "llm",
                            }
                        )
                    ]
                    self._ask_results[query_id] = AskResultResponse(
                        status="finished",
                        type="TEXT_TO_SQL",
                        response=api_results,
                        rephrased_question=user_query,
                        retrieved_tables=["dbo_tblSales"],
                        trace_id=trace_id,
                        is_followup=True if histories else False,
                    )
                    results["ask_result"] = api_results
                    results["metadata"]["type"] = "TEXT_TO_SQL"
                    logger.info(
                        "Using direct Orders/Sales SQL for query_id %s",
                        query_id,
                    )
                    return results

                explicit_table_names = self._extract_explicit_table_names_from_query(
                    user_query
                )
                if explicit_table_names:
                    self._ask_results[query_id] = AskResultResponse(
                        status="searching",
                        type="TEXT_TO_SQL",
                        rephrased_question=user_query,
                        intent_reasoning="Explicit table name detected; retrieving that deployed schema directly.",
                        trace_id=trace_id,
                        is_followup=True if histories else False,
                    )
                    retrieval_result = await self._run_with_timeout(
                        "Explicit table schema retrieval",
                        self._pipelines["db_schema_retrieval"].run(
                            query=user_query,
                            tables=explicit_table_names,
                            project_id=ask_request.project_id,
                            histories=histories,
                            enable_column_pruning=False,
                        ),
                        timeout_seconds=min(
                            self._schema_retrieval_timeout_seconds,
                            self._pipeline_timeout_seconds,
                            20,
                        ),
                    )
                    documents, table_names, table_ddls = (
                        self._extract_retrieval_metadata(retrieval_result)
                    )
                    logger.info(
                        "Retrieved explicit tables for query_id %s: %s",
                        query_id,
                        table_names,
                    )

                    if explicit_table_preview := self._build_explicit_table_preview_sql(
                        user_query, table_ddls
                    ):
                        explicit_sql, explicit_table_name = explicit_table_preview
                        if explicit_table_name not in table_names:
                            table_names.append(explicit_table_name)
                        api_results = [
                            AskResult(
                                **{
                                    "sql": explicit_sql,
                                    "type": "llm",
                                }
                            )
                        ]
                        self._ask_results[query_id] = AskResultResponse(
                            status="finished",
                            type="TEXT_TO_SQL",
                            response=api_results,
                            rephrased_question=user_query,
                            intent_reasoning="Explicit table preview request matched deployed schema.",
                            retrieved_tables=table_names,
                            trace_id=trace_id,
                            is_followup=True if histories else False,
                        )
                        results["ask_result"] = api_results
                        results["metadata"]["type"] = "TEXT_TO_SQL"
                        return results

                    error_message = (
                        "The requested table was not found in the deployed schema: "
                        + ", ".join(explicit_table_names)
                    )
                    self._ask_results[query_id] = AskResultResponse(
                        status="failed",
                        type="TEXT_TO_SQL",
                        error=AskError(
                            code="NO_RELEVANT_DATA",
                            message=error_message,
                        ),
                        rephrased_question=user_query,
                        intent_reasoning="Explicit table preview request did not match any deployed schema table.",
                        retrieved_tables=table_names,
                        trace_id=trace_id,
                        is_followup=True if histories else False,
                    )
                    results["metadata"]["error_type"] = "NO_RELEVANT_DATA"
                    results["metadata"]["error_message"] = error_message
                    results["metadata"]["type"] = "TEXT_TO_SQL"
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
                        if ask_result := self._build_validated_ask_result_from_sql(
                            heuristic_sql,
                            table_ddls,
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
                        error_message = "Heuristic SQL fallback was not valid for the active datasource schema."

                if explicit_group_count_sql := self._build_explicit_group_count_sql(
                    user_query
                ):
                    table_column_reference = (
                        self._extract_explicit_table_column_reference(user_query)
                    )
                    table_names = (
                        [table_column_reference[0]] if table_column_reference else []
                    )
                    api_results = [
                        AskResult(
                            **{
                                "sql": explicit_group_count_sql,
                                "type": "llm",
                            }
                        )
                    ]
                    rephrased_question = user_query
                    logger.info(
                        "Using explicit table-column grouped count SQL for query_id %s",
                        query_id,
                    )

                historical_question_result = []
                if not api_results:
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
                elif not api_results:
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
                if not documents:
                    explicit_table_names = self._extract_explicit_table_names_from_query(
                        user_query
                    )
                    if explicit_table_names:
                        logger.info(
                            "Retrying schema retrieval for explicit tables query_id %s: %s",
                            query_id,
                            explicit_table_names,
                        )
                        retrieval_result = await self._run_with_timeout(
                            "Explicit table schema retrieval",
                            self._pipelines["db_schema_retrieval"].run(
                                query=user_query,
                                tables=explicit_table_names,
                                project_id=ask_request.project_id,
                                histories=histories,
                                enable_column_pruning=enable_column_pruning,
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

                if explicit_table_preview := self._build_explicit_table_preview_sql(
                    user_query, table_ddls
                ):
                    explicit_sql, explicit_table_name = explicit_table_preview
                    logger.info(
                        "Using explicit table preview SQL for query_id %s and table %s",
                        query_id,
                        explicit_table_name,
                    )
                    if explicit_table_name not in table_names:
                        table_names.append(explicit_table_name)
                    api_results = [
                        AskResult(
                            **{
                                "sql": explicit_sql,
                                "type": "llm",
                            }
                        )
                    ]

                if not api_results and (
                    audit_log_activity_sql := self._build_audit_log_activity_sql(
                        user_query, table_ddls, table_names=table_names
                    )
                ):
                    logger.info(
                        "Using schema-grounded audit log activity SQL for query_id %s",
                        query_id,
                    )
                    api_results = [
                        AskResult(
                            **{
                                "sql": audit_log_activity_sql,
                                "type": "llm",
                            }
                        )
                    ]

                if not api_results and (
                    deterministic_sales_sql := self._build_schema_grounded_sales_sql(
                        user_query, table_ddls
                    )
                ):
                    logger.info(
                        "Using schema-grounded CWSales SQL for query_id %s",
                        query_id,
                    )
                    api_results = [
                        AskResult(
                            **{
                                "sql": deterministic_sales_sql,
                                "type": "llm",
                            }
                        )
                    ]

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
                        ask_result = self._build_validated_ask_result_from_sql(
                            heuristic_sql,
                            table_ddls,
                        )
                        if not ask_result:
                            invalid_sql = heuristic_sql
                            error_message = "Heuristic SQL fallback was not valid for the active datasource schema."
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
                    ask_result = self._build_validated_ask_result_from_sql(
                        heuristic_sql,
                        table_ddls,
                    )
                    if not ask_result:
                        invalid_sql = heuristic_sql
                        error_message = "Heuristic SQL fallback was not valid for the active datasource schema."
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
