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


def _replace_relative_current_date_calls(sql: str, now: datetime) -> str:
    def replace_date_sub_interval(match: re.Match[str]) -> str:
        amount = int(match.group("amount"))
        unit = match.group("unit").lower()
        if unit.startswith("month"):
            return _format_timestamp_literal(_add_months(now, -amount))
        if unit.startswith("year"):
            return _format_timestamp_literal(_add_months(now, -amount * 12))
        if unit.startswith("day"):
            return _format_timestamp_literal(now - timedelta(days=amount))
        return match.group(0)

    def replace_date_sub_unit_amount(match: re.Match[str]) -> str:
        unit = match.group("unit").lower()
        amount = int(match.group("amount"))
        if unit.startswith("month"):
            return _format_timestamp_literal(_add_months(now, -amount))
        if unit.startswith("year"):
            return _format_timestamp_literal(_add_months(now, -amount * 12))
        if unit.startswith("day"):
            return _format_timestamp_literal(now - timedelta(days=amount))
        return match.group(0)

    sql = re.sub(
        r"\bDATE_SUB\(\s*CURRENT_DATE(?:\(\))?\s*,\s*INTERVAL\s+(?P<amount>\d+)\s+(?P<unit>YEAR|MONTH|DAY)S?\s*\)",
        replace_date_sub_interval,
        sql,
        flags=re.IGNORECASE,
    )
    sql = re.sub(
        r"\bDATE_SUB\(\s*'?(?P<unit>YEAR|MONTH|DAY)'?\s*,\s*(?P<amount>\d+)\s*,\s*CURRENT_DATE(?:\(\))?\s*\)",
        replace_date_sub_unit_amount,
        sql,
        flags=re.IGNORECASE,
    )
    sql = re.sub(
        r"\bCURRENT_DATE(?:\(\))?\b",
        _format_timestamp_literal(now),
        sql,
        flags=re.IGNORECASE,
    )
    return sql


