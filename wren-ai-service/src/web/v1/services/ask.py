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

NO_RELEVANT_ACTIVE_DATASOURCE_MESSAGE = (
    "No relevant data found in the active datasource for this question."
)
MAX_FORCED_EXPLICIT_TABLES = 5


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
    explicit_tables: Optional[list[str]] = Field(
        default=None,
        validation_alias=AliasChoices("explicit_tables", "explicitTables"),
    )


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
        max_sql_generation_tables: int = 10,
        pipeline_timeout_seconds: int = 45,
        schema_retrieval_timeout_seconds: int = 25,
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
        self._max_sql_generation_tables = max_sql_generation_tables

    def _is_stopped(self, query_id: str, container: dict):
        if (
            result := container.get(query_id)
        ) is not None and result.status == "stopped":
            return True

        return False

    async def _run_with_timeout(
        self,
        label: str,
        awaitable,
        *,
        timeout_seconds: Optional[int] = None,
    ):
        timeout = timeout_seconds or self._pipeline_timeout_seconds
        try:
            return await asyncio.wait_for(awaitable, timeout=timeout)
        except TimeoutError:
            logger.warning("%s timed out after %s seconds", label, timeout)
            raise

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

    def _normalize_schema_identifier_key(self, value: str) -> str:
        return re.sub(r"[^a-z0-9]", "", str(value or "").lower())

    def _schema_identifier_alias_keys(self, value: str) -> set[str]:
        raw_value = str(value or "")
        base_key = self._normalize_schema_identifier_key(raw_value)
        separator_normalized_key = self._normalize_schema_identifier_key(
            re.sub(r"[._\-]+", " ", raw_value)
        )
        part_keys = {
            self._normalize_schema_identifier_key(part)
            for part in re.split(r"[._\-]+", raw_value)
            if part
        }
        return {key for key in {base_key, separator_normalized_key, *part_keys} if key}

    def _extract_explicit_table_names_from_query(self, query: str) -> list[str]:
        names: list[str] = []
        for quoted in re.findall(r"[`\"\[]([^`\"\]]+)[`\"\]]", query or ""):
            if quoted and quoted not in names:
                names.append(quoted)
        for token in re.findall(r"\b[A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)+\b", query or ""):
            if token and token not in names:
                names.append(token)
        return names

    def _explicit_table_alias_keys_from_query(self, query: str | None) -> set[str]:
        keys: set[str] = set()
        for table_name in self._extract_explicit_table_names_from_query(query or ""):
            keys.update(self._schema_identifier_alias_keys(table_name))
        return keys

    def _explicit_table_alias_keys(self, table_names: list[str]) -> set[str]:
        keys: set[str] = set()
        for table_name in table_names:
            keys.update(self._schema_identifier_alias_keys(table_name))
        return keys

    def _filter_retrieval_metadata_for_explicit_query(
        self,
        query: str,
        documents: list[dict],
        explicit_table_names: list[str] | None = None,
    ) -> tuple[list[dict], list[str], list[str]]:
        explicit_keys = (
            self._explicit_table_alias_keys(explicit_table_names or [])
            if explicit_table_names
            else self._explicit_table_alias_keys_from_query(query)
        )
        if not explicit_keys:
            return self._metadata_from_documents(documents)

        filtered_documents: list[dict] = []
        for document in documents or []:
            metadata = document.get("metadata") or {}
            table_name = metadata.get("table_name") or document.get("table_name")
            table_ddl = metadata.get("table_ddl") or document.get("table_ddl")
            candidate_names = [table_name]
            if table_ddl:
                candidate_names.extend(
                    table.get("name")
                    for table in self._parse_schema_tables([table_ddl])
                    if table.get("name")
                )

            candidate_keys: set[str] = set()
            for candidate_name in candidate_names:
                candidate_keys.update(self._schema_identifier_alias_keys(candidate_name))

            if candidate_keys & explicit_keys:
                filtered_documents.append(document)

        if not filtered_documents:
            return [], [], []
        return self._metadata_from_documents(filtered_documents)

    def _normalize_explicit_table_names(
        self,
        table_names: list[str] | None,
    ) -> list[str]:
        normalized: list[str] = []
        for table_name in table_names or []:
            candidate = str(table_name or "").strip()
            if candidate and candidate not in normalized:
                normalized.append(candidate)
        return normalized

    def _should_retry_selected_schema_after_retrieval_timeout(
        self, retrieval_table_names: Optional[list[str]]
    ) -> bool:
        return bool(retrieval_table_names)

    def _forced_explicit_table_names(
        self, table_names: list[str], *, source: str = "request"
    ) -> list[str]:
        if not table_names:
            return []
        if len(table_names) <= MAX_FORCED_EXPLICIT_TABLES:
            return table_names

        logger.info(
            "Treating broad %s explicit_tables list as retrieval candidates, not a forced schema scope: %s",
            source,
            table_names,
        )
        return []

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
        return documents, *self._metadata_from_documents(documents)

    def _metadata_from_documents(
        self, documents: list[dict]
    ) -> tuple[list[str], list[str]]:
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
        return table_names, table_ddls

    async def _complete_sql_generation_context(
        self,
        *,
        query: str,
        project_id: Optional[str],
        documents: list[dict],
        table_names: list[str],
        table_ddls: list[str],
    ) -> tuple[list[dict], list[str], list[str], dict]:
        if not table_names or "db_schema_retrieval" not in self._pipelines:
            return documents, table_names, table_ddls, {}

        selected_table_names = list(dict.fromkeys(table_names))
        try:
            retrieval_result = await self._run_with_timeout(
                "Complete selected schema retrieval",
                self._pipelines["db_schema_retrieval"].run(
                    query=query,
                    tables=selected_table_names,
                    project_id=project_id,
                    histories=[],
                    enable_column_pruning=False,
                ),
                timeout_seconds=min(self._schema_retrieval_timeout_seconds, 30),
            )
        except Exception as error:
            logger.warning(
                "Complete selected schema retrieval failed; using existing retrieval context. project_id=%s tables=%s error=%s",
                project_id,
                selected_table_names,
                error,
            )
            return documents, table_names, table_ddls, {}

        complete_documents, complete_table_names, complete_table_ddls = (
            self._extract_retrieval_metadata(retrieval_result)
        )
        if not complete_documents:
            logger.warning(
                "Complete selected schema retrieval returned no documents; using existing retrieval context. project_id=%s tables=%s",
                project_id,
                selected_table_names,
            )
            return documents, table_names, table_ddls, {}

        logger.info(
            "Completed SQL generation context with full schemas for project_id %s tables=%s",
            project_id,
            complete_table_names,
        )
        return (
            complete_documents,
            complete_table_names,
            complete_table_ddls,
            retrieval_result.get("construct_retrieval_results", {}),
        )

    def _is_visualization_request(self, query: str) -> bool:
        normalized = (query or "").lower()
        return bool(
            re.search(
                r"\b(?:chart|graph|plot|visuali[sz]e|dashboard|bar|line|pie|donut|"
                r"scatter|histogram|heatmap|trend|trends|distribution)\b",
                normalized,
            )
        )

    def _get_metadata_question_kind(self, query: str) -> str | None:
        normalized = re.sub(r"\s+", " ", (query or "").lower()).strip()
        if not normalized:
            return None

        if self._is_visualization_request(normalized):
            return None

        if re.search(r"\b(?:row|rows|record|records)\s+count\b", normalized):
            return None

        relationship_patterns = (
            r"\b(?:relationships?|relations?|joins?|foreign keys?|primary keys?)\b",
            r"\b(?:how|what|which|show|list|describe)\b.*\b(?:tables?|models?)\b.*\b(?:connected|related|joined)\b",
        )
        if any(re.search(pattern, normalized) for pattern in relationship_patterns):
            return "relationships"

        table_count_patterns = (
            r"\b(?:how many|count|number of)\b.*\b(?:tables?|models?)\b",
            r"\b(?:tables?|models?)\b.*\b(?:count|number)\b",
        )
        if any(re.search(pattern, normalized) for pattern in table_count_patterns):
            return "table_count"

        column_count_patterns = (
            r"\b(?:how many|count|number of)\b.*\b(?:columns?|fields?)\b",
            r"\b(?:columns?|fields?)\b.*\b(?:count|number)\b",
        )
        if any(re.search(pattern, normalized) for pattern in column_count_patterns):
            return "column_count"

        schema_patterns = (
            r"\b(?:what|show|display|describe|list)\b.*\b(?:schema|metadata)\b",
            r"\b(?:schema|metadata)\b.*\b(?:of|for|in)\b",
        )
        if any(re.search(pattern, normalized) for pattern in schema_patterns):
            return "schema"

        explicit_column_patterns = (
            r"\b(?:what|which|list|show|display|give|describe)\b.*\b(?:columns?|fields?)\b",
            r"\b(?:columns?|fields?)\b.*\b(?:available|present|there|exist|schema|metadata)\b",
        )
        if any(re.search(pattern, normalized) for pattern in explicit_column_patterns):
            return "columns"

        table_patterns = (
            r"\b(?:what|which|list|show|display|give)\b.*\b(?:tables?|models?)\b",
            r"\b(?:tables?|models?)\b.*\b(?:available|present|there|exist|in this datasource|in the datasource)\b",
            r"\b(?:datasource|database|semantic layer|semantic model)\b.*\b(?:tables?|models?)\b",
        )
        if any(re.search(pattern, normalized) for pattern in table_patterns):
            return "tables"

        return None

    def _find_metadata_table_matches(
        self, query: str, tables: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        query_key = self._normalize_schema_token(query)
        if not query_key:
            return []

        matches: list[tuple[int, dict[str, Any]]] = []
        for table in tables:
            table_name = str(table.get("name") or "")
            if not table_name:
                continue
            short_name = re.split(r"[.$]", table_name)[-1]
            normalized_name = self._normalize_schema_token(table_name)
            normalized_short_name = self._normalize_schema_token(short_name)

            score = 0
            if normalized_name and normalized_name in query_key:
                score = 100 + len(normalized_name)
            elif normalized_short_name and normalized_short_name in query_key:
                score = 80 + len(normalized_short_name)

            if score:
                matches.append((score, table))

        return [
            table
            for _, table in sorted(matches, key=lambda item: item[0], reverse=True)
        ]

    def _format_metadata_table_list(
        self, tables: list[dict[str, Any]], *, max_tables: int = 120
    ) -> str:
        if not tables:
            return "I couldn't find any deployed tables in the active datasource metadata."

        sorted_tables = sorted(
            {str(table.get("name")) for table in tables if table.get("name")},
            key=str.lower,
        )
        shown_tables = sorted_tables[:max_tables]
        lines = [
            f"The active datasource has {len(sorted_tables)} deployed table"
            f"{'' if len(sorted_tables) == 1 else 's'}:"
        ]
        lines.extend(f"- {table_name}" for table_name in shown_tables)
        if len(sorted_tables) > max_tables:
            lines.append(
                f"- ...and {len(sorted_tables) - max_tables} more tables."
            )
        return "\n".join(lines)

    def _format_metadata_columns(
        self,
        query: str,
        tables: list[dict[str, Any]],
        *,
        max_tables: int = 25,
        max_columns_per_table: int = 60,
    ) -> str:
        if not tables:
            return "I couldn't find any deployed columns in the active datasource metadata."

        matched_tables = self._find_metadata_table_matches(query, tables)
        selected_tables = matched_tables or sorted(
            tables, key=lambda table: str(table.get("name") or "").lower()
        )
        selected_tables = selected_tables[:max_tables]

        heading = (
            "Columns available in the matched deployed table"
            if matched_tables and len(selected_tables) == 1
            else "Columns available in the active datasource metadata"
        )
        lines = [f"{heading}:"]
        for table in selected_tables:
            table_name = str(table.get("name") or "unknown_table")
            columns = [
                column
                for column in table.get("columns", [])
                if isinstance(column, dict) and column.get("name")
            ]
            if not columns:
                lines.append(f"- {table_name}: no columns found")
                continue

            column_parts = []
            for column in columns[:max_columns_per_table]:
                column_name = str(column.get("name"))
                column_type = str(column.get("type") or "").upper()
                column_parts.append(
                    f"{column_name} ({column_type})" if column_type else column_name
                )
            if len(columns) > max_columns_per_table:
                column_parts.append(
                    f"...and {len(columns) - max_columns_per_table} more"
                )
            lines.append(f"- {table_name}: {', '.join(column_parts)}")

        if len(tables) > max_tables and not matched_tables:
            lines.append(f"- ...and {len(tables) - max_tables} more tables.")

        return "\n".join(lines)

    def _extract_metadata_relationships(self, table_ddls: list[str]) -> list[str]:
        relationships: list[str] = []
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
            source_table = next(
                (value for value in table_match.groupdict().values() if value),
                "unknown_table",
            )

            for relationship_match in re.finditer(
                r"FOREIGN\s+KEY\s*\((?P<source_columns>[^)]+)\)\s+REFERENCES\s+"
                r'(?:"(?P<quoted>[^"]+)"|\[(?P<bracketed>[^\]]+)\]|'
                r"`(?P<backticked>[^`]+)`|(?P<bare>[A-Za-z_][A-Za-z0-9_.$]*))"
                r"\s*\((?P<target_columns>[^)]+)\)",
                ddl,
                flags=re.IGNORECASE,
            ):
                target_table = next(
                    (
                        value
                        for key, value in relationship_match.groupdict().items()
                        if key
                        in {
                            "quoted",
                            "bracketed",
                            "backticked",
                            "bare",
                        }
                        and value
                    ),
                    "unknown_table",
                )
                source_columns = relationship_match.group("source_columns")
                target_columns = relationship_match.group("target_columns")
                relationships.append(
                    f"{source_table}({source_columns}) -> "
                    f"{target_table}({target_columns})"
                )

        return sorted(set(relationships), key=str.lower)

    def _format_metadata_relationships(self, table_ddls: list[str]) -> str:
        relationships = self._extract_metadata_relationships(table_ddls)
        if not relationships:
            return (
                "I couldn't find explicit relationships or foreign keys in the "
                "active datasource metadata."
            )

        lines = [
            f"The active datasource metadata has {len(relationships)} "
            f"relationship{'' if len(relationships) == 1 else 's'}:"
        ]
        lines.extend(f"- {relationship}" for relationship in relationships[:120])
        if len(relationships) > 120:
            lines.append(f"- ...and {len(relationships) - 120} more relationships.")
        return "\n".join(lines)

    def _format_metadata_schema(
        self, query: str, tables: list[dict[str, Any]], table_ddls: list[str]
    ) -> str:
        matched_tables = self._find_metadata_table_matches(query, tables)
        selected_tables = matched_tables or sorted(
            tables, key=lambda table: str(table.get("name") or "").lower()
        )
        selected_tables = selected_tables[:20]
        if not selected_tables:
            return "I couldn't find schema details in the active datasource metadata."

        lines = ["Schema details from the active datasource metadata:"]
        for table in selected_tables:
            table_name = str(table.get("name") or "unknown_table")
            columns = [
                column
                for column in table.get("columns", [])
                if isinstance(column, dict) and column.get("name")
            ]
            lines.append(f"- {table_name}")
            if columns:
                column_parts = []
                for column in columns[:60]:
                    column_name = str(column.get("name"))
                    column_type = str(column.get("type") or "").upper()
                    column_parts.append(
                        f"{column_name} ({column_type})"
                        if column_type
                        else column_name
                    )
                if len(columns) > 60:
                    column_parts.append(f"...and {len(columns) - 60} more")
                lines.append(f"  Columns: {', '.join(column_parts)}")
            else:
                lines.append("  Columns: no columns found")

        relationships = self._extract_metadata_relationships(table_ddls)
        if relationships:
            lines.append("Relationships:")
            lines.extend(f"- {relationship}" for relationship in relationships[:40])
            if len(relationships) > 40:
                lines.append(f"- ...and {len(relationships) - 40} more relationships.")

        return "\n".join(lines)

    def _format_metadata_table_count(self, tables: list[dict[str, Any]]) -> str:
        table_names = {str(table.get("name")) for table in tables if table.get("name")}
        return (
            f"The active datasource has {len(table_names)} deployed table"
            f"{'' if len(table_names) == 1 else 's'}."
        )

    def _format_metadata_column_count(
        self, query: str, tables: list[dict[str, Any]]
    ) -> str:
        matched_tables = self._find_metadata_table_matches(query, tables)
        selected_tables = matched_tables or tables
        total_columns = sum(
            len(
                [
                    column
                    for column in table.get("columns", [])
                    if isinstance(column, dict) and column.get("name")
                ]
            )
            for table in selected_tables
        )
        if matched_tables and len(selected_tables) == 1:
            table_name = str(selected_tables[0].get("name") or "the matched table")
            return f"{table_name} has {total_columns} deployed columns."
        return (
            f"The active datasource metadata has {total_columns} deployed columns "
            f"across {len(selected_tables)} table"
            f"{'' if len(selected_tables) == 1 else 's'}."
        )

    def _build_metadata_response(
        self, query: str, table_ddls: list[str], table_names: list[str]
    ) -> str:
        kind = self._get_metadata_question_kind(query)
        parsed_tables = self._parse_schema_tables(table_ddls)

        if not parsed_tables and table_names:
            parsed_tables = [
                {"name": table_name, "columns": []} for table_name in table_names
            ]

        if kind == "schema":
            return self._format_metadata_schema(query, parsed_tables, table_ddls)
        if kind == "relationships":
            return self._format_metadata_relationships(table_ddls)
        if kind == "table_count":
            return self._format_metadata_table_count(parsed_tables)
        if kind == "column_count":
            return self._format_metadata_column_count(query, parsed_tables)
        if kind == "columns":
            return self._format_metadata_columns(query, parsed_tables)
        return self._format_metadata_table_list(parsed_tables)

    def _normalize_schema_token(self, value: str) -> str:
        return re.sub(r"[^a-z0-9]", "", (value or "").lower())

    def _prune_sql_generation_context(
        self,
        query: str,
        documents: list[dict],
        table_names: list[str],
        table_ddls: list[str],
        *,
        max_tables: int = 10,
    ) -> tuple[list[dict], list[str], list[str]]:
        if len(documents) <= max_tables:
            return documents, table_names, table_ddls

        pruned_documents = documents[:max_tables]
        pruned_table_names = table_names[:max_tables]
        pruned_table_ddls = table_ddls[:max_tables]
        logger.info(
            "Pruned SQL generation context from %s to %s tables for query: %s",
            len(documents),
            len(pruned_documents),
            query,
        )
        return pruned_documents, pruned_table_names, pruned_table_ddls

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
        query: str | None = None,
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
                "Ignoring generated SQL because it is not valid for active schema. "
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

    def _build_no_relevant_active_datasource_response(
        self,
        trace_id: Optional[str],
        *,
        rephrased_question: Optional[str] = None,
        intent_reasoning: Optional[str] = None,
        retrieved_tables: Optional[list[str]] = None,
        sql_generation_reasoning: Optional[str] = None,
        is_followup: bool = False,
    ) -> AskResultResponse:
        return self._build_failed_text_to_sql_response(
            trace_id,
            NO_RELEVANT_ACTIVE_DATASOURCE_MESSAGE,
            rephrased_question=rephrased_question,
            intent_reasoning=intent_reasoning,
            retrieved_tables=retrieved_tables,
            sql_generation_reasoning=sql_generation_reasoning,
            invalid_sql=None,
            is_followup=is_followup,
            code="NO_RELEVANT_DATA",
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
        documents = []
        table_names = []
        table_ddls = []
        _retrieval_result = {}
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
        understanding_timeout_seconds = min(self._pipeline_timeout_seconds, 12)
        planning_timeout_seconds = min(self._pipeline_timeout_seconds, 15)
        generation_timeout_seconds = min(self._pipeline_timeout_seconds, 30)
        correction_timeout_seconds = min(self._pipeline_timeout_seconds, 15)
        request_explicit_table_names = self._normalize_explicit_table_names(
            ask_request.explicit_tables
        )
        forced_request_explicit_table_names = self._forced_explicit_table_names(
            request_explicit_table_names,
            source="request",
        )
        explicit_table_names = forced_request_explicit_table_names
        retrieval_table_names = explicit_table_names or None

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

                metadata_question_kind = self._get_metadata_question_kind(user_query)
                if metadata_question_kind:
                    self._ask_results[query_id] = AskResultResponse(
                        status="searching",
                        type="GENERAL",
                        rephrased_question=user_query,
                        intent_reasoning=(
                            "Basic datasource metadata question detected; "
                            "retrieving deployed schema metadata directly."
                        ),
                        trace_id=trace_id,
                        is_followup=True if histories else False,
                        general_type="DATA_ASSISTANCE",
                    )
                    retrieval_result = await self._run_with_timeout(
                        "Metadata schema retrieval",
                        self._pipelines["db_schema_retrieval"].run(
                            query="",
                            project_id=ask_request.project_id,
                            histories=[],
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
                    metadata_answer = self._build_metadata_response(
                        user_query, table_ddls, table_names
                    )
                    self._general_streaming_results[query_id] = metadata_answer
                    self._ask_results[query_id] = AskResultResponse(
                        status="finished",
                        type="GENERAL",
                        rephrased_question=user_query,
                        intent_reasoning=(
                            "Answered from active datasource deployed metadata "
                            "without SQL generation."
                        ),
                        retrieved_tables=table_names,
                        trace_id=trace_id,
                        is_followup=True if histories else False,
                        general_type="DATA_ASSISTANCE",
                    )
                    results["metadata"]["type"] = "GENERAL"
                    results["metadata"]["metadata_question_kind"] = (
                        metadata_question_kind
                    )
                    results["metadata"]["retrieved_table_count"] = len(documents)
                    return results

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
                            histories=[],
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
                    documents, table_names, table_ddls = (
                        self._filter_retrieval_metadata_for_explicit_query(
                            user_query,
                            documents,
                            explicit_table_names,
                        )
                    )
                    _retrieval_result = retrieval_result.get(
                        "construct_retrieval_results", {}
                    )
                    logger.info(
                        "Retrieved explicit tables for query_id %s: %s",
                        query_id,
                        table_names,
                    )

                    if not documents:
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
                            intent_reasoning="Explicit table request did not match any deployed schema table.",
                            retrieved_tables=table_names,
                            trace_id=trace_id,
                            is_followup=True if histories else False,
                        )
                        results["metadata"]["error_type"] = "NO_RELEVANT_DATA"
                        results["metadata"]["error_message"] = error_message
                        results["metadata"]["type"] = "TEXT_TO_SQL"
                        return results

                    rephrased_question = user_query
                    intent_reasoning = (
                        "Explicit table request matched deployed schema; generating SQL against retrieved schema."
                    )
                    sql_user_query = user_query

                historical_question_result = []
                if not api_results:
                    if not self._is_stopped(query_id, self._ask_results):
                        self._ask_results[query_id] = AskResultResponse(
                            status="understanding",
                            rephrased_question=rephrased_question,
                            intent_reasoning=intent_reasoning,
                            trace_id=trace_id,
                            is_followup=True if histories else False,
                        )

                    try:
                        historical_question = await self._run_with_timeout(
                            "Historical question retrieval",
                            self._pipelines["historical_question"].run(
                                query=user_query,
                                project_id=ask_request.project_id,
                            ),
                            timeout_seconds=min(understanding_timeout_seconds, 10),
                        )

                        # we only return top 1 result
                        historical_question_result = historical_question.get(
                            "formatted_output", {}
                        ).get("documents", [])[:1]
                    except TimeoutError as exc:
                        logger.warning(
                            "Historical question retrieval timed out; continuing without history match. query_id=%s project_id=%s error=%s",
                            query_id,
                            ask_request.project_id,
                            exc,
                        )

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
                    # Run both pipeline operations concurrently
                    try:
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
                            timeout_seconds=understanding_timeout_seconds,
                        )

                        # Extract results from completed tasks
                        sql_samples = sql_samples_task["formatted_output"].get(
                            "documents", []
                        )
                        instructions = instructions_task["formatted_output"].get(
                            "documents", []
                        )
                    except TimeoutError as exc:
                        logger.warning(
                            "SQL pair and instruction retrieval timed out; continuing without optional examples. query_id=%s project_id=%s error=%s",
                            query_id,
                            ask_request.project_id,
                            exc,
                        )
                        sql_samples = []
                        instructions = []

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
                                    timeout_seconds=understanding_timeout_seconds,
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

                        if rephrased_question:
                            user_query = rephrased_question

                        sql_user_query = user_query

                        if intent == "MISLEADING_QUERY":
                            asyncio.create_task(
                                self._pipelines["misleading_assistance"].run(
                                    query=user_query,
                                    histories=histories,
                                    db_schemas=intent_classification_result.get(
                                        "db_schemas"
                                    ),
                                    language=ask_request.configurations.language,
                                    query_id=query_id,
                                    custom_instruction=ask_request.custom_instruction,
                                )
                            )

                            self._ask_results[query_id] = AskResultResponse(
                                status="finished",
                                type="GENERAL",
                                rephrased_question=rephrased_question,
                                intent_reasoning=intent_reasoning,
                                trace_id=trace_id,
                                is_followup=True if histories else False,
                                general_type="MISLEADING_QUERY",
                            )
                            results["metadata"]["type"] = "MISLEADING_QUERY"
                            return results
                        elif intent == "GENERAL":
                            intent_reasoning = (
                                f"{intent_reasoning or ''}\n"
                                "Classifier returned GENERAL, but this ask flow "
                                "treats non-schema, non-guide questions as data "
                                "retrieval requests so they continue through "
                                "semantic retrieval and SQL generation."
                            )
                            self._ask_results[query_id] = AskResultResponse(
                                status="understanding",
                                type="TEXT_TO_SQL",
                                rephrased_question=rephrased_question,
                                intent_reasoning=intent_reasoning,
                                trace_id=trace_id,
                                is_followup=True if histories else False,
                            )
                        elif intent == "USER_GUIDE":
                            asyncio.create_task(
                                self._pipelines["user_guide_assistance"].run(
                                    query=user_query,
                                    language=ask_request.configurations.language,
                                    query_id=query_id,
                                    custom_instruction=ask_request.custom_instruction,
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
            if (
                not self._is_stopped(query_id, self._ask_results)
                and not api_results
                and not documents
            ):
                self._ask_results[query_id] = AskResultResponse(
                    status="searching",
                    type="TEXT_TO_SQL",
                    rephrased_question=rephrased_question,
                    intent_reasoning=intent_reasoning,
                    trace_id=trace_id,
                    is_followup=True if histories else False,
                )

                try:
                    retrieval_result = await self._run_with_timeout(
                        "Schema retrieval",
                        self._pipelines["db_schema_retrieval"].run(
                            query=sql_user_query,
                            tables=retrieval_table_names,
                            histories=[],
                            project_id=ask_request.project_id,
                            enable_column_pruning=enable_column_pruning,
                        ),
                        timeout_seconds=self._schema_retrieval_timeout_seconds,
                    )
                except TimeoutError as error:
                    if not self._should_retry_selected_schema_after_retrieval_timeout(
                        retrieval_table_names
                    ):
                        logger.warning(
                            "Schema retrieval timed out for data query; not loading full project schema. "
                            "query_id=%s project_id=%s error=%s",
                            query_id,
                            ask_request.project_id,
                            error,
                        )
                        retrieval_result = {"construct_retrieval_results": {}}
                    else:
                        logger.warning(
                            "Schema retrieval timed out; retrying only explicit selected schemas. "
                            "query_id=%s project_id=%s tables=%s error=%s",
                            query_id,
                            ask_request.project_id,
                            retrieval_table_names,
                            error,
                        )
                        retrieval_result = await self._run_with_timeout(
                            "Selected schema fallback retrieval",
                            self._pipelines["db_schema_retrieval"].run(
                                query=sql_user_query,
                                tables=retrieval_table_names,
                                histories=[],
                                project_id=ask_request.project_id,
                                enable_column_pruning=False,
                            ),
                            timeout_seconds=min(
                                self._schema_retrieval_timeout_seconds,
                                30,
                            ),
                        )
                _retrieval_result = retrieval_result.get(
                    "construct_retrieval_results", {}
                )
                documents, table_names, table_ddls = (
                    self._extract_retrieval_metadata(retrieval_result)
                )
                if explicit_table_names:
                    documents, table_names, table_ddls = (
                        self._filter_retrieval_metadata_for_explicit_query(
                            user_query,
                            documents,
                            explicit_table_names,
                        )
                    )
                if not documents:
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
                                histories=[],
                                enable_column_pruning=enable_column_pruning,
                            ),
                            timeout_seconds=min(
                                self._schema_retrieval_timeout_seconds,
                                20,
                            ),
                        )
                        _retrieval_result = retrieval_result.get(
                            "construct_retrieval_results", {}
                        )
                        documents, table_names, table_ddls = (
                            self._extract_retrieval_metadata(retrieval_result)
                        )
                        documents, table_names, table_ddls = (
                            self._filter_retrieval_metadata_for_explicit_query(
                                user_query,
                                documents,
                                explicit_table_names,
                            )
                        )
                logger.info(
                    "Retrieved tables for query_id %s: %s", query_id, table_names
                )

                if not documents:
                    logger.exception(f"ask pipeline - NO_RELEVANT_DATA: {user_query}")
                    if not self._is_stopped(query_id, self._ask_results):
                        self._ask_results[query_id] = (
                            self._build_no_relevant_active_datasource_response(
                                trace_id,
                                rephrased_question=rephrased_question,
                                intent_reasoning=intent_reasoning,
                                retrieved_tables=table_names,
                                is_followup=True if histories else False,
                            )
                        )
                    results["metadata"]["error_type"] = "NO_RELEVANT_DATA"
                    results["metadata"]["error_message"] = (
                        NO_RELEVANT_ACTIVE_DATASOURCE_MESSAGE
                    )
                    results["metadata"]["type"] = "TEXT_TO_SQL"
                    return results

            if documents and not api_results:
                documents, table_names, table_ddls = self._prune_sql_generation_context(
                    sql_user_query,
                    documents,
                    table_names,
                    table_ddls,
                    max_tables=self._max_sql_generation_tables,
                )
                (
                    documents,
                    table_names,
                    table_ddls,
                    completed_retrieval_result,
                ) = await self._complete_sql_generation_context(
                    query=sql_user_query,
                    project_id=ask_request.project_id,
                    documents=documents,
                    table_names=table_names,
                    table_ddls=table_ddls,
                )
                if completed_retrieval_result:
                    _retrieval_result = completed_retrieval_result

            sql_generation_histories = histories

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

                if sql_generation_histories:
                    try:
                        sql_generation_reasoning = (
                            await self._run_with_timeout(
                                "Follow-up SQL generation reasoning",
                                self._pipelines[
                                    "followup_sql_generation_reasoning"
                                ].run(
                                    query=sql_user_query,
                                    contexts=table_ddls,
                                    histories=sql_generation_histories,
                                    sql_samples=sql_samples,
                                    instructions=instructions,
                                    configuration=ask_request.configurations,
                                    query_id=query_id,
                                ),
                                timeout_seconds=planning_timeout_seconds,
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
                                timeout_seconds=planning_timeout_seconds,
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

                try:
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
                        timeout_seconds=min(self._pipeline_timeout_seconds, 10),
                    )
                except TimeoutError as helper_timeout:
                    logger.warning(
                        "SQL helper retrieval timed out for query_id %s; continuing with schema only: %s",
                        query_id,
                        helper_timeout,
                    )
                    sql_functions, sql_knowledge = [], None

                has_calculated_field = _retrieval_result.get(
                    "has_calculated_field", False
                )
                has_metric = _retrieval_result.get("has_metric", False)
                has_json_field = _retrieval_result.get("has_json_field", False)

                try:
                    if sql_generation_histories:
                        text_to_sql_generation_results = await self._run_with_timeout(
                            "Follow-up SQL generation",
                            self._pipelines["followup_sql_generation"].run(
                                query=sql_user_query,
                                contexts=table_ddls,
                                sql_generation_reasoning=sql_generation_reasoning,
                                histories=sql_generation_histories,
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
                            timeout_seconds=generation_timeout_seconds,
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
                            timeout_seconds=generation_timeout_seconds,
                        )
                except TimeoutError as generation_timeout:
                    logger.warning(
                        "SQL generation timed out for query_id %s: %s",
                        query_id,
                        generation_timeout,
                    )
                    text_to_sql_generation_results = {
                        "post_process": {
                            "valid_generation_result": None,
                            "invalid_generation_result": None,
                        }
                    }
                    error_message = str(generation_timeout)

                if sql_valid_result := text_to_sql_generation_results["post_process"][
                    "valid_generation_result"
                ]:
                    if ask_result := self._build_validated_ask_result_from_sql(
                        sql_valid_result.get("sql"),
                        table_ddls,
                        sql_user_query,
                    ):
                        api_results = [ask_result]
                    else:
                        invalid_sql = sql_valid_result.get("sql")
                        error_message = (
                            "SQL generation did not produce SQL that matches the active datasource schema and question intent."
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
                                timeout_seconds=correction_timeout_seconds,
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
                            timeout_seconds=correction_timeout_seconds,
                        )

                        if valid_generation_result := sql_correction_results[
                            "post_process"
                        ]["valid_generation_result"]:
                            if ask_result := self._build_validated_ask_result_from_sql(
                                valid_generation_result.get("sql"),
                                table_ddls,
                                sql_user_query,
                            ):
                                api_results = [ask_result]
                                break
                            invalid_sql = valid_generation_result.get("sql")
                            error_message = (
                                "SQL correction did not produce SQL that matches the active datasource schema and question intent."
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
                logger.exception(f"ask pipeline - NO_RELEVANT_SQL: {user_query}")
                if not self._is_stopped(query_id, self._ask_results):
                    self._ask_results[query_id] = (
                        self._build_no_relevant_active_datasource_response(
                            trace_id,
                            rephrased_question=rephrased_question,
                            intent_reasoning=intent_reasoning,
                            retrieved_tables=table_names,
                            sql_generation_reasoning=sql_generation_reasoning,
                            is_followup=True if histories else False,
                        )
                    )
                if error_message or invalid_sql:
                    logger.info(
                        "Suppressed technical SQL failure for query_id %s. "
                        "error=%s invalid_sql=%s",
                        query_id,
                        error_message,
                        invalid_sql,
                    )
                results["metadata"]["error_type"] = "NO_RELEVANT_DATA"
                results["metadata"]["error_message"] = (
                    NO_RELEVANT_ACTIVE_DATASOURCE_MESSAGE
                )
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
