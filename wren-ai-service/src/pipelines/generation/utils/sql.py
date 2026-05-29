import logging
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List

import aiohttp
import orjson
from haystack import component
from haystack.dataclasses import ChatMessage
from pydantic import BaseModel

from src.core.engine import (
    Engine,
    clean_generation_result,
)
from src.core.provider import LLMProvider
from src.pipelines.retrieval.sql_knowledge import SqlKnowledge
from src.web.v1.services.ask import AskHistory

logger = logging.getLogger("wren-ai-service")


def _parse_sql_json_payload(payload: str) -> str | None:
    try:
        parsed_payload = orjson.loads(payload)
    except orjson.JSONDecodeError:
        return None

    if isinstance(parsed_payload, dict) and isinstance(parsed_payload.get("sql"), str):
        return parsed_payload["sql"]

    return None


def _extract_json_object_with_sql(result: str) -> str | None:
    sql_key_match = re.search(r'"sql"\s*:', result, flags=re.IGNORECASE)
    if not sql_key_match:
        return None

    start = result.rfind("{", 0, sql_key_match.start())
    if start == -1:
        return None

    depth = 0
    in_string = False
    escape_next = False
    for index, char in enumerate(result[start:], start=start):
        if escape_next:
            escape_next = False
            continue
        if char == "\\" and in_string:
            escape_next = True
            continue
        if char == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return result[start : index + 1]

    return None


def _extract_select_statement(result: str) -> str | None:
    sql_match = re.search(r"\b(?:WITH|SELECT)\b", result, flags=re.IGNORECASE)
    if not sql_match:
        return None

    statement = result[sql_match.start() :].strip()
    semicolon_index = statement.find(";")
    if semicolon_index >= 0:
        statement = statement[:semicolon_index]

    return statement


def extract_sql_generation_result(result: str) -> str:
    fenced_blocks = re.findall(
        r"```(?:json|sql)?\s*(.*?)```", result, flags=re.IGNORECASE | re.DOTALL
    )
    for block in fenced_blocks:
        if sql := _parse_sql_json_payload(block.strip()):
            return clean_generation_result(sql)
        if sql := _extract_select_statement(block):
            return clean_generation_result(sql)

    cleaned_result = clean_generation_result(result)
    if sql := _parse_sql_json_payload(cleaned_result):
        return clean_generation_result(sql)

    if json_payload := _extract_json_object_with_sql(result):
        if sql := _parse_sql_json_payload(json_payload):
            return clean_generation_result(sql)

    if sql := _extract_select_statement(result):
        return clean_generation_result(sql)

    return cleaned_result


def is_select_statement(sql: str) -> bool:
    return bool(re.match(r"^\s*(?:WITH|SELECT)\b", sql, flags=re.IGNORECASE))


def normalize_data_source(data_source: str | None) -> str:
    normalized = (data_source or "").strip().upper().replace("-", "_").replace(
        " ", "_"
    )
    if normalized in {"SQLSERVER", "SQL_SERVER", "MS_SQL", "MSSQLSERVER"}:
        return "MSSQL"
    return normalized


def _format_timestamp_literal(value: datetime) -> str:
    return value.strftime("'%Y-%m-%d %H:%M:%S'")


def _add_months(value: datetime, months: int) -> datetime:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(
        value.day,
        [
            31,
            29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28,
            31,
            30,
            31,
            30,
            31,
            31,
            30,
            31,
            30,
            31,
        ][month - 1],
    )
    return value.replace(year=year, month=month, day=day)


def _start_of_month(value: datetime) -> datetime:
    return value.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _replace_relative_getdate_calls(sql: str, now: datetime) -> str:
    def replace_month_offset(match: re.Match[str]) -> str:
        months = int(match.group(1))
        return _format_timestamp_literal(_add_months(now, months))

    def replace_year_offset(match: re.Match[str]) -> str:
        years = int(match.group(1))
        return _format_timestamp_literal(_add_months(now, years * 12))

    def replace_day_offset(match: re.Match[str]) -> str:
        days = int(match.group(1))
        return _format_timestamp_literal(now + timedelta(days=days))

    sql = re.sub(
        r"DATEADD\(\s*month\s*,\s*([+-]?\d+)\s*,\s*GETDATE\(\)\s*\)",
        replace_month_offset,
        sql,
        flags=re.IGNORECASE,
    )
    sql = re.sub(
        r"DATEADD\(\s*year\s*,\s*([+-]?\d+)\s*,\s*GETDATE\(\)\s*\)",
        replace_year_offset,
        sql,
        flags=re.IGNORECASE,
    )
    sql = re.sub(
        r"DATEADD\(\s*day\s*,\s*([+-]?\d+)\s*,\s*GETDATE\(\)\s*\)",
        replace_day_offset,
        sql,
        flags=re.IGNORECASE,
    )

    current_month_start = _format_timestamp_literal(_start_of_month(now))
    previous_month_start = _format_timestamp_literal(
        _start_of_month(_add_months(now, -1))
    )
    sql = re.sub(
        r"DATEADD\(\s*month\s*,\s*DATEDIFF\(\s*month\s*,\s*0\s*,\s*GETDATE\(\)\s*\)\s*,\s*0\s*\)",
        current_month_start,
        sql,
        flags=re.IGNORECASE,
    )
    sql = re.sub(
        r"DATEADD\(\s*month\s*,\s*DATEDIFF\(\s*month\s*,\s*0\s*,\s*GETDATE\(\)\s*\)\s*-\s*1\s*,\s*0\s*\)",
        previous_month_start,
        sql,
        flags=re.IGNORECASE,
    )
    return sql


def _rewrite_mssql_bucket_functions(sql: str) -> str:
    expression_pattern = r"((?:[^(),]|\([^()]*\))+?)"

    sql = re.sub(
        rf"DATEADD\(\s*month\s*,\s*DATEDIFF\(\s*month\s*,\s*0\s*,\s*{expression_pattern}\s*\)\s*,\s*0\s*\)",
        lambda m: (
            f"(DATEPART(YEAR, {m.group(1)}) * 100 + DATEPART(MONTH, {m.group(1)}))"
        ),
        sql,
        flags=re.IGNORECASE,
    )
    sql = re.sub(
        rf"DATEADD\(\s*year\s*,\s*DATEDIFF\(\s*year\s*,\s*0\s*,\s*{expression_pattern}\s*\)\s*,\s*0\s*\)",
        lambda m: f"DATEPART(YEAR, {m.group(1)})",
        sql,
        flags=re.IGNORECASE,
    )
    return sql