def _rewrite_mssql_bucket_functions(sql: str) -> str:
    expression_pattern = r"((?:[^(),]|\([^()]*\))+?)"

    sql = re.sub(
        rf"DATEADD\(\s*month\s*,\s*DATEDIFF\(\s*month\s*,\s*0\s*,\s*{expression_pattern}\s*\)\s*,\s*0\s*\)",
        lambda m: (
            f"(EXTRACT(YEAR FROM {m.group(1)}) * 100 + EXTRACT(MONTH FROM {m.group(1)}))"
        ),
        sql,
        flags=re.IGNORECASE,
    )
    sql = re.sub(
        rf"DATEADD\(\s*year\s*,\s*DATEDIFF\(\s*year\s*,\s*0\s*,\s*{expression_pattern}\s*\)\s*,\s*0\s*\)",
        lambda m: f"EXTRACT(YEAR FROM {m.group(1)})",
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
            lambda m: f"EXTRACT(YEAR FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATEPART\(\s*MONTH\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(MONTH FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATEPART\(\s*DAY\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(DAY FROM {m.group(1)})",
        ),
        (
            re.compile(rf"YEAR\(\s*{expression_pattern}\s*\)", re.IGNORECASE),
            lambda m: f"EXTRACT(YEAR FROM {m.group(1)})",
        ),
        (
            re.compile(rf"MONTH\(\s*{expression_pattern}\s*\)", re.IGNORECASE),
            lambda m: f"EXTRACT(MONTH FROM {m.group(1)})",
        ),
        (
            re.compile(rf"DAY\(\s*{expression_pattern}\s*\)", re.IGNORECASE),
            lambda m: f"EXTRACT(DAY FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATETRUNC\(\s*MONTH\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(MONTH FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATETRUNC\(\s*YEAR\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(YEAR FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATE_TRUNC\(\s*'?\s*MONTH\s*'?\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(MONTH FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATE_TRUNC\(\s*'?\s*YEAR\s*'?\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(YEAR FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATE_PART\(\s*'?\s*YEAR\s*'?\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(YEAR FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATE_PART\(\s*'?\s*MONTH\s*'?\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(MONTH FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATE_PART\(\s*'?\s*DAY\s*'?\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(DAY FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"EXTRACT\(\s*YEAR\s+FROM\s+{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(YEAR FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"EXTRACT\(\s*MONTH\s+FROM\s+{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(MONTH FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"EXTRACT\(\s*DAY\s+FROM\s+{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(DAY FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATEPART\(\s*'YEAR'\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(YEAR FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATEPART\(\s*'MONTH'\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(MONTH FROM {m.group(1)})",
        ),
        (
            re.compile(
                rf"DATEPART\(\s*'DAY'\s*,\s*{expression_pattern}\s*\)",
                re.IGNORECASE,
            ),
            lambda m: f"EXTRACT(DAY FROM {m.group(1)})",
        ),
    ]

    rewritten = sql
    for pattern, replacement in replacements:
        rewritten = pattern.sub(replacement, rewritten)

    return rewritten


def _qualify_mssql_temporal_expression(expression: str, sql: str) -> str:
    expression = expression.strip()
    if "." in expression or expression.startswith(('"', "[")):
        return expression

    if re.search(r"\bdbo_DebugEntries\b", sql, flags=re.IGNORECASE) and re.fullmatch(
        r"(?:DateIn|DateOut|FailedAt)", expression, flags=re.IGNORECASE
    ):
        canonical_columns = {
            "datein": "DateIn",
            "dateout": "DateOut",
            "failedat": "FailedAt",
        }
        return f'"dbo_DebugEntries"."{canonical_columns[expression.lower()]}"'

    return f'"{expression}"'


def _rewrite_mssql_to_date_buckets(sql: str) -> str:
    expression_pattern = r"((?:[^(),]|\([^()]*\))+?)"

    def make_day_bucket(expression: str) -> str:
        timestamp_expression = _qualify_mssql_temporal_expression(expression, sql)
        return (
            f"(EXTRACT(YEAR FROM {timestamp_expression}) * 10000 + "
            f"EXTRACT(MONTH FROM {timestamp_expression}) * 100 + "
            f"EXTRACT(DAY FROM {timestamp_expression}))"
        )

    rewritten = re.sub(
        rf"\bTO_DATE\(\s*{expression_pattern}\s*,\s*'YYYY-MM-DD'\s*\)",
        lambda match: make_day_bucket(match.group(1)),
        sql,
        flags=re.IGNORECASE,
    )
    rewritten = re.sub(
        rf"\bDATE\(\s*{expression_pattern}\s*\)",
        lambda match: make_day_bucket(match.group(1)),
        rewritten,
        flags=re.IGNORECASE,
    )
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
        alias_text = str(alias or "").strip('"').lower()

        if not any(token in alias_text for token in ("duration", "turnaround")):
            return match.group(0)

        return f"DATEDIFF('second', {right}, {left}) AS {alias}"

    return timestamp_subtraction_pattern.sub(replace_subtraction, sql)


def _infer_mssql_timestamp_expression(sql: str) -> str | None:
    timestamp_column_pattern = re.compile(
        r'(?:(?:"[^"]+"\.)?"(?:created_at|updated_at|generated_at|opened_at|closed_at|completed_at|resolved_at|DateIn|DateOut|FailedAt)")',
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
        raw_table_name = str(table_name or "").strip('"[]')
        normalized_table_name = raw_table_name.lower()
        quoted_table_name = f'"{raw_table_name}"'
        if normalized_table_name == "dbo_debugentries":
            return f'{quoted_table_name}."DateIn"'
        if "report" in normalized_table_name:
            return f'{quoted_table_name}."generated_at"'
        if any(
            token in normalized_table_name
            for token in ("knowledge", "kb_article", "kb_articles", "article")
        ):
            return f'{quoted_table_name}."created_at"'
        if any(
            token in normalized_table_name
            for token in ("repair", "ticket", "event", "log")
        ):
            return f'{quoted_table_name}."created_at"'

    return None


def _rewrite_mssql_aggregate_qualified_temporal_columns(sql: str) -> str:
    table_references = extract_sql_table_references(sql)
    if len(table_references) != 1:
        return sql

    table_name = table_references[0]
    if not table_name:
        return sql

    table_ref = _quote_sql_identifier(table_name)
    aggregate_qualifier_pattern = (
        r'(?:"(?:SUM|COUNT|AVG|MIN|MAX)"|\[(?:SUM|COUNT|AVG|MIN|MAX)\]|'
        r'\b(?:SUM|COUNT|AVG|MIN|MAX)\b)'
    )
    temporal_column_pattern = (
        r'(?:"(?P<quoted>created_at|updated_at|generated_at|opened_at|closed_at|'
        r'completed_at|resolved_at|DateIn|DateOut|FailedAt)"|'
        r'\[(?P<bracketed>created_at|updated_at|generated_at|opened_at|closed_at|'
        r'completed_at|resolved_at|DateIn|DateOut|FailedAt)\]|'
        r'(?P<bare>created_at|updated_at|generated_at|opened_at|closed_at|'
        r'completed_at|resolved_at|DateIn|DateOut|FailedAt))'
    )
    pattern = re.compile(
        rf"{aggregate_qualifier_pattern}\s*\.\s*{temporal_column_pattern}",
        re.IGNORECASE,
    )

    def replace_reference(match: re.Match[str]) -> str:
        column = (
            match.group("quoted")
            or match.group("bracketed")
            or match.group("bare")
        )
        return f"{table_ref}.{_quote_sql_identifier(str(column))}"

    return pattern.sub(replace_reference, sql)


def _rewrite_mssql_invented_date_identifiers(sql: str) -> str:
    timestamp_expression = _infer_mssql_timestamp_expression(sql)
    if not timestamp_expression:
        return sql

    qualified_invented_date_identifier_pattern = re.compile(
        r'(?:(?:"[^"]+"|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\s*\.\s*)'
        r'(?:"(?:RepairDate|repair_date|repairDate|date|month_date|event_date)"|\[(?:RepairDate|repair_date|repairDate|date|month_date|event_date)\]|(?:RepairDate|repair_date|repairDate|month_date|event_date))',
        re.IGNORECASE,
    )
    invented_date_identifier_pattern = re.compile(
        r'(?<!\.)"(?:RepairDate|repair_date|repairDate|date|month_date|event_date)"',
        re.IGNORECASE,
    )
    rewritten = qualified_invented_date_identifier_pattern.sub(
        timestamp_expression, sql
    )
    return invented_date_identifier_pattern.sub(timestamp_expression, rewritten)


def _rewrite_mssql_sales_schema_aliases(sql: str) -> str:
    sales_table_identifier = (
        r'(?:"dbo_(?:qSales1|tblSalesHistory|tblSales)"'
        r"|\[dbo_(?:qSales1|tblSalesHistory|tblSales)\]"
        r"|dbo_(?:qSales1|tblSalesHistory|tblSales))"
    )

    def replace_qualified_column(column_pattern: str, canonical_column: str) -> None:
        nonlocal sql
        sql = re.sub(
            rf"(?P<table>{sales_table_identifier})\s*\.\s*{column_pattern}",
            lambda match: f'{match.group("table")}."{canonical_column}"',
            sql,
            flags=re.IGNORECASE,
        )

    otd_date_pattern = (
        r'(?:"OTD_Date"|"OTDDate"|\[OTD_Date\]|\[OTDDate\]|OTD_Date|OTDDate)'
    )
    fix_log_id_pattern = (
        r'(?:"FixLogId"|"FixLogID"|\[FixLogId\]|\[FixLogID\]|FixLogId|FixLogID)'
    )
    replace_qualified_column(otd_date_pattern, "InvDate")
    replace_qualified_column(fix_log_id_pattern, "InvoiceNo")

    if len(extract_sql_table_references(sql)) == 1 and re.search(
        rf"\bFROM\s+{sales_table_identifier}\b", sql, flags=re.IGNORECASE
    ):
        sql = re.sub(
            rf"(?<![\.\w]){otd_date_pattern}(?!\w)",
            '"InvDate"',
            sql,
            flags=re.IGNORECASE,
        )
        sql = re.sub(
            rf"(?<![\.\w]){fix_log_id_pattern}(?!\w)",
            '"InvoiceNo"',
            sql,
            flags=re.IGNORECASE,
        )

    return sql


def _rewrite_mssql_invented_repair_relationship_identifiers(sql: str) -> str:
    rewritten = sql

    if re.search(r"\bdbo_repair_logs\b", rewritten, flags=re.IGNORECASE):
        invented_failure_pattern_id_pattern = re.compile(
            r'(?:"dbo_repair_logs"|\[dbo_repair_logs\]|dbo_repair_logs)\s*\.\s*(?:"FailurePatternID"|"FailurePatternId"|\[FailurePatternID\]|\[FailurePatternId\]|FailurePatternID|FailurePatternId)',
            re.IGNORECASE,
        )
        rewritten = invented_failure_pattern_id_pattern.sub(
            '"dbo_repair_logs"."failure_code"', rewritten
        )

    if re.search(r"\bdbo_DebugEntries\b", rewritten, flags=re.IGNORECASE) and re.search(
        r"\bdbo_failure_patterns\b", rewritten, flags=re.IGNORECASE
    ):
        invented_debug_failure_pattern_pattern = re.compile(
            r'(?:"dbo_DebugEntries"|\[dbo_DebugEntries\]|dbo_DebugEntries)\s*\.\s*(?:"FailurePatternID"|"FailurePatternId"|\[FailurePatternID\]|\[FailurePatternId\]|FailurePatternID|FailurePatternId)',
            re.IGNORECASE,
        )
        rewritten = invented_debug_failure_pattern_pattern.sub(
            '"dbo_DebugEntries"."FailureSys"', rewritten
        )

        debug_id_identifier = (
            r'(?:"dbo_DebugEntries"|\[dbo_DebugEntries\]|dbo_DebugEntries)'
            r'\s*\.\s*(?:"DebugEntryId"|\[DebugEntryId\]|DebugEntryId)'
        )
        failure_pattern_id_identifier = (
            r'(?:"dbo_failure_patterns"|\[dbo_failure_patterns\]|dbo_failure_patterns)'
            r'\s*\.\s*(?:"id"|\[id\]|id)'
        )
        debug_id_to_failure_pattern_pattern = re.compile(
            rf"{debug_id_identifier}\s*=\s*{failure_pattern_id_identifier}",
            re.IGNORECASE,
        )
        failure_pattern_to_debug_id_pattern = re.compile(
            rf"{failure_pattern_id_identifier}\s*=\s*{debug_id_identifier}",
            re.IGNORECASE,
        )
        rewritten = debug_id_to_failure_pattern_pattern.sub(
            '"dbo_DebugEntries"."FailureSys" = "dbo_failure_patterns"."id"',
            rewritten,
        )
        rewritten = failure_pattern_to_debug_id_pattern.sub(
            '"dbo_failure_patterns"."id" = "dbo_DebugEntries"."FailureSys"',
            rewritten,
        )

    return rewritten


def _rewrite_mssql_invented_pcb_throughput_identifiers(sql: str) -> str:
    rewritten = sql
    manufacturing_unit_pattern = (
        r'(?:"ManufacturingUnit"|"Manufacturing_Unit"|"manufacturing_unit"|'
        r'\[ManufacturingUnit\]|\[Manufacturing_Unit\]|\[manufacturing_unit\]|'
        r'ManufacturingUnit|Manufacturing_Unit|manufacturing_unit)'
    )

    if re.search(r"\bdbo_DebugEntries\b", rewritten, flags=re.IGNORECASE):
        debug_table_pattern = (
            r'(?:"dbo_DebugEntries"|\[dbo_DebugEntries\]|dbo_DebugEntries)\s*\.\s*'
        )
        rewritten = re.sub(
            rf"{debug_table_pattern}{manufacturing_unit_pattern}",
            '"dbo_DebugEntries"."BusinessUnit"',
            rewritten,
            flags=re.IGNORECASE,
        )

    if re.search(r"\bdbo_repair_logs\b", rewritten, flags=re.IGNORECASE) and re.search(
        manufacturing_unit_pattern, rewritten, flags=re.IGNORECASE
    ):
        rewritten = re.sub(
            r'(?:"dbo_repair_logs"|\[dbo_repair_logs\]|dbo_repair_logs)',
            '"dbo_DebugEntries"',
            rewritten,
            flags=re.IGNORECASE,
        )
        rewritten = re.sub(
            rf'"dbo_DebugEntries"\s*\.\s*{manufacturing_unit_pattern}',
            '"dbo_DebugEntries"."BusinessUnit"',
            rewritten,
            flags=re.IGNORECASE,
        )
        rewritten = re.sub(
            r'"dbo_DebugEntries"\s*\.\s*(?:"id"|\[id\]|id)',
            '"dbo_DebugEntries"."DebugEntryId"',
            rewritten,
            flags=re.IGNORECASE,
        )
        rewritten = re.sub(
            r'"dbo_DebugEntries"\s*\.\s*(?:"created_at"|"updated_at"|\[created_at\]|\[updated_at\]|created_at|updated_at)',
            '"dbo_DebugEntries"."DateIn"',
            rewritten,
            flags=re.IGNORECASE,
        )

    return rewritten


def _rewrite_mssql_repair_log_throughput_shape(sql: str) -> str:
    if not re.search(r"\bdbo_repair_logs\b", sql, flags=re.IGNORECASE):
        return sql
    if not re.search(r"\bavg_turnaround_time\b", sql, flags=re.IGNORECASE):
        return sql
    if not re.search(r"\brepair_count\b|\bthroughput\b", sql, flags=re.IGNORECASE):
        return sql

    return (
        'SELECT "dbo_DebugEntries"."BusinessUnit" AS "unit_name", '
        'COUNT("dbo_DebugEntries"."DebugEntryId") AS "throughput" '
        'FROM "dbo_DebugEntries" '
        'GROUP BY "dbo_DebugEntries"."BusinessUnit" '
        'ORDER BY "throughput" DESC'
    )


def _rewrite_mssql_repair_log_turnaround_trend_shape(sql: str) -> str:
    if not re.search(r"\bdbo_repair_logs\b", sql, flags=re.IGNORECASE):
        return sql
    if not re.search(r"\bavg_turnaround_time\b|\bturnaround\b", sql, flags=re.IGNORECASE):
        return sql
    if not re.search(r"\bMONTH\b|DATEPART\(\s*'?\s*MONTH", sql, flags=re.IGNORECASE):
        return sql

    return (
        "SELECT EXTRACT(YEAR FROM \"dbo_repair_logs\".\"created_at\") AS \"year\", "
        "EXTRACT(MONTH FROM \"dbo_repair_logs\".\"created_at\") AS \"month\", "
        'AVG(DATEDIFF(\'second\', "dbo_repair_logs"."created_at", '
        '"dbo_repair_logs"."updated_at")) AS "avg_turnaround_seconds" '
        'FROM "dbo_repair_logs" '
        'WHERE "dbo_repair_logs"."created_at" IS NOT NULL '
        'AND "dbo_repair_logs"."updated_at" IS NOT NULL '
        "GROUP BY EXTRACT(YEAR FROM \"dbo_repair_logs\".\"created_at\"), "
        "EXTRACT(MONTH FROM \"dbo_repair_logs\".\"created_at\") "
        "ORDER BY EXTRACT(YEAR FROM \"dbo_repair_logs\".\"created_at\") ASC, "
        "EXTRACT(MONTH FROM \"dbo_repair_logs\".\"created_at\") ASC"
    )


def _rewrite_mssql_ticket_cycle_turnaround_shape(sql: str) -> str:
    if not re.search(r"\bdbo_ticket_cycles\b", sql, flags=re.IGNORECASE):
        return sql
    if not re.search(r"\bturnaround_time\b|\bavg_turnaround_time\b", sql, flags=re.IGNORECASE):
        return sql
    if not re.search(r"\bMONTH\b|DATEPART\(\s*'?\s*MONTH", sql, flags=re.IGNORECASE):
        return sql

    return (
        'SELECT EXTRACT(YEAR FROM "dbo_ticket_cycles"."created_at") AS "year", '
        'EXTRACT(MONTH FROM "dbo_ticket_cycles"."created_at") AS "month", '
        'AVG(DATEDIFF(\'second\', "dbo_ticket_cycles"."start_date", '
        '"dbo_ticket_cycles"."end_date")) AS "avg_turnaround_seconds" '
        'FROM "dbo_ticket_cycles" '
        'WHERE "dbo_ticket_cycles"."start_date" IS NOT NULL '
        'AND "dbo_ticket_cycles"."end_date" IS NOT NULL '
        'GROUP BY EXTRACT(YEAR FROM "dbo_ticket_cycles"."created_at"), '
        'EXTRACT(MONTH FROM "dbo_ticket_cycles"."created_at") '
        'ORDER BY EXTRACT(YEAR FROM "dbo_ticket_cycles"."created_at") ASC, '
        'EXTRACT(MONTH FROM "dbo_ticket_cycles"."created_at") ASC'
    )


def _rewrite_mssql_invented_failure_category(sql: str) -> str:
    if not re.search(r"\bdbo_repair_logs\b", sql, flags=re.IGNORECASE):
        return sql
    if not re.search(r"\bfailure[_\s]+category\b", sql, flags=re.IGNORECASE):
        return sql

    failure_code_expression = '"dbo_repair_logs"."failure_code"'
    rewritten = re.sub(
        r'(?P<prefix>\bSELECT\s+|,\s*)(?:(?:"dbo_repair_logs"|\[dbo_repair_logs\]|dbo_repair_logs)\s*\.\s*)?(?:"failure[_\s]+category"|\[failure[_\s]+category\]|failure[_\s]+category)(?P<suffix>\s*(?:,|\bFROM\b))',
        rf'\g<prefix>{failure_code_expression} AS "failure_category"\g<suffix>',
        sql,
        flags=re.IGNORECASE,
    )
    rewritten = re.sub(
        r"\bAS\s+failure\s+category\b",
        'AS "failure_category"',
        rewritten,
        flags=re.IGNORECASE,
    )

    clause_pattern = re.compile(
        r"\b(GROUP\s+BY|ORDER\s+BY|HAVING)\b(?P<body>.*?)(?=\b(?:ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|OFFSET|FETCH|UNION|WHERE)\b|$)",
        re.IGNORECASE | re.DOTALL,
    )

    def replace_clause(match: re.Match[str]) -> str:
        body = re.sub(
            r'(?:(?:"dbo_repair_logs"|\[dbo_repair_logs\]|dbo_repair_logs)\s*\.\s*)?(?:"failure[_\s]+category"|\[failure[_\s]+category\]|failure[_\s]+category)',
            failure_code_expression,
            match.group("body"),
            flags=re.IGNORECASE,
        )
        return f"{match.group(1)}{body}"

    return clause_pattern.sub(replace_clause, rewritten)


def _rewrite_mssql_invented_report_fields(sql: str) -> str:
    if not re.search(r"\bdbo_reports\b", sql, flags=re.IGNORECASE):
        return sql

    report_table = r'(?:"dbo_reports"|\[dbo_reports\]|dbo_reports)'
    rewritten = re.sub(
        rf"(?:(?:{report_table})\s*\.\s*)?(?:\"filters\"|\[filters\]|\bfilters\b)",
        '"dbo_reports"."data"',
        sql,
        flags=re.IGNORECASE,
    )
    rewritten = re.sub(
        rf"(?:(?:{report_table})\s*\.\s*)?(?:\"report_size\"|\"file_size\"|\[report_size\]|\[file_size\]|\breport_size\b|\bfile_size\b)",
        '"dbo_reports"."size_bytes"',
        rewritten,
        flags=re.IGNORECASE,
    )
    return rewritten


def _rewrite_mssql_invented_ticket_metrics(sql: str) -> str:
    if not re.search(r"\bdbo_tickets\b", sql, flags=re.IGNORECASE):
        return sql

    if not re.search(
        r"\b(?:token_cost|average_token_cost|avg_token_cost|cost)\b",
        sql,
        flags=re.IGNORECASE,
    ):
        return sql

    dimension = '"dbo_tickets"."status"'
    alias = "status"
    if re.search(r"\bpriority\b", sql, flags=re.IGNORECASE):
        dimension = '"dbo_tickets"."priority"'
        alias = "priority"

    return (
        f'SELECT {dimension} AS "{alias}", '
        'COUNT("dbo_tickets"."id") AS "ticket_count" '
        'FROM "dbo_tickets" '
        f"GROUP BY {dimension} "
        'ORDER BY "ticket_count" DESC'
    )


def _rewrite_mssql_invented_knowledge_article_fields(sql: str) -> str:
    if not re.search(
        r"\b(?:dbo_knowledge_articles|dbo_kb_articles)\b", sql, flags=re.IGNORECASE
    ):
        return sql

    rewritten = sql
    table_replacements = {
        "dbo_knowledge_articles": {
            "article_id": '"id"',
            "knowledge_article_id": '"id"',
            "article_content": '"content"',
            "article_text": '"content"',
            "article_body": '"content"',
            "effectiveness_score": '"helpful"',
            "created_by": '"author"',
            "created_by_user": '"author"',
            "created_by_user_id": '"author"',
            "author_id": '"author"',
        },
        "dbo_kb_articles": {
            "article_id": '"id"',
            "knowledge_article_id": '"id"',
            "article_content": '"content"',
            "article_text": '"content"',
            "article_body": '"content"',
            "category": '"category"',
            "section": '"category"',
            "article_section": '"category"',
            "created_by": '"created_by_user_id"',
            "created_by_user": '"created_by_user_id"',
            "author": '"created_by_user_id"',
            "author_id": '"created_by_user_id"',
        },
    }

    for table_name, field_replacements in table_replacements.items():
        article_table = (
            rf'(?:"{table_name}"|\[{table_name}\]|{table_name})'
        )
        for invented_field, replacement_field in field_replacements.items():
            rewritten = re.sub(
                rf"(?P<table>{article_table})\s*\.\s*(?:\"{invented_field}\"|\[{invented_field}\]|\b{invented_field}\b)",
                rf"\g<table>.{replacement_field}",
                rewritten,
                flags=re.IGNORECASE,
            )

    if re.search(r"\bdbo_knowledge_articles\b", rewritten, flags=re.IGNORECASE):
        unqualified_replacements = table_replacements["dbo_knowledge_articles"]
    elif re.search(r"\bdbo_kb_articles\b", rewritten, flags=re.IGNORECASE):
        unqualified_replacements = table_replacements["dbo_kb_articles"]
    else:
        unqualified_replacements = {}

    for invented_field, replacement_field in unqualified_replacements.items():
        rewritten = re.sub(
            rf'(?<!\.)"{invented_field}"',
            replacement_field,
            rewritten,
            flags=re.IGNORECASE,
        )
        rewritten = re.sub(
            rf"(?<!\.)\[{invented_field}\]",
            replacement_field,
            rewritten,
            flags=re.IGNORECASE,
        )
        rewritten = re.sub(
            rf"(?<![\.\w]){invented_field}(?!\w)",
            replacement_field,
            rewritten,
            flags=re.IGNORECASE,
        )

    return rewritten


def contains_unsupported_mssql_json_access(sql: str) -> bool:
    if re.search(r"(?:->>|->)", sql):
        return True

    unsupported_json_functions = (
        "JSON_VALUE",
        "JSON_QUERY",
        "JSON_EXTRACT",
        "JSON_EXTRACT_SCALAR",
        "JSON_EXTRACT_ARRAY",
        "LAX_BOOL",
        "LAX_FLOAT64",
        "LAX_INT64",
        "LAX_STRING",
    )
    function_pattern = r"\b(?:{})\s*\(".format("|".join(unsupported_json_functions))
    return bool(re.search(function_pattern, sql, flags=re.IGNORECASE))


def _rewrite_mssql_bare_time_bucket_identifiers(sql: str) -> str:
    timestamp_expression = _infer_mssql_timestamp_expression(sql)
    if not timestamp_expression:
        return sql

    bucket_expressions = {
        "year": f"EXTRACT(YEAR FROM {timestamp_expression})",
        "month": f"EXTRACT(MONTH FROM {timestamp_expression})",
        "day": f"EXTRACT(DAY FROM {timestamp_expression})",
    }
    rewritten = sql

    for bucket, expression in bucket_expressions.items():
        qualified_bucket_pattern = re.compile(
            rf'(?:(?:"[^"]+"|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\s*\.\s*)'
            rf'(?:"{bucket}"|\[{bucket}\]|{bucket})',
            re.IGNORECASE,
        )
        select_pattern = re.compile(
            r"\bSELECT\b(?P<body>.*?)(?=\bFROM\b)",
            re.IGNORECASE | re.DOTALL,
        )

        def replace_select(match: re.Match[str]) -> str:
            body = match.group("body")
            items = _split_top_level_select_items(body)
            if not items:
                return match.group(0)

            rebuilt: list[str] = []
            changed = False
            bucket_select_item_pattern = re.compile(
                rf"^(?P<identifier>(?:\"{bucket}\"|\[{bucket}\]|{bucket}|{qualified_bucket_pattern.pattern}))"
                rf"(?:\s+(?:AS\s+)?(?P<alias>\"[^\"]+\"|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*))?$",
                re.IGNORECASE,
            )
            for item in items:
                item_match = bucket_select_item_pattern.fullmatch(item.strip())
                if item_match:
                    alias = item_match.group("alias") or f'"{bucket}"'
                    rebuilt.append(f"{expression} AS {alias}")
                    changed = True
                else:
                    rebuilt.append(item)

            if not changed:
                return match.group(0)

            return "SELECT " + ", ".join(rebuilt) + " "

        rewritten = select_pattern.sub(replace_select, rewritten)

    clause_pattern = re.compile(
        r"\b(GROUP\s+BY|ORDER\s+BY|HAVING)\b(?P<body>.*?)(?=\b(?:ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|OFFSET|FETCH|UNION|WHERE)\b|$)",
        re.IGNORECASE | re.DOTALL,
    )

    def replace_clause(match: re.Match[str]) -> str:
        body = match.group("body")
        for bucket, expression in bucket_expressions.items():
            qualified_bucket_pattern = re.compile(
                rf'(?:(?:"[^"]+"|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\s*\.\s*)'
                rf'(?:"{bucket}"|\[{bucket}\]|{bucket})',
                re.IGNORECASE,
            )
            body = qualified_bucket_pattern.sub(expression, body)
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
            body = re.sub(
                rf"(?<![('\.\w])\b{bucket}\b(?!['\w])",
                expression,
                body,
                flags=re.IGNORECASE,
            )
        return f"{match.group(1)}{body}"

    return clause_pattern.sub(replace_clause, rewritten)


def _rewrite_mssql_limit_clause(sql: str) -> str:
    limit_match = re.search(r"\s+LIMIT\s+(\d+)\s*;?\s*$", sql, flags=re.IGNORECASE)
    if not limit_match:
        return sql

    limit = limit_match.group(1)
    without_limit = sql[: limit_match.start()].rstrip()
    if re.search(
        r"\bSELECT\s+(?:DISTINCT\s+)?TOP\s+(?:\(\s*)?\d+",
        without_limit,
        flags=re.IGNORECASE,
    ):
        return without_limit

    if re.match(r"\s*SELECT\s+DISTINCT\b", without_limit, flags=re.IGNORECASE):
        return re.sub(
            r"\bSELECT\s+DISTINCT\b",
            f"SELECT DISTINCT TOP {limit}",
            without_limit,
            count=1,
            flags=re.IGNORECASE,
        )

    if re.match(r"\s*SELECT\b", without_limit, flags=re.IGNORECASE):
        return re.sub(
            r"\bSELECT\b",
            f"SELECT TOP {limit}",
            without_limit,
            count=1,
            flags=re.IGNORECASE,
        )

    return without_limit


def _unwrap_simple_mssql_where_parentheses(sql: str) -> str:
    return re.sub(
        r"\bWHERE\s*\(\s*([^()]+?)\s*\)(?=\s*(?:GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET|FETCH|UNION|$))",
        r"WHERE \1",
        sql,
        flags=re.IGNORECASE | re.DOTALL,
    )


def _rewrite_mssql_datepart_alias_references(sql: str) -> str:
    datepart_alias_pattern = re.compile(
        r"\b((?:DATEPART\(\s*'?\s*(?:YEAR|MONTH|DAY)\s*'?\s*,\s*((?:[^()]|\([^()]*\))+?)\s*\)|(?:YEAR|MONTH|DAY)\(\s*((?:[^()]|\([^()]*\))+?)\s*\)|EXTRACT\(\s*(?:YEAR|MONTH|DAY)\s+FROM\s+((?:[^()]|\([^()]*\))+?)\s*\)))\s+AS\s+(?:\"([^\"]+)\"|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*))",
        re.IGNORECASE,
    )
    aliases: dict[str, str] = {}

    for match in datepart_alias_pattern.finditer(sql):
        expression = match.group(1)
        alias = match.group(5) or match.group(6) or match.group(7)
        if alias:
            aliases[str(alias).lower()] = expression

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
                rf"(?<![A-Za-z_\(])\b{re.escape(alias)}\b(?!\s*\()",
                placeholder,
                body,
                flags=re.IGNORECASE,
            )
        for placeholder, expression in placeholders.items():
            body = body.replace(placeholder, expression)
        return f"{match.group(1)}{body}"

    return clause_pattern.sub(replace_clause, sql)


def _split_top_level_select_items(select_body: str) -> list[str]:
    items: list[str] = []
    current: list[str] = []
    depth = 0
    in_single_quote = False
    in_double_quote = False

    for char in select_body:
        if char == "'" and not in_double_quote:
            in_single_quote = not in_single_quote
        elif char == '"' and not in_single_quote:
            in_double_quote = not in_double_quote
        elif not in_single_quote and not in_double_quote:
            if char == "(":
                depth += 1
            elif char == ")" and depth > 0:
                depth -= 1
            elif char == "," and depth == 0:
                items.append("".join(current).strip())
                current = []
                continue
        current.append(char)

    if current:
        items.append("".join(current).strip())

    return items


def _is_word_at(sql: str, index: int, word: str) -> bool:
    end = index + len(word)
    if sql[index:end].upper() != word:
        return False
    before = sql[index - 1] if index > 0 else ""
    after = sql[end] if end < len(sql) else ""
    return not (before.isalnum() or before == "_") and not (
        after.isalnum() or after == "_"
    )


def _find_select_list_spans(sql: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    depth = 0
    in_single_quote = False
    in_double_quote = False
    in_bracket = False
    index = 0

    while index < len(sql):
        char = sql[index]
        if char == "'" and not in_double_quote and not in_bracket:
            in_single_quote = not in_single_quote
        elif char == '"' and not in_single_quote and not in_bracket:
            in_double_quote = not in_double_quote
        elif char == "[" and not in_single_quote and not in_double_quote:
            in_bracket = True
        elif char == "]" and in_bracket:
            in_bracket = False
        elif not in_single_quote and not in_double_quote and not in_bracket:
            if char == "(":
                depth += 1
            elif char == ")" and depth > 0:
                depth -= 1
            elif _is_word_at(sql, index, "SELECT"):
                select_depth = depth
                select_body_start = index + len("SELECT")
                cursor = select_body_start
                cursor_depth = depth
                cursor_in_single_quote = False
                cursor_in_double_quote = False
                cursor_in_bracket = False

                while cursor < len(sql):
                    cursor_char = sql[cursor]
                    if (
                        cursor_char == "'"
                        and not cursor_in_double_quote
                        and not cursor_in_bracket
                    ):
                        cursor_in_single_quote = not cursor_in_single_quote
                    elif (
                        cursor_char == '"'
                        and not cursor_in_single_quote
                        and not cursor_in_bracket
                    ):
                        cursor_in_double_quote = not cursor_in_double_quote
                    elif (
                        cursor_char == "["
                        and not cursor_in_single_quote
                        and not cursor_in_double_quote
                    ):
                        cursor_in_bracket = True
                    elif cursor_char == "]" and cursor_in_bracket:
                        cursor_in_bracket = False
                    elif (
                        not cursor_in_single_quote
                        and not cursor_in_double_quote
                        and not cursor_in_bracket
                    ):
                        if cursor_char == "(":
                            cursor_depth += 1
                        elif cursor_char == ")" and cursor_depth > 0:
                            cursor_depth -= 1
                        elif cursor_depth == select_depth and _is_word_at(
                            sql, cursor, "FROM"
                        ):
                            spans.append((select_body_start, cursor))
                            break
                    cursor += 1
                index = cursor
        index += 1

    return spans


def _strip_projection_alias(item: str) -> str:
    alias_match = re.search(
        r"\s+(?:AS\s+)?(?:\"[^\"]+\"|\[[^\]]+\]|`[^`]+`|[A-Za-z_][A-Za-z0-9_]*)\s*$",
        item,
        flags=re.IGNORECASE,
    )
    if not alias_match:
        return item.strip()

    expression = item[: alias_match.start()].strip()
    if not expression:
        return item.strip()
    return expression


def _simple_projection_key(item: str) -> str | None:
    cleaned = re.sub(r"^\s*DISTINCT\s+", "", item, flags=re.IGNORECASE).strip()
    cleaned = _strip_projection_alias(cleaned)
    identifier_pattern = (
        r'(?:"(?P<quoted>[^"]+)"|\[(?P<bracketed>[^\]]+)\]|'
        r"`(?P<backticked>[^`]+)`|(?P<bare>[A-Za-z_][A-Za-z0-9_]*|\*))"
    )
    identifier_match_pattern = (
        r'(?:"[^"]+"|\[[^\]]+\]|`[^`]+`|[A-Za-z_][A-Za-z0-9_]*|\*)'
    )
    qualified_identifier_pattern = rf"^\s*{identifier_match_pattern}(?:\s*\.\s*{identifier_match_pattern})*\s*$"
    if not re.match(qualified_identifier_pattern, cleaned):
        return None

    parts = re.findall(identifier_pattern, cleaned)
    if not parts:
        return None
    last_part = next((value for value in parts[-1] if value), "")
    return str(last_part).lower()


def _dedupe_duplicate_simple_select_items(sql: str) -> str:
    spans = _find_select_list_spans(sql)
    if not spans:
        return sql

    normalized = sql
    for start, end in reversed(spans):
        body = normalized[start:end]
        items = _split_top_level_select_items(body)
        if len(items) < 2:
            continue

        seen_simple_projection_keys: set[str] = set()
        deduped_items: list[str] = []
        changed = False
        for item in items:
            key = _simple_projection_key(item)
            if key and key in seen_simple_projection_keys:
                changed = True
                logger.debug(
                    'Removing duplicate simple projection "%s" from generated SQL',
                    item,
                )
                continue
            if key:
                seen_simple_projection_keys.add(key)
            deduped_items.append(item)

        if changed:
            normalized = (
                normalized[:start]
                + " "
                + ", ".join(deduped_items)
                + " "
                + normalized[end:]
            )

    return normalized


def _rewrite_mssql_temporal_bucket_alias_references(sql: str) -> str:
    select_match = re.search(
        r"\bSELECT\b(?P<body>.*?)(?=\bFROM\b)",
        sql,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not select_match:
        return sql

    aliases: dict[str, str] = {}
    for item in _split_top_level_select_items(select_match.group("body")):
        if not re.search(
            r"\b(?:DATEPART|YEAR|MONTH|DAY|EXTRACT)\s*\(", item, flags=re.IGNORECASE
        ):
            continue

        alias_match = re.search(
            r"\s+(?:AS\s+)?(?:\"([^\"]+)\"|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*))\s*$",
            item,
            flags=re.IGNORECASE,
        )
        if not alias_match:
            continue

        alias = alias_match.group(1) or alias_match.group(2) or alias_match.group(3)
        expression = item[: alias_match.start()].strip()
        if alias:
            aliases[str(alias).lower()] = expression

    if not aliases:
        return sql

    clause_pattern = re.compile(
        r"\b(GROUP\s+BY|ORDER\s+BY|HAVING)\b(?P<body>.*?)(?=\b(?:ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|OFFSET|FETCH|UNION|WHERE)\b|$)",
        re.IGNORECASE | re.DOTALL,
    )

    def replace_clause(match: re.Match[str]) -> str:
        body = match.group("body")
        placeholders: dict[str, str] = {}
        for alias, expression in aliases.items():
            placeholder = f"__WREN_MSSQL_TEMPORAL_BUCKET_ALIAS_{len(placeholders)}__"
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
                rf"(?<![A-Za-z_\(])\b{re.escape(alias)}\b(?!\s*\()",
                placeholder,
                body,
                flags=re.IGNORECASE,
            )
        for placeholder, expression in placeholders.items():
            body = body.replace(placeholder, expression)
        return f"{match.group(1)}{body}"

    return clause_pattern.sub(replace_clause, sql)


def _references_known_hallucination_prone_schema(sql: str) -> bool:
    return False


def _rewrite_known_schema_hallucinations(sql: str, now: datetime) -> str:
    normalized = _replace_relative_current_date_calls(sql, now)
    normalized = _unwrap_simple_mssql_where_parentheses(normalized)
    normalized = _rewrite_mssql_limit_clause(normalized)
    normalized = _rewrite_mssql_to_date_buckets(normalized)
    normalized = _rewrite_mssql_aggregate_qualified_temporal_columns(normalized)
    normalized = _rewrite_mssql_invented_date_identifiers(normalized)
    normalized = _rewrite_mssql_invented_report_fields(normalized)
    normalized = _rewrite_mssql_invented_ticket_metrics(normalized)
    normalized = _rewrite_mssql_invented_knowledge_article_fields(normalized)
    normalized = _rewrite_mssql_bare_time_bucket_identifiers(normalized)
    normalized = _rewrite_temporal_bucket_functions(normalized)
    normalized = _rewrite_mssql_datepart_alias_references(normalized)
    normalized = _rewrite_mssql_temporal_bucket_alias_references(normalized)
    return normalized


def _rewrite_mssql_limit_clause(sql: str) -> str:
    limit_match = re.search(r"\s+LIMIT\s+(\d+)\s*;?\s*$", sql, flags=re.IGNORECASE)
    if not limit_match:
        return sql

    limit = limit_match.group(1)
    without_limit = sql[: limit_match.start()].rstrip()
    if re.search(r"\bUNION(?:\s+ALL)?\b", without_limit, flags=re.IGNORECASE):
        return without_limit

    if re.search(
        r"\bSELECT\s+(?:DISTINCT\s+)?TOP\s*\(?\s*\d+\s*\)?",
        without_limit,
        flags=re.IGNORECASE,
    ):
        return without_limit

    return re.sub(
        r"\bSELECT\s+(DISTINCT\s+)?",
        lambda match: f"{match.group(0)}TOP {limit} ",
        without_limit,
        count=1,
        flags=re.IGNORECASE,
    )


def _normalize_identifier_quote_syntax(sql: str) -> str:
    normalized = re.sub(
        r"`([^`]+)`",
        lambda match: _quote_sql_identifier(match.group(1)),
        sql,
    )
    normalized = re.sub(
        r"\[([^\]]+)\]",
        lambda match: _quote_sql_identifier(match.group(1)),
        normalized,
    )
    normalized = re.sub(
        r'"{2,}([A-Za-z_][A-Za-z0-9_$]*)"{2,}',
        lambda match: _quote_sql_identifier(match.group(1)),
        normalized,
    )
    return normalized


def normalize_generation_result_sql(sql: str, data_source: str | None = None) -> str:
    normalized = _normalize_identifier_quote_syntax(sql)
    normalized_data_source = normalize_data_source(data_source)

    if normalized_data_source == "MSSQL":
        now = datetime.now()
        normalized = re.sub(
            r"\s+NULLS\s+(?:LAST|FIRST)\b", "", normalized, flags=re.IGNORECASE
        )
        normalized = _unwrap_simple_mssql_where_parentheses(normalized)
        normalized = _rewrite_mssql_limit_clause(normalized)
        normalized = re.sub(
            r"CAST\(\s*('(?:[^']|'')*')\s+AS\s+DATETIME(?:2|OFFSET)\s*\)",
            r"\1",
            normalized,
            flags=re.IGNORECASE,
        )
        normalized = _replace_relative_getdate_calls(normalized, now)
        normalized = _replace_relative_current_date_calls(normalized, now)
        normalized = _rewrite_mssql_to_unixtime(normalized)
        normalized = _rewrite_mssql_timestamp_subtraction(normalized)
        normalized = _rewrite_mssql_to_date_buckets(normalized)
        normalized = _rewrite_mssql_timestamp_casts(normalized)
        normalized = _rewrite_mssql_aggregate_qualified_temporal_columns(normalized)
        normalized = _rewrite_mssql_invented_date_identifiers(normalized)
        normalized = _rewrite_mssql_bare_time_bucket_identifiers(normalized)
        normalized = _rewrite_mssql_bucket_functions(normalized)
        normalized = _rewrite_temporal_bucket_functions(normalized)
        normalized = _rewrite_mssql_datepart_alias_references(normalized)
        normalized = _rewrite_mssql_temporal_bucket_alias_references(normalized)
        normalized = _rewrite_mssql_bare_time_bucket_identifiers(normalized)
        normalized = _rewrite_mssql_limit_clause(normalized)
    elif _references_known_hallucination_prone_schema(normalized):
        normalized = _rewrite_known_schema_hallucinations(normalized, datetime.now())

    normalized = _dedupe_duplicate_simple_select_items(normalized)

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
        valid_table_names: list[str] | None = None,
        valid_table_columns: dict[str, list[str]] | None = None,
        query: str | None = None,
        semantic_analysis: dict[str, Any] | None = None,
    ) -> dict:
        try:
            cleaned_generation_result = extract_sql_generation_result(replies[0])

            cleaned_generation_result = normalize_generation_result_sql(
                cleaned_generation_result, data_source=data_source
            )
            cleaned_generation_result = normalize_sql_table_references_to_schema(
                cleaned_generation_result,
                valid_table_names or [],
            )
            cleaned_generation_result = normalize_sql_column_references_to_schema(
                cleaned_generation_result,
                valid_table_columns or {},
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

            invalid_table_references = find_invalid_table_references(
                cleaned_generation_result,
                valid_table_names or [],
            )
            if invalid_table_references:
                valid_table_list = ", ".join(valid_table_names or [])
                invalid_table_list = ", ".join(invalid_table_references)
                return {
                    "valid_generation_result": {},
                    "invalid_generation_result": {
                        "sql": cleaned_generation_result,
                        "original_sql": cleaned_generation_result,
                        "type": "SCHEMA_VALIDATION",
                        "error": (
                            "Generated SQL references table(s) not present in the "
                            f"active datasource metadata: {invalid_table_list}. "
                            "Use only these valid table names exactly as shown: "
                            f"{valid_table_list}"
                        ),
                        "correlation_id": "",
                    },
                }

            invalid_column_references = find_invalid_column_references(
                cleaned_generation_result,
                valid_table_columns or {},
            )
            if invalid_column_references:
                invalid_column_list = ", ".join(invalid_column_references)
                valid_column_list = format_valid_table_columns(valid_table_columns or {})
                return {
                    "valid_generation_result": {},
                    "invalid_generation_result": {
                        "sql": cleaned_generation_result,
                        "original_sql": cleaned_generation_result,
                        "type": "SCHEMA_VALIDATION",
                        "error": (
                            "Generated SQL references column(s) not present in the "
                            f"active datasource metadata: {invalid_column_list}. "
                            "Use only these valid table columns exactly as shown: "
                            f"{valid_column_list}"
                        ),
                        "correlation_id": "",
                    },
                }

            intent_validation_error = validate_sql_intent_alignment(
                query,
                cleaned_generation_result,
                valid_table_columns or {},
                semantic_analysis=semantic_analysis,
            )
            if intent_validation_error:
                return {
                    "valid_generation_result": {},
                    "invalid_generation_result": {
                        "sql": cleaned_generation_result,
                        "original_sql": cleaned_generation_result,
                        "type": "SCHEMA_INTENT_VALIDATION",
                        "error": intent_validation_error,
                        "correlation_id": "",
                    },
                }

            if normalize_data_source(
                data_source
            ) == "MSSQL" and contains_unsupported_mssql_json_access(
                cleaned_generation_result
            ):
                return {
                    "valid_generation_result": {},
                    "invalid_generation_result": {
                        "sql": cleaned_generation_result,
                        "original_sql": cleaned_generation_result,
                        "type": "UNSUPPORTED_SQL",
                        "error": (
                            "Generated SQL uses JSON extraction, but the MSSQL "
                            "Wren/Ibis runtime does not support JSON operators "
                            "or JSON extraction functions. Use only first-class "
                            "columns exposed in the schema."
                        ),
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
                        generation_result,
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
                        generation_result,
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
- Never invent foreign key columns or relationship fields from table names unless that exact column appears in the DATABASE SCHEMA. Join only on explicit schema columns or explicit relationships.
- Never invent time bucket columns such as "MONTH", "YEAR", "DAY", "month", "year", or "date" unless that exact column appears in the DATABASE SCHEMA. For monthly, yearly, or daily trends, apply a supported date/time bucket function from SQL FUNCTIONS to a real timestamp column from the selected table.
- Every generated SQL query must be grounded only in the connected datasource metadata, deployed semantic model definitions, relationships, and DATABASE SCHEMA shown in the prompt. Do not use table names, column names, join paths, JSON keys, or business dimensions that are not explicitly present in that context.
- For trend questions, choose an explicit timestamp/date column from the active schema and bucket it with supported SQL FUNCTIONS. Do not select, group by, or order by invented time bucket columns unless they explicitly appear in the schema.
- For grouped count questions, choose an explicit dimension column from the active schema. Do not invent category/status/type columns unless they explicitly appear in the schema.
- For top/bottom N questions, return exactly the business columns needed to answer the question. For example, "top 10 common failures" should return the failure field and the failure count.
- For top/bottom N questions, prefer ORDER BY on the metric plus a row limit instead of adding ranking helper columns.
- Do not include helper ranking columns such as "rank", "row_number", or "dense_rank" in the final SELECT unless the user explicitly asks to see ranks.
- If a ranking helper is required internally, compute it in a subquery/CTE and filter on it, but omit it from the final SELECT unless explicitly requested.
"""

_MSSQL_TEXT_TO_SQL_RULES = """
### MSSQL-SPECIFIC RULES ###
- The target database is MSSQL.
- Prefer parser-safe date bucket syntax such as EXTRACT(YEAR FROM "created_at") and EXTRACT(MONTH FROM "created_at").
- DO NOT use PostgreSQL-style or Trino-style date syntax such as DATE_TRUNC, DATETRUNC, INTERVAL, CURRENT_DATE, TIMESTAMP WITH TIME ZONE, TO_CHAR, TO_UNIXTIME, TO_TIMESTAMP, TO_TIMESTAMP_MILLIS, TO_TIMESTAMP_SECONDS, TO_TIMESTAMP_MICROS, TO_TIMESTAMP_NANOS, or :: casts.
- DO NOT use JSON extraction functions or operators such as JSON_VALUE, JSON_QUERY, JSON_EXTRACT, JSON_EXTRACT_SCALAR, JSON_EXTRACT_ARRAY, json_value, json_extract, ->, or ->>. The MSSQL Wren/Ibis runtime does not support them.
- If a table has a generic JSON/text column such as "data", do not assume keys inside it are queryable. Only use fields that are exposed as first-class columns in the DATABASE SCHEMA.
- If a requested metric is only present inside a JSON/text column and is not exposed as a first-class column or calculated field, do not generate SQL that extracts it from JSON.
- Never invent JSON-derived columns unless they are explicitly listed as columns in the DATABASE SCHEMA.
- For trend or volume questions, use explicit timestamp/date columns only when those exact columns appear in the selected table schema.
- For grouped count questions, use explicit exposed dimension fields and only join tables when an explicit join key or relationship exists in the DATABASE SCHEMA.
- DO NOT use DATEADD, DATEDIFF, DATETIME2, or DATETIMEOFFSET unless the SQL FUNCTIONS section explicitly proves they are supported by the target runtime.
- Do not subtract timestamp/date columns directly. If a duration or turnaround column exists in the schema, select that column directly. If only start/end timestamps exist and the SQL FUNCTIONS section lists DATEDIFF, use DATEDIFF('second', <start_timestamp>, <end_timestamp>) for duration in seconds.
- Resolve relative time phrases such as "last 12 months", "last month", or "this year" into absolute ISO timestamp boundaries using the current time context. Prefer closed-open literal ranges over runtime date arithmetic.
- For month bucketing, prefer separate year/month fields:
    - EXTRACT(YEAR FROM <timestamp_expression>) AS "year"
    - EXTRACT(MONTH FROM <timestamp_expression>) AS "month"
  Then GROUP BY and ORDER BY the same year/month expressions.
- Do not GROUP BY or ORDER BY quoted year/month aliases such as "YEAR" or "MONTH"; repeat the EXTRACT(...) expression instead.
- For year bucketing, prefer EXTRACT(YEAR FROM <timestamp_expression>).
- For top/bottom N questions in MSSQL, prefer SELECT TOP (N) with ORDER BY over DENSE_RANK/ROW_NUMBER when the user did not explicitly request ranks.
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
3. For top/bottom N questions, plan to order by the relevant metric and limit the result to N rows. Do not add a rank column unless the user explicitly asks to see ranks.
4. For questions like "top 10 common failures", the final table should contain the grouped business field and its count/metric, not helper ranking columns.
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
- For month trend metrics, prefer EXTRACT(YEAR FROM <timestamp_expression>) and EXTRACT(MONTH FROM <timestamp_expression>) as separate grouped columns.
"""

    return instructions


_MSSQL_JSON_FIELD_INSTRUCTIONS = """
#### MSSQL JSON Field Instructions ####
- The target runtime cannot execute JSON extraction from generic JSON/text columns.
- Do not use JSON operators or functions such as ->, ->>, JSON_VALUE, JSON_QUERY,
  JSON_EXTRACT, JSON_EXTRACT_SCALAR, LAX_STRING, LAX_INT64, LAX_FLOAT64, or LAX_BOOL.
- If the requested value is only inside a generic JSON/text column such as "data",
  do not infer or extract it. Use only first-class columns and calculated fields
  that are explicitly exposed in the DATABASE SCHEMA.
"""


def get_json_field_instructions(
    sql_knowledge: SqlKnowledge | None = None,
    data_source: str | None = None,
) -> str:
    if normalize_data_source(data_source) == "MSSQL":
        return _MSSQL_JSON_FIELD_INSTRUCTIONS

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
6. YOU MUST ONLY use table names and column names that are explicitly present in the ACTIVE DATASOURCE METADATA, DATABASE SCHEMA, or VALID TABLE NAMES sections.
7. SQL SAMPLES are examples of style only. NEVER reuse a sample table or column name unless that exact table or column also appears in the active metadata, DATABASE SCHEMA, or VALID TABLE NAMES sections.
8. NEVER invent generic table names from the user's business terms unless that exact table name is present in the active metadata, DATABASE SCHEMA, or VALID TABLE NAMES sections.
9. Map business concepts to the closest explicit tables, columns, metrics, views, and relationships from the active metadata. Do not create a new table or column name from the business concept.
10. Before applying SUM, AVG, MIN, MAX, or arithmetic to a column, verify that the chosen column is numeric in the active metadata. Do not aggregate text/string columns as numeric values.
11. Do not prefix table names with catalog or schema names unless the active metadata, DATABASE SCHEMA, or VALID TABLE NAMES section shows the table name with that exact prefix.
12. Before generating SQL, validate that the selected schema elements directly support all key entities, metrics, dimensions, filters, time ranges, relationships, and aggregations mentioned or implied by the question.
13. Do not answer a specific business metric, trend, summary, comparison, dashboard, or analysis request with a generic record-count query unless the user explicitly asks only for record count.
14. If the required information cannot be derived from the available active schema, return the closest schema-grounded limitation instead of inventing unrelated SQL.
15. If a SEMANTIC SCHEMA CONTRACT is provided, it is the primary source of truth for selecting tables, columns, metrics, joins, filters, grouping, sorting, and date logic. Generate SQL from the highest-confidence validated concept-to-schema mappings in that contract and do not independently infer substitute schema objects.

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


_SCHEMA_IDENTIFIER_PATTERN = (
    r'(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*)'
)
_SCHEMA_TABLE_REFERENCE_PATTERN = (
    rf"{_SCHEMA_IDENTIFIER_PATTERN}(?:\s*\.\s*{_SCHEMA_IDENTIFIER_PATTERN})*"
)
_SEMANTIC_TABLE_NAME_KEYS = (
    "name",
    "referenceName",
    "sourceTableName",
    "tableName",
    "table",
)
_SEMANTIC_COLUMN_CONTAINER_KEYS = (
    "columns",
    "fields",
    "calculatedFields",
    "dimensions",
    "measures",
)
_SEMANTIC_COLUMN_NAME_KEYS = (
    "name",
    "referenceName",
    "sourceColumnName",
    "columnName",
    "fieldName",
)


def construct_instructions(
    instructions: list[dict] | None = None,
):
    _instructions = []
    if instructions:
        _instructions += [
            instruction.get("instruction") for instruction in instructions
        ]

    return _instructions


def _format_semantic_list(label: str, values: list[str]) -> list[str]:
    if not values:
        return []
    return [f"{label}: {', '.join(values)}"]


def construct_semantic_schema_contract(
    semantic_analysis: dict[str, Any] | None,
) -> str:
    if not _has_semantic_analysis(semantic_analysis):
        return ""

    lines: list[str] = [
        "Use this semantic schema contract as the primary source of truth for SQL generation.",
        "Generate SQL only from schema objects listed here or in the selected retrieval metadata.",
        "Do not infer alternative tables, columns, metrics, joins, or identifiers independently.",
    ]

    analytical_intent = str(
        semantic_analysis.get("analytical_intent") or ""
    ).strip()
    if analytical_intent:
        lines.append(f"Analytical intent: {analytical_intent}")

    for label, key in (
        ("Entities", "entities"),
        ("Identifiers", "identifiers"),
        ("Metrics", "metrics"),
        ("Dimensions", "dimensions"),
        ("Filters", "filters"),
        ("Time constraints", "time_constraints"),
        ("Aggregations", "aggregations"),
        ("Ranking", "ranking"),
        ("Relationships", "relationships"),
        ("Supported schema objects", "supported_schema_objects"),
    ):
        lines.extend(_format_semantic_list(label, _semantic_analysis_items(semantic_analysis, key)))

    concept_mappings = _semantic_concept_mappings(semantic_analysis)
    if concept_mappings:
        lines.append("Required concept-to-schema mappings:")
        for mapping in concept_mappings:
            schema_objects = _mapping_schema_objects(mapping)
            required = "required" if mapping.get("required_in_sql") is not False else "optional"
            confidence = mapping.get("confidence")
            confidence_text = (
                f", confidence={confidence}"
                if confidence is not None and str(confidence).strip()
                else ""
            )
            mapping_reason = str(mapping.get("mapping_reason") or "").strip()
            reason_text = f" Reason: {mapping_reason}" if mapping_reason else ""
            lines.append(
                "- "
                f"{_mapping_request_concept(mapping)} "
                f"({_mapping_concept_type(mapping) or 'concept'}, {required}"
                f"{confidence_text}) -> {', '.join(schema_objects) or 'NO_MAPPING'}."
                f"{reason_text}"
            )

    interpretations = _semantic_analysis_dict_items(
        semantic_analysis, "interpretations"
    )
    if interpretations:
        lines.append("Ranked schema interpretations:")
        for interpretation in interpretations:
            description = str(interpretation.get("description") or "").strip()
            if not description:
                continue
            selected = "selected" if interpretation.get("is_selected") is True else "candidate"
            confidence = interpretation.get("confidence")
            confidence_text = (
                f", confidence={confidence}"
                if confidence is not None and str(confidence).strip()
                else ""
            )
            schema_objects = interpretation.get("schema_objects")
            if isinstance(schema_objects, list):
                schema_text = ", ".join(
                    str(item).strip()
                    for item in schema_objects
                    if item is not None and str(item).strip()
                )
            else:
                schema_text = ""
            schema_suffix = f" Objects: {schema_text}." if schema_text else ""
            lines.append(
                f"- {description} ({selected}{confidence_text}).{schema_suffix}"
            )

    missing_requirements = _semantic_analysis_items(
        semantic_analysis, "missing_requirements"
    )
    if missing_requirements:
        lines.append(f"Missing requirements: {', '.join(missing_requirements)}")

    ambiguous_requirements = _semantic_analysis_items(
        semantic_analysis, "ambiguous_requirements"
    )
    if ambiguous_requirements:
        lines.append(f"Ambiguous requirements: {', '.join(ambiguous_requirements)}")

    support_reasoning = str(semantic_analysis.get("support_reasoning") or "").strip()
    if support_reasoning:
        lines.append(f"Support reasoning: {support_reasoning}")

    lines.append(
        "Validation requirement: every required mapping must be represented in the SQL. "
        "Do not substitute identifiers for metrics, entities for identifiers, or COUNT(*) "
        "for a requested business measure unless the semantic intent explicitly requests a record count."
    )

    return "\n".join(lines)


def _parse_semantic_metadata_content(content: str) -> Any | None:
    content = content.strip()
    if not content:
        return None

    if content.startswith("```"):
        content = re.sub(r"^```(?:json|mdl)?\s*", "", content, flags=re.IGNORECASE)
        content = re.sub(r"\s*```$", "", content)

    candidates = [content]
    object_start = content.find("{")
    object_end = content.rfind("}")
    if object_start >= 0 and object_end > object_start:
        candidates.append(content[object_start : object_end + 1])
    array_start = content.find("[")
    array_end = content.rfind("]")
    if array_start >= 0 and array_end > array_start:
        candidates.append(content[array_start : array_end + 1])

    for candidate in candidates:
        try:
            return orjson.loads(candidate)
        except orjson.JSONDecodeError:
            continue

    return None


def _semantic_name_values(metadata: dict[str, Any], keys: tuple[str, ...]) -> list[str]:
    values = []
    for key in keys:
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            values.append(value.strip())
    return values


def _semantic_column_names(metadata: Any) -> set[str]:
    columns: set[str] = set()
    if isinstance(metadata, dict):
        for column_name in _semantic_name_values(metadata, _SEMANTIC_COLUMN_NAME_KEYS):
            columns.add(column_name)
        for key in _SEMANTIC_COLUMN_CONTAINER_KEYS:
            value = metadata.get(key)
            if value is not None:
                columns.update(_semantic_column_names(value))
    elif isinstance(metadata, list):
        for item in metadata:
            columns.update(_semantic_column_names(item))

    return columns


def _construct_semantic_table_columns(content: str) -> dict[str, set[str]]:
    parsed_content = _parse_semantic_metadata_content(content)
    if parsed_content is None:
        return {}

    table_columns: dict[str, set[str]] = {}

    def collect(metadata: Any) -> None:
        if isinstance(metadata, list):
            for item in metadata:
                collect(item)
            return

        if not isinstance(metadata, dict):
            return

        column_containers = [
            metadata.get(key)
            for key in _SEMANTIC_COLUMN_CONTAINER_KEYS
            if metadata.get(key) is not None
        ]
        if column_containers:
            columns = set()
            for container in column_containers:
                columns.update(_semantic_column_names(container))

            if columns:
                for table_reference in _semantic_name_values(
                    metadata, _SEMANTIC_TABLE_NAME_KEYS
                ):
                    for table_name in _table_reference_suffixes(table_reference):
                        table_columns.setdefault(table_name, set()).update(columns)

        for value in metadata.values():
            collect(value)

    collect(parsed_content)
    return table_columns


def construct_valid_table_names(documents: list[Any] | None = None) -> list[str]:
    table_names: set[str] = set()
    for document in documents or []:
        content = getattr(document, "content", document)
        if not isinstance(content, str):
            continue

        for table_name in _construct_semantic_table_columns(content):
            table_names.add(table_name)

        for match in re.finditer(
            rf"\bCREATE\s+TABLE\s+(?P<table>{_SCHEMA_TABLE_REFERENCE_PATTERN})",
            content,
            flags=re.IGNORECASE,
        ):
            for table_name in _table_reference_suffixes(match.group("table")):
                table_names.add(table_name)

        for table_reference in extract_sql_table_references(content):
            for table_name in _table_reference_suffixes(table_reference):
                table_names.add(table_name)

    return sorted(table_names)


def construct_valid_table_columns(
    documents: list[Any] | None = None,
) -> dict[str, list[str]]:
    table_columns: dict[str, set[str]] = {}
    for document in documents or []:
        content = getattr(document, "content", document)
        if not isinstance(content, str):
            continue

        for table_name, columns in _construct_semantic_table_columns(
            content
        ).items():
            table_columns.setdefault(table_name, set()).update(columns)

        for table_match in re.finditer(
            rf"\bCREATE\s+TABLE\s+(?P<table>{_SCHEMA_TABLE_REFERENCE_PATTERN})\s*\(",
            content,
            flags=re.IGNORECASE,
        ):
            table_names = _table_reference_suffixes(table_match.group("table"))
            body_start = table_match.end()
            depth = 1
            body_end = body_start
            while body_end < len(content) and depth > 0:
                char = content[body_end]
                if char == "(":
                    depth += 1
                elif char == ")":
                    depth -= 1
                body_end += 1

            table_body = content[body_start : body_end - 1]
            columns_by_table = [
                table_columns.setdefault(table_name, set())
                for table_name in table_names
            ]
            for line in table_body.splitlines():
                line = line.strip()
                if not line or line.startswith("--"):
                    continue
                line = line.rstrip(",")
                if re.match(
                    r"^(?:PRIMARY|FOREIGN|CONSTRAINT|UNIQUE|KEY)\b",
                    line,
                    flags=re.IGNORECASE,
                ):
                    continue

                column_match = re.match(
                    r"([`\"\[]?)(?P<column>[A-Za-z_][A-Za-z0-9_$]*)\1\s+",
                    line,
                )
                if column_match:
                    for columns in columns_by_table:
                        columns.add(column_match.group("column"))

    return {
        table_name: sorted(columns)
        for table_name, columns in sorted(table_columns.items())
    }


_SQL_IDENTIFIER_PATTERN = (
    r'(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*)'
)
_SQL_TABLE_REFERENCE_PATTERN = re.compile(
    rf"\b(?:FROM|JOIN)\s+"
    rf"(?P<table>{_SQL_IDENTIFIER_PATTERN}(?:\s*\.\s*{_SQL_IDENTIFIER_PATTERN})*)",
    flags=re.IGNORECASE,
)
_SQL_TABLE_WITH_ALIAS_PATTERN = re.compile(
    rf"\b(?:FROM|JOIN)\s+"
    rf"(?P<table>{_SQL_IDENTIFIER_PATTERN}(?:\s*\.\s*{_SQL_IDENTIFIER_PATTERN})*)"
    rf"(?:\s+(?:AS\s+)?(?P<alias>{_SQL_IDENTIFIER_PATTERN}))?",
    flags=re.IGNORECASE,
)
_SQL_CTE_PATTERN = re.compile(
    rf"(?:\bWITH\b|,)\s*(?P<cte>{_SQL_IDENTIFIER_PATTERN})\s+AS\s*\(",
    flags=re.IGNORECASE,
)
_SQL_QUALIFIED_COLUMN_PATTERN = re.compile(
    rf"(?P<qualifier>{_SQL_IDENTIFIER_PATTERN})\s*\.\s*(?P<column>{_SQL_IDENTIFIER_PATTERN})",
    flags=re.IGNORECASE,
)
_SQL_RESERVED_ALIASES = {
    "where",
    "join",
    "left",
    "right",
    "inner",
    "outer",
    "full",
    "cross",
    "on",
    "group",
    "order",
    "having",
    "limit",
    "union",
}
_SQL_NON_COLUMN_IDENTIFIERS = {
    *_SQL_RESERVED_ALIASES,
    "and",
    "as",
    "asc",
    "between",
    "by",
    "case",
    "cast",
    "count",
    "date",
    "dateadd",
    "datediff",
    "datepart",
    "day",
    "desc",
    "distinct",
    "else",
    "end",
    "false",
    "from",
    "getdate",
    "hour",
    "in",
    "is",
    "like",
    "max",
    "min",
    "month",
    "not",
    "null",
    "or",
    "select",
    "sum",
    "then",
    "top",
    "true",
    "when",
    "year",
}


def _normalize_sql_identifier(identifier: str) -> str:
    identifier = identifier.strip()
    if (
        (identifier.startswith('"') and identifier.endswith('"'))
        or (identifier.startswith("`") and identifier.endswith("`"))
        or (identifier.startswith("[") and identifier.endswith("]"))
    ):
        return identifier[1:-1]
    return identifier


def _quote_sql_identifier(identifier: str) -> str:
    return f'"{identifier.replace(chr(34), chr(34) + chr(34))}"'


def _compact_sql_identifier(identifier: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(identifier or "").lower())


def _strip_sql_literals(sql: str) -> str:
    without_strings = re.sub(r"'(?:''|[^'])*'", " ", sql)
    return re.sub(r"\b\d+(?:\.\d+)?\b", " ", without_strings)


def _extract_clause_bodies(
    sql: str, clause: str, terminators: list[str]
) -> list[str]:
    terminator_pattern = "|".join(rf"\b{terminator}\b" for terminator in terminators)
    pattern = re.compile(
        rf"\b{clause}\b(?P<body>.*?)(?={terminator_pattern}|$)",
        flags=re.IGNORECASE | re.DOTALL,
    )
    return [match.group("body") or "" for match in pattern.finditer(sql)]


def _find_unqualified_column_candidates(sql: str) -> set[str]:
    bodies = [
        *_extract_clause_bodies(
            sql,
            r"WHERE",
            [r"GROUP\s+BY", r"ORDER\s+BY", "HAVING", "LIMIT", "FETCH", "UNION"],
        ),
        *_extract_clause_bodies(
            sql,
            r"HAVING",
            [r"GROUP\s+BY", r"ORDER\s+BY", "LIMIT", "FETCH", "UNION"],
        ),
        *_extract_clause_bodies(
            sql,
            r"ON",
            [
                "WHERE",
                r"GROUP\s+BY",
                r"ORDER\s+BY",
                "HAVING",
                "JOIN",
                "LIMIT",
                "FETCH",
                "UNION",
            ],
        ),
        *_extract_clause_bodies(
            sql,
            r"GROUP\s+BY",
            [r"ORDER\s+BY", "HAVING", "LIMIT", "FETCH", "UNION"],
        ),
    ]
    candidates: set[str] = set()
    identifier_pattern = re.compile(_SQL_IDENTIFIER_PATTERN, flags=re.IGNORECASE)

    for body in bodies:
        searchable_body = _strip_sql_literals(body)
        for match in identifier_pattern.finditer(searchable_body):
            token = match.group(0)
            before = searchable_body[: match.start()].rstrip()
            after = searchable_body[match.end() :].lstrip()
            identifier = _normalize_sql_identifier(token)
            normalized = identifier.lower()
            if (
                not identifier
                or normalized in _SQL_NON_COLUMN_IDENTIFIERS
                or before.endswith(".")
                or after.startswith(".")
                or after.startswith("(")
            ):
                continue
            candidates.add(identifier)

    function_argument_pattern = re.compile(
        rf"\b[A-Za-z_][A-Za-z0-9_$]*\s*\(\s*"
        rf"(?:DISTINCT\s+)?(?P<arg>{_SQL_IDENTIFIER_PATTERN})"
        rf"(?:\s*\.\s*(?P<column>{_SQL_IDENTIFIER_PATTERN}))?",
        flags=re.IGNORECASE,
    )
    for match in function_argument_pattern.finditer(_strip_sql_literals(sql)):
        column = _normalize_sql_identifier(match.group("column") or match.group("arg"))
        if column and column != "*" and column.lower() not in _SQL_NON_COLUMN_IDENTIFIERS:
            candidates.add(column)

    return candidates


def _sql_identifier_alias_candidates(identifier: str) -> set[str]:
    normalized = _normalize_sql_identifier(identifier)
    candidates = {normalized}
    acronym_split = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", normalized)
    snake_case = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", acronym_split)
    candidates.add(snake_case)
    return {candidate for candidate in candidates if candidate}


_SEMANTIC_COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "source": (
        "source",
        "source_ticket_id",
        "source_repair_ids",
        "category",
        "subcategory",
        "author",
        "created_by_user_id",
        "status",
    ),
    "leadsource": ("source", "source_ticket_id", "source_repair_ids", "category"),
    "articletype": ("article_type", "category", "subcategory", "type", "status"),
    "articleid": ("article_id", "id"),
    "knowledgearticleid": ("knowledge_article_id", "id"),
    "type": ("type", "category", "subcategory", "status"),
    "category": ("category", "subcategory", "status", "priority"),
    "subcategory": ("subcategory", "category", "status", "priority"),
    "author": ("author", "created_by_user_id", "owner", "assignee_user_id"),
    "createdby": ("created_by", "created_by_user_id", "author"),
    "createdbyuser": ("created_by_user", "created_by_user_id", "author"),
    "createdbyuserid": ("created_by_user_id", "author"),
    "lastupdatedate": (
        "last_update_date",
        "last_updated_at",
        "updated_at",
        "DateOut",
        "DateIn",
        "FailedAt",
        "ModifiedAt",
        "CreatedAt",
        "created_at",
    ),
    "lastupdate": (
        "last_update_date",
        "last_updated_at",
        "updated_at",
        "DateOut",
        "DateIn",
        "FailedAt",
        "ModifiedAt",
        "CreatedAt",
        "created_at",
    ),
    "updateddate": (
        "updated_at",
        "last_update_date",
        "last_updated_at",
        "DateOut",
        "DateIn",
        "FailedAt",
        "ModifiedAt",
        "CreatedAt",
        "created_at",
    ),
    "invoicequantity": ("Qty", "Quantity", "InvoiceQty", "InvoiceCount"),
    "otddate": ("InvDate", "OrdDate", "OrderDate", "InvoiceDate", "Date"),
    "period": ("timeid", "TimeID", "TimeId", "YearInd", "Year", "Date"),
    "periodid": ("timeid", "TimeID", "TimeId"),
    "timeid": ("timeid", "TimeID", "TimeId"),
    "customer": ("account", "Customer", "CustName", "CustNo", "customerpo"),
    "customers": ("account", "Customer", "CustName", "CustNo", "customerpo"),
    "customername": ("account", "Customer", "CustName", "CustNo", "customerpo"),
    "customerid": ("account", "Customer", "CustNo", "customerpo"),
    "customeraccount": ("account", "Customer", "CustName", "CustNo"),
    "customerregion": ("Country", "Market", "Region", "CustomerRegion"),
    "fixlogid": ("DebugEntryId", "FixId", "RepairItem", "id"),
}


def _find_semantic_column_alias(
    requested_column: str,
    canonical_columns: dict[str, str],
) -> str | None:
    for alias in _SEMANTIC_COLUMN_ALIASES.get(
        _compact_sql_identifier(requested_column), ()
    ):
        canonical = canonical_columns.get(_compact_sql_identifier(alias))
        if canonical:
            return canonical
    return None


def _split_table_reference(table_reference: str) -> list[str]:
    stripped = table_reference.strip()
    if not stripped:
        return []

    is_multipart_quoted_reference = bool(
        re.search(r'"\s*\.\s*"|\]\s*\.\s*\[|`\s*\.\s*`', stripped)
    )
    if (
        not is_multipart_quoted_reference
        and (
            (stripped.startswith('"') and stripped.endswith('"'))
            or (stripped.startswith("[") and stripped.endswith("]"))
            or (stripped.startswith("`") and stripped.endswith("`"))
        )
    ):
        normalized_identifier = _normalize_sql_identifier(stripped)
        if "." in normalized_identifier:
            return [
                part
                for part in re.split(r"\s*\.\s*", normalized_identifier)
                if part.strip()
            ]

    return [
        _normalize_sql_identifier(part)
        for part in re.split(r"\s*\.\s*", stripped)
        if part.strip()
    ]


def _table_reference_suffixes(table_reference: str) -> list[str]:
    parts = _split_table_reference(table_reference)
    return [".".join(parts[index:]) for index in range(len(parts))]


def _quote_table_reference(table_reference: str) -> str:
    return ".".join(
        _quote_sql_identifier(part) for part in _split_table_reference(table_reference)
    )


def extract_sql_table_references(sql: str) -> list[str]:
    references = []
    for match in _SQL_TABLE_REFERENCE_PATTERN.finditer(sql):
        table_reference = match.group("table")
        if table_reference.startswith("("):
            continue
        references.append(".".join(_split_table_reference(table_reference)))
    return references


def extract_cte_names(sql: str) -> set[str]:
    return {
        _normalize_sql_identifier(match.group("cte")).lower()
        for match in _SQL_CTE_PATTERN.finditer(sql)
    }


def find_invalid_table_references(sql: str, valid_table_names: list[str]) -> list[str]:
    if not valid_table_names:
        return []

    valid_tables = {
        str(table_name).lower()
        for table_name in valid_table_names
        if table_name is not None
    }
    if not valid_tables:
        return []
    cte_names = extract_cte_names(sql)
    invalid_references = []

    for table_reference in extract_sql_table_references(sql):
        normalized_reference = table_reference.lower()
        reference_suffixes = {
            suffix.lower() for suffix in _table_reference_suffixes(table_reference)
        }
        if (
            normalized_reference in valid_tables
            or normalized_reference in cte_names
            or reference_suffixes.intersection(valid_tables)
            or reference_suffixes.intersection(cte_names)
        ):
            continue
        invalid_references.append(table_reference)

    return sorted(set(invalid_references))


def _find_schema_table_alias(
    requested_table: str, valid_table_names: list[str]
) -> str | None:
    requested_suffixes = _table_reference_suffixes(requested_table)
    requested_candidates = [
        suffix for suffix in requested_suffixes if suffix and len(suffix) > 2
    ]
    if not requested_candidates:
        return None

    valid_candidates = [
        str(table_name)
        for table_name in valid_table_names or []
        if table_name is not None and str(table_name).strip()
    ]
    valid_by_lower = {table.lower(): table for table in valid_candidates}
    for candidate in requested_candidates:
        exact = valid_by_lower.get(candidate.lower())
        if exact:
            return exact

    scored: list[tuple[int, int, str]] = []
    for valid_table in valid_candidates:
        valid_suffixes = _table_reference_suffixes(valid_table)
        valid_keys = [valid_table, *valid_suffixes]
        for requested_key in requested_candidates:
            requested_compact = _compact_sql_identifier(requested_key)
            if not requested_compact:
                continue
            for valid_key in valid_keys:
                valid_compact = _compact_sql_identifier(valid_key)
                if not valid_compact:
                    continue
                score = 0
                if requested_compact == valid_compact:
                    score = 1000 + len(valid_compact)
                elif valid_compact.endswith(requested_compact):
                    score = 800 + len(requested_compact)
                elif requested_compact.endswith(valid_compact):
                    score = 700 + len(valid_compact)
                elif (
                    len(requested_compact) >= 6
                    and valid_compact.startswith(requested_compact)
                ):
                    score = 600 + len(requested_compact)
                elif (
                    len(valid_compact) >= 6
                    and requested_compact.startswith(valid_compact)
                ):
                    score = 500 + len(valid_compact)
                if score:
                    scored.append((score, len(valid_compact), valid_table))

    if not scored:
        return None

    scored.sort(reverse=True)
    best_score = scored[0][0]
    best_tables = {table for score, _, table in scored if score == best_score}
    if len(best_tables) != 1:
        return None
    return scored[0][2]


def normalize_sql_table_references_to_schema(
    sql: str, valid_table_names: list[str]
) -> str:
    if not sql or not valid_table_names:
        return sql

    replacements: dict[str, str] = {}
    for table_reference in extract_sql_table_references(sql):
        canonical_table = _find_schema_table_alias(table_reference, valid_table_names)
        if not canonical_table or canonical_table == table_reference:
            continue
        replacements[table_reference] = canonical_table

    if not replacements:
        return sql

    normalized_sql = sql
    for requested_table, canonical_table in sorted(
        replacements.items(), key=lambda item: len(item[0]), reverse=True
    ):
        requested_parts = _split_table_reference(requested_table)
        if not requested_parts:
            continue
        quoted_requested = r"\s*\.\s*".join(
            re.escape(_quote_sql_identifier(part)) for part in requested_parts
        )
        single_quoted_requested = re.escape(_quote_sql_identifier(requested_table))
        bracketed_requested = re.escape(f"[{requested_table}]")
        backticked_requested = re.escape(f"`{requested_table}`")
        bare_requested = r"\s*\.\s*".join(
            re.escape(part) for part in requested_parts
        )
        table_pattern = re.compile(
            rf"(?<![A-Za-z0-9_$])(?:{quoted_requested}|"
            rf"{single_quoted_requested}|{bracketed_requested}|"
            rf"{backticked_requested}|{bare_requested})"
            rf"(?![A-Za-z0-9_$])",
            flags=re.IGNORECASE,
        )
        normalized_sql = table_pattern.sub(
            _quote_table_reference(canonical_table), normalized_sql
        )

    return normalized_sql


def _extract_table_aliases(
    sql: str, valid_table_columns: dict[str, list[str]]
) -> dict[str, str]:
    valid_tables = {
        str(table_name).lower(): table_name
        for table_name in valid_table_columns
        if table_name is not None
    }
    cte_names = extract_cte_names(sql)
    aliases: dict[str, str] = {}

    for table_name in valid_table_columns:
        if table_name is None:
            continue
        aliases[str(table_name).lower()] = table_name

    for match in _SQL_TABLE_WITH_ALIAS_PATTERN.finditer(sql):
        table_reference = ".".join(_split_table_reference(match.group("table")))
        normalized_table = table_reference.lower()
        matched_table = valid_tables.get(normalized_table)
        if not matched_table:
            for suffix in _table_reference_suffixes(table_reference):
                matched_table = valid_tables.get(suffix.lower())
                if matched_table:
                    break
        if not matched_table or normalized_table in cte_names:
            continue

        alias = match.group("alias")
        if not alias:
            continue

        normalized_alias = _normalize_sql_identifier(alias or "").lower()
        if normalized_alias in _SQL_RESERVED_ALIASES:
            continue
        aliases[normalized_alias] = matched_table

    return aliases


def normalize_sql_column_references_to_schema(
    sql: str, valid_table_columns: dict[str, list[str]]
) -> str:
    if not valid_table_columns:
        return sql

    aliases = _extract_table_aliases(sql, valid_table_columns)
    if not aliases:
        return sql

    canonical_columns_by_table: dict[str, dict[str, str]] = {}
    for table_name, columns in valid_table_columns.items():
        if table_name is None:
            continue
        compact_columns = {
            _compact_sql_identifier(column): str(column)
            for column in columns
            if column is not None
        }
        compact_columns = {
            compact: column
            for compact, column in compact_columns.items()
            if compact
        }
        canonical_columns_by_table[str(table_name)] = compact_columns

    def replace_column_reference(match: re.Match[str]) -> str:
        qualifier = match.group("qualifier")
        column = match.group("column")
        normalized_qualifier = _normalize_sql_identifier(qualifier).lower()
        table_name = aliases.get(normalized_qualifier)
        if not table_name:
            return match.group(0)

        canonical_columns = canonical_columns_by_table.get(str(table_name), {})
        normalized_column = _normalize_sql_identifier(column)
        compact_column = _compact_sql_identifier(normalized_column)
        canonical_column = canonical_columns.get(
            compact_column
        ) or _find_semantic_column_alias(normalized_column, canonical_columns)
        if not canonical_column or canonical_column == normalized_column:
            return match.group(0)

        return f"{qualifier}.{_quote_sql_identifier(canonical_column)}"

    normalized_sql = _SQL_QUALIFIED_COLUMN_PATTERN.sub(replace_column_reference, sql)

    referenced_tables = {
        aliases.get(table_reference.lower())
        for table_reference in extract_sql_table_references(normalized_sql)
    }
    referenced_tables = {table for table in referenced_tables if table}
    if len(referenced_tables) != 1:
        return normalized_sql

    table_name = next(iter(referenced_tables))
    canonical_columns = canonical_columns_by_table.get(str(table_name), {})
    if not canonical_columns:
        return normalized_sql

    valid_compact_columns = set(canonical_columns)

    def replace_unqualified_identifier(match: re.Match[str]) -> str:
        identifier = next(
            value
            for value in (
                match.group("quoted"),
                match.group("bracketed"),
                match.group("bare"),
            )
            if value
        )
        compact_identifier = _compact_sql_identifier(identifier)
        canonical_column = canonical_columns.get(
            compact_identifier
        ) or _find_semantic_column_alias(identifier, canonical_columns)
        if not canonical_column:
            return match.group(0)

        if canonical_column == identifier:
            return match.group(0)

        return _quote_sql_identifier(canonical_column)

    schema_candidates = {
        candidate
        for column in canonical_columns.values()
        if column
        and _normalize_sql_identifier(column).lower() not in _SQL_RESERVED_ALIASES
        for candidate in _sql_identifier_alias_candidates(column)
    }
    unqualified_candidates = sorted(
        schema_candidates
        | {
            alias_key
            for alias_key in _SEMANTIC_COLUMN_ALIASES
            if alias_key
            and _normalize_sql_identifier(alias_key).lower()
            not in _SQL_RESERVED_ALIASES
        }
        | {
            alias
            for aliases in _SEMANTIC_COLUMN_ALIASES.values()
            for alias in aliases
            if alias
            and _normalize_sql_identifier(alias).lower() not in _SQL_RESERVED_ALIASES
        },
        key=len,
        reverse=True,
    )
    if not unqualified_candidates:
        return normalized_sql

    candidate_pattern = "|".join(
        re.escape(candidate) for candidate in unqualified_candidates
    )
    unqualified_identifier_pattern = re.compile(
        rf'(?<![\.\w])(?:"(?P<quoted>{candidate_pattern})"'
        rf"|\[(?P<bracketed>{candidate_pattern})\]"
        rf"|(?P<bare>{candidate_pattern}))(?!\w)",
        flags=re.IGNORECASE,
    )
    return unqualified_identifier_pattern.sub(
        replace_unqualified_identifier,
        normalized_sql,
    )


def find_invalid_column_references(
    sql: str, valid_table_columns: dict[str, list[str]]
) -> list[str]:
    if not valid_table_columns:
        return []

    aliases = _extract_table_aliases(sql, valid_table_columns)
    cte_names = extract_cte_names(sql)
    invalid_references = []

    for match in _SQL_QUALIFIED_COLUMN_PATTERN.finditer(sql):
        qualifier = _normalize_sql_identifier(match.group("qualifier"))
        column = _normalize_sql_identifier(match.group("column"))
        normalized_qualifier = qualifier.lower()

        if normalized_qualifier in cte_names:
            continue

        table_name = aliases.get(normalized_qualifier)
        if not table_name:
            continue

        valid_columns = {
            str(col).lower()
            for col in valid_table_columns.get(table_name, [])
            if col is not None
        }
        if column.lower() not in valid_columns:
            invalid_references.append(f"{qualifier}.{column}")

    referenced_tables = {
        aliases.get(table_reference.lower())
        for table_reference in extract_sql_table_references(sql)
    }
    referenced_tables = {table for table in referenced_tables if table}
    if len(referenced_tables) == 1:
        table_name = next(iter(referenced_tables))
        valid_columns = {
            str(col).lower()
            for col in valid_table_columns.get(table_name, [])
            if col is not None
        }
        valid_compact_columns = {
            _compact_sql_identifier(col)
            for col in valid_table_columns.get(table_name, [])
            if col is not None
        }
        for start, end in _find_select_list_spans(sql):
            for item in _split_top_level_select_items(sql[start:end]):
                expression = _strip_projection_alias(
                    re.sub(r"^\s*DISTINCT\s+", "", item, flags=re.IGNORECASE)
                )
                if not re.fullmatch(_SQL_IDENTIFIER_PATTERN, expression.strip()):
                    continue
                column = _normalize_sql_identifier(expression)
                if column == "*":
                    continue
                if (
                    column.lower() not in valid_columns
                    and _compact_sql_identifier(column) not in valid_compact_columns
                ):
                    invalid_references.append(column)
        table_aliases = {
            alias.lower()
            for alias, alias_table in aliases.items()
            if alias_table == table_name
        }
        for column in _find_unqualified_column_candidates(sql):
            normalized_column = column.lower()
            if (
                normalized_column in table_aliases
                or normalized_column in valid_columns
                or _compact_sql_identifier(column) in valid_compact_columns
            ):
                continue
            invalid_references.append(column)

    return sorted(set(invalid_references))


def format_valid_table_columns(valid_table_columns: dict[str, list[str]]) -> str:
    return "; ".join(
        f"{table}: {', '.join(columns)}"
        for table, columns in sorted(valid_table_columns.items())
    )


_PLAIN_COUNT_SQL_PATTERN = re.compile(
    r"^\s*SELECT\s+COUNT\s*\(\s*\*\s*\)(?:\s+AS\s+"
    r'(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*))?\s+'
    rf"FROM\s+{_SQL_IDENTIFIER_PATTERN}(?:\s*\.\s*{_SQL_IDENTIFIER_PATTERN})*"
    r"(?:\s+WHERE\s+.+?)?\s*(?:ORDER\s+BY\s+.+?)?(?:LIMIT\s+\d+\s*)?$",
    flags=re.IGNORECASE | re.DOTALL,
)
_AGGREGATE_PATTERN = re.compile(
    r"\b(?:SUM|AVG|MIN|MAX|COUNT)\s*\(",
    flags=re.IGNORECASE,
)
_SPECIFIC_METRIC_TERM_GROUPS: dict[str, tuple[str, ...]] = {
    "revenue": ("revenue", "sales", "sale", "amount", "value", "price", "total"),
    "sales": ("sales", "sale", "revenue", "amount", "value", "price"),
    "profit": ("profit", "margin", "income", "earnings"),
    "cost": ("cost", "expense", "spend", "charge"),
    "amount": ("amount", "value", "price", "total", "sum"),
    "value": ("value", "amount", "price", "total"),
    "quantity": ("quantity", "qty", "volume", "units", "count"),
    "average": ("average", "avg", "mean"),
    "avg": ("avg", "average", "mean"),
    "rate": ("rate", "ratio", "percent", "percentage"),
    "ratio": ("ratio", "rate", "percent", "percentage"),
    "percentage": ("percentage", "percent", "pct", "rate"),
    "percent": ("percent", "percentage", "pct", "rate"),
    "duration": ("duration", "turnaround", "elapsed", "cycle", "leadtime", "time"),
    "turnaround": ("turnaround", "duration", "elapsed", "cycle", "leadtime", "time"),
}
_ANALYSIS_TERMS = {
    "analysis",
    "analyze",
    "dashboard",
    "summary",
    "summarize",
    "trend",
    "compare",
    "comparison",
    "breakdown",
    "distribution",
    "performance",
    "ranking",
    "top",
    "bottom",
    "highest",
    "lowest",
}
_COUNT_VOLUME_TERMS = {
    "count",
    "counts",
    "number",
    "volume",
    "records",
    "record",
    "rows",
    "row",
    "how many",
}
_TEMPORAL_TERMS = {
    "date",
    "timestamp",
    "month",
    "monthly",
    "year",
    "yearly",
    "week",
    "weekly",
    "day",
    "daily",
    "quarter",
    "quarterly",
    "trend",
    "over time",
}
_TEMPORAL_IDENTIFIER_TERMS = {
    "date",
    "time",
    "timestamp",
    "month",
    "year",
    "week",
    "day",
    "quarter",
    "created",
    "updated",
    "modified",
    "started",
    "ended",
    "closed",
    "approved",
}
_DIMENSION_TERMS = {
    "category",
    "type",
    "status",
    "source",
    "region",
    "country",
    "market",
    "customer",
    "product",
    "salesperson",
    "owner",
    "assignee",
    "division",
    "department",
    "location",
}


def _contains_phrase(text: str, terms: set[str] | tuple[str, ...]) -> bool:
    normalized = f" {str(text or '').lower()} "
    return any(f" {term.lower()} " in normalized for term in terms if " " in term) or any(
        re.search(rf"\b{re.escape(term.lower())}\b", normalized)
        for term in terms
        if " " not in term
    )


def _query_requests_specific_metric(query: str) -> bool:
    normalized = str(query or "").lower()
    if not normalized:
        return False

    return any(
        re.search(rf"\b{re.escape(term)}\b", normalized)
        for term in _SPECIFIC_METRIC_TERM_GROUPS
    )


def _query_requests_count_volume(query: str) -> bool:
    return _contains_phrase(query, _COUNT_VOLUME_TERMS)


def _query_requests_time_analysis(query: str) -> bool:
    normalized = str(query or "").lower()
    if _contains_phrase(normalized, _TEMPORAL_TERMS):
        return True

    return bool(
        re.search(
            r"\b(?:last|next|previous|prior|this)\s+"
            r"(?:\d+\s+)?(?:day|week|month|quarter|year)s?\b",
            normalized,
        )
        or re.search(r"\b(?:between|since|before|after)\b", normalized)
    )


def _query_requests_time_bucket(query: str) -> bool:
    normalized = str(query or "").lower()
    return bool(
        _contains_phrase(
            normalized,
            {
                "daily",
                "weekly",
                "monthly",
                "quarterly",
                "yearly",
                "trend",
                "over time",
                "time series",
            },
        )
        or re.search(
            r"\b(?:by|per|for each)\s+"
            r"(?:day|week|month|quarter|year)s?\b",
            normalized,
        )
    )


def _query_requests_grouped_analysis(query: str) -> bool:
    normalized = str(query or "").lower()
    return bool(
        re.search(r"\b(?:by|per|across)\s+[A-Za-z_][A-Za-z0-9_ -]*", normalized)
        or re.search(r"\bfor each\s+[A-Za-z_][A-Za-z0-9_ -]*", normalized)
        or _contains_phrase(normalized, {"breakdown", "distribution", "grouped"})
    )


def _sql_is_plain_count(sql: str) -> bool:
    if re.search(r"\bGROUP\s+BY\b", sql, flags=re.IGNORECASE):
        return False
    return bool(_PLAIN_COUNT_SQL_PATTERN.match(sql or ""))


def _compacted_schema_identifiers(
    valid_table_columns: dict[str, list[str]],
) -> set[str]:
    identifiers: set[str] = set()
    for table, columns in valid_table_columns.items():
        identifiers.add(_compact_sql_identifier(table))
        for column in columns or []:
            identifiers.add(_compact_sql_identifier(column))
    return {identifier for identifier in identifiers if identifier}


def _compacted_sql_identifiers(sql: str) -> set[str]:
    identifiers = {
        _compact_sql_identifier(identifier)
        for identifier in re.findall(
            r'"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|\b([A-Za-z_][A-Za-z0-9_$]*)\b',
            sql or "",
        )
        for identifier in identifier
        if identifier
    }
    return {identifier for identifier in identifiers if identifier}


def _sql_references_term_group(sql: str, terms: tuple[str, ...]) -> bool:
    sql_identifiers = _compacted_sql_identifiers(sql)
    compact_terms = {_compact_sql_identifier(term) for term in terms}
    return any(
        term
        and any(term in identifier or identifier in term for identifier in sql_identifiers)
        for term in compact_terms
    )


def _schema_supports_term_group(
    valid_table_columns: dict[str, list[str]],
    terms: tuple[str, ...],
) -> bool:
    schema_identifiers = _compacted_schema_identifiers(valid_table_columns)
    compact_terms = {_compact_sql_identifier(term) for term in terms}
    return any(
        term
        and any(term in identifier or identifier in term for identifier in schema_identifiers)
        for term in compact_terms
    )


def _missing_metric_support(
    query: str,
    sql: str,
    valid_table_columns: dict[str, list[str]],
) -> list[str]:
    normalized_query = str(query or "").lower()
    missing_terms: list[str] = []

    for term, group in _SPECIFIC_METRIC_TERM_GROUPS.items():
        if not re.search(rf"\b{re.escape(term)}\b", normalized_query):
            continue
        if _sql_references_term_group(sql, group):
            continue
        if not _schema_supports_term_group(valid_table_columns, group):
            missing_terms.append(term)

    return sorted(set(missing_terms))


def _sql_has_temporal_reference(
    sql: str,
    valid_table_columns: dict[str, list[str]],
) -> bool:
    if re.search(
        r"\b(?:DATEPART|DATE_TRUNC|DATETRUNC|EXTRACT|TO_TIMESTAMP|CAST)\s*\(",
        sql or "",
        flags=re.IGNORECASE,
    ):
        return True

    return _sql_references_term_group(
        sql,
        tuple(_TEMPORAL_IDENTIFIER_TERMS),
    ) or any(
        _schema_supports_term_group({table: [column]}, tuple(_TEMPORAL_IDENTIFIER_TERMS))
        and _sql_references_term_group(sql, (column,))
        for table, columns in valid_table_columns.items()
        for column in columns
    )


def _semantic_analysis_items(
    semantic_analysis: dict[str, Any] | None,
    key: str,
) -> list[str]:
    if not isinstance(semantic_analysis, dict):
        return []

    value = semantic_analysis.get(key)
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        return [
            str(item).strip()
            for item in value
            if item is not None and str(item).strip()
        ]
    return []


def _semantic_analysis_dict_items(
    semantic_analysis: dict[str, Any] | None,
    key: str,
) -> list[dict[str, Any]]:
    if not isinstance(semantic_analysis, dict):
        return []

    value = semantic_analysis.get(key)
    if not isinstance(value, list):
        return []

    return [item for item in value if isinstance(item, dict)]


def _has_semantic_analysis(semantic_analysis: dict[str, Any] | None) -> bool:
    if not isinstance(semantic_analysis, dict) or not semantic_analysis:
        return False
    semantic_keys = {
        "analytical_intent",
        "entities",
        "identifiers",
        "metrics",
        "dimensions",
        "filters",
        "aggregations",
        "relationships",
        "time_constraints",
        "ranking",
        "supported_schema_objects",
        "candidate_schema_scores",
        "concept_mappings",
        "interpretations",
        "missing_requirements",
        "ambiguous_requirements",
        "support_reasoning",
    }
    return any(semantic_analysis.get(key) for key in semantic_keys)


def _schema_interpretation_clarification_error(
    semantic_analysis: dict[str, Any],
) -> str | None:
    interpretations = _semantic_analysis_dict_items(
        semantic_analysis, "interpretations"
    )
    if not interpretations:
        return None

    selected_interpretations = [
        str(interpretation.get("description") or "").strip()
        for interpretation in interpretations
        if interpretation.get("is_selected") is True
        and str(interpretation.get("description") or "").strip()
    ]
    if len(selected_interpretations) > 1:
        return (
            "The request has multiple selected schema interpretations: "
            f"{', '.join(selected_interpretations)}. Please clarify which one to use."
        )

    clarification_interpretations = [
        str(interpretation.get("description") or "").strip()
        for interpretation in interpretations
        if interpretation.get("needs_clarification") is True
        and str(interpretation.get("description") or "").strip()
    ]
    if clarification_interpretations:
        return (
            "The request needs clarification before SQL generation: "
            f"{', '.join(clarification_interpretations)}."
        )

    return None


def _semantic_candidate_scores(
    semantic_analysis: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    return _semantic_analysis_dict_items(semantic_analysis, "candidate_schema_scores")


def _semantic_candidate_support_error(
    semantic_analysis: dict[str, Any],
) -> str | None:
    candidate_scores = _semantic_candidate_scores(semantic_analysis)
    if not candidate_scores:
        return None

    complete_candidates = [
        candidate
        for candidate in candidate_scores
        if candidate.get("is_complete") is True
    ]
    if complete_candidates:
        return None

    incomplete_with_missing = [
        candidate
        for candidate in candidate_scores
        if candidate.get("missing_concepts")
    ]
    if not incomplete_with_missing:
        return None

    missing_concepts = []
    for candidate in incomplete_with_missing[:3]:
        candidate_id = str(candidate.get("candidate_id") or "candidate").strip()
        missing = candidate.get("missing_concepts")
        if isinstance(missing, list):
            missing_text = ", ".join(
                str(item).strip()
                for item in missing
                if item is not None and str(item).strip()
            )
        else:
            missing_text = str(missing or "").strip()
        if missing_text:
            missing_concepts.append(f"{candidate_id}: {missing_text}")

    if not missing_concepts:
        return None

    return (
        "Semantic schema retrieval did not find a complete schema mapping for "
        "the request. Missing concepts: "
        f"{'; '.join(missing_concepts)}. I cannot generate unrelated SQL."
    )


def _required_concept_mapping_support_error(
    semantic_analysis: dict[str, Any],
) -> str | None:
    unsupported_required_concepts = []
    for mapping in _semantic_concept_mappings(semantic_analysis):
        if mapping.get("required_in_sql") is False:
            continue
        if _mapping_schema_objects(mapping):
            continue

        request_concept = _mapping_request_concept(mapping)
        concept_type = _mapping_concept_type(mapping)
        if request_concept:
            unsupported_required_concepts.append(
                f"{request_concept} ({concept_type or 'concept'})"
            )

    if not unsupported_required_concepts:
        return None

    return (
        "The semantic contract did not map required request concepts to active "
        "schema objects: "
        f"{', '.join(unsupported_required_concepts)}. I cannot generate unrelated SQL."
    )


def get_schema_intent_analysis_error(
    semantic_analysis: dict[str, Any] | None,
) -> str | None:
    if not _has_semantic_analysis(semantic_analysis):
        return None

    missing_requirements = _semantic_analysis_items(
        semantic_analysis, "missing_requirements"
    )
    if missing_requirements:
        return (
            "The active datasource schema does not expose the information needed "
            "to answer the request: "
            f"{', '.join(missing_requirements)}. I cannot generate unrelated SQL."
        )

    ambiguous_requirements = _semantic_analysis_items(
        semantic_analysis, "ambiguous_requirements"
    )
    if ambiguous_requirements:
        return (
            "The request has multiple equally plausible schema interpretations: "
            f"{', '.join(ambiguous_requirements)}. Please clarify which one to use."
        )

    if interpretation_error := _schema_interpretation_clarification_error(
        semantic_analysis
    ):
        return interpretation_error

    if candidate_support_error := _semantic_candidate_support_error(
        semantic_analysis
    ):
        return candidate_support_error

    if required_mapping_error := _required_concept_mapping_support_error(
        semantic_analysis
    ):
        return required_mapping_error

    if semantic_analysis.get("is_fully_supported") is False:
        support_reasoning = str(semantic_analysis.get("support_reasoning") or "").strip()
        if support_reasoning:
            return (
                "The selected schema does not fully support the request: "
                f"{support_reasoning}"
            )
        return (
            "The selected schema does not fully support every required component "
            "of the request. I cannot generate unrelated SQL."
        )

    return None


def _semantic_analysis_requests_record_count(
    semantic_analysis: dict[str, Any],
) -> bool:
    analytical_intent = str(semantic_analysis.get("analytical_intent") or "").lower()
    if analytical_intent == "record_count":
        return True

    semantic_text = " ".join(
        item
        for key in ("metrics", "aggregations")
        for item in _semantic_analysis_items(semantic_analysis, key)
    )
    return bool(
        re.search(
            r"\b(?:count|number of|volume|record count|row count|count records|count rows|number of records)\b",
            semantic_text.lower(),
        )
    )


def _semantic_concept_mappings(
    semantic_analysis: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    return _semantic_analysis_dict_items(semantic_analysis, "concept_mappings")


def _schema_object_parts(schema_object: str) -> list[str]:
    return [
        _normalize_sql_identifier(part.strip())
        for part in str(schema_object or "").split(".")
        if part.strip()
    ]


def _schema_object_table_matches(
    referenced_table: str,
    expected_table: str,
) -> bool:
    referenced_suffixes = {
        suffix.lower() for suffix in _table_reference_suffixes(referenced_table)
    }
    expected_suffixes = {
        suffix.lower() for suffix in _table_reference_suffixes(expected_table)
    }
    return bool(referenced_suffixes & expected_suffixes)


def _sql_contains_identifier(sql: str, identifier: str) -> bool:
    identifier = _normalize_sql_identifier(str(identifier or "").strip())
    if not identifier:
        return False

    escaped = re.escape(identifier)
    quoted_identifier_pattern = rf'(?:"{escaped}"|`{escaped}`|\[{escaped}\])'
    bare_identifier_pattern = rf"(?<![A-Za-z0-9_$]){escaped}(?![A-Za-z0-9_$])"
    return bool(
        re.search(
            rf"(?:{quoted_identifier_pattern}|{bare_identifier_pattern})",
            sql or "",
            flags=re.IGNORECASE,
        )
    )


def _sql_references_table(sql: str, table_name: str) -> bool:
    table_name = str(table_name or "").strip()
    if not table_name:
        return False

    table_candidates = {table_name, *_table_reference_suffixes(table_name)}
    return any(_sql_contains_identifier(sql, candidate) for candidate in table_candidates)


def _sql_references_schema_object(
    sql: str,
    schema_object: str,
    valid_table_columns: dict[str, list[str]],
) -> bool:
    parts = _schema_object_parts(schema_object)
    if not parts:
        return False

    if len(parts) == 1:
        return _sql_contains_identifier(sql, parts[0])

    expected_column = parts[-1]
    expected_table = ".".join(parts[:-1])
    aliases = _extract_table_aliases(sql, valid_table_columns)

    for match in _SQL_QUALIFIED_COLUMN_PATTERN.finditer(sql or ""):
        qualifier = _normalize_sql_identifier(match.group("qualifier"))
        column = _normalize_sql_identifier(match.group("column"))
        referenced_table = aliases.get(qualifier.lower(), qualifier)
        if (
            column.lower() == expected_column.lower()
            and _schema_object_table_matches(referenced_table, expected_table)
        ):
            return True

    if _sql_references_table(sql, expected_table) and _sql_contains_identifier(
        sql, expected_column
    ):
        return True

    return False


def _sql_references_schema_object_table(
    sql: str,
    schema_object: str,
) -> bool:
    parts = _schema_object_parts(schema_object)
    if len(parts) < 2:
        return _sql_references_table(sql, schema_object)
    return _sql_references_table(sql, ".".join(parts[:-1]))


def _mapping_schema_objects(mapping: dict[str, Any]) -> list[str]:
    value = mapping.get("schema_objects")
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        return [
            str(item).strip()
            for item in value
            if item is not None and str(item).strip()
        ]
    return []


def _mapping_concept_type(mapping: dict[str, Any]) -> str:
    return str(mapping.get("concept_type") or "").strip().lower()


def _mapping_request_concept(mapping: dict[str, Any]) -> str:
    return str(mapping.get("request_concept") or "requested concept").strip()


def _requested_aggregate_functions(*texts: str) -> set[str]:
    joined = " ".join(text for text in texts if text).lower()
    aggregate_terms = {
        "SUM": r"\b(?:sum|total)\b",
        "AVG": r"\b(?:avg|average|mean)\b",
        "MIN": r"\b(?:min|minimum|lowest|smallest)\b",
        "MAX": r"\b(?:max|maximum|highest|largest)\b",
        "COUNT": r"\b(?:count|number of|how many|volume)\b",
    }
    return {
        function
        for function, pattern in aggregate_terms.items()
        if re.search(pattern, joined, flags=re.IGNORECASE)
    }


def _sql_has_aggregate_function(sql: str, function_name: str) -> bool:
    return bool(
        re.search(
            rf"\b{re.escape(function_name)}\s*\(",
            sql or "",
            flags=re.IGNORECASE,
        )
    )


def _validate_sql_against_concept_mappings(
    semantic_analysis: dict[str, Any],
    sql: str,
    valid_table_columns: dict[str, list[str]],
) -> str | None:
    mappings = _semantic_concept_mappings(semantic_analysis)
    if not mappings:
        return None

    requests_record_count = _semantic_analysis_requests_record_count(
        semantic_analysis
    )
    aggregation_text = " ".join(
        _semantic_analysis_items(semantic_analysis, "aggregations")
    )
    has_grouping = bool(re.search(r"\bGROUP\s+BY\b", sql or "", flags=re.IGNORECASE))
    has_ordering = bool(
        re.search(r"\bORDER\s+BY\b", sql or "", flags=re.IGNORECASE)
    )
    has_limit = bool(
        re.search(
            r"\b(?:LIMIT|TOP\s*\(|FETCH\s+FIRST)\b",
            sql or "",
            flags=re.IGNORECASE,
        )
    )

    for mapping in mappings:
        if mapping.get("required_in_sql") is False:
            continue

        concept_type = _mapping_concept_type(mapping)
        request_concept = _mapping_request_concept(mapping)
        schema_objects = _mapping_schema_objects(mapping)
        if not schema_objects:
            return (
                "The semantic analysis did not map the required "
                f"{concept_type or 'concept'} '{request_concept}' to a schema "
                "object. I cannot generate unrelated SQL."
            )

        references_concept = any(
            _sql_references_schema_object(sql, schema_object, valid_table_columns)
            for schema_object in schema_objects
        )
        if (
            not references_concept
            and concept_type == "metric"
            and requests_record_count
            and _sql_is_plain_count(sql)
        ):
            references_concept = any(
                _sql_references_schema_object_table(sql, schema_object)
                for schema_object in schema_objects
            )

        if not references_concept:
            return (
                "Generated SQL does not reference schema objects mapped to the "
                f"required {concept_type or 'concept'} '{request_concept}': "
                f"{', '.join(schema_objects)}."
            )

        if concept_type == "metric":
            if _sql_is_plain_count(sql) and not requests_record_count:
                return (
                    "Generated SQL answers with a generic record count, but the "
                    f"requested metric '{request_concept}' maps to "
                    f"{', '.join(schema_objects)} and must be retrieved or "
                    "calculated from that schema object."
                )

            requested_functions = _requested_aggregate_functions(
                request_concept,
                str(mapping.get("mapping_reason") or ""),
                aggregation_text,
            )
            for function_name in requested_functions:
                if function_name == "COUNT" and requests_record_count:
                    continue
                if not _sql_has_aggregate_function(sql, function_name):
                    return (
                        "Generated SQL does not use the aggregation required "
                        f"for metric '{request_concept}': {function_name}."
                    )

        if concept_type in {"dimension", "time"} and _AGGREGATE_PATTERN.search(
            sql or ""
        ) and not has_grouping:
            return (
                "Generated SQL aggregates results without grouping by the "
                f"required {concept_type} '{request_concept}'."
            )

        if concept_type == "ranking" and (not has_ordering or not has_limit):
            return (
                "Generated SQL does not include sorting and limiting logic "
                f"required by ranking concept '{request_concept}'."
            )

    return None


def _validate_sql_against_semantic_analysis(
    semantic_analysis: dict[str, Any] | None,
    sql: str,
    valid_table_columns: dict[str, list[str]],
) -> str | None:
    if not _has_semantic_analysis(semantic_analysis):
        return None

    if analysis_error := get_schema_intent_analysis_error(semantic_analysis):
        return analysis_error

    if mapping_error := _validate_sql_against_concept_mappings(
        semantic_analysis,
        sql,
        valid_table_columns,
    ):
        return mapping_error

    analytical_intent = str(
        semantic_analysis.get("analytical_intent") or ""
    ).strip().lower()
    metrics = _semantic_analysis_items(semantic_analysis, "metrics")
    dimensions = _semantic_analysis_items(semantic_analysis, "dimensions")
    aggregations = _semantic_analysis_items(semantic_analysis, "aggregations")
    time_constraints = _semantic_analysis_items(
        semantic_analysis, "time_constraints"
    )
    ranking = _semantic_analysis_items(semantic_analysis, "ranking")
    requests_record_count = _semantic_analysis_requests_record_count(
        semantic_analysis
    )
    analytical_sql_intents = {
        "summary",
        "comparison",
        "trend",
        "dashboard",
        "kpi",
        "ranking",
    }

    if _sql_is_plain_count(sql) and (
        (metrics and not requests_record_count)
        or dimensions
        or ranking
        or (analytical_intent in analytical_sql_intents and not requests_record_count)
    ):
        return (
            "Generated SQL answers with a generic record count, but the semantic "
            "analysis requires specific business metrics, dimensions, ranking, "
            "or analytical calculations from the active schema."
        )

    if time_constraints and not _sql_has_temporal_reference(sql, valid_table_columns):
        return (
            "Generated SQL does not use a temporal field or supported date/time "
            "expression, but the semantic analysis identified time constraints "
            "or trend requirements."
        )

    if (dimensions or analytical_intent == "trend") and _AGGREGATE_PATTERN.search(
        sql or ""
    ):
        has_grouping = bool(re.search(r"\bGROUP\s+BY\b", sql or "", flags=re.IGNORECASE))
        if not has_grouping:
            return (
                "Generated SQL aggregates results without grouping by the "
                "dimensions or time grain identified in the semantic analysis."
            )

    if ranking and not re.search(
        r"\b(?:ORDER\s+BY|LIMIT|TOP\s*\(|FETCH\s+FIRST)\b",
        sql or "",
        flags=re.IGNORECASE,
    ):
        return (
            "Generated SQL does not include sorting or limiting logic required "
            "by the ranking intent."
        )

    if aggregations and not _AGGREGATE_PATTERN.search(sql or ""):
        return (
            "Generated SQL does not include the aggregation required by the "
            "semantic analysis."
        )

    return None


def validate_sql_intent_alignment(
    query: str | None,
    sql: str,
    valid_table_columns: dict[str, list[str]] | None = None,
    semantic_analysis: dict[str, Any] | None = None,
) -> str | None:
    valid_table_columns = valid_table_columns or {}

    semantic_validation_error = _validate_sql_against_semantic_analysis(
        semantic_analysis,
        sql,
        valid_table_columns,
    )
    if semantic_validation_error:
        return semantic_validation_error

    if not query:
        return None

    normalized_query = str(query or "").lower()
    asks_specific_metric = _query_requests_specific_metric(normalized_query)
    asks_count_volume = _query_requests_count_volume(normalized_query)
    asks_time_analysis = _query_requests_time_analysis(normalized_query)
    asks_time_bucket = _query_requests_time_bucket(normalized_query)
    asks_grouped_analysis = _query_requests_grouped_analysis(normalized_query)
    asks_analysis = _contains_phrase(normalized_query, _ANALYSIS_TERMS)

    if _sql_is_plain_count(sql) and (
        asks_specific_metric
        or asks_time_bucket
        or asks_grouped_analysis
        or (asks_analysis and not asks_count_volume)
    ):
        return (
            "Generated SQL answers with a generic record count, but the question "
            "asks for a specific metric, trend, grouping, comparison, dashboard, "
            "or analysis. Select schema elements that directly support the "
            "requested business intent, or report that the schema does not expose them."
        )

    if asks_time_analysis and not _sql_has_temporal_reference(sql, valid_table_columns):
        return (
            "Generated SQL does not use a temporal field or supported date/time "
            "expression, but the question asks for a time range or trend. The "
            "active schema must expose a relevant date/time column to answer this."
        )

    if (asks_grouped_analysis or asks_time_bucket) and _AGGREGATE_PATTERN.search(
        sql or ""
    ):
        has_grouping = bool(re.search(r"\bGROUP\s+BY\b", sql or "", flags=re.IGNORECASE))
        if not has_grouping:
            return (
                "Generated SQL aggregates results without grouping by the requested "
                "dimension. Use an explicit schema column for the requested grouping, "
                "or report that the schema does not expose that dimension."
            )

    missing_metric_terms = _missing_metric_support(
        normalized_query,
        sql,
        valid_table_columns,
    )
    if missing_metric_terms:
        missing = ", ".join(missing_metric_terms)
        return (
            "The active schema does not expose columns or metrics that directly "
            f"support the requested business term(s): {missing}. Do not generate "
            "an unrelated query."
        )

    if asks_grouped_analysis and _contains_phrase(normalized_query, _DIMENSION_TERMS):
        missing_dimensions = [
            term
            for term in _DIMENSION_TERMS
            if re.search(rf"\b{re.escape(term)}\b", normalized_query)
            and not _sql_references_term_group(sql, (term,))
            and not _schema_supports_term_group(valid_table_columns, (term,))
        ]
        if missing_dimensions:
            return (
                "The active schema does not expose the requested grouping "
                f"dimension(s): {', '.join(sorted(missing_dimensions))}. Do not "
                "generate an unrelated query."
            )

    return None


def construct_ask_history_messages(
    histories: list[Any] | list[dict],
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