def _rewrite_temporal_bucket_functions(sql: str) -> str:
    expression_pattern = r"((?:[^(),]|\([^()]*\))+?)"
    replacements = [
        (
            re.compile(
                rf"DATEPART\(\s*YEAR\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"DATEPART(YEAR, {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATEPART\(\s*MONTH\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"DATEPART(MONTH, {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATEPART\(\s*DAY\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"DATEPART(DAY, {m.group(1)})",
        ),
        (
            re.compile(rf"YEAR\(\s*{expression_pattern}\s*\)", re.IGNORECASE),
            lambda m: f"DATEPART(YEAR, {m.group(1)})",
        ),
        (
            re.compile(rf"MONTH\(\s*{expression_pattern}\s*\)", re.IGNORECASE),
            lambda m: f"DATEPART(MONTH, {m.group(1)})",
        ),
        (
            re.compile(rf"DAY\(\s*{expression_pattern}\s*\)", re.IGNORECASE),
            lambda m: f"DATEPART(DAY, {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATETRUNC\(\s*MONTH\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"DATEPART(MONTH, {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATETRUNC\(\s*YEAR\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"DATEPART(YEAR, {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATE_TRUNC\(\s*'?\s*MONTH\s*'?\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"DATEPART(MONTH, {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATE_TRUNC\(\s*'?\s*YEAR\s*'?\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"DATEPART(YEAR, {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATE_PART\(\s*'?\s*YEAR\s*'?\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"DATEPART(YEAR, {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATE_PART\(\s*'?\s*MONTH\s*'?\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"DATEPART(MONTH, {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATE_PART\(\s*'?\s*DAY\s*'?\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"DATEPART(DAY, {m.group(1)})",
        ),
        (
            re.compile(
                rf"EXTRACT\(\s*YEAR\s+FROM\s+{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"DATEPART(YEAR, {m.group(1)})",
        ),
        (
            re.compile(
                rf"EXTRACT\(\s*MONTH\s+FROM\s+{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"DATEPART(MONTH, {m.group(1)})",
        ),
        (
            re.compile(
                rf"EXTRACT\(\s*DAY\s+FROM\s+{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"DATEPART(DAY, {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATEPART\(\s*'YEAR'\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"DATEPART(YEAR, {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATEPART\(\s*'MONTH'\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"DATEPART(MONTH, {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATEPART\(\s*'DAY'\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"DATEPART(DAY, {m.group(1)})",
        ),
    ]

    rewritten = sql
    for pattern, replacement in replacements:
        rewritten = pattern.sub(replacement, rewritten)

    return rewritten


def _rewrite_mssql_timestamp_casts(sql: str) -> str:
    expression_pattern = r"((?:[^(),]|\([^()]*\))+?)"
    timestamp_function_pattern = re.compile(
        rf"\bTO_TIMESTAMP(?:_(?:MILLIS|SECONDS|MICROS|NANOS))?\(\s*{expression_pattern}\s*\)",
        re.IGNORECASE,
    )
    timestamp_cast_pattern = re.compile(
        r"CAST\(\s*((?:[^()]|\([^()]*\))+?)\s+AS\s+TIMESTAMP\s*\)",
        re.IGNORECASE,
    )

    rewritten = timestamp_function_pattern.sub(
        lambda m: f"CAST({m.group(1)} AS DATETIME)", sql
    )
    rewritten = timestamp_cast_pattern.sub(
        lambda m: f"CAST({m.group(1)} AS DATETIME)", rewritten
    )
    return rewritten


def _rewrite_mssql_to_unixtime(sql: str) -> str:
    expression_pattern = r"((?:[^(),]|\([^()]*\))+?)"
    to_unixtime_pattern = re.compile(
        rf"\bTO_UNIXTIME\(\s*{expression_pattern}\s*\)",
        re.IGNORECASE,
    )

    return to_unixtime_pattern.sub(lambda m: m.group(1), sql)


def _rewrite_mssql_timestamp_subtraction(sql: str) -> str:
    expression_pattern = r"((?:[^(),+\-]|\([^()]*\))+?)"
    timestamp_subtraction_pattern = re.compile(
        rf"{expression_pattern}\s*-\s*{expression_pattern}\s+AS\s+(\"[^\"]+\")",
        re.IGNORECASE,
    )

    def replace_subtraction(match: re.Match[str]) -> str:
        left = match.group(1).strip()
        right = match.group(2).strip()
        alias = match.group(3)
        alias_text = alias.strip('"').lower()

        if not any(token in alias_text for token in ("duration", "turnaround")):
            return match.group(0)

        return f"DATEDIFF('second', {right}, {left}) AS {alias}"

    return timestamp_subtraction_pattern.sub(replace_subtraction, sql)


def _infer_mssql_timestamp_expression(sql: str) -> str | None:
    timestamp_column_pattern = re.compile(
        r'(?:(?:"[^"]+"\.)?"(?:created_at|updated_at|opened_at|closed_at|completed_at|resolved_at)")',
        re.IGNORECASE,
    )
    if match := timestamp_column_pattern.search(sql):
        return match.group(0)

    table_pattern = re.compile(
        r'\bFROM\s+("[^"]+"|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)',
        re.IGNORECASE,
    )
    if match := table_pattern.search(sql):
        table_name = match.group(1)
        if any(
            token in table_name.strip('"[]').lower()
            for token in ("repair", "ticket", "debug", "event", "log")
        ):
            return f'{table_name}."created_at"'

    return None


def _rewrite_mssql_invented_date_identifiers(sql: str) -> str:
    timestamp_expression = _infer_mssql_timestamp_expression(sql)
    if not timestamp_expression:
        return sql

    invented_date_identifier_pattern = re.compile(
        r'(?<!\.)"(?:RepairDate|repair_date|repairDate|date|month_date|event_date)"',
        re.IGNORECASE,
    )
    return invented_date_identifier_pattern.sub(timestamp_expression, sql)


def _rewrite_mssql_bare_time_bucket_identifiers(sql: str) -> str:
    timestamp_expression = _infer_mssql_timestamp_expression(sql)
    if not timestamp_expression:
        return sql

    bucket_expressions = {
        "year": f"DATEPART(YEAR, {timestamp_expression})",
        "month": f"DATEPART(MONTH, {timestamp_expression})",
        "day": f"DATEPART(DAY, {timestamp_expression})",
    }
    rewritten = sql

    for bucket, expression in bucket_expressions.items():
        select_identifier_pattern = re.compile(
            rf'(?P<prefix>\bSELECT\s+|,\s*)"{bucket}"(?P<suffix>\s*(?:,|\bFROM\b))',
            re.IGNORECASE,
        )

        def replace_select_identifier(match: re.Match[str]) -> str:
            prefix = match.group("prefix")
            suffix = match.group("suffix")
            return f'{prefix}{expression} AS "{bucket}"{suffix}'

        rewritten = select_identifier_pattern.sub(
            replace_select_identifier, rewritten
        )

    clause_pattern = re.compile(
        r"\b(GROUP\s+BY|ORDER\s+BY|HAVING)\b(?P<body>.*?)(?=\b(?:ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|OFFSET|FETCH|UNION|WHERE)\b|$)",
        re.IGNORECASE | re.DOTALL,
    )

    def replace_clause(match: re.Match[str]) -> str:
        body = match.group("body")
        for bucket, expression in bucket_expressions.items():
            body = re.sub(
                rf'"{bucket}"',
                expression,
                body,
                flags=re.IGNORECASE,
            )
            body = re.sub(
                rf"\[{bucket}\]",
                expression,
                body,
                flags=re.IGNORECASE,
            )
        return f"{match.group(1)}{body}"

    return clause_pattern.sub(replace_clause, rewritten)


def _rewrite_mssql_datepart_alias_references(sql: str) -> str:
    datepart_alias_pattern = re.compile(
        r"\b(DATEPART\(\s*(YEAR|MONTH|DAY)\s*,\s*((?:[^()]|\([^()]*\))+?)\s*\))\s+AS\s+(?:\"([^\"]+)\"|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*))",
        re.IGNORECASE,
    )
    aliases: dict[str, str] = {}

    for match in datepart_alias_pattern.finditer(sql):
        expression = match.group(1)
        alias = match.group(4) or match.group(5) or match.group(6)
        aliases[alias.lower()] = expression

    if not aliases:
        return sql

    clause_pattern = re.compile(
        r"\b(GROUP\s+BY|ORDER\s+BY|HAVING)\b(?P<body>.*?)(?=\b(?:ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|OFFSET|FETCH|UNION|WHERE)\b|$)",
        re.IGNORECASE | re.DOTALL,
    )

    def replace_clause(match: re.Match) -> str:
        body = match.group("body")
        placeholders: dict[str, str] = {}
        for alias, expression in aliases.items():
            placeholder = f"__WREN_MSSQL_DATEPART_ALIAS_{len(placeholders)}__"
            placeholders[placeholder] = expression
            body = re.sub(
                rf'"{re.escape(alias)}"',
                placeholder,
                body,
                flags=re.IGNORECASE,
            )
            body = re.sub(
                rf"\[{re.escape(alias)}\]",
                placeholder,
                body,
                flags=re.IGNORECASE,
            )
            body = re.sub(
                rf"(?<!DATEPART\()\b{re.escape(alias)}\b",
                placeholder,
                body,
                flags=re.IGNORECASE,
            )
        for placeholder, expression in placeholders.items():
            body = body.replace(placeholder, expression)
        return f"{match.group(1)}{body}"

    return clause_pattern.sub(replace_clause, sql)


def normalize_generation_result_sql(sql: str, data_source: str | None = None) -> str:
    normalized = sql

    if normalize_data_source(data_source) == "MSSQL":
        now = datetime.now()
        normalized = re.sub(
            r"\s+NULLS\s+(?:LAST|FIRST)\b", "", normalized, flags=re.IGNORECASE
        )
        normalized = re.sub(
            r"CAST\(\s*('(?:[^']|'')*')\s+AS\s+DATETIME(?:2|OFFSET)\s*\)",
            r"\1",
            normalized,
            flags=re.IGNORECASE,
        )
        normalized = _replace_relative_getdate_calls(normalized, now)
        normalized = _rewrite_mssql_to_unixtime(normalized)
        normalized = _rewrite_mssql_timestamp_subtraction(normalized)
        normalized = _rewrite_mssql_timestamp_casts(normalized)
        normalized = _rewrite_mssql_invented_date_identifiers(normalized)
        normalized = _rewrite_mssql_bare_time_bucket_identifiers(normalized)
        normalized = _rewrite_mssql_bucket_functions(normalized)
        normalized = _rewrite_temporal_bucket_functions(normalized)
        normalized = _rewrite_mssql_datepart_alias_references(normalized)

    return re.sub(r"\s+", " ", normalized).strip()


@component
class SQLGenPostProcessor:
    def __init__(self, engine: Engine):
        self._engine = engine

    @component.output_types(
        valid_generation_result=Dict[str, Any],
        invalid_generation_result=Dict[str, Any],
    )
    async def run(
        self,
        replies: List[str] | List[List[str]],
        project_id: str | None = None,
        use_dry_plan: bool = False,
        allow_dry_plan_fallback: bool = True,
        data_source: str = "",
        allow_data_preview: bool = False,
    ) -> dict:
        try:
            cleaned_generation_result = extract_sql_generation_result(replies[0])

            cleaned_generation_result = normalize_generation_result_sql(
                cleaned_generation_result, data_source=data_source
            )

            if not is_select_statement(cleaned_generation_result):
                return {
                    "valid_generation_result": {},
                    "invalid_generation_result": {
                        "sql": cleaned_generation_result,
                        "original_sql": cleaned_generation_result,
                        "type": "DRY_RUN",
                        "error": "Generated response did not contain a SQL SELECT statement.",
                        "correlation_id": "",
                    },
                }

            (
                valid_generation_result,
                invalid_generation_result,
            ) = await self._classify_generation_result(
                cleaned_generation_result,
                project_id=project_id,
                use_dry_plan=use_dry_plan,
                allow_dry_plan_fallback=allow_dry_plan_fallback,
                data_source=data_source,
                allow_data_preview=allow_data_preview,
            )

            return {
                "valid_generation_result": valid_generation_result,
                "invalid_generation_result": invalid_generation_result,
            }
        except Exception as e:
            logger.exception(f"Error in SQLGenPostProcessor: {e}")

            return {
                "valid_generation_result": {},
                "invalid_generation_result": {},
            }

    async def _classify_generation_result(
        self,
        generation_result: str,
        project_id: str | None = None,
        use_dry_plan: bool = False,
        allow_dry_plan_fallback: bool = True,
        data_source: str = "",
        allow_data_preview: bool = False,
    ) -> Dict[str, str]:
        valid_generation_result = {}
        invalid_generation_result = {}
        generation_result = normalize_generation_result_sql(
            generation_result, data_source=data_source
        )
        use_dry_run = not allow_data_preview

        async with aiohttp.ClientSession() as session:
            if use_dry_plan:
                dry_plan_result, error_message = await self._engine.dry_plan(
                    session,
                    generation_result,
                    data_source,
                    allow_fallback=allow_dry_plan_fallback,
                )

                if dry_plan_result:
                    valid_generation_result = {
                        "sql": generation_result,
                        "correlation_id": "",
                    }
                else:
                    invalid_generation_result = {
                        "sql": generation_result,
                        "type": "TIME_OUT"
                        if error_message.startswith("Request timed out")
                        else "DRY_PLAN",
                        "error": error_message,
                        "correlation_id": "",
                    }
            elif use_dry_run:
                success, _, addition = await self._engine.execute_sql(
                    generation_result,
                    session,
                    project_id=project_id,
                    limit=1,
                    dry_run=True,
                )

                if success:
                    valid_generation_result = {
                        "sql": generation_result,
                        "correlation_id": addition.get("correlation_id", ""),
                    }
                else:
                    error_message = addition.get("error_message", "")
                    normalized_error_sql = normalize_generation_result_sql(
                        addition.get("error_sql", generation_result),
                        data_source=data_source,
                    )
                    invalid_generation_result = {
                        "sql": normalized_error_sql,
                        "original_sql": generation_result,
                        "type": "TIME_OUT"
                        if error_message.startswith("Request timed out")
                        else "DRY_RUN",
                        "error": error_message,
                        "correlation_id": addition.get("correlation_id", ""),
                    }
            else:
                has_data, _, addition = await self._engine.execute_sql(
                    generation_result,
                    session,
                    project_id=project_id,
                    limit=1,
                    dry_run=False,
                )

                if has_data:
                    valid_generation_result = {
                        "sql": generation_result,
                        "correlation_id": addition.get("correlation_id", ""),
                    }
                else:
                    error_message = addition.get("error_message", "")
                    preview_data_status = (
                        "PREVIEW_EMPTY_DATA"
                        if error_message == ""
                        else "PREVIEW_FAILED"
                    )
                    normalized_error_sql = normalize_generation_result_sql(
                        addition.get("error_sql", generation_result),
                        data_source=data_source,
                    )
                    invalid_generation_result = {
                        "sql": normalized_error_sql,
                        "original_sql": generation_result,
                        "type": "TIME_OUT"
                        if error_message.startswith("Request timed out")
                        else preview_data_status,
                        "error": error_message,
                        "correlation_id": addition.get("correlation_id", ""),
                    }

        return valid_generation_result, invalid_generation_result


_DEFAULT_TEXT_TO_SQL_RULES = """
### SQL RULES ###
- ONLY USE SELECT statements, NO DELETE, UPDATE OR INSERT etc. statements that might change the data in the database.
- ONLY USE the tables and columns mentioned in the database schema.
- ONLY USE "*" if the user query asks for all the columns of a table.
- ONLY CHOOSE columns belong to the tables mentioned in the database schema.
- DON'T INCLUDE comments in the generated SQL query.
- YOU MUST USE "JOIN" if you choose columns from multiple tables!
- PREFER USING CTEs over subqueries.
- When generating SQL query, always:
    - Put double quotes around column and table names.
    - Put single quotes around string literals.
    - Never quote numeric literals.
    For example: SELECT "customers"."customer_name" FROM "customers" WHERE "customers"."city" = 'Taipei' and "customers"."year" = 1992;
- YOU MUST USE "lower(<table_name>.<column_name>) like lower(<value>)" function or "lower(<table_name>.<column_name>) = lower(<value>)" function for case-insensitive comparison!
    - Use "lower(<table_name>.<column_name>) LIKE lower(<value>)" when:
        - The user requests a pattern or partial match.
        - The value is not specific enough to be a single, exact value.
        - Wildcards (%) are needed to capture the pattern.
    - Use "lower(<table_name>.<column_name>) = lower(<value>)" when:
        - The user requests an exact, specific value.
        - There is no ambiguity or pattern in the value.
- If the column is date/time related field, and it is a INT/BIGINT/DOUBLE/FLOAT type, please use the appropriate function mentioned in the SQL FUNCTIONS section to cast the column to a temporal type first before using it in the query.
    - For engines that list these functions in SQL FUNCTIONS, use TO_TIMESTAMP_MILLIS("<timestamp_column>") if the timestamp_column is in milliseconds.
    - For engines that list these functions in SQL FUNCTIONS, use TO_TIMESTAMP_SECONDS("<timestamp_column>") if the timestamp_column is in seconds.
    - For engines that list these functions in SQL FUNCTIONS, use TO_TIMESTAMP_MICROS("<timestamp_column>") if the timestamp_column is in microseconds.
- When you need to cast a date/time related field, CAST it to a temporal type that is supported by the target data source and consistent with the SQL FUNCTIONS section.
    - example 1: CAST(properties_closedate AS TIMESTAMP)
    - example 2: CAST('2024-11-09 00:00:00' AS TIMESTAMP)
- If the user asks for a specific date, please give the date range in SQL query
    - example: "What is the total revenue for the month of 2024-11-01?"
    - answer: "SELECT SUM(r.PriceSum) FROM Revenue r WHERE CAST(r.PurchaseTimestamp AS TIMESTAMP) >= CAST('2024-11-01 00:00:00' AS TIMESTAMP) AND CAST(r.PurchaseTimestamp AS TIMESTAMP) < CAST('2024-11-02 00:00:00' AS TIMESTAMP)"
- USE THE VIEW TO SIMPLIFY THE QUERY.
- DON'T MISUSE THE VIEW NAME. THE ACTUAL NAME IS FOLLOWING THE CREATE VIEW STATEMENT.
- ONLY USE table/column alias in the final SELECT clause; don't use table/columnalias in the other clauses.
- Refer to the value of alias from the comment section of the corresponding table or column in the DATABASE SCHEMA section for reference when using alias in the final SELECT clause.
  - EXAMPLE
    DATABASE SCHEMA
    /* {"alias":"_orders","description":"A model representing the orders data."} */
    CREATE TABLE orders (
      -- {"description":"A column that represents the timestamp when the order was approved.","alias":"_timestamp"}
      ApprovedTimestamp TIMESTAMP
    }

    SQL
    SELECT "_orders"."ApprovedTimestamp" AS "_timestamp" FROM "orders" AS "_orders";
- DON'T USE '.' in column/table alias, replace '.' with '_' in column/table alias.
- DON'T USE "FILTER(WHERE <expression>)" clause in the generated SQL query.
- DON'T USE "EXTRACT(EPOCH FROM <expression>)" clause in the generated SQL query.
- DON'T USE "EXTRACT()" function with INTERVAL data types as arguments
- DON'T USE INTERVAL or generate INTERVAL-like expression in the generated SQL query.
- DON'T USE "TO_CHAR" function in the generated SQL query.
- Aggregate functions are not allowed in the WHERE clause. Instead, they belong in the HAVING clause, which is used to filter after aggregation.
- You can only add "ORDER BY" and "LIMIT" to the final "UNION" result.
- For the ranking problem, you must use the ranking function, `DENSE_RANK()` to rank the results and then use `WHERE` clause to filter the results.
- For the ranking problem, you must add the ranking column to the final SELECT clause.
"""

_MSSQL_TEXT_TO_SQL_RULES = """
### MSSQL-SPECIFIC RULES ###
- The target database is MSSQL.
- Prefer native T-SQL date bucket syntax such as DATEPART(YEAR, "created_at") and DATEPART(MONTH, "created_at").
- DO NOT use PostgreSQL-style or Trino-style date syntax such as DATE_TRUNC, DATETRUNC, INTERVAL, CURRENT_DATE, TIMESTAMP WITH TIME ZONE, TO_CHAR, TO_UNIXTIME, TO_TIMESTAMP, TO_TIMESTAMP_MILLIS, TO_TIMESTAMP_SECONDS, TO_TIMESTAMP_MICROS, TO_TIMESTAMP_NANOS, or :: casts.
- DO NOT use JSON extraction functions or operators such as JSON_VALUE, JSON_QUERY, JSON_EXTRACT, JSON_EXTRACT_SCALAR, JSON_EXTRACT_ARRAY, json_value, json_extract, ->, or ->>. The MSSQL Wren/Ibis runtime does not support them.
- If a table has a generic JSON/text column such as "data", do not assume keys inside it are queryable. Only use fields that are exposed as first-class columns in the DATABASE SCHEMA.
- Never invent JSON-derived columns such as "repair_date", "repair_status", or "failure_code" unless they are explicitly listed as columns in the DATABASE SCHEMA.
- For repair trend or repair volume questions, prefer explicit timestamp columns such as "created_at", "updated_at", "opened_at", or "closed_at" only when those exact columns appear in the selected table schema.
- DO NOT use DATEADD, DATEDIFF, DATETIME2, or DATETIMEOFFSET unless the SQL FUNCTIONS section explicitly proves they are supported by the target runtime.
- Do not subtract timestamp/date columns directly. If a duration or turnaround column exists in the schema, select that column directly. If only start/end timestamps exist and the SQL FUNCTIONS section lists DATEDIFF, use DATEDIFF('second', <start_timestamp>, <end_timestamp>) for duration in seconds.
- Resolve relative time phrases such as "last 12 months", "last month", or "this year" into absolute ISO timestamp boundaries using the current time context. Prefer closed-open literal ranges over runtime date arithmetic.
- For month bucketing, prefer separate year/month fields:
    - DATEPART(YEAR, <timestamp_expression>) AS "year"
    - DATEPART(MONTH, <timestamp_expression>) AS "month"
  Then GROUP BY and ORDER BY the same year/month expressions.
- Do not GROUP BY or ORDER BY quoted year/month aliases such as "YEAR" or "MONTH"; repeat the DATEPART(...) expression instead.
- For year bucketing, prefer DATEPART(YEAR, <timestamp_expression>).
- For filtering a specific year such as 2025, prefer a closed-open range:
    - <timestamp_expression> >= '2025-01-01 00:00:00'
    - AND <timestamp_expression> < '2026-01-01 00:00:00'
- When a temporal cast is required, use CAST(<expression> AS DATETIME), or keep literal timestamps as plain ISO strings if the column is already datetime-like.
- Keep MSSQL date logic simple and planner-safe. Never emit DATEADD/DATEDIFF fallback expressions unless the SQL FUNCTIONS section explicitly requires them.
"""


_DEFAULT_CALCULATED_FIELD_INSTRUCTIONS = """
#### Instructions for Calculated Field ####

The first structure is the special column marked as "Calculated Field". You need to interpret the purpose and calculation basis for these columns, then utilize them in the following text-to-sql generation tasks.
First, provide a brief explanation of what each field represents in the context of the schema, including how each field is computed using the relationships between models.
Then, during the following tasks, if the user queries pertain to any calculated fields defined in the database schema, ensure to utilize those calculated fields appropriately in the output SQL queries.
The goal is to accurately reflect the intent of the question in the SQL syntax, leveraging the pre-computed logic embedded within the calculated fields.

EXAMPLES:
The given schema is created by the SQL command:

CREATE TABLE orders (
  OrderId VARCHAR PRIMARY KEY,
  CustomerId VARCHAR,
  -- This column is a Calculated Field
  -- column expression: avg(reviews.Score)
  Rating DOUBLE,
  -- This column is a Calculated Field
  -- column expression: count(reviews.Id)
  ReviewCount BIGINT,
  -- This column is a Calculated Field
  -- column expression: count(order_items.ItemNumber)
  Size BIGINT,
  -- This column is a Calculated Field
  -- column expression: count(order_items.ItemNumber) > 1
  Large BOOLEAN,
  FOREIGN KEY (CustomerId) REFERENCES customers(Id)
);

Interpret the columns that are marked as Calculated Fields in the schema:
Rating (DOUBLE) - Calculated as the average score (avg) of the Score field from the reviews table where the reviews are associated with the order. This field represents the overall customer satisfaction rating for the order based on review scores.
ReviewCount (BIGINT) - Calculated by counting (count) the number of entries in the reviews table associated with this order. It measures the volume of customer feedback received for the order.
Size (BIGINT) - Represents the total number of items in the order, calculated by counting the number of item entries (ItemNumber) in the order_items table linked to this order. This field is useful for understanding the scale or size of an order.
Large (BOOLEAN) - A boolean value calculated to check if the number of items in the order exceeds one (count(order_items.ItemNumber) > 1). It indicates whether the order is considered large in terms of item quantity.

And if the user input queries like these:
1. "How many large orders have been placed by customer with ID 'C1234'?"
2. "What is the average customer rating for orders that were rated by more than 10 reviewers?"

For the first query:
First try to intepret the user query, the user wants to know the average rating for orders which have attracted significant review activity, specifically those with more than 10 reviews.
Then, according to the above intepretation about the given schema, the term 'Rating' is predefined in the Calculated Field of the 'orders' model. And, the number of reviews is also predefined in the 'ReviewCount' Calculated Field.
So utilize those Calculated Fields in the SQL generation process to give an answer like this:

SQL Query: SELECT AVG(Rating) FROM orders WHERE ReviewCount > 10
"""

_DEFAULT_METRIC_INSTRUCTIONS = """
#### Instructions for Metric ####

Second, you will learn how to effectively utilize the special "metric" structure in text-to-SQL generation tasks.
Metrics in a data model simplify complex data analysis by structuring data through predefined dimensions and measures.
This structuring closely mirrors the concept of OLAP (Online Analytical Processing) cubes but is implemented in a more flexible and SQL-friendly manner.

The metric typically constructed of the following components:
1. Base Object
The "base object" of a metric indicates the primary data source or table that provides the raw data.
Metrics are constructed by selecting specific data points (dimensions and measures) from this base object, effectively creating a summarized or aggregated view of the data that can be queried like a normal table.
Base object is the attribute of the metric, showing the origin of this metric and is typically not used in the query.
2. Dimensions
Dimensions in a metric represent the various axes along which data can be segmented for analysis.
These are fields that provide a categorical breakdown of data.
Each dimension provides a unique perspective on the data, allowing users to "slice and dice" the data cube to view different facets of the information contained within the base dataset.
Dimensions are used as table columns in the querying process. Querying a dimension means to get the statistic from the certain perspective.
3. Measures
Measures are numerical or quantitative statistics calculated from the data. Measures are key results or outputs derived from data aggregation functions like SUM, COUNT, or AVG.
Measures are used as table columns in the querying process, and are the main querying items in the metric structure.
The expression of a measure represents the definition of the  that users are intrested in. Make sure to understand the meaning of measures from their expressions.
4. Time Grain
Time Grain specifies the granularity of time-based data aggregation, such as daily, monthly, or yearly, facilitating trend analysis over specified periods.

If the given schema contains the structures marked as 'metric', you should first interpret the metric schema based on the above definition.
Then, during the following tasks, if the user queries pertain to any metrics defined in the database schema, ensure to utilize those metrics appropriately in the output SQL queries.
The target is making complex data analysis more accessible and manageable by pre-aggregating data and structuring it using the metric structure, and supporting direct querying for business insights.

EXAMPLES:
The given schema is created by the SQL command:

/* This table is a metric */
/* Metric Base Object: orders */
CREATE TABLE Revenue (
  -- This column is a dimension
  PurchaseTimestamp TIMESTAMP,
  -- This column is a dimension
  CustomerId VARCHAR,
  -- This column is a dimension
  Status VARCHAR,
  -- This column is a measure
  -- expression: sum(order_items.Price)
  PriceSum DOUBLE,
  -- This column is a measure
  -- expression: count(OrderId)
  NumberOfOrders BIGINT
);

Interpret the metric with the understanding of the metric structure:
1. Base Object: orders
This is the primary data source for the metric.
The orders table provides the underlying data from which dimensions and measures are derived.
It is the foundation upon which the metric is built, though it itself is not directly used in queries against the Revenue table.
It shows the reference between the 'Revenue' metric and the 'orders' model. For the user queries pretain to the 'Revenue' of 'orders', the metric should be utilize in the sql generation process.
2. Dimensions
The metric contains the columns marked as 'dimension'. They can be interpreted as below:
- PurchaseTimestamp (TIMESTAMP)
  Acts as a temporal dimension, allowing analysis of revenue over time. This can be used to observe trends, seasonal variations, or performance over specific periods.
- CustomerId (VARCHAR)
  A key dimension for customer segmentation, it enables the analysis of revenue generated from individual customers or customer groups.
- Status (VARCHAR)
  Reflects the current state of an order (e.g., pending, completed, cancelled). This dimension is crucial for analyses that differentiate performance based on order status.
3. Measures
The metric contains the columns marked as 'measure'. They can be interpreted as below:
- PriceSum (DOUBLE)
  A financial measure calculated as sum(order_items.Price), representing the total revenue generated from orders. This measure is vital for tracking overall sales performance and is the primary output of interest in many financial and business analyses.
- NumberOfOrders (BIGINT)
  A count measure that provides the total number of orders. This is essential for operational metrics, such as assessing the volume of business activity and evaluating the efficiency of sales processes.

Now, if the user input queries like this:
Question: "What was the total revenue from each customer last month?"

First try to intepret the user query, the user asks for a breakdown of the total revenue generated by each customer in the previous calendar month.
The user is specifically interested in understanding how much each customer contributed to the total sales during this period.
To answer this question, it is suitable to use the following components from the metric:
1. CustomerId (Dimension): This will be used to group the revenue data by each unique customer, allowing us to segment the total revenue by customer.
2. PurchaseTimestamp (Dimension): This timestamp field will be used to filter the data to only include orders from the last month.
3. PriceSum (Measure): Since PriceSum is a pre-aggregated measure of total revenue (sum of order_items.Price), it can be directly used to sum up the revenue without needing further aggregation in the SQL query.
So utilize those metric components in the SQL generation process to give an answer using the date functions that are valid for the target data source and listed in the SQL FUNCTIONS section.

For example, the SQL should filter PurchaseTimestamp to the previous calendar month using the dialect-appropriate month-boundary functions from the SQL FUNCTIONS section.
"""

_DEFAULT_JSON_FIELD_INSTRUCTIONS = """
#### Instructions for JSON related functions ####
- ONLY USE JSON_QUERY for querying fields if "json_type":"JSON" is identified in the columns comment, NOT the deprecated JSON_EXTRACT_SCALAR function.
    - DON'T USE CAST for JSON fields, ONLY USE the following funtions:
      - LAX_BOOL for boolean fields
      - LAX_FLOAT64 for double and float fields
      - LAX_INT64 for bigint fields
      - LAX_STRING for varchar fields
    - For Example:
      DATA SCHEMA:
        `/* {"alias":"users","description":"A model representing the users data."} */
        CREATE TABLE users (
            -- {"alias":"address","description":"A JSON object that represents address information of this user.","json_type":"JSON","json_fields":{"json_type":"JSON","address.json.city":{"name":"city","type":"varchar","path":"$.city","properties":{"alias":"city","description":"City Name."}},"address.json.state":{"name":"state","type":"varchar","path":"$.state","properties":{"alias":"state","description":"ISO code or name of the state, province or district."}},"address.json.postcode":{"name":"postcode","type":"varchar","path":"$.postcode","properties":{"alias":"postcode","description":"Postal code."}},"address.json.country":{"name":"country","type":"varchar","path":"$.country","properties":{"alias":"country","description":"ISO code of the country."}}}}
            address JSON
        )`
      To get the city of address in user table use SQL:
      `SELECT LAX_STRING(JSON_QUERY(u.address, '$.city')) FROM user as u`
- ONLY USE JSON_QUERY_ARRAY for querying "json_type":"JSON_ARRAY" is identified in the comment of the column, NOT the deprecated JSON_EXTRACT_ARRAY.
    - USE UNNEST to analysis each item individually in the ARRAY. YOU MUST SELECT FROM the parent table ahead of the UNNEST ARRAY.
    - The alias of the UNNEST(ARRAY) should be in the format `unnest_table_alias(individual_item_alias)`
      - For Example: `SELECT item FROM UNNEST(ARRAY[1,2,3]) as my_unnested_table(item)`
    - If the items in the ARRAY are JSON objects, use JSON_QUERY to query the fields inside each JSON item.
      - For Example:
      DATA SCHEMA
        `/* {"alias":"my_table","description":"A test my_table"} */
        CREATE TABLE my_table (
            -- {"alias":"elements","description":"elements column","json_type":"JSON_ARRAY","json_fields":{"json_type":"JSON_ARRAY","elements.json_array.id":{"name":"id","type":"bigint","path":"$.id","properties":{"alias":"id","description":"data ID."}},"elements.json_array.key":{"name":"key","type":"varchar","path":"$.key","properties":{"alias":"key","description":"data Key."}},"elements.json_array.value":{"name":"value","type":"varchar","path":"$.value","properties":{"alias":"value","description":"data Value."}}}}
            elements JSON
        )`
        To get the number of elements in my_table table use SQL:
        `SELECT LAX_INT64(JSON_QUERY(element, '$.number')) FROM my_table as t, UNNEST(JSON_QUERY_ARRAY(elements)) AS my_unnested_table(element) WHERE LAX_FLOAT64(JSON_QUERY(element, '$.value')) > 3.5`
    - To JOIN ON the fields inside UNNEST(ARRAY), YOU MUST SELECT FROM the parent table ahead of the UNNEST syntax, and the alias of the UNNEST(ARRAY) SHOULD BE IN THE FORMAT unnest_table_alias(individual_item_alias)
      - For Example: `SELECT p.column_1, j.column_2 FROM parent_table AS p, join_table AS j JOIN UNNEST(p.array_column) AS unnested(array_item) ON j.id = array_item.id`
- DON'T USE JSON_QUERY and JSON_QUERY_ARRAY when "json_type":"".
- DON'T USE LAX_BOOL, LAX_FLOAT64, LAX_INT64, LAX_STRING when "json_type":"".
"""

sql_samples_instructions = """
#### Instructions for SQL Samples ####

Finally, you will learn from the sample SQL queries provided in the input. These samples demonstrate best practices and common patterns for querying this specific database.

For each sample, you should:
1. Study the question that explains what the query aims to accomplish
2. Analyze the SQL implementation to understand:
   - Table structures and relationships used
   - Specific functions and operators employed
   - Query patterns and techniques demonstrated
3. Use these samples as reference patterns when generating similar queries
4. Adapt the techniques shown in the samples to match new query requirements while maintaining consistent style and approach

The samples will help you understand:
- Preferred table join patterns
- Common aggregation methods
- Specific function usage
- Query structure and formatting conventions

When generating new queries, try to follow similar patterns when applicable, while adapting them to the specific requirements of each new query.

Learn about the usage of the schema structures and generate SQL based on them.
"""


sql_generation_reasoning_system_prompt = """
### TASK ###
You are a helpful data analyst who is great at thinking deeply and reasoning about the user's question and the database schema, and you provide a step-by-step reasoning plan in order to answer the user's question.

### INSTRUCTIONS ###
1. Think deeply and reason about the user's question, the database schema, and the user's query history if provided.
2. Explicitly state the following information in the reasoning plan:
if the user puts any specific timeframe(e.g. YYYY-MM-DD) in the user's question(excluding the value of the current time), you will put the absolute time frame in the SQL query;
if the user uses a relative timeframe and Current Time is provided in the input, you will resolve it into an absolute time frame in the SQL query using exact dates rather than relative date arithmetic.
3. For the ranking problem(e.g. "top x", "bottom x", "first x", "last x"), you must use the ranking function, `DENSE_RANK()` to rank the results and then use `WHERE` clause to filter the results.
4. For the ranking problem(e.g. "top x", "bottom x", "first x", "last x"), you must add the ranking column to the final SELECT clause.
5. If USER INSTRUCTIONS section is provided, make sure to consider them in the reasoning plan.
6. If SQL SAMPLES section is provided, make sure to consider them in the reasoning plan.
7. Give a step by step reasoning plan in order to answer user's question.
8. The reasoning plan should be in the language same as the language user provided in the input.
9. Don't include SQL in the reasoning plan.
10. Each step in the reasoning plan must start with a number, a title(in bold format in markdown), and a reasoning for the step.
11. Do not include ```markdown or ``` in the answer.
12. A table name in the reasoning plan must be in this format: `table: <table_name>`.
13. A column name in the reasoning plan must be in this format: `column: <table_name>.<column_name>`.
14. ONLY SHOWING the reasoning plan in bullet points.

### FINAL ANSWER FORMAT ###
The final answer must be a reasoning plan in plain Markdown string format
"""


def _extract_from_sql_knowledge(
    sql_knowledge: SqlKnowledge | None, attribute_name: str, default_value: str
) -> str:
    if sql_knowledge is None:
        return default_value

    value = getattr(sql_knowledge, attribute_name, "")
    return value if value and value.strip() else default_value


def _append_data_source_rules(base_rules: str, data_source: str | None = None) -> str:
    normalized_data_source = normalize_data_source(data_source)
    if normalized_data_source == "MSSQL":
        return f"{base_rules}\n\n{_MSSQL_TEXT_TO_SQL_RULES}"
    return base_rules


def get_text_to_sql_rules(
    sql_knowledge: SqlKnowledge | None = None,
    data_source: str | None = None,
) -> str:
    if sql_knowledge is not None:
        base_rules = _extract_from_sql_knowledge(
            sql_knowledge, "text_to_sql_rule", _DEFAULT_TEXT_TO_SQL_RULES
        )
        return _append_data_source_rules(base_rules, data_source)

    return _append_data_source_rules(_DEFAULT_TEXT_TO_SQL_RULES, data_source)


def get_calculated_field_instructions(sql_knowledge: SqlKnowledge | None = None) -> str:
    if sql_knowledge is not None:
        return _extract_from_sql_knowledge(
            sql_knowledge,
            "calculated_field_instructions",
            _DEFAULT_CALCULATED_FIELD_INSTRUCTIONS,
        )

    return _DEFAULT_CALCULATED_FIELD_INSTRUCTIONS


def get_metric_instructions(
    sql_knowledge: SqlKnowledge | None = None,
    data_source: str | None = None,
) -> str:
    instructions = _DEFAULT_METRIC_INSTRUCTIONS
    if sql_knowledge is not None:
        instructions = _extract_from_sql_knowledge(
            sql_knowledge, "metric_instructions", _DEFAULT_METRIC_INSTRUCTIONS
        )

    if normalize_data_source(data_source) == "MSSQL":
        instructions += """

#### MSSQL Metric Notes ####
- Resolve relative metric time windows into absolute ISO date ranges whenever current time context is available.
- Do not use DATE_TRUNC, DATETRUNC, DATEADD, DATEDIFF, INTERVAL, CURRENT_DATE, or TIMESTAMP WITH TIME ZONE in MSSQL metric queries unless the SQL FUNCTIONS section explicitly shows they are supported by the target engine.
- For month trend metrics, prefer DATEPART(YEAR, <timestamp_expression>) and DATEPART(MONTH, <timestamp_expression>) as separate grouped columns.
"""

    return instructions


def get_json_field_instructions(sql_knowledge: SqlKnowledge | None = None) -> str:
    if sql_knowledge is not None:
        return _extract_from_sql_knowledge(
            sql_knowledge, "json_field_instructions", _DEFAULT_JSON_FIELD_INSTRUCTIONS
        )

    return _DEFAULT_JSON_FIELD_INSTRUCTIONS


def get_sql_generation_system_prompt(
    sql_knowledge: SqlKnowledge | None = None,
    data_source: str | None = None,
) -> str:
    text_to_sql_rules = get_text_to_sql_rules(
        sql_knowledge,
        data_source=data_source,
    )

    return f"""
You are a helpful assistant that converts natural language queries into ANSI SQL queries.

Given user's question, database schema, etc., you should think deeply and carefully and generate the SQL query based on the given reasoning plan step by step.

### GENERAL RULES ###

1. YOU MUST FOLLOW the instructions strictly to generate the SQL query if the section of USER INSTRUCTIONS is available in user's input.
2. YOU MUST ONLY CHOOSE the appropriate functions from the sql functions list and use them in the SQL query if the section of SQL FUNCTIONS is available in user's input.
3. YOU MUST REFER to the sql samples and learn the usage of the schema structures and how SQL is written based on them if the section of SQL SAMPLES is available in user's input.
4. YOU MUST FOLLOW the reasoning plan step by step strictly to generate the SQL query if the section of REASONING PLAN is available in user's input.
5. YOU MUST FOLLOW SQL Rules if they are not contradicted with instructions.
6. YOU MUST ONLY use table names and column names that are explicitly present in the DATABASE SCHEMA or VALID TABLE NAMES sections.
7. NEVER invent generic table names such as repair_logs, repair_log, sales_data, orders, users, tickets, events, or transactions unless that exact table name is present in the DATABASE SCHEMA or VALID TABLE NAMES sections.
8. If the user asks about a business concept such as repairs, PCB, cost, turnaround time, or volume, map it to the closest explicit table and column names from the provided schema. Do not create a new table name from the business concept.
9. Do not prefix table names with catalog or schema names unless the DATABASE SCHEMA or VALID TABLE NAMES section shows the table name with that exact prefix.

{text_to_sql_rules}

### FINAL ANSWER FORMAT ###
The final answer must be a ANSI SQL query in JSON format:

{{
    "sql": <SQL_QUERY_STRING>
}}
"""


class SqlGenerationResult(BaseModel):
    sql: str


SQL_GENERATION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "sql_generation_result",
            "schema": SqlGenerationResult.model_json_schema(),
        },
    }
}


def get_sql_generation_model_kwargs(llm_provider: LLMProvider) -> dict:
    model_kwargs = llm_provider.get_model_kwargs() or {}
    response_format = model_kwargs.get("response_format", {})

    if isinstance(response_format, dict) and response_format.get("type") == "text":
        return {}

    return SQL_GENERATION_MODEL_KWARGS


def construct_instructions(
    instructions: list[dict] | None = None,
):
    _instructions = []
    if instructions:
        _instructions += [
            instruction.get("instruction") for instruction in instructions
        ]

    return _instructions


def construct_valid_table_names(documents: list[Any] | None = None) -> list[str]:
    table_names = []
    for document in documents or []:
        content = getattr(document, "content", document)
        if not isinstance(content, str):
            continue

        for match in re.finditer(
            r"\bCREATE\s+TABLE\s+([`\"\[]?)([A-Za-z_][A-Za-z0-9_.$]*)\1",
            content,
            flags=re.IGNORECASE,
        ):
            table_names.append(match.group(2))

    return sorted(set(table_names))


def construct_ask_history_messages(
    histories: list[AskHistory] | list[dict],
) -> list[ChatMessage]:
    messages = []
    for history in histories:
        messages.append(
            ChatMessage.from_user(
                history.question
                if hasattr(history, "question")
                else history["question"]
            )
        )
        messages.append(
            ChatMessage.from_assistant(
                history.sql if hasattr(history, "sql") else history["sql"]
            )
        )
    return messages
