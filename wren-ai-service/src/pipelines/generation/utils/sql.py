import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List

import aiohttp
import orjson
import sqlparse
from haystack import component
from pydantic import BaseModel, ConfigDict
from sqlparse.sql import Identifier, IdentifierList, TokenList
from sqlparse.tokens import Comment, Keyword

from src.core.engine import (
    Engine,
    clean_generation_result,
)
from src.pipelines.retrieval.sql_knowledge import SqlKnowledge
from src.providers.llm import ChatMessage
from src.web.v1.services.ask import AskHistory

logger = logging.getLogger("wren-ai-service")

_DDL_CREATE_PATTERN = re.compile(
    r"\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW)\s+(?P<table>[^\s(]+)\s*\(",
    re.IGNORECASE,
)
_DDL_COLUMN_KEYWORDS = {
    "CHECK",
    "CONSTRAINT",
    "FOREIGN",
    "INDEX",
    "KEY",
    "PRIMARY",
    "UNIQUE",
}


_IDENTIFIER_TOKEN = r'"[^"]+"|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*'
_QUALIFIED_IDENTIFIER = rf"(?:{_IDENTIFIER_TOKEN})(?:\s*\.\s*(?:{_IDENTIFIER_TOKEN}))*"
_SIMPLE_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]*$")
_DDL_RELATION = re.compile(
    rf"\bCREATE\s+(?:TABLE|VIEW)\s+(?P<name>{_QUALIFIED_IDENTIFIER})",
    re.IGNORECASE,
)
_RELATION_REFERENCE = re.compile(
    rf"\b(?:FROM|JOIN)\s+(?P<name>{_QUALIFIED_IDENTIFIER})"
    rf"(?:\s+(?:AS\s+)?(?P<alias>{_IDENTIFIER_TOKEN}))?",
    re.IGNORECASE,
)
_TSQL_TOP_LIMIT = re.compile(
    r"(?is)^(\s*)SELECT\s+TOP\s*\(?\s*(\d+)\s*\)?\s+(?!PERCENT\b)(.+?)\s*;?\s*$"
)
_TO_DATE_SIMPLE = re.compile(
    r"(?is)\bTO_DATE\s*\(\s*"
    r"(?P<expr>\"[^\"]+\"|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*"
    r"(?:\s*\.\s*(?:\"[^\"]+\"|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*))?)"
    r"\s*,\s*'[^']+'\s*\)"
)
_ORDER_BY_ALIAS_ITEM = re.compile(
    r"(?is)^(?P<identifier>\"[^\"]+\"|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*)"
    r"(?P<suffix>\s+(?:ASC|DESC))?$"
)
_JOINED_DESC_LIMIT = re.compile(r"(?i)\bDESC\s*LIMIT\b|DESCLIMIT")
_JOINED_ASC_LIMIT = re.compile(r"(?i)\bASC\s*LIMIT\b|ASCLIMIT")
_CTE_REFERENCE = re.compile(
    rf"(?:\bWITH|,)\s+(?P<name>{_IDENTIFIER_TOKEN})\s+AS\s*\(",
    re.IGNORECASE,
)
_QUALIFIED_COLUMN = re.compile(
    rf"(?P<qualifier>{_QUALIFIED_IDENTIFIER})\s*\.\s*(?P<column>{_IDENTIFIER_TOKEN})"
)
_SQL_START = re.compile(r"^\s*(?:WITH|SELECT)\b", re.IGNORECASE | re.DOTALL)
_SQL_OBJECT_ALIAS_STOP_WORDS = {
    "CROSS",
    "EXCEPT",
    "FETCH",
    "FULL",
    "GROUP",
    "HAVING",
    "INNER",
    "INTERSECT",
    "JOIN",
    "LEFT",
    "LIMIT",
    "MATCH_RECOGNIZE",
    "NATURAL",
    "OFFSET",
    "ORDER",
    "RIGHT",
    "TABLESAMPLE",
    "UNION",
    "WHERE",
}
_UNQUALIFIED_QUOTED_IDENTIFIER = re.compile(r'(?<!\.)"(?P<name>(?:[^"]|"")*)"')
_UNQUALIFIED_BARE_IDENTIFIER = re.compile(
    r"(?<![\.\"])\b(?P<name>[A-Za-z_][A-Za-z0-9_$]*)\b(?!\s*\.)"
)
_SINGLE_QUOTED_LITERAL = re.compile(r"'(?:''|[^'])*'")
_SQL_RESERVED_WORDS = {
    "ALL",
    "ALTER",
    "AND",
    "ASC",
    "AS",
    "BETWEEN",
    "BY",
    "CASE",
    "CAST",
    "COUNT",
    "CREATE",
    "CROSS",
    "CURRENT_DATE",
    "CURRENT_TIME",
    "CURRENT_TIMESTAMP",
    "DELETE",
    "DESC",
    "DISTINCT",
    "ELSE",
    "END",
    "EXCEPT",
    "FALSE",
    "FETCH",
    "FOR",
    "FROM",
    "FULL",
    "GROUP",
    "HAVING",
    "IN",
    "ISNULL",
    "INNER",
    "INSERT",
    "INTERVAL",
    "INTERSECT",
    "IS",
    "JOIN",
    "LEFT",
    "LIKE",
    "LIMIT",
    "NATURAL",
    "NO",
    "NOT",
    "NULL",
    "OFFSET",
    "ON",
    "OR",
    "ORDER",
    "OUTER",
    "RIGHT",
    "SELECT",
    "TABLE",
    "TABLESAMPLE",
    "THEN",
    "TRUE",
    "UNION",
    "UPDATE",
    "VALUES",
    "WHEN",
    "WHERE",
    "WINDOW",
    "WITH",
}
_SQL_FUNCTION_WORDS = {
    "ABS",
    "AVG",
    "CAST",
    "CEIL",
    "CEILING",
    "COALESCE",
    "CONCAT",
    "COUNT",
    "COUNT_BIG",
    "CURRENT_DATE",
    "CURRENT_TIME",
    "CURRENT_TIMESTAMP",
    "DATE_TRUNC",
    "DAY",
    "EXTRACT",
    "FLOOR",
    "LOWER",
    "MAX",
    "MIN",
    "MONTH",
    "NULLIF",
    "ROUND",
    "SUM",
    "TRIM",
    "UPPER",
    "YEAR",
}
_SQL_TYPE_WORDS = {
    "BIGINT",
    "BOOLEAN",
    "CHAR",
    "DATE",
    "DATETIME",
    "DECIMAL",
    "DOUBLE",
    "FLOAT",
    "FLOAT4",
    "FLOAT8",
    "INT",
    "INT2",
    "INT4",
    "INT8",
    "INTEGER",
    "NUMERIC",
    "REAL",
    "SMALLINT",
    "TEXT",
    "TIME",
    "TIMESTAMP",
    "VARCHAR",
}
_DATE_PART_WORDS = {
    "DAY",
    "DOW",
    "DOY",
    "HOUR",
    "MICROSECOND",
    "MILLISECOND",
    "MINUTE",
    "MONTH",
    "QUARTER",
    "SECOND",
    "WEEK",
    "YEAR",
}
_FALLBACK_TOKEN = re.compile(r"[a-z0-9]+")
_FALLBACK_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "by",
    "from",
    "in",
    "of",
    "show",
    "that",
    "the",
    "to",
    "with",
}
_MONTH_NAME_TO_NUMBER = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
}


def _expand_fallback_token_variants(tokens: set[str]) -> set[str]:
    expanded = set(tokens)
    for token in tokens:
        if len(token) > 4 and token.endswith("ies"):
            expanded.add(token[:-3] + "y")
        if len(token) > 4 and token.endswith("es"):
            expanded.add(token[:-2])
        if len(token) > 3 and token.endswith("s"):
            expanded.add(token[:-1])
    return expanded


def normalize_wren_sql_dialect(sql: str) -> str:
    if not sql:
        return sql

    sql = _TO_DATE_SIMPLE.sub(
        lambda match: f"CAST({match.group('expr')} AS DATE)",
        sql,
    )
    sql = _JOINED_DESC_LIMIT.sub("DESC LIMIT", sql)
    sql = _JOINED_ASC_LIMIT.sub("ASC LIMIT", sql)
    sql = _replace_order_by_aliases_with_select_expressions(sql)
    sql = _JOINED_DESC_LIMIT.sub("DESC LIMIT", sql)
    sql = _JOINED_ASC_LIMIT.sub("ASC LIMIT", sql)

    if re.search(r"(?i)\bLIMIT\s+\d+\b", sql):
        return sql

    match = _TSQL_TOP_LIMIT.match(sql)
    if not match:
        return sql

    leading_space, limit, select_body = match.groups()
    if re.search(r"(?i)\bWITH\s+TIES\b", select_body):
        return sql

    return f"{leading_space}SELECT {select_body.strip()}\nLIMIT {limit}"


def _replace_order_by_aliases_with_select_expressions(sql: str) -> str:
    select_clause = _extract_select_clause(sql)
    order_by_clause = _extract_clause(sql, "ORDER BY", ("LIMIT", "OFFSET"))
    if not select_clause or not order_by_clause:
        return sql

    alias_to_expression = {}
    for select_item in _split_sql_tokens(select_clause):
        expression, alias = _split_select_expression_alias(select_item)
        if alias and expression:
            alias_to_expression[alias] = expression

    if not alias_to_expression:
        return sql

    replaced_any = False
    rewritten_order_items = []
    for order_item in _split_sql_tokens(order_by_clause):
        match = _ORDER_BY_ALIAS_ITEM.match(order_item.strip())
        if not match:
            rewritten_order_items.append(order_item)
            continue

        alias = _unquote_identifier(match.group("identifier"))
        expression = alias_to_expression.get(alias)
        if not expression:
            rewritten_order_items.append(order_item)
            continue

        rewritten_order_items.append(f"{expression}{match.group('suffix') or ''}")
        replaced_any = True

    if not replaced_any:
        return sql

    order_by_match = re.search(
        r"(?is)\bORDER\s+BY\b\s+.*?(?=\b(?:LIMIT|OFFSET)\b|$)",
        sql,
    )
    if not order_by_match:
        return sql

    suffix = sql[order_by_match.end() :]
    if suffix and not suffix[0].isspace():
        suffix = "\n" + suffix
    replacement = "ORDER BY " + ", ".join(rewritten_order_items)
    return sql[: order_by_match.start()] + replacement + suffix


def _unquote_identifier(identifier: str) -> str:
    identifier = identifier.strip()
    if len(identifier) >= 2 and identifier[0] == "[" and identifier[-1] == "]":
        return identifier[1:-1].replace("]]", "]")
    if len(identifier) >= 2 and identifier[0] == '"' and identifier[-1] == '"':
        return identifier[1:-1].replace('""', '"')
    return identifier


def _split_qualified_identifier(identifier: str) -> list[str]:
    parts = []
    current = []
    in_double_quote = False
    in_bracket = False
    index = 0

    while index < len(identifier):
        char = identifier[index]
        nxt = identifier[index + 1] if index + 1 < len(identifier) else None

        if in_double_quote:
            current.append(char)
            if char == '"' and nxt == '"':
                current.append(nxt)
                index += 2
                continue
            if char == '"':
                in_double_quote = False
            index += 1
            continue

        if in_bracket:
            current.append(char)
            if char == "]":
                in_bracket = False
            index += 1
            continue

        if char == '"':
            current.append(char)
            in_double_quote = True
        elif char == "[":
            current.append(char)
            in_bracket = True
        elif char == ".":
            part = "".join(current).strip()
            if part:
                parts.append(part)
            current = []
        else:
            current.append(char)
        index += 1

    part = "".join(current).strip()
    if part:
        parts.append(part)

    return parts


def _normalize_identifier(identifier: str) -> str:
    return ".".join(_unquote_identifier(part) for part in _split_qualified_identifier(identifier))


def _quote_identifier(identifier: str) -> str:
    return f'"{identifier.replace(chr(34), chr(34) * 2)}"'


def _split_sql_tokens(sql: str) -> list[str]:
    tokens = []
    current = []
    in_double_quote = False

    for char in sql:
        if char == '"':
            current.append(char)
            in_double_quote = not in_double_quote
            continue
        if char == "," and not in_double_quote:
            token = "".join(current).strip()
            if token:
                tokens.append(token)
            current = []
            continue
        current.append(char)

    token = "".join(current).strip()
    if token:
        tokens.append(token)
    return tokens


def _identifier_needs_quotes(identifier: str) -> bool:
    return (
        not _SIMPLE_IDENTIFIER.fullmatch(identifier)
        or identifier.upper() in _SQL_RESERVED_WORDS
    )


def _iter_context_texts(contexts: list[Any] | None):
    if not contexts:
        return
    for context in contexts:
        yield getattr(context, "content", context)


def _clean_contract_value(value: str) -> str:
    value = value.strip().strip(",")
    if not value:
        return ""
    return _normalize_identifier(value)


def _parse_contract_values(value: str) -> list[str]:
    value = value.strip().strip(",")
    if not value:
        return []

    try:
        loaded = orjson.loads(value)
    except orjson.JSONDecodeError:
        loaded = None

    if isinstance(loaded, list):
        return [
            _clean_contract_value(str(item))
            for item in loaded
            if _clean_contract_value(str(item))
        ]

    parsed = _clean_contract_value(value)
    return [parsed] if parsed else []


def _extract_contract_schema_index(
    contexts: list[Any] | None,
) -> dict[str, set[str] | None]:
    schema_index: dict[str, set[str] | None] = {}
    if not contexts:
        return schema_index

    for context in _iter_context_texts(contexts):
        current_relation = None
        reading_columns = False

        for raw_line in str(context).splitlines():
            line = raw_line.strip()
            if not line:
                continue

            if line.startswith("sql_table_name_use_exactly:"):
                current_relation = _clean_contract_value(line.split(":", 1)[1])
                if current_relation:
                    schema_index.setdefault(current_relation, set())
                reading_columns = False
                continue

            if line.startswith("sql_column_names_use_exactly:"):
                reading_columns = True
                if current_relation:
                    columns = schema_index.setdefault(current_relation, set())
                    if columns is not None:
                        for value in _parse_contract_values(line.split(":", 1)[1]):
                            columns.add(value)
                continue

            if line.startswith("relationship_constraints_use_exactly:"):
                reading_columns = False
                continue

            if line.startswith("sql_column_name_use_exactly:"):
                if current_relation:
                    columns = schema_index.setdefault(current_relation, set())
                    if columns is not None:
                        for value in _parse_contract_values(line.split(":", 1)[1]):
                            columns.add(value)
                continue

            if reading_columns and line.startswith("-") and current_relation:
                columns = schema_index.setdefault(current_relation, set())
                if columns is not None:
                    value = _clean_contract_value(line[1:])
                    if value:
                        columns.add(value)
                continue

            if line.startswith(("END WREN SQL IDENTIFIER CONTRACT", "Only ")):
                reading_columns = False

    return schema_index


def _extract_schema_identifiers(contexts: list[Any] | None) -> list[str]:
    if not contexts:
        return []

    identifiers: list[str] = []
    seen = set()

    def add(identifier: str) -> None:
        identifier = _unquote_identifier(identifier.strip().rstrip(","))
        if not identifier or identifier.upper() in {"FOREIGN", "PRIMARY", "KEY"}:
            return
        if identifier not in seen:
            seen.add(identifier)
            identifiers.append(identifier)

    for relation, columns in _extract_schema_index(contexts).items():
        add(relation)
        if columns:
            for column in columns:
                add(column)

    for context in _iter_context_texts(contexts):
        for match in _DDL_RELATION.finditer(context):
            add(match.group("name"))

        in_table = False
        for raw_line in context.splitlines():
            line = raw_line.strip()
            if not line or line.startswith("--") or line.startswith("/*"):
                continue
            if re.search(r"\bCREATE\s+TABLE\b", line, re.IGNORECASE):
                in_table = True
                remainder = line.split("(", 1)
                if len(remainder) == 1:
                    continue
                line = remainder[1].strip()
            if not in_table:
                continue
            if line.startswith(");") or line == ")":
                in_table = False
                continue
            line = line.split("--", 1)[0].strip().rstrip(",")
            if not line or line.upper().startswith(("FOREIGN KEY", "PRIMARY KEY")):
                continue
            if line.startswith('"'):
                end = line.find('"', 1)
                while end != -1 and end + 1 < len(line) and line[end + 1] == '"':
                    end = line.find('"', end + 2)
                if end > 0:
                    add(line[: end + 1])
            else:
                add(line.split(None, 1)[0])

    return identifiers


def _extract_schema_index(contexts: list[Any] | None) -> dict[str, set[str] | None]:
    if not contexts:
        return {}

    schema_index = _extract_contract_schema_index(contexts)

    for context in _iter_context_texts(contexts):
        relation_match = _DDL_RELATION.search(context)
        if not relation_match:
            continue

        relation_name = _normalize_identifier(relation_match.group("name"))
        if re.search(r"\bCREATE\s+VIEW\b", context, re.IGNORECASE):
            schema_index.setdefault(relation_name, None)
            continue

        column_block_match = re.search(
            r"\bCREATE\s+TABLE\b[^(]*\((?P<columns>.*)\)\s*;?",
            context,
            re.IGNORECASE | re.DOTALL,
        )
        if not column_block_match:
            schema_index.setdefault(relation_name, None)
            continue

        columns = set()
        for raw_column in _split_sql_tokens(column_block_match.group("columns")):
            line = "\n".join(
                line.strip()
                for line in raw_column.splitlines()
                if line.strip()
                and not line.strip().startswith("--")
                and not line.strip().startswith("/*")
            ).strip()
            if not line:
                continue
            line = line.split("--", 1)[0].strip()
            if not line or line.startswith("/*"):
                continue
            if line.upper().startswith(("FOREIGN KEY", "PRIMARY KEY")):
                continue
            if line.startswith('"'):
                end = line.find('"', 1)
                while end != -1 and end + 1 < len(line) and line[end + 1] == '"':
                    end = line.find('"', end + 2)
                if end > 0:
                    columns.add(_unquote_identifier(line[: end + 1]))
            else:
                columns.add(_unquote_identifier(line.split(None, 1)[0]))

        existing_columns = schema_index.get(relation_name)
        if existing_columns is None:
            schema_index[relation_name] = columns
        else:
            existing_columns.update(columns)

    return schema_index


def _semantic_tokens_from_value(value: Any) -> set[str]:
    tokens: set[str] = set()
    if isinstance(value, str):
        tokens.update(_fallback_tokens(value))
    elif isinstance(value, dict):
        for nested_value in value.values():
            tokens.update(_semantic_tokens_from_value(nested_value))
    elif isinstance(value, list):
        for nested_value in value:
            tokens.update(_semantic_tokens_from_value(nested_value))
    return tokens


def _extract_semantic_context_payload(context: str) -> dict[str, Any]:
    start_marker = "WREN RETRIEVED SEMANTIC CONTEXT"
    end_marker = "WREN SQL IDENTIFIER CONTRACT"
    start_index = context.upper().find(start_marker)
    end_index = context.upper().find(end_marker, start_index)
    if start_index < 0 or end_index < 0:
        return {}
    payload_text = context[start_index + len(start_marker) : end_index].strip()
    try:
        payload = orjson.loads(payload_text)
    except orjson.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _extract_semantic_tokens_by_column(
    context: str,
) -> tuple[set[str], dict[str, set[str]], dict[str, list[str]]]:
    payload = _extract_semantic_context_payload(context)
    if not payload:
        return set(), {}, {}

    table_tokens = _semantic_tokens_from_value(
        payload.get("semantic_context_not_sql_identifiers")
    )
    table_tokens.update(_semantic_tokens_from_value(payload.get("object_type")))

    column_tokens: dict[str, set[str]] = {}
    column_sample_values: dict[str, list[str]] = {}
    for column in payload.get("columns", []) or []:
        if not isinstance(column, dict):
            continue
        column_name = column.get("sql_column_name_use_exactly")
        if not isinstance(column_name, str) or not column_name:
            continue
        tokens = _semantic_tokens_from_value(
            column.get("semantic_context_not_sql_identifier")
        )
        if tokens:
            column_tokens[column_name] = tokens
        sample_values = _extract_column_sample_values(column)
        if sample_values:
            column_sample_values[column_name] = sample_values

    return table_tokens, column_tokens, column_sample_values


def _extract_column_sample_values(column: dict[str, Any]) -> list[str]:
    values: list[str] = []

    def add(value: Any) -> None:
        if value is None:
            return
        if isinstance(value, (list, tuple, set)):
            for item in value:
                add(item)
            return
        if isinstance(value, dict):
            for item in value.values():
                add(item)
            return
        text = str(value).strip()
        if text and text.lower() not in {item.lower() for item in values}:
            values.append(text)

    for key in (
        "sample_values",
        "sample_value",
        "samples",
        "values",
        "example_values",
        "examples",
        "distinct_values",
    ):
        add(column.get(key))
    return values


def _extract_schema_details(
    contexts: list[Any] | None,
) -> dict[str, list[dict[str, str]]]:
    if not contexts:
        return {}

    schema_details: dict[str, list[dict[str, str]]] = {}

    for context in _iter_context_texts(contexts):
        relation_match = _DDL_RELATION.search(context)
        if not relation_match:
            continue

        relation_name = _unquote_identifier(relation_match.group("name"))
        table_semantic_tokens, column_semantic_tokens, column_sample_values = (
            _extract_semantic_tokens_by_column(context)
        )
        column_block_match = re.search(
            r"\bCREATE\s+TABLE\b[^(]*\((?P<columns>.*)\)\s*;?",
            context,
            re.IGNORECASE | re.DOTALL,
        )
        if not column_block_match:
            continue

        columns = []
        for raw_column in _split_sql_tokens(column_block_match.group("columns")):
            line = "\n".join(
                line.strip()
                for line in raw_column.splitlines()
                if line.strip()
                and not line.strip().startswith("--")
                and not line.strip().startswith("/*")
            ).strip()
            if not line:
                continue
            line = line.split("--", 1)[0].strip()
            if not line or line.upper().startswith(("FOREIGN KEY", "PRIMARY KEY")):
                continue

            if line.startswith('"'):
                end = line.find('"', 1)
                while end != -1 and end + 1 < len(line) and line[end + 1] == '"':
                    end = line.find('"', end + 2)
                if end <= 0:
                    continue
                name = _unquote_identifier(line[: end + 1])
                remainder = line[end + 1 :].strip()
            else:
                parts = line.split(None, 1)
                if not parts:
                    continue
                name = _unquote_identifier(parts[0])
                remainder = parts[1].strip() if len(parts) > 1 else ""

            data_type = remainder.split(None, 1)[0].upper() if remainder else ""
            columns.append(
                {
                    "name": name,
                    "data_type": data_type,
                    "semantic_tokens": column_semantic_tokens.get(name, set()),
                    "sample_values": column_sample_values.get(name, []),
                    "_table_semantic_tokens": table_semantic_tokens,
                }
            )

        schema_details[relation_name] = columns

    return schema_details


def _is_identifier_boundary(char: str | None) -> bool:
    return char is None or not (char.isalnum() or char in {"_", "$", '"'})


def _replace_identifier_outside_literals(sql: str, identifier: str) -> str:
    quoted = _quote_identifier(identifier)
    result = []
    index = 0
    in_single_quote = False
    in_double_quote = False
    in_line_comment = False
    in_block_comment = False
    length = len(sql)
    identifier_length = len(identifier)

    while index < length:
        current = sql[index]
        nxt = sql[index + 1] if index + 1 < length else None

        if in_line_comment:
            result.append(current)
            if current == "\n":
                in_line_comment = False
            index += 1
            continue
        if in_block_comment:
            result.append(current)
            if current == "*" and nxt == "/":
                result.append(nxt)
                index += 2
                in_block_comment = False
            else:
                index += 1
            continue
        if in_single_quote:
            result.append(current)
            if current == "'" and nxt == "'":
                result.append(nxt)
                index += 2
            elif current == "'":
                in_single_quote = False
                index += 1
            else:
                index += 1
            continue
        if in_double_quote:
            result.append(current)
            if current == '"' and nxt == '"':
                result.append(nxt)
                index += 2
            elif current == '"':
                in_double_quote = False
                index += 1
            else:
                index += 1
            continue

        if current == "-" and nxt == "-":
            result.append(current)
            result.append(nxt)
            index += 2
            in_line_comment = True
            continue
        if current == "/" and nxt == "*":
            result.append(current)
            result.append(nxt)
            index += 2
            in_block_comment = True
            continue
        if current == "'":
            result.append(current)
            index += 1
            in_single_quote = True
            continue
        if current == '"':
            result.append(current)
            index += 1
            in_double_quote = True
            continue

        if sql.startswith(identifier, index):
            before = sql[index - 1] if index > 0 else None
            after_index = index + identifier_length
            after = sql[after_index] if after_index < length else None
            if _is_identifier_boundary(before) and _is_identifier_boundary(after):
                result.append(quoted)
                index = after_index
                continue

        result.append(current)
        index += 1

    return "".join(result)


def _replace_bracket_identifiers(sql: str, valid_identifiers: set[str]) -> str:
    result = []
    index = 0
    in_single_quote = False
    in_double_quote = False
    length = len(sql)

    while index < length:
        current = sql[index]
        nxt = sql[index + 1] if index + 1 < length else None

        if in_single_quote:
            result.append(current)
            if current == "'" and nxt == "'":
                result.append(nxt)
                index += 2
            elif current == "'":
                in_single_quote = False
                index += 1
            else:
                index += 1
            continue
        if in_double_quote:
            result.append(current)
            if current == '"' and nxt == '"':
                result.append(nxt)
                index += 2
            elif current == '"':
                in_double_quote = False
                index += 1
            else:
                index += 1
            continue
        if current == "'":
            result.append(current)
            in_single_quote = True
            index += 1
            continue
        if current == '"':
            result.append(current)
            in_double_quote = True
            index += 1
            continue
        if current == "[":
            end = sql.find("]", index + 1)
            if end > index:
                identifier = sql[index + 1 : end]
                if identifier in valid_identifiers:
                    result.append(_quote_identifier(identifier))
                    index = end + 1
                    continue
        result.append(current)
        index += 1

    return "".join(result)


def _extract_sql_grounding(sql: str) -> dict[str, Any]:
    cte_names = {
        _normalize_identifier(match.group("name"))
        for match in _CTE_REFERENCE.finditer(sql)
    }
    relation_references = []
    alias_to_relation = {}

    for match in _RELATION_REFERENCE.finditer(sql):
        if _is_extract_from_clause(sql, match.start()):
            continue
        relation = _unquote_identifier(match.group("name"))
        if relation.upper() in {"UNNEST", "LATERAL"}:
            continue
        alias = match.group("alias")
        alias = _normalize_identifier(alias) if alias else relation
        if alias.upper() in _SQL_OBJECT_ALIAS_STOP_WORDS:
            alias = relation
        relation_references.append(relation)
        alias_to_relation[alias] = relation
        alias_to_relation[relation] = relation

    qualified_columns = [
        (
            _normalize_identifier(match.group("qualifier")),
            _normalize_identifier(match.group("column")),
        )
        for match in _QUALIFIED_COLUMN.finditer(sql)
    ]

    return {
        "cte_names": cte_names,
        "relation_references": relation_references,
        "alias_to_relation": alias_to_relation,
        "qualified_columns": qualified_columns,
    }


def _is_extract_from_clause(sql: str, from_start: int) -> bool:
    prefix = sql[:from_start]
    last_open = prefix.rfind("(")
    if last_open == -1 or prefix.rfind(")") > last_open:
        return False

    before_open = prefix[:last_open].rstrip()
    return before_open.upper().endswith("EXTRACT")


def _strip_string_literals(sql: str) -> str:
    return _SINGLE_QUOTED_LITERAL.sub("''", sql)


def _extract_clause(sql: str, clause: str, end_clauses: tuple[str, ...]) -> str:
    end_pattern = "|".join(re.escape(end_clause) for end_clause in end_clauses)
    pattern = re.compile(
        rf"(?is)\b{re.escape(clause)}\b\s+(?P<body>.*?)(?=\b(?:{end_pattern})\b|$)"
    )
    match = pattern.search(sql)
    return match.group("body").strip() if match else ""


def _extract_select_clause(sql: str) -> str:
    match = re.search(r"(?is)\bSELECT\b\s+(?P<body>.*?)(?=\bFROM\b)", sql)
    return match.group("body").strip() if match else ""


def _split_select_expression_alias(expression: str) -> tuple[str, str | None]:
    as_match = re.search(
        r"(?is)\s+AS\s+(?P<alias>\"[^\"]+\"|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*)\s*$",
        expression,
    )
    if as_match:
        return expression[: as_match.start()].strip(), _unquote_identifier(
            as_match.group("alias")
        )

    return expression, None


def _extract_output_aliases(select_clause: str) -> set[str]:
    aliases = set()
    for expression in _split_sql_tokens(select_clause):
        _, alias = _split_select_expression_alias(expression)
        if alias:
            aliases.add(alias)
    return aliases


def _iter_unqualified_identifier_candidates(expression: str):
    stripped = _strip_string_literals(expression)

    for match in _UNQUALIFIED_QUOTED_IDENTIFIER.finditer(stripped):
        yield _unquote_identifier(f'"{match.group("name")}"')

    without_quoted = _UNQUALIFIED_QUOTED_IDENTIFIER.sub(" ", stripped)
    for match in _UNQUALIFIED_BARE_IDENTIFIER.finditer(without_quoted):
        name = match.group("name")
        following = without_quoted[match.end() :].lstrip()
        if following.startswith("("):
            continue
        yield name


def _sql_mentions_identifier(sql: str, identifier: str) -> bool:
    stripped = _strip_string_literals(sql)
    quoted_identifier = re.escape(_quote_identifier(identifier))
    bracket_identifier = re.escape(f"[{identifier}]")
    bare_identifier = re.escape(identifier)
    return bool(
        re.search(rf'(?<![\w$]){quoted_identifier}(?![\w$])', stripped)
        or re.search(rf"(?<![\w$]){bracket_identifier}(?![\w$])", stripped)
        or re.search(rf"(?<![\w$\".]){bare_identifier}(?![\w$])", stripped)
    )


def _sql_mentions_literal_value(sql: str, values: list[str]) -> bool:
    lowered_sql = sql.lower()
    for value in values:
        cleaned = _clean_filter_value(value)
        if cleaned and _quote_literal(cleaned.lower()) in lowered_sql:
            return True
    return False


def _extract_sql_string_literals(sql: str) -> list[str]:
    literals = []
    for match in _SINGLE_QUOTED_LITERAL.finditer(sql):
        literal = match.group(0)[1:-1].replace("''", "'")
        if literal:
            literals.append(literal)
    return literals


def _extract_column_filter_literals(sql: str, column_name: str) -> list[str]:
    stripped = _strip_string_literals(sql)
    quoted_column = re.escape(_quote_identifier(column_name))
    bare_column = re.escape(column_name)
    column_pattern = rf"(?:{quoted_column}|(?<![\w$\".]){bare_column}(?![\w$]))"
    literals = []
    for match in re.finditer(column_pattern, stripped):
        window = sql[match.start() : match.start() + 240]
        literals.extend(_extract_sql_string_literals(window))
    return literals


def _validate_literal_values_against_samples(
    sql: str,
    schema_details: dict[str, list[dict[str, str]]],
    grounding: dict[str, Any],
) -> str | None:
    referenced_relations = {
        relation
        for relation in grounding["relation_references"]
        if relation not in grounding["cte_names"]
    }
    for relation in referenced_relations:
        for column in schema_details.get(relation, []):
            sample_values = column.get("sample_values") or []
            if not sample_values:
                continue
            literals = _extract_column_filter_literals(sql, column["name"])
            if not literals:
                continue
            sample_tokens = _sample_value_tokens(column)
            sample_lowers = {str(value).lower() for value in sample_values}
            for literal in literals:
                literal_tokens = _fallback_tokens(literal)
                if literal.lower() in sample_lowers or literal_tokens & sample_tokens:
                    continue
                return (
                    "Schema grounding failed. The generated SQL filters column "
                    f"{column['name']} with a literal value not found in that "
                    "column's verified sample values."
                )
    return None


def _validate_unqualified_columns_for_single_relation(
    sql: str,
    schema_index: dict[str, set[str] | None],
    grounding: dict[str, Any],
) -> str | None:
    real_relations = [
        relation
        for relation in grounding["relation_references"]
        if relation not in grounding["cte_names"]
    ]
    if grounding["cte_names"]:
        return None

    unique_real_relations = list(dict.fromkeys(real_relations))
    if len(unique_real_relations) != 1:
        return None

    relation = unique_real_relations[0]
    valid_columns = schema_index.get(relation)
    if valid_columns is None:
        return None

    select_clause = _extract_select_clause(sql)
    output_aliases = _extract_output_aliases(select_clause)
    ignored_identifiers = (
        set(schema_index)
        | set(grounding["alias_to_relation"])
        | set(grounding["cte_names"])
        | output_aliases
    )

    clause_expressions = []
    for expression in _split_sql_tokens(select_clause):
        expression, _ = _split_select_expression_alias(expression)
        clause_expressions.append(expression)
    clause_expressions.extend(
        filter(
            None,
            [
                _extract_clause(
                    sql,
                    "WHERE",
                    ("GROUP BY", "HAVING", "ORDER BY", "LIMIT", "OFFSET"),
                ),
                _extract_clause(
                    sql,
                    "GROUP BY",
                    ("HAVING", "ORDER BY", "LIMIT", "OFFSET"),
                ),
                _extract_clause(
                    sql,
                    "HAVING",
                    ("ORDER BY", "LIMIT", "OFFSET"),
                ),
                _extract_clause(sql, "ORDER BY", ("LIMIT", "OFFSET")),
            ],
        )
    )

    invalid_columns = set()
    for expression in clause_expressions:
        for identifier in _iter_unqualified_identifier_candidates(expression):
            upper_identifier = identifier.upper()
            if (
                upper_identifier in _SQL_RESERVED_WORDS
                or upper_identifier in _SQL_FUNCTION_WORDS
                or upper_identifier in _SQL_TYPE_WORDS
                or upper_identifier in _DATE_PART_WORDS
                or identifier in ignored_identifiers
                or identifier in valid_columns
            ):
                continue
            invalid_columns.add(identifier)

    if not invalid_columns:
        return None

    return (
        "Schema grounding failed. The SQL references unqualified columns that "
        f"are not present in verified table or view {relation}: "
        f"{', '.join(sorted(invalid_columns))}. Use only verified columns: "
        f"{', '.join(sorted(valid_columns))}."
    )


def validate_sql_against_contexts(
    sql: str,
    contexts: list[Any] | None = None,
) -> str | None:
    schema_index = _extract_schema_index(contexts)
    if not schema_index:
        return None

    valid_relations = set(schema_index)
    grounding = _extract_sql_grounding(sql)
    cte_names = grounding["cte_names"]

    shadowed_relations = sorted(cte_names & valid_relations)
    if shadowed_relations:
        return (
            "Schema grounding failed. The SQL creates CTEs with names that already "
            f"belong to verified schema objects: {', '.join(shadowed_relations)}. "
            "Do not create dummy CTEs for schema objects; use the verified tables or views directly."
        )

    invalid_relations = sorted(
        {
            relation
            for relation in grounding["relation_references"]
            if relation not in valid_relations and relation not in cte_names
        }
    )
    if invalid_relations:
        return (
            "Schema grounding failed. The SQL references tables or views that are not "
            f"in the retrieved schema for the active question: {', '.join(invalid_relations)}. "
            f"Use only verified tables or views: {', '.join(sorted(valid_relations))}."
        )

    alias_to_relation = grounding["alias_to_relation"]
    for qualifier, column in grounding["qualified_columns"]:
        relation = alias_to_relation.get(qualifier)
        if not relation or relation in cte_names:
            continue
        valid_columns = schema_index.get(relation)
        if valid_columns is None:
            continue
        if column not in valid_columns:
            return (
                "Schema grounding failed. The SQL references column "
                f"{qualifier}.{column}, but column {column} is not present in verified "
                f"table or view {relation}. Use only verified columns: "
                f"{', '.join(sorted(valid_columns))}."
            )

    unqualified_column_error = _validate_unqualified_columns_for_single_relation(
        sql,
        schema_index,
        grounding,
    )
    if unqualified_column_error:
        return unqualified_column_error

    return None


def _extract_sql_from_value(value: Any) -> str | None:
    if value is None:
        return None

    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None

        try:
            parsed = orjson.loads(text)
        except orjson.JSONDecodeError:
            return text if _SQL_START.search(text) else None

        return _extract_sql_from_value(parsed)

    if isinstance(value, dict):
        for key in ("sql", "query", "code"):
            extracted = _extract_sql_from_value(value.get(key))
            if extracted:
                return extracted

        extracted = _extract_sql_from_value(value.get("arguments"))
        if extracted:
            return extracted

        return None

    if isinstance(value, list):
        for item in value:
            extracted = _extract_sql_from_value(item)
            if extracted:
                return extracted

    return None


def _extract_generation_sql(generation_result: str | None) -> str | None:
    if not generation_result:
        return None

    extracted = _extract_sql_from_value(generation_result)
    if extracted:
        return extracted

    text = generation_result.strip()
    return text if _SQL_START.search(text) else None


def validate_sql_semantic_coverage(
    sql: str,
    query: str | None,
    contexts: list[Any] | None = None,
) -> str | None:
    if not sql or not query:
        return None

    raw_query_tokens = _fallback_tokens(query)

    schema_details = _extract_schema_details(contexts)
    if not schema_details:
        return None

    grounding = _extract_sql_grounding(sql)
    referenced_relations = {
        relation
        for relation in grounding["relation_references"]
        if relation not in grounding["cte_names"]
    }
    if not referenced_relations:
        return None

    schema_tokens = set()
    for relation in referenced_relations:
        columns = schema_details.get(relation)
        if columns is not None:
            schema_tokens.update(_schema_tokens_for_table(relation, columns))

    required_tokens = _schema_derived_query_tokens(raw_query_tokens, schema_details)
    unsupported_tokens = _unsupported_query_tokens(raw_query_tokens, schema_details)
    if unsupported_tokens:
        return (
            "Schema grounding failed. The retrieved schema metadata does not "
            "support these non-operational question term(s): "
            f"{', '.join(sorted(unsupported_tokens))}. "
            "Select a project with matching schema metadata or ask a supported "
            "question."
        )

    missing_concepts = sorted(required_tokens - schema_tokens)
    if missing_concepts:
        return (
            "Schema grounding failed. The generated SQL uses verified identifiers, "
            "but the selected table or view does not cover these schema-backed "
            f"question tokens: {', '.join(missing_concepts)}. Use only schema "
            "objects whose metadata supports the requested terms, or return no "
            "SQL if the active project does not contain them."
        )

    if _is_average_metric_intent(raw_query_tokens):
        if not re.search(r"(?is)\bAVG\s*\(", sql):
            return (
                "Schema grounding failed. The question asks for an average "
                "metric, but the generated SQL does not compute AVG over a "
                "verified measure."
            )
        if re.search(r"(?is)\bCOUNT\s*\(", sql) and not re.search(
            r"(?is)\bAVG\s*\(",
            sql,
        ):
            return (
                "Schema grounding failed. The question asks for an average "
                "metric, but the generated SQL computes a count."
            )

    if _is_distribution_metric_intent(raw_query_tokens):
        if not re.search(r"(?is)\bCOUNT\s*\(", sql) or not re.search(
            r"(?is)\bGROUP\s+BY\b",
            sql,
        ):
            return (
                "Schema grounding failed. The question asks for a distribution "
                "or breakdown, but the generated SQL does not compute grouped "
                "counts."
            )

    return _validate_literal_values_against_samples(sql, schema_details, grounding)


def unsupported_schema_message(
    query: str | None,
    contexts: list[Any] | None = None,
) -> str | None:
    if not query:
        return None
    query_tokens = _fallback_tokens(query)
    schema_details = _extract_schema_details(contexts)
    if not schema_details:
        return None
    required_tokens = _schema_derived_query_tokens(query_tokens, schema_details)
    unsupported_tokens = _unsupported_query_tokens(query_tokens, schema_details)
    if unsupported_tokens:
        return (
            "No retrieved table or view in the active project contains verified "
            "schema metadata for all requested non-operational term(s): "
            f"{', '.join(sorted(unsupported_tokens))}. Select a project with "
            "matching fields, add schema descriptions/sample values, or ask a "
            "question supported by the selected project's schema."
        )

    table_tokens = _schema_tokens_by_table(schema_details)
    if required_tokens and any(
        required_tokens <= tokens for tokens in table_tokens.values()
    ):
        return None

    if not required_tokens and not unsupported_tokens:
        return None
    detail_tokens = sorted(required_tokens or unsupported_tokens)
    return (
        "No retrieved table or view in the active project contains verified "
        "schema metadata for all requested non-operational term(s): "
        f"{', '.join(detail_tokens)}. Select a project with matching fields, "
        "add schema descriptions/sample values, or ask a question supported by "
        "the selected project's schema."
    )


def unsupported_schema_generation_result(
    query: str | None,
    contexts: list[Any] | None = None,
    data_source: str = "",
) -> dict[str, Any] | None:
    message = unsupported_schema_message(query, contexts=contexts)
    if not message:
        return None
    return {
        "valid_generation_result": {},
        "invalid_generation_result": {
            "sql": "",
            "original_sql": "",
            "type": "NO_RELEVANT_SQL",
            "error": message,
            "correlation_id": "",
            "data_source": data_source,
        },
    }


def normalize_sql_with_schema_identifiers(
    sql: str,
    contexts: list[Any] | None = None,
) -> str:
    schema_identifiers = set(_extract_schema_identifiers(contexts))
    identifiers = [
        identifier
        for identifier in schema_identifiers
        if "." not in identifier and _identifier_needs_quotes(identifier)
    ]
    sql = _replace_bracket_identifiers(sql, schema_identifiers)
    for identifier in sorted(identifiers, key=len, reverse=True):
        sql = _replace_identifier_outside_literals(sql, identifier)
    return sql


def _fallback_tokens(value: Any) -> set[str]:
    if value is None:
        return set()
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", str(value))
    tokens = {
        token
        for token in _FALLBACK_TOKEN.findall(text.lower())
        if token not in _FALLBACK_STOPWORDS
    }
    return _expand_fallback_token_variants(tokens)


def _column_business_tokens(column: dict[str, Any]) -> set[str]:
    tokens = _fallback_tokens(column["name"])
    tokens.update(column.get("semantic_tokens") or set())
    return tokens


def _table_business_tokens(
    table_name: str,
    columns: list[dict[str, Any]],
) -> set[str]:
    tokens = _fallback_tokens(table_name)
    for column in columns:
        tokens.update(column.get("_table_semantic_tokens") or set())
    return tokens


def _is_numeric_type(data_type: str) -> bool:
    return data_type.upper() in {
        "BIGINT",
        "DECIMAL",
        "DOUBLE",
        "FLOAT",
        "FLOAT4",
        "FLOAT8",
        "INT",
        "INT2",
        "INT4",
        "INT8",
        "INTEGER",
        "NUMERIC",
        "REAL",
        "SMALLINT",
    }


def _is_date_type(data_type: str) -> bool:
    return data_type.upper() in {
        "DATE",
        "DATETIME",
        "DATETIME2",
        "SMALLDATETIME",
        "TIME",
        "TIMESTAMP",
        "TIMESTAMPTZ",
        "TIMESTAMP_LTZ",
        "TIMESTAMP_NTZ",
        "TIMESTAMP_TZ",
    }


_RATE_METRIC_TOKENS = {"rate", "ratio", "percent", "percentage"}
_COUNT_METRIC_TOKENS = {"count", "many", "most", "number", "total"}
_AVERAGE_METRIC_TOKENS = {"average", "avg", "mean"}
_DISTRIBUTION_METRIC_TOKENS = {"distribution", "breakdown"}
_SUM_METRIC_TOKENS = {"sum", "total"}
_MIN_METRIC_TOKENS = {"bottom", "least", "lowest", "min", "minimum", "smallest"}
_MAX_METRIC_TOKENS = {"greatest", "highest", "largest", "max", "maximum", "most", "top"}
_LATEST_METRIC_TOKENS = {"latest", "newest", "recent"}
_NULL_CHECK_TOKENS = {"blank", "empty", "missing", "null"}
_GENERIC_SCHEMA_INTENT_TOKENS = {
    "a",
    "across",
    "all",
    "an",
    "and",
    "as",
    "ascending",
    "associated",
    "association",
    "average",
    "avg",
    "between",
    "bottom",
    "breakdown",
    "bucket",
    "buckets",
    "by",
    "compare",
    "count",
    "date",
    "day",
    "descending",
    "distribution",
    "each",
    "for",
    "from",
    "group",
    "grouped",
    "has",
    "have",
    "highest",
    "in",
    "latest",
    "least",
    "list",
    "lowest",
    "many",
    "max",
    "maximum",
    "me",
    "mean",
    "min",
    "minimum",
    "month",
    "monthly",
    "most",
    "newest",
    "number",
    "of",
    "ordered",
    "per",
    "please",
    "quarter",
    "recent",
    "record",
    "records",
    "row",
    "rows",
    "show",
    "smallest",
    "sort",
    "sorted",
    "sum",
    "the",
    "to",
    "top",
    "total",
    "week",
    "which",
    "with",
    "without",
    "year",
}
_GENERIC_SCHEMA_INTENT_TOKENS.update(_MONTH_NAME_TO_NUMBER.keys())


def _is_rate_metric_intent(raw_query_tokens: set[str]) -> bool:
    return bool(raw_query_tokens & _RATE_METRIC_TOKENS)


def _is_average_metric_intent(raw_query_tokens: set[str]) -> bool:
    return bool(raw_query_tokens & _AVERAGE_METRIC_TOKENS)


def _is_distribution_metric_intent(raw_query_tokens: set[str]) -> bool:
    return bool(raw_query_tokens & _DISTRIBUTION_METRIC_TOKENS)


def _is_rate_like_column(column: dict[str, str]) -> bool:
    return bool(_fallback_tokens(column["name"]) & (_RATE_METRIC_TOKENS | {"score"}))


def _is_identifier_like_column(column: dict[str, str]) -> bool:
    tokens = _fallback_tokens(column["name"])
    return bool(tokens) and tokens <= {"id", "identifier", "key", "uuid"}


def _quote_joined(identifiers: list[str]) -> str:
    return ", ".join(_quote_identifier(identifier) for identifier in identifiers)


def _schema_tokens_for_table(table_name: str, columns: list[dict[str, str]]) -> set[str]:
    tokens = _table_business_tokens(table_name, columns)
    for column in columns:
        tokens.update(_column_business_tokens(column))
        tokens.update(_sample_value_tokens(column))
    return tokens


def _schema_tokens_by_table(
    schema_details: dict[str, list[dict[str, str]]],
) -> dict[str, set[str]]:
    return {
        table_name: _schema_tokens_for_table(table_name, columns)
        for table_name, columns in schema_details.items()
    }


def _schema_derived_query_tokens(
    query_tokens: set[str],
    schema_details: dict[str, list[dict[str, str]]],
) -> set[str]:
    schema_tokens = set().union(*_schema_tokens_by_table(schema_details).values())
    return {
        token
        for token in query_tokens
        if token not in _GENERIC_SCHEMA_INTENT_TOKENS
        and not token.isdigit()
        and token in schema_tokens
    }


def _unsupported_query_tokens(
    query_tokens: set[str],
    schema_details: dict[str, list[dict[str, str]]],
) -> set[str]:
    schema_tokens = set().union(*_schema_tokens_by_table(schema_details).values())
    return {
        token
        for token in query_tokens
        if token not in _GENERIC_SCHEMA_INTENT_TOKENS
        and not token.isdigit()
        and token not in schema_tokens
    }


def _table_covers_requested_concepts(
    table_name: str,
    columns: list[dict[str, str]],
    concept_tokens: set[str],
) -> bool:
    required_tokens = {
        token
        for token in concept_tokens
        if token not in _GENERIC_SCHEMA_INTENT_TOKENS
    }
    if not required_tokens:
        return True
    schema_tokens = _schema_tokens_for_table(table_name, columns)
    return required_tokens <= schema_tokens


def _choose_fallback_table(
    query_tokens: set[str],
    schema_details: dict[str, list[dict[str, str]]],
    concept_tokens: set[str] | None = None,
) -> tuple[str, list[dict[str, str]]] | None:
    concept_tokens = concept_tokens or query_tokens
    required_tokens = _schema_derived_query_tokens(concept_tokens, schema_details)
    scored_tables = []
    for table_name, columns in schema_details.items():
        table_tokens = _table_business_tokens(table_name, columns)
        column_token_union = set()
        score = len(query_tokens & table_tokens) * 8
        for column in columns:
            column_tokens = _column_business_tokens(column)
            sample_tokens = _sample_value_tokens(column)
            column_token_union.update(column_tokens)
            column_token_union.update(sample_tokens)
            score += len(query_tokens & column_tokens) * 10
            score += len(query_tokens & sample_tokens) * 6
            if _is_numeric_type(column["data_type"]):
                score += len(query_tokens & column_tokens) * 2
            if _is_date_type(column["data_type"]):
                score += 2

        table_schema_tokens = _schema_tokens_for_table(table_name, columns)
        if required_tokens and not required_tokens <= table_schema_tokens:
            continue
        score += len(required_tokens & table_schema_tokens) * 20

        if score > 0:
            scored_tables.append((score, table_name, columns))

    if not scored_tables:
        return None

    scored_tables.sort(key=lambda item: (-item[0], item[1]))
    return scored_tables[0][1], scored_tables[0][2]


def _choose_column_by_tokens(
    columns: list[dict[str, str]],
    required_tokens: set[str],
    numeric: bool | None = None,
    date: bool | None = None,
) -> str | None:
    candidates = []
    for column in columns:
        column_tokens = _column_business_tokens(column)
        if numeric is True and not _is_numeric_type(column["data_type"]):
            continue
        if date is True and not (
            _is_date_type(column["data_type"])
            or column_tokens & {"date", "day", "month", "time", "year"}
        ):
            continue
        score = len(required_tokens & column_tokens) * 10
        if date is True and _is_date_type(column["data_type"]):
            score += 20
        if required_tokens and required_tokens.issubset(column_tokens):
            score += 30
        if score > 0:
            candidates.append((score, column["name"]))
    if not candidates:
        return None
    candidates.sort(key=lambda item: (-item[0], item[1]))
    return candidates[0][1]


def _column_score_for_tokens(
    column: dict[str, str],
    required_tokens: set[str],
    numeric: bool | None = None,
) -> int:
    column_tokens = _fallback_tokens(column["name"])
    column_tokens.update(column.get("semantic_tokens") or set())
    if numeric is True and not _is_numeric_type(column["data_type"]):
        return 0
    score = len(required_tokens & column_tokens) * 10
    if required_tokens and required_tokens.issubset(column_tokens):
        score += 30
    return score


def _choose_ranked_column_by_tokens(
    columns: list[dict[str, str]],
    required_tokens: set[str],
    numeric: bool | None = None,
) -> dict[str, str] | None:
    candidates = [
        (_column_score_for_tokens(column, required_tokens, numeric=numeric), column)
        for column in columns
    ]
    candidates = [(score, column) for score, column in candidates if score > 0]
    if not candidates:
        return None
    candidates.sort(key=lambda item: (-item[0], item[1]["name"]))
    return candidates[0][1]


def _sample_value_tokens(column: dict[str, Any]) -> set[str]:
    tokens: set[str] = set()
    for value in column.get("sample_values") or []:
        tokens.update(_fallback_tokens(value))
    return tokens


def _column_supports_filter_values(
    column: dict[str, Any],
    values: list[str],
) -> bool:
    cleaned_values = [value for value in (_clean_filter_value(value) for value in values) if value]
    if not cleaned_values:
        return True

    column_tokens = _column_business_tokens(column)
    sample_tokens = _sample_value_tokens(column)
    value_tokens: set[str] = set()
    for value in cleaned_values:
        value_tokens.update(_fallback_tokens(value))

    if value_tokens & sample_tokens:
        return True
    if value_tokens & column_tokens:
        return True
    return False


def _filter_predicate_for_values(
    column: dict[str, str],
    values: list[str],
) -> str:
    cleaned_values = [
        value for value in (_clean_filter_value(value) for value in values) if value
    ]
    if not cleaned_values:
        return _non_missing_value_predicate(column)

    column_tokens = _column_business_tokens(column)
    value_tokens: set[str] = set()
    for value in cleaned_values:
        value_tokens.update(_fallback_tokens(value))

    return _value_match_predicate(column, cleaned_values[0], cleaned_values[1:])


def _choose_filter_column_for_values(
    columns: list[dict[str, str]],
    values: list[str],
) -> dict[str, str] | None:
    candidates: list[tuple[int, dict[str, str]]] = []

    for column in columns:
        column_tokens = _column_business_tokens(column)
        if not _column_supports_filter_values(column, values):
            continue
        value_tokens = {
            token
            for value in values
            for token in _fallback_tokens(value)
        }
        score = len(column_tokens & value_tokens) * 10
        score += len(_sample_value_tokens(column) & value_tokens) * 20
        if score > 0:
            candidates.append((score, column))

    if not candidates:
        return None
    candidates.sort(key=lambda item: (-item[0], item[1]["name"]))
    return candidates[0][1]


def _choose_temporal_column(
    query_tokens: set[str],
    columns: list[dict[str, str]],
) -> str | None:
    candidates = []
    for column in columns:
        column_tokens = _column_business_tokens(column)
        if not _is_date_type(column["data_type"]):
            continue
        score = len(query_tokens & column_tokens) * 12
        score += 20
        if score > 0:
            candidates.append((score, column["name"]))

    if not candidates:
        return None
    candidates.sort(key=lambda item: (-item[0], item[1]))
    return candidates[0][1]


def _order_by_phrase_tokens(query: str) -> set[str]:
    match = re.search(
        r"(?is)\b(?:order(?:ed)?|sort(?:ed)?)\s+by\s+(?P<value>[A-Za-z0-9_ /-]+)",
        query,
    )
    if not match:
        return set()
    return _fallback_tokens(match.group("value"))


def _choose_order_by_column(
    query: str,
    query_tokens: set[str],
    columns: list[dict[str, str]],
) -> str | None:
    order_tokens = _order_by_phrase_tokens(query)
    if not order_tokens:
        return None

    column = _choose_ranked_column_by_tokens(columns, order_tokens)
    return column["name"] if column else None


def _choose_dimension_column(
    query_tokens: set[str],
    columns: list[dict[str, str]],
) -> str | None:
    columns = _choose_dimension_columns(query_tokens, columns, max_columns=1)
    return columns[0] if columns else None


def _choose_dimension_columns(
    query_tokens: set[str],
    columns: list[dict[str, str]],
    max_columns: int = 3,
) -> list[str]:
    candidates = []
    filtered_query_tokens = query_tokens - _GENERIC_SCHEMA_INTENT_TOKENS
    for index, column in enumerate(columns):
        if _is_numeric_type(column["data_type"]):
            continue
        column_tokens = _column_business_tokens(column)
        score = len(filtered_query_tokens & column_tokens) * 10
        if score > 0:
            candidates.append((score, index, column["name"]))
    candidates.sort(key=lambda item: (-item[0], item[1]))
    return [name for _, _, name in candidates[:max_columns]]


def _choose_missing_value_column(
    query_tokens: set[str],
    columns: list[dict[str, str]],
) -> dict[str, str] | None:
    return _choose_ranked_column_by_tokens(
        columns,
        query_tokens - (_GENERIC_SCHEMA_INTENT_TOKENS | _NULL_CHECK_TOKENS),
    )


def _choose_count_subject_column(
    query_tokens: set[str],
    columns: list[dict[str, str]],
) -> dict[str, str] | None:
    column = _choose_ranked_column_by_tokens(
        columns,
        query_tokens - _GENERIC_SCHEMA_INTENT_TOKENS,
    )
    if column:
        return column
    for column in columns:
        if not _is_numeric_type(column["data_type"]) and not _is_rate_like_column(column):
            return column
    return columns[0] if columns else None


def _choose_average_measure_column(
    query_tokens: set[str],
    columns: list[dict[str, str]],
) -> dict[str, str] | None:
    filtered_tokens = query_tokens - _GENERIC_SCHEMA_INTENT_TOKENS
    measure_candidates = [
        column for column in columns if not _is_identifier_like_column(column)
    ]
    column = _choose_ranked_column_by_tokens(
        measure_candidates,
        filtered_tokens,
        numeric=True,
    )
    if column:
        return column
    numeric_columns = [
        column
        for column in columns
        if _is_numeric_type(column["data_type"])
        and not _is_identifier_like_column(column)
    ]
    return numeric_columns[0] if len(numeric_columns) == 1 else None


def _is_text_type(data_type: str) -> bool:
    return data_type.upper() in {"CHAR", "NCHAR", "NVARCHAR", "STRING", "TEXT", "VARCHAR"}


def _is_boolean_type(data_type: str) -> bool:
    return data_type.upper() in {"BIT", "BOOL", "BOOLEAN"}


def _missing_value_predicate(column: dict[str, str]) -> str:
    quoted_column = _quote_identifier(column["name"])
    if _is_text_type(column["data_type"]):
        return f"({quoted_column} IS NULL OR {quoted_column} = '')"
    return f"{quoted_column} IS NULL"


def _non_missing_value_predicate(column: dict[str, str]) -> str:
    quoted_column = _quote_identifier(column["name"])
    if _is_text_type(column["data_type"]):
        return f"({quoted_column} IS NOT NULL AND {quoted_column} <> '')"
    return f"{quoted_column} IS NOT NULL"


def _aggregate_for_measure(measure_column: str) -> tuple[str, str]:
    tokens = _fallback_tokens(measure_column)
    if tokens & {"rate", "score", "percent", "percentage"}:
        return "AVG", "average_value"
    return "SUM", "total_value"


def _select_listing_columns(
    query_tokens: set[str],
    columns: list[dict[str, str]],
    measure_column: str | None = None,
    date_column: str | None = None,
    max_columns: int = 6,
) -> list[str]:
    scored_columns: list[tuple[int, int, str]] = []
    for index, column in enumerate(columns):
        name = column["name"]
        tokens = _column_business_tokens(column)
        score = len(query_tokens & tokens) * 10
        if name == date_column:
            score += 35
        if name == measure_column:
            score += 12
        if score > 0:
            scored_columns.append((score, index, name))

    scored_columns.sort(key=lambda item: (-item[0], item[1]))
    selected = []
    for _, _, name in scored_columns:
        if name not in selected:
            selected.append(name)
        if len(selected) >= max_columns:
            break
    if not selected and columns:
        selected = [column["name"] for column in columns[:max_columns]]
    return selected


def _fallback_limit(query: str) -> int | None:
    match = re.search(r"(?i)\btop\s+(\d+)\b", query)
    return int(match.group(1)) if match else None


def _fallback_month_filter(query: str) -> tuple[int, int] | None:
    tokens = _fallback_tokens(query)
    for month_name, month_number in _MONTH_NAME_TO_NUMBER.items():
        if month_name in tokens:
            return datetime.now(timezone.utc).year, month_number
    return None


def _grouping_phrase_tokens(query: str) -> set[str]:
    query = re.sub(
        r"(?is)\b(?:order(?:ed)?|sort(?:ed)?)\s+by\s+[A-Za-z0-9_ /-]+",
        "",
        query,
    )
    match = re.search(
        r"(?is)\b(?:grouped\s+by|group\s+by|by)\s+(?P<value>[A-Za-z0-9_ /-]+)",
        query,
    )
    if not match:
        return set()
    return _fallback_tokens(match.group("value"))


def _current_year_where_clause(
    date_column: str | None,
    columns: list[dict[str, str]],
    query_tokens: set[str],
) -> str:
    if not date_column or not {"this", "year"}.issubset(query_tokens):
        return ""

    column = next((column for column in columns if column["name"] == date_column), None)
    if not column:
        return ""

    current_year = datetime.now(timezone.utc).year
    quoted_column = _quote_identifier(date_column)
    if _is_numeric_type(column["data_type"]) or _fallback_tokens(date_column) & {"year"}:
        return f"\nWHERE {quoted_column} = {current_year}"
    if _is_date_type(column["data_type"]) or _fallback_tokens(date_column) & {
        "date",
        "day",
        "month",
        "time",
    }:
        return f"\nWHERE EXTRACT(YEAR FROM {quoted_column}) = {current_year}"
    return ""


def _quote_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _value_match_predicate(
    column: dict[str, str] | str,
    value: str,
    alternate_values: list[str] | None = None,
) -> str:
    column_name = column["name"] if isinstance(column, dict) else column
    quoted_column = _quote_identifier(column_name)
    values = []
    for candidate in [value] + (alternate_values or []):
        cleaned = _clean_filter_value(candidate)
        if cleaned and cleaned.lower() not in {item.lower() for item in values}:
            values.append(cleaned)

    if not values:
        return f"{quoted_column} IS NOT NULL"

    if isinstance(column, dict) and _is_text_type(column["data_type"]):
        lowered_values = [_quote_literal(candidate.lower()) for candidate in values]
        if len(lowered_values) == 1:
            return f"LOWER({quoted_column}) = {lowered_values[0]}"
        return f"LOWER({quoted_column}) IN ({', '.join(lowered_values)})"

    return f"{quoted_column} = {_quote_literal(values[0])}"


def _clean_filter_value(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip(" \t\r\n'\"`.,;:()[]{}")
    return value or None


def _query_content_tokens(query_tokens: set[str]) -> set[str]:
    return {
        token
        for token in query_tokens
        if token not in _GENERIC_SCHEMA_INTENT_TOKENS
        and token not in _MONTH_NAME_TO_NUMBER
    }


def _has_grouping_intent(query: str, query_tokens: set[str]) -> bool:
    query_without_ordering = re.sub(
        r"(?is)\b(?:order(?:ed)?|sort(?:ed)?)\s+by\s+[A-Za-z0-9_ /-]+",
        "",
        query,
    )
    return bool(
        _is_distribution_metric_intent(query_tokens)
        or query_tokens & {"group", "grouped", "per"}
        or re.search(r"(?i)\bby\s+[A-Za-z0-9_ -]+\b", query_without_ordering)
    )


def _has_count_intent(query_tokens: set[str]) -> bool:
    return bool(query_tokens & _COUNT_METRIC_TOKENS)


def _has_sum_intent(query_tokens: set[str]) -> bool:
    return bool(query_tokens & _SUM_METRIC_TOKENS)


def _has_extreme_intent(query_tokens: set[str]) -> bool:
    return bool(query_tokens & (_MAX_METRIC_TOKENS | _MIN_METRIC_TOKENS))


def _has_latest_intent(query_tokens: set[str]) -> bool:
    return bool(query_tokens & _LATEST_METRIC_TOKENS)


def _has_missing_value_intent(query_tokens: set[str]) -> bool:
    return bool(query_tokens & _NULL_CHECK_TOKENS)


def _sort_direction_for_query(query_tokens: set[str]) -> str:
    return "ASC" if query_tokens & _MIN_METRIC_TOKENS else "DESC"


def _choose_numeric_measure_column(
    query_tokens: set[str],
    columns: list[dict[str, str]],
) -> dict[str, str] | None:
    content_tokens = _query_content_tokens(query_tokens)
    measure_candidates = [
        column for column in columns if not _is_identifier_like_column(column)
    ]
    column = _choose_ranked_column_by_tokens(
        measure_candidates,
        content_tokens,
        numeric=True,
    )
    if column:
        return column

    numeric_columns = [
        column
        for column in columns
        if _is_numeric_type(column["data_type"])
        and not _is_identifier_like_column(column)
    ]
    if len(numeric_columns) == 1:
        return numeric_columns[0]
    return None


def _sample_value_filters(
    query_tokens: set[str],
    columns: list[dict[str, Any]],
) -> list[tuple[dict[str, Any], list[str]]]:
    filters: list[tuple[dict[str, Any], list[str]]] = []
    consumed_tokens: set[str] = set()
    content_tokens = _query_content_tokens(query_tokens)
    if not content_tokens:
        return filters

    for column in columns:
        matches: list[str] = []
        for value in column.get("sample_values") or []:
            cleaned_value = _clean_filter_value(str(value))
            if not cleaned_value:
                continue
            value_tokens = _fallback_tokens(cleaned_value)
            if not value_tokens or not value_tokens <= content_tokens:
                continue
            if value_tokens <= consumed_tokens:
                continue
            if cleaned_value.lower() not in {item.lower() for item in matches}:
                matches.append(cleaned_value)
                consumed_tokens.update(value_tokens)
        if matches:
            filters.append((column, matches))

    return filters


def _where_clause(predicates: list[str]) -> str:
    return f"\nWHERE {' AND '.join(predicates)}" if predicates else ""


def _count_expression_for_query(
    query_tokens: set[str],
    columns: list[dict[str, str]],
) -> tuple[str, list[str]]:
    subject_column = _choose_count_subject_column(query_tokens, columns)
    if not subject_column:
        return "COUNT(*)", []
    return (
        f"COUNT({_quote_identifier(subject_column['name'])})",
        [_non_missing_value_predicate(subject_column)],
    )


def _date_bucket_expressions(date_column: str) -> tuple[str, str]:
    quoted_date = _quote_identifier(date_column)
    return (
        f"EXTRACT(YEAR FROM {quoted_date})",
        f"EXTRACT(MONTH FROM {quoted_date})",
    )


def generate_simple_analytics_sql(
    query: str | None,
    contexts: list[Any] | None,
) -> str | None:
    if not query:
        return None

    query_tokens = _fallback_tokens(query)
    if not query_tokens:
        return None

    schema_details = _extract_schema_details(contexts)
    if not schema_details:
        return None

    content_tokens = _query_content_tokens(query_tokens)
    schema_backed_tokens = _schema_derived_query_tokens(query_tokens, schema_details)
    unsupported_tokens = _unsupported_query_tokens(query_tokens, schema_details)
    if unsupported_tokens:
        logger.info(
            "Schema-derived SQL fallback skipped unsupported_tokens=%s",
            sorted(unsupported_tokens),
        )
        return None
    if content_tokens and not schema_backed_tokens:
        logger.info(
            "Schema-derived SQL fallback skipped no_schema_backed_tokens=%s",
            sorted(content_tokens),
        )
        return None
    if not content_tokens and len(schema_details) != 1:
        logger.info(
            "Schema-derived SQL fallback skipped ambiguous_schema_only_request tables=%s",
            sorted(schema_details),
        )
        return None

    chosen = _choose_fallback_table(
        query_tokens,
        schema_details,
        concept_tokens=query_tokens,
    )
    if not chosen:
        return None

    table_name, columns = chosen
    column_names = [column["name"] for column in columns]
    quoted_table = _quote_identifier(table_name)
    limit = _fallback_limit(query)
    date_column = _choose_temporal_column(query_tokens, columns)
    order_column = _choose_order_by_column(query, query_tokens, columns)
    sample_filters = _sample_value_filters(query_tokens, columns)
    sample_predicates = [
        _filter_predicate_for_values(column, values)
        for column, values in sample_filters
    ]
    selected_sample_filter_columns = [column["name"] for column, _ in sample_filters]
    month_filter = _fallback_month_filter(query)
    metric_intent = {
        "average": _is_average_metric_intent(query_tokens),
        "count": _has_count_intent(query_tokens),
        "distribution": _is_distribution_metric_intent(query_tokens),
        "extreme": _has_extreme_intent(query_tokens),
        "latest": _has_latest_intent(query_tokens),
        "missing": _has_missing_value_intent(query_tokens),
        "rate": _is_rate_metric_intent(query_tokens),
        "sum": _has_sum_intent(query_tokens),
    }
    logger.info(
        "Schema-derived SQL fallback selected table=%s schema_tokens=%s verified_columns=%s sample_filter_columns=%s metric_intent=%s",
        table_name,
        sorted(schema_backed_tokens),
        column_names,
        selected_sample_filter_columns,
        metric_intent,
    )

    if _has_missing_value_intent(query_tokens):
        missing_column = _choose_missing_value_column(query_tokens, columns)
        if not missing_column:
            return None
        selected_columns = _select_listing_columns(
            query_tokens,
            columns,
            date_column=date_column,
            max_columns=8,
        )
        if missing_column["name"] not in selected_columns:
            selected_columns.insert(0, missing_column["name"])
        predicates = [*sample_predicates, _missing_value_predicate(missing_column)]
        limit_clause = f"\nLIMIT {limit}" if limit else ""
        return (
            f"SELECT {_quote_joined(selected_columns)}\n"
            f"FROM {quoted_table}{_where_clause(predicates)}{limit_clause}"
        )

    month_predicate = ""
    if date_column and month_filter:
        year, month = month_filter
        start_date = f"{year:04d}-{month:02d}-01"
        end_year = year + 1 if month == 12 else year
        end_month = 1 if month == 12 else month + 1
        end_date = f"{end_year:04d}-{end_month:02d}-01"
        quoted_date = _quote_identifier(date_column)
        month_predicate = (
            f"{quoted_date} >= '{start_date}' AND {quoted_date} < '{end_date}'"
        )

    predicates = list(sample_predicates)
    if month_predicate:
        predicates.append(month_predicate)

    if _is_average_metric_intent(query_tokens):
        measure_column = _choose_average_measure_column(query_tokens, columns)
        if not measure_column:
            return None
        grouping_tokens = _grouping_phrase_tokens(query) or query_tokens
        dimension_columns = _choose_dimension_columns(
            grouping_tokens,
            columns,
            max_columns=2,
        )
        aggregate_expr = f"AVG({_quote_identifier(measure_column['name'])})"
        if dimension_columns:
            quoted_dimensions = _quote_joined(dimension_columns)
            return (
                f"SELECT {quoted_dimensions}, {aggregate_expr} AS {_quote_identifier('average_value')}\n"
                f"FROM {quoted_table}{_where_clause(predicates)}\n"
                f"GROUP BY {quoted_dimensions}\n"
                f"ORDER BY {_quote_identifier('average_value')} DESC"
            )
        return (
            f"SELECT {aggregate_expr} AS {_quote_identifier('average_value')}\n"
            f"FROM {quoted_table}{_where_clause(predicates)}"
        )

    if date_column and query_tokens & {"month", "monthly"} and _has_count_intent(query_tokens):
        year_expr, month_expr = _date_bucket_expressions(date_column)
        return (
            f"SELECT {year_expr} AS {_quote_identifier('year')}, "
            f"{month_expr} AS {_quote_identifier('month')}, "
            f"COUNT(*) AS {_quote_identifier('record_count')}\n"
            f"FROM {quoted_table}{_where_clause(sample_predicates)}\n"
            f"GROUP BY {year_expr}, {month_expr}\n"
            f"ORDER BY {year_expr}, {month_expr}"
        )

    measure_column = _choose_numeric_measure_column(query_tokens, columns)
    if (
        measure_column
        and date_column
        and query_tokens & {"month", "monthly"}
        and (_has_sum_intent(query_tokens) or _has_grouping_intent(query, query_tokens))
    ):
        year_expr, month_expr = _date_bucket_expressions(date_column)
        aggregate, alias = _aggregate_for_measure(measure_column["name"])
        return (
            f"SELECT {year_expr} AS {_quote_identifier('year')}, "
            f"{month_expr} AS {_quote_identifier('month')}, "
            f"{aggregate}({_quote_identifier(measure_column['name'])}) AS {_quote_identifier(alias)}\n"
            f"FROM {quoted_table}{_where_clause(sample_predicates)}\n"
            f"GROUP BY {year_expr}, {month_expr}\n"
            f"ORDER BY {year_expr}, {month_expr}"
        )

    if (
        measure_column
        and date_column
        and "year" in query_tokens
        and "month" not in query_tokens
        and "monthly" not in query_tokens
        and (_has_sum_intent(query_tokens) or _has_grouping_intent(query, query_tokens))
    ):
        year_expr = f"EXTRACT(YEAR FROM {_quote_identifier(date_column)})"
        aggregate, alias = _aggregate_for_measure(measure_column["name"])
        return (
            f"SELECT {year_expr} AS {_quote_identifier('year')}, "
            f"{aggregate}({_quote_identifier(measure_column['name'])}) AS {_quote_identifier(alias)}\n"
            f"FROM {quoted_table}{_where_clause(sample_predicates)}\n"
            f"GROUP BY {year_expr}\nORDER BY {year_expr}"
        )

    if _has_grouping_intent(query, query_tokens) or _has_count_intent(query_tokens):
        grouping_tokens = _grouping_phrase_tokens(query) or query_tokens
        max_dimensions = 1 if _has_extreme_intent(query_tokens) else 3
        dimension_columns = _choose_dimension_columns(
            grouping_tokens,
            columns,
            max_columns=max_dimensions,
        )
        if dimension_columns:
            quoted_dimensions = _quote_joined(dimension_columns)
            if measure_column and (_has_sum_intent(query_tokens) or _is_rate_metric_intent(query_tokens)):
                aggregate, alias = _aggregate_for_measure(measure_column["name"])
                aggregate_expr = f"{aggregate}({_quote_identifier(measure_column['name'])})"
                direction = _sort_direction_for_query(query_tokens)
                limit_clause = f"\nLIMIT {limit}" if limit else ""
                return (
                    f"SELECT {quoted_dimensions}, {aggregate_expr} AS {_quote_identifier(alias)}\n"
                    f"FROM {quoted_table}{_where_clause(predicates)}\n"
                    f"GROUP BY {quoted_dimensions}\n"
                    f"ORDER BY {_quote_identifier(alias)} {direction}{limit_clause}"
                )

            limit_clause = f"\nLIMIT {limit}" if limit else ""
            return (
                f"SELECT {quoted_dimensions}, COUNT(*) AS {_quote_identifier('record_count')}\n"
                f"FROM {quoted_table}{_where_clause(predicates)}\n"
                f"GROUP BY {quoted_dimensions}\n"
                f"ORDER BY {_quote_identifier('record_count')} DESC{limit_clause}"
            )
        if _has_count_intent(query_tokens) and not _has_grouping_intent(query, query_tokens):
            return (
                f"SELECT COUNT(*) AS {_quote_identifier('record_count')}\n"
                f"FROM {quoted_table}{_where_clause(predicates)}"
            )
        return None

    if measure_column and _has_sum_intent(query_tokens):
        return (
            f"SELECT SUM({_quote_identifier(measure_column['name'])}) AS {_quote_identifier('total_value')}\n"
            f"FROM {quoted_table}{_where_clause(predicates)}"
        )

    if _has_latest_intent(query_tokens):
        if not date_column:
            return None
        selected_columns = _select_listing_columns(
            query_tokens,
            columns,
            date_column=date_column,
            max_columns=8,
        )
        if date_column not in selected_columns:
            selected_columns.insert(0, date_column)
        limit_clause = f"\nLIMIT {limit}" if limit else ""
        return (
            f"SELECT {_quote_joined(selected_columns)}\n"
            f"FROM {quoted_table}{_where_clause(predicates)}\n"
            f"ORDER BY {_quote_identifier(date_column)} DESC{limit_clause}"
        )

    if _has_extreme_intent(query_tokens):
        direction = _sort_direction_for_query(query_tokens)
        if measure_column:
            dimension_column = _choose_dimension_column(query_tokens, columns)
            limit_clause = f"\nLIMIT {limit}" if limit else ""
            if dimension_column:
                aggregate, alias = _aggregate_for_measure(measure_column["name"])
                return (
                    f"SELECT {_quote_identifier(dimension_column)}, "
                    f"{aggregate}({_quote_identifier(measure_column['name'])}) AS {_quote_identifier(alias)}\n"
                    f"FROM {quoted_table}{_where_clause(predicates)}\n"
                    f"GROUP BY {_quote_identifier(dimension_column)}\n"
                    f"ORDER BY {_quote_identifier(alias)} {direction}{limit_clause}"
                )
            selected_columns = _select_listing_columns(
                query_tokens,
                columns,
                measure_column=measure_column["name"],
                date_column=date_column,
                max_columns=8,
            )
            if measure_column["name"] not in selected_columns:
                selected_columns.insert(0, measure_column["name"])
            return (
                f"SELECT {_quote_joined(selected_columns)}\n"
                f"FROM {quoted_table}{_where_clause(predicates)}\n"
                f"ORDER BY {_quote_identifier(measure_column['name'])} {direction}{limit_clause}"
            )
        if order_column:
            selected_columns = _select_listing_columns(
                query_tokens,
                columns,
                date_column=date_column,
                max_columns=8,
            )
            if order_column not in selected_columns:
                selected_columns.insert(0, order_column)
            limit_clause = f"\nLIMIT {limit}" if limit else ""
            return (
                f"SELECT {_quote_joined(selected_columns)}\n"
                f"FROM {quoted_table}{_where_clause(predicates)}\n"
                f"ORDER BY {_quote_identifier(order_column)} {direction}{limit_clause}"
            )
        return None

    if month_predicate and date_column:
        selected_columns = _select_listing_columns(
            query_tokens,
            columns,
            measure_column=measure_column["name"] if measure_column else None,
            date_column=date_column,
            max_columns=8,
        )
        limit_clause = f"\nLIMIT {limit}" if limit else ""
        return (
            f"SELECT {_quote_joined(selected_columns)}\n"
            f"FROM {quoted_table}{_where_clause(predicates)}\n"
            f"ORDER BY {_quote_identifier(date_column)} DESC{limit_clause}"
        )

    if order_column:
        selected_columns = _select_listing_columns(
            query_tokens,
            columns,
            date_column=date_column,
            max_columns=8,
        )
        if order_column not in selected_columns:
            selected_columns.insert(0, order_column)
        limit_clause = f"\nLIMIT {limit}" if limit else ""
        return (
            f"SELECT {_quote_joined(selected_columns)}\n"
            f"FROM {quoted_table}{_where_clause(predicates)}\n"
            f"ORDER BY {_quote_identifier(order_column)} ASC{limit_clause}"
        )

    if sample_predicates or query_tokens & {"all", "list"}:
        selected_columns = _select_listing_columns(
            query_tokens,
            columns,
            date_column=date_column,
            max_columns=8,
        )
        limit_clause = f"\nLIMIT {limit}" if limit else ""
        return (
            f"SELECT {_quote_joined(selected_columns)}\n"
            f"FROM {quoted_table}{_where_clause(predicates)}{limit_clause}"
        )

    return None


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
        mdl_hash: str | None = None,
        contexts: list[Any] | None = None,
        fallback_query: str | None = None,
        use_dry_plan: bool = False,
        allow_dry_plan_fallback: bool = True,
        data_source: str = "",
        allow_data_preview: bool = False,
    ) -> dict:
        try:
            cleaned_generation_result, extraction_error = _extract_sql_response(
                clean_generation_result(replies[0])
            )
            grounding_invalid_generation_result = None

            def validate_candidate_sql(candidate_sql: str) -> str | None:
                schema_catalog = _SchemaCatalog.from_contexts(contexts or [])
                grounding_error = schema_catalog.validate_sql(candidate_sql)
                if not grounding_error:
                    grounding_error = validate_sql_against_contexts(
                        candidate_sql,
                        contexts=contexts,
                    )
                if not grounding_error:
                    grounding_error = validate_sql_semantic_coverage(
                        candidate_sql,
                        fallback_query,
                        contexts=contexts,
                    )
                return grounding_error

            if cleaned_generation_result:
                cleaned_generation_result = normalize_sql_with_schema_identifiers(
                    cleaned_generation_result,
                    contexts=contexts,
                )
                cleaned_generation_result = normalize_wren_sql_dialect(
                    cleaned_generation_result
                )
                grounding_error = validate_candidate_sql(cleaned_generation_result)
                if grounding_error:
                    logger.info(
                        "Generated SQL validation result project_id=%s status=rejected reason=%s sql=%s",
                        project_id or "",
                        grounding_error,
                        cleaned_generation_result,
                    )
                    grounding_invalid_generation_result = {
                        "sql": cleaned_generation_result,
                        "original_sql": cleaned_generation_result,
                        "type": "SCHEMA_GROUNDING",
                        "error": grounding_error,
                        "correlation_id": "",
                        "data_source": data_source,
                    }
                else:
                    logger.info(
                        "Generated SQL validation result project_id=%s status=grounded sql=%s",
                        project_id or "",
                        cleaned_generation_result,
                    )
            elif extraction_error:
                logger.info(
                    "Generated SQL extraction result project_id=%s status=rejected reason=%s",
                    project_id or "",
                    extraction_error,
                )

            fallback_generation_result = generate_simple_analytics_sql(
                fallback_query,
                contexts,
            )
            if fallback_generation_result:
                logger.info(
                    "Deterministic SQL fallback generated project_id=%s sql=%s",
                    project_id or "",
                    fallback_generation_result,
                )
                fallback_generation_result = normalize_sql_with_schema_identifiers(
                    fallback_generation_result,
                    contexts=contexts,
                )
                fallback_generation_result = normalize_wren_sql_dialect(
                    fallback_generation_result
                )
                fallback_grounding_error = validate_candidate_sql(
                    fallback_generation_result
                )
                logger.info(
                    "Deterministic SQL fallback validation result project_id=%s status=%s%s",
                    project_id or "",
                    "grounded" if not fallback_grounding_error else "rejected",
                    ""
                    if not fallback_grounding_error
                    else f" reason={fallback_grounding_error}",
                )
                if not fallback_grounding_error:
                    (
                        fallback_valid_generation_result,
                        fallback_invalid_generation_result,
                    ) = await self._classify_generation_result(
                        fallback_generation_result,
                        project_id=project_id,
                        mdl_hash=mdl_hash,
                        use_dry_plan=use_dry_plan,
                        allow_dry_plan_fallback=allow_dry_plan_fallback,
                        data_source=data_source,
                        allow_data_preview=allow_data_preview,
                    )
                    if fallback_valid_generation_result:
                        logger.info(
                            "Using deterministic schema-grounded SQL fallback for query."
                        )
                        return {
                            "valid_generation_result": fallback_valid_generation_result,
                            "invalid_generation_result": {},
                        }
                    logger.info(
                        "Deterministic SQL fallback did not validate: %s",
                        fallback_invalid_generation_result.get("error"),
                    )

            if grounding_invalid_generation_result:
                unsupported_result = unsupported_schema_generation_result(
                    fallback_query,
                    contexts=contexts,
                    data_source=data_source,
                )
                if unsupported_result:
                    unsupported_message = unsupported_result[
                        "invalid_generation_result"
                    ]["error"]
                    grounding_invalid_generation_result["type"] = "NO_RELEVANT_SQL"
                    grounding_invalid_generation_result["error"] = unsupported_message
                    grounding_invalid_generation_result["sql"] = ""
                    grounding_invalid_generation_result["original_sql"] = ""
                return {
                    "valid_generation_result": {},
                    "invalid_generation_result": grounding_invalid_generation_result,
                }

            unsupported_result = unsupported_schema_generation_result(
                fallback_query,
                contexts=contexts,
                data_source=data_source,
            )
            if not cleaned_generation_result and unsupported_result:
                return unsupported_result

            if not cleaned_generation_result and extraction_error:
                return {
                    "valid_generation_result": {},
                    "invalid_generation_result": {
                        "sql": "",
                        "original_sql": "",
                        "type": "NO_RELEVANT_SQL",
                        "error": extraction_error,
                        "correlation_id": "",
                        "data_source": data_source,
                    },
                }

            (
                valid_generation_result,
                invalid_generation_result,
            ) = await self._classify_generation_result(
                cleaned_generation_result,
                project_id=project_id,
                mdl_hash=mdl_hash,
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
        generation_result: str | None,
        project_id: str | None = None,
        mdl_hash: str | None = None,
        use_dry_plan: bool = False,
        allow_dry_plan_fallback: bool = True,
        data_source: str = "",
        allow_data_preview: bool = False,
    ) -> Dict[str, str]:
        valid_generation_result = {}
        invalid_generation_result = {}
        use_dry_run = not allow_data_preview

        if not generation_result:
            return valid_generation_result, {
                "sql": "",
                "original_sql": "",
                "type": "NO_RELEVANT_SQL",
                "error": "No grounded SQL was generated from the current schema.",
                "correlation_id": "",
            }

        async with aiohttp.ClientSession() as session:
            if use_dry_plan:
                dry_plan_result, error_message = await self._engine.dry_plan(
                    session,
                    generation_result,
                    data_source,
                    project_id=project_id,
                    mdl_hash=mdl_hash,
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
                        "original_sql": generation_result,
                        "type": "TIME_OUT"
                        if error_message.startswith("Request timed out")
                        else "DRY_PLAN",
                        "error": error_message,
                        "correlation_id": "",
                    }
            elif use_dry_run:
                dry_plan_result, error_message = await self._engine.dry_plan(
                    session,
                    generation_result,
                    data_source,
                    project_id=project_id,
                    mdl_hash=mdl_hash,
                    allow_fallback=allow_dry_plan_fallback,
                )

                if not dry_plan_result:
                    invalid_generation_result = {
                        "sql": generation_result,
                        "original_sql": generation_result,
                        "type": "TIME_OUT"
                        if error_message.startswith("Request timed out")
                        else "DRY_PLAN",
                        "error": error_message,
                        "correlation_id": "",
                    }
                    return valid_generation_result, invalid_generation_result

                success, _, addition = await self._engine.execute_sql(
                    generation_result,
                    session,
                    project_id=project_id,
                    mdl_hash=mdl_hash,
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
                    invalid_generation_result = {
                        "sql": generation_result,
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
                    mdl_hash=mdl_hash,
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
                    invalid_generation_result = {
                        "sql": generation_result,
                        "original_sql": generation_result,
                        "type": "TIME_OUT"
                        if error_message.startswith("Request timed out")
                        else preview_data_status,
                        "error": error_message,
                        "correlation_id": addition.get("correlation_id", ""),
                    }

        return valid_generation_result, invalid_generation_result


class _SchemaCatalog:
    def __init__(
        self,
        tables: dict[str, set[str]],
        relationships: dict[str, set[str]] | None = None,
    ):
        self._tables = tables
        self._relationships = relationships or {}

    @classmethod
    def from_contexts(cls, contexts: list[str]) -> "_SchemaCatalog":
        tables: dict[str, set[str]] = {}
        relationships: dict[str, set[str]] = {}

        for context in contexts:
            cls._add_contract_identifiers(context, tables, relationships)
            cls._add_ddl_identifiers(context, tables)

        return cls(tables, relationships)

    @staticmethod
    def _add_contract_identifiers(
        context: str,
        tables: dict[str, set[str]],
        relationships: dict[str, set[str]],
    ) -> None:
        current_table: str | None = None
        current_section: str | None = None

        for raw_line in context.splitlines():
            line = raw_line.strip()
            if line.startswith("table: "):
                current_table = _clean_identifier(line.removeprefix("table: "))
                if current_table:
                    tables.setdefault(current_table, set())
                    relationships.setdefault(current_table, set())
                current_section = None
                continue

            if line.startswith("sql_table_name_use_exactly:"):
                current_table = _clean_identifier(
                    line.removeprefix("sql_table_name_use_exactly:")
                )
                if current_table:
                    tables.setdefault(current_table, set())
                    relationships.setdefault(current_table, set())
                current_section = None
                continue

            if current_table and line in {"columns:", "sql_column_names_use_exactly:"}:
                current_section = "columns"
                continue

            if current_table and line in {
                "relationships:",
                "relationship_constraints_use_exactly:",
            }:
                current_section = "relationships"
                continue

            if current_section and current_table and line.startswith("- "):
                value = line.removeprefix("- ").strip()
                if not value:
                    continue
                if current_section == "columns":
                    column_name = _clean_identifier(value)
                    if column_name:
                        tables.setdefault(current_table, set()).add(column_name)
                elif current_section == "relationships":
                    relationships.setdefault(current_table, set()).add(value)
                continue

            if current_section and line and not line.startswith("- "):
                current_section = None

    @staticmethod
    def _add_ddl_identifiers(
        context: str,
        tables: dict[str, set[str]],
    ) -> None:
        for match in _DDL_CREATE_PATTERN.finditer(context):
            table_name = _clean_identifier(match.group("table"))
            if not table_name:
                continue

            body_start = match.end()
            body_end = _find_matching_parenthesis(context, body_start)
            if body_end is None:
                tables.setdefault(table_name, set())
                continue

            tables.setdefault(table_name, set()).update(
                _extract_ddl_column_names(context[body_start:body_end])
            )

    def to_prompt(self) -> str:
        if not self._tables:
            return ""

        lines = [
            "### VALIDATED RETRIEVED SCHEMA IDENTIFIERS ###",
            "The SQL must use only these exact deployed Wren identifiers.",
            "Each table value below is one indivisible Wren model identifier; never split it into database, schema, or table parts.",
            "Use a multipart table reference only when that exact multipart identifier is listed below as a table value.",
            "Do not derive table or column names from the user's wording, source SQL, physical names, comments, aliases, or descriptions.",
        ]
        for table_name, column_names in self._tables.items():
            lines.append(f"table: {table_name}")
            if column_names:
                lines.append("columns:")
                lines.extend(f"- {column_name}" for column_name in sorted(column_names))
            table_relationships = self._relationships.get(table_name)
            if table_relationships:
                lines.append("relationships:")
                lines.extend(
                    f"- {relationship}"
                    for relationship in sorted(table_relationships)
                )
        lines.extend(
            [
                "If the requested intent cannot be expressed with these exact identifiers, return null for sql.",
                "### END VALIDATED RETRIEVED SCHEMA IDENTIFIERS ###",
            ]
        )
        return "\n".join(lines)

    def validate_sql(self, sql: str | None) -> str | None:
        if not sql or not self._tables:
            return None

        parsed_statements = sqlparse.parse(sql)
        if not parsed_statements:
            return "Generated SQL could not be parsed for schema grounding."

        referenced_tables: set[str] = set()
        table_aliases: dict[str, str] = {}
        qualified_columns: list[tuple[str, str]] = []
        cte_names: set[str] = set()

        for statement in parsed_statements:
            cte_names.update(_extract_cte_names(statement))
            statement_tables, statement_aliases = _extract_table_references(statement)
            referenced_tables.update(statement_tables)
            table_aliases.update(statement_aliases)
            qualified_columns.extend(_extract_qualified_columns(statement))

        executable_tables = referenced_tables - cte_names
        unknown_tables = sorted(
            table_name
            for table_name in executable_tables
            if table_name not in self._tables
        )
        if unknown_tables:
            return (
                "Generated SQL referenced table(s) not present in the retrieved "
                f"schema context: {', '.join(unknown_tables)}."
            )

        unknown_columns = []
        for qualifier, column_name in qualified_columns:
            table_name = table_aliases.get(qualifier, qualifier)
            if table_name in cte_names:
                continue
            if table_name in self._tables and self._tables[table_name]:
                if column_name not in self._tables[table_name]:
                    unknown_columns.append(f"{qualifier}.{column_name}")

        if unknown_columns:
            return (
                "Generated SQL referenced column(s) not present in the retrieved "
                f"schema context: {', '.join(sorted(set(unknown_columns)))}."
            )

        return None


def construct_schema_identifier_catalog(contexts: list[str] | None) -> str:
    return _SchemaCatalog.from_contexts(contexts or []).to_prompt()


def _extract_cte_names(token_list: TokenList) -> set[str]:
    cte_names: set[str] = set()
    with_seen = False

    for token in token_list.tokens:
        if token.is_whitespace or token.ttype in Comment:
            continue

        if token.normalized == "WITH":
            with_seen = True
            continue

        if not with_seen:
            continue

        if isinstance(token, IdentifierList):
            for identifier in token.get_identifiers():
                name = _clean_identifier(identifier.get_name())
                if name:
                    cte_names.add(name)
            break

        if isinstance(token, Identifier):
            name = _clean_identifier(token.get_name())
            if name:
                cte_names.add(name)
            break

        if token.ttype is Keyword:
            break

    return cte_names


def _extract_table_references(token_list: TokenList) -> tuple[set[str], dict[str, str]]:
    table_names: set[str] = set()
    aliases: dict[str, str] = {}
    expect_table = False

    for token in token_list.tokens:
        if token.is_whitespace or token.ttype in Comment:
            continue

        if isinstance(token, TokenList):
            nested_tables, nested_aliases = _extract_table_references(token)
            table_names.update(nested_tables)
            aliases.update(nested_aliases)

        if token.ttype is Keyword and token.normalized in {
            "FROM",
            "JOIN",
            "INNER JOIN",
            "LEFT JOIN",
            "LEFT OUTER JOIN",
            "RIGHT JOIN",
            "RIGHT OUTER JOIN",
            "FULL JOIN",
            "FULL OUTER JOIN",
            "CROSS JOIN",
        }:
            expect_table = True
            continue

        if not expect_table:
            continue

        if isinstance(token, IdentifierList):
            for identifier in token.get_identifiers():
                _add_table_reference(identifier, table_names, aliases)
            expect_table = False
            continue

        if isinstance(token, Identifier):
            _add_table_reference(token, table_names, aliases)
            expect_table = False
            continue

        if token.ttype is Keyword:
            expect_table = False

    return table_names, aliases


def _add_table_reference(
    identifier: Identifier, table_names: set[str], aliases: dict[str, str]
) -> None:
    if not isinstance(identifier, Identifier):
        return

    table_name = _table_reference_name(identifier)
    alias = _clean_identifier(identifier.get_alias())
    if not table_name:
        return

    table_names.add(table_name)
    aliases[table_name] = table_name
    if alias:
        aliases[alias] = table_name


def _table_reference_name(identifier: Identifier) -> str | None:
    if not isinstance(identifier, Identifier):
        return None

    parent_getter = getattr(identifier, "get_parent_name", None)
    real_getter = getattr(identifier, "get_real_name", None)
    parent_name = _clean_identifier(parent_getter() if parent_getter else None)
    real_name = _clean_identifier(real_getter() if real_getter else None)
    if parent_name and real_name:
        return f"{parent_name}.{real_name}"
    return real_name


def _extract_qualified_columns(token_list: TokenList) -> list[tuple[str, str]]:
    columns: list[tuple[str, str]] = []

    for token in token_list.tokens:
        if isinstance(token, Identifier):
            _add_qualified_column(token, columns)
        elif isinstance(token, IdentifierList):
            for identifier in token.get_identifiers():
                if isinstance(identifier, Identifier):
                    _add_qualified_column(identifier, columns)
                elif isinstance(identifier, TokenList):
                    columns.extend(_extract_qualified_columns(identifier))
        elif isinstance(token, TokenList):
            columns.extend(_extract_qualified_columns(token))

    return columns


def _add_qualified_column(
    identifier: Identifier, columns: list[tuple[str, str]]
) -> None:
    if not isinstance(identifier, Identifier):
        return

    parent_getter = getattr(identifier, "get_parent_name", None)
    real_getter = getattr(identifier, "get_real_name", None)
    parent_name = _clean_identifier(parent_getter() if parent_getter else None)
    column_name = _clean_identifier(real_getter() if real_getter else None)
    if parent_name and column_name and column_name != "*":
        columns.append((parent_name, column_name))


def _find_matching_parenthesis(text: str, body_start: int) -> int | None:
    depth = 1
    quote: str | None = None
    i = body_start

    while i < len(text):
        char = text[i]
        if quote:
            if char == quote:
                if quote == "'" and i + 1 < len(text) and text[i + 1] == "'":
                    i += 2
                    continue
                quote = None
            i += 1
            continue

        if char in {"'", '"', "`"}:
            quote = char
        elif char == "[":
            closing = text.find("]", i + 1)
            if closing == -1:
                return None
            i = closing
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1

    return None


def _extract_ddl_column_names(ddl_body: str) -> set[str]:
    column_names: set[str] = set()
    for column_definition in _split_top_level_commas(ddl_body):
        column_name = _extract_ddl_column_name(column_definition)
        if column_name:
            column_names.add(column_name)
    return column_names


def _split_top_level_commas(value: str) -> list[str]:
    parts: list[str] = []
    depth = 0
    quote: str | None = None
    start = 0
    i = 0

    while i < len(value):
        char = value[i]
        if quote:
            if char == quote:
                if quote == "'" and i + 1 < len(value) and value[i + 1] == "'":
                    i += 2
                    continue
                quote = None
            i += 1
            continue

        if char in {"'", '"', "`"}:
            quote = char
        elif char == "[":
            closing = value.find("]", i + 1)
            if closing == -1:
                break
            i = closing
        elif char == "(":
            depth += 1
        elif char == ")":
            depth = max(depth - 1, 0)
        elif char == "," and depth == 0:
            parts.append(value[start:i].strip())
            start = i + 1
        i += 1

    tail = value[start:].strip()
    if tail:
        parts.append(tail)
    return parts


def _extract_ddl_column_name(column_definition: str) -> str | None:
    definition = _strip_leading_sql_comments(column_definition.strip())
    if not definition:
        return None

    first_word = definition.split(maxsplit=1)[0].strip().strip('"`[]').upper()
    if first_word in _DDL_COLUMN_KEYWORDS:
        return None

    if definition.startswith("["):
        closing = definition.find("]")
        if closing > 0:
            return _clean_identifier(definition[: closing + 1])

    if definition.startswith('"'):
        closing = definition.find('"', 1)
        if closing > 0:
            return _clean_identifier(definition[: closing + 1])

    if definition.startswith("`"):
        closing = definition.find("`", 1)
        if closing > 0:
            return _clean_identifier(definition[: closing + 1])

    return _clean_identifier(definition.split(maxsplit=1)[0])


def _strip_leading_sql_comments(value: str) -> str:
    stripped = value.strip()
    while stripped:
        if stripped.startswith("--"):
            lines = stripped.splitlines()
            stripped = "\n".join(lines[1:]).strip()
            continue
        if stripped.startswith("/*"):
            closing = stripped.find("*/")
            if closing == -1:
                return ""
            stripped = stripped[closing + 2 :].strip()
            continue
        break
    return stripped


def _clean_identifier(identifier: str | None) -> str | None:
    if identifier is None:
        return None
    cleaned = identifier.strip().strip('"`[]')
    return cleaned or None


def _extract_sql_from_json_value(value: Any) -> str | None:
    if isinstance(value, str):
        candidate = value.strip()
        if not candidate:
            return None
        if candidate.upper().startswith(("SELECT", "WITH")):
            return candidate
        if candidate.startswith(("{", "[")):
            try:
                return _extract_sql_from_json_value(orjson.loads(candidate))
            except orjson.JSONDecodeError:
                return None
        return None

    if isinstance(value, dict):
        for key in ("sql", "query"):
            sql = _extract_sql_from_json_value(value.get(key))
            if sql:
                return sql

        for key in ("arguments", "content", "tool_calls", "function_call", "message"):
            sql = _extract_sql_from_json_value(value.get(key))
            if sql:
                return sql

        for nested_value in value.values():
            sql = _extract_sql_from_json_value(nested_value)
            if sql:
                return sql

    if isinstance(value, list):
        for item in value:
            sql = _extract_sql_from_json_value(item)
            if sql:
                return sql

    return None


def _extract_sql_response(generation_result: str) -> tuple[str | None, str | None]:
    cleaned_generation_result = generation_result.strip()
    if not cleaned_generation_result:
        return None, "No grounded SQL was generated from the current schema."

    if cleaned_generation_result.startswith(("{", "[")):
        try:
            payload = orjson.loads(cleaned_generation_result)
        except orjson.JSONDecodeError:
            return (
                None,
                "SQL generation response did not include a supported SQL JSON payload.",
            )

        sql = _extract_sql_from_json_value(payload)
        if sql:
            return sql, None

        return (
            None,
            f"SQL generation response did not include a supported SQL field: {payload}",
        )

    if cleaned_generation_result.upper().startswith(("SELECT", "WITH")):
        return cleaned_generation_result, None

    return None, "SQL generation response did not include a supported SQL JSON payload."


_MANDATORY_SQL_GROUNDING_RULES = """
### MANDATORY SQL GROUNDING RULES ###
- Treat the DATABASE SCHEMA section as the only source of executable table and column identifiers.
- Every table and column referenced in SELECT, FROM, JOIN, WHERE, GROUP BY, HAVING, and ORDER BY must appear exactly in the CREATE TABLE, CREATE VIEW, or metric schema text provided in DATABASE SCHEMA.
- Comments, aliases, display labels, descriptions, reasoning text, SQL samples, and user wording are semantic hints only. They are never source table or source column identifiers.
- Physical datasource names, source database names, source schema names, source table names, source column names, lineage names, and names embedded inside descriptions or comments are semantic context only. Never use them as executable Wren table or column identifiers unless the exact same identifier is declared in DATABASE SCHEMA.
- Interpret the user's intent from the question wording, schema descriptions, aliases, display labels, calculated fields, metrics, and relationships, then express that intent with exact executable identifiers from DATABASE SCHEMA.
- When DATABASE SCHEMA contains WREN RETRIEVED SEMANTIC CONTEXT blocks, first use those blocks to understand each retrieved object's exact SQL identifier contract, semantic meaning, relationships, views, metrics, and calculated fields.
- When DATABASE SCHEMA contains WREN SQL IDENTIFIER CONTRACT sections, treat them as the compact authoritative list of executable identifiers for each retrieved object before reading semantic descriptions.
- In WREN RETRIEVED SEMANTIC CONTEXT, copy executable identifiers only from sql_table_name_use_exactly, sql_column_name_use_exactly, sql_column_names_use_exactly, relationship_constraints_use_exactly, or the following DDL declarations.
- Treat every retrieved Wren table/model name as one indivisible executable identifier. Prefixes, suffixes, underscores, source schema names, connector names, or words that look like database/schema parts are still part of that single Wren identifier.
- Never convert an exact Wren table/model name into a multipart native database reference. If DATABASE SCHEMA declares a table named abc_def, use "abc_def"; do not write abc.def, "abc"."def", or any other split form.
- Use multipart table references such as schema.table or "schema"."table" only when DATABASE SCHEMA declares that exact multipart Wren identifier as the executable table/model name.
- Values under semantic_context_not_sql_identifiers and semantic_context_not_sql_identifier are meaning only. Do not combine words, labels, ordinals, prefixes, suffixes, abbreviations, comments, or descriptions from those values into a table or column identifier.
- When a business term is represented by a column alias, display label, or description, use the corresponding real table and column name from DATABASE SCHEMA in the SQL, not the display text.
- The executable identifier is the name in the CREATE TABLE, CREATE VIEW, or metric field declaration. Do not derive executable identifiers by rewriting, translating, singularizing, pluralizing, spacing, casing, or abbreviating natural language, comments, aliases, display labels, or descriptions.
- Never generate SQL from assumptions such as "assuming the table contains", "assuming this column exists", or "a possible table/column". Use only schema-confirmed identifiers.
- Never generate placeholder identifiers, placeholder table names, or template markers in the SQL. If the retrieved metadata does not contain an executable object or column for a requested concept, omit that unsupported concept.
- Never create an identifier from user question wording by changing spaces, casing, punctuation, singular/plural form, abbreviations, prefixes, or suffixes. If the exact requested table or column concept is not represented by a retrieved schema identifier, return null for sql.
- If a requested concept, output column, filter, sort, join, grouping, measure, or time field is not represented by an exact table or column in DATABASE SCHEMA, do not invent a field for it. If that field is required to answer the request, return null for sql.
- When a dry run error reports an invalid object name or invalid column name, remove that identifier unless it appears exactly in DATABASE SCHEMA. Correct it only to an exact schema identifier.
- Do not replace an invalid identifier with a similar-looking physical, source, lineage, alias, display, description, sample, or error-message name. Regenerate from the user's intent and the current DATABASE SCHEMA, and omit unsupported parts instead of substituting non-schema identifiers.
- When using multiple tables to combine fields into the same output row, join only through the FOREIGN KEY relationships shown in DATABASE SCHEMA. If no relationship is shown for the needed tables, prefer a single table, view, or metric that already contains the requested fields.
- When the same requested result can be answered from multiple schema objects with compatible fields or metrics, include all relevant objects by combining separate result rows with UNION ALL instead of choosing only one object.
- Use UNION ALL only when each SELECT branch is independently valid from DATABASE SCHEMA and returns the same result shape. Do not use UNION ALL to combine unrelated concepts or to compensate for missing columns.
- If the question requires fields that are spread across multiple schema objects, use all required related tables, views, or metrics only when the DATABASE SCHEMA provides the needed columns and relationship path.
- Do not query INFORMATION_SCHEMA, system catalogs, metadata tables, or table-existence checks to answer the user. Query only the business tables, views, and metrics in DATABASE SCHEMA.
- SQL samples and query history are examples of intent and style only. Never copy a table name, column name, alias, literal value, or function from them unless it is also valid for the current DATABASE SCHEMA and SQL FUNCTIONS.
- Generate Wren SQL only, not the native SQL dialect of the connected warehouse. Do not use SQL Server TOP, square-bracket quoting, backtick quoting, FETCH FIRST, OFFSET/FETCH pagination, or warehouse-specific functions unless they are explicitly listed in SQL FUNCTIONS for this request.
- For top, first, highest, lowest, largest, smallest, or other limited result requests, express the ranking/order with ORDER BY and apply a final LIMIT clause in Wren SQL. Never use SELECT TOP n.
- Apply relative date or time filters only when DATABASE SCHEMA contains an exact date/time field for the requested time concept and SQL FUNCTIONS contains the exact date/time operation needed. Do not compare text fields to date functions.
- Treat reasoning plans, correction notes, and error messages as non-executable context. Never copy SQL fragments, inferred identifiers, placeholder names, template markers, literal values, or unsupported functions from them.
- If a column comment, alias, display label, or description names a business concept, first locate the exact declared source column for that concept in DATABASE SCHEMA. If no exact declared source column exists, omit that concept.
- For aggregate sorting, select the aggregate with an alias and order by that alias instead of ordering directly by an aggregate expression.
- In grouped queries, every non-aggregate ORDER BY expression must be a selected grouping column, a selected ordering helper column that is also present in GROUP BY, or a selected aggregate alias. Do not order grouped SQL by a hidden column.
- Before returning the final SQL, silently check that each identifier and function in the SQL is grounded in DATABASE SCHEMA or SQL FUNCTIONS. If any identifier or function is ungrounded, remove that part. If the ungrounded part is needed to answer the user's requested intent, return null for sql.
- If the retrieved DATABASE SCHEMA does not contain a table, column, relationship, or supported function needed for part of the user's request, leave that part out instead of inventing a replacement.
- If a requested noun, output column, grouping, filter, or measure appears only in the user's wording and not in DATABASE SCHEMA, do not translate it into a generic object name. Use only schema-supported concepts and omit unsupported parts.
- If the user's primary requested subject, output column, grouping, filter, timeframe, measure, or required relationship cannot be grounded by the retrieved DATABASE SCHEMA, return null for sql instead of producing an approximate query.
- Do not answer by selecting a nearby table only because it was retrieved. A retrieved object is usable only when its declared table, columns, relationships, or metric fields support the user's requested intent.
- Do not answer from generic log, file, JSON, payload, text, or app-metric columns when retrieved schema metadata contains specific modeled columns for the requested entity, measure, filter, date, or dimension.
- Prefer exact modeled fields over generic text search. If a requested concept is represented by an explicit declared column, use that column rather than searching a generic payload field with LIKE.
- If the schema already exposes a measure that directly matches the requested metric, use that exact measure column instead of recomputing it from invented component fields.
- Do not prefer or exclude any business domain by built-in rules. Ground every choice in the DATABASE SCHEMA supplied for this request.
"""


_DEFAULT_TEXT_TO_SQL_RULES = """
### SQL RULES ###
- ONLY USE SELECT statements, NO DELETE, UPDATE OR INSERT etc. statements that might change the data in the database.
- ONLY USE the tables and columns mentioned in the database schema.
- ONLY USE "*" if the user query asks for all the columns of a table.
- ONLY CHOOSE columns belong to the tables mentioned in the database schema.
- DON'T INCLUDE comments in the generated SQL query.
- YOU MUST USE "JOIN" if you choose columns from multiple tables!
- PREFER USING CTEs over subqueries.
- Copy table names exactly as one Wren identifier from DATABASE SCHEMA. Do not split underscores or source-schema-like prefixes into dot-qualified database/schema/table references.
- Use table aliases only as SQL aliases for already-declared Wren table names; never use aliases or source schema names as replacements for Wren table names.
- Qualify every source column reference with its exact Wren table name or SQL table alias in SELECT, JOIN, WHERE, GROUP BY, HAVING, and ORDER BY. Output aliases in the final SELECT may be unqualified.
- When generating SQL query, always:
    - Put double quotes around exact column and table names copied from DATABASE SCHEMA.
    - Put single quotes around string literals.
    - Never quote numeric literals.
- YOU MUST USE "lower(<table_name>.<column_name>) like lower(<value>)" function or "lower(<table_name>.<column_name>) = lower(<value>)" function for case-insensitive comparison!
    - Use "lower(<table_name>.<column_name>) LIKE lower(<value>)" when:
        - The user requests a pattern or partial match.
        - The value is not specific enough to be a single, exact value.
        - Wildcards (%) are needed to capture the pattern.
    - Use "lower(<table_name>.<column_name>) = lower(<value>)" when:
        - The user requests an exact, specific value.
        - There is no ambiguity or pattern in the value.
- If the column is date/time related field, and it is a INT/BIGINT/DOUBLE/FLOAT type, please use the appropriate function mentioned in the SQL FUNCTIONS section to cast the column to "TIMESTAMP" type first before using it in the query
    - example: TO_TIMESTAMP_MILLIS("<timestamp_column>")  # if the timestamp_column is in milliseconds
    - example: TO_TIMESTAMP_SECONDS("<timestamp_column>")  # if the timestamp_column is in seconds
    - example: TO_TIMESTAMP_MICROS("<timestamp_column>")  # if the timestamp_column is in microseconds
- ALWAYS CAST the date/time related field to "TIMESTAMP WITH TIME ZONE" type when using them in the query
    - example 1: CAST(properties_closedate AS TIMESTAMP WITH TIME ZONE)
    - example 2: CAST('2024-11-09 00:00:00' AS TIMESTAMP WITH TIME ZONE)
    - example 3: CAST(DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') AS TIMESTAMP WITH TIME ZONE)
- If the user asks for a specific date, use a date range over an exact date/time column from DATABASE SCHEMA.
    - example: filter an exact date/time column with a start timestamp and the next boundary timestamp for the requested period.
- USE THE VIEW TO SIMPLIFY THE QUERY.
- DON'T MISUSE THE VIEW NAME. THE ACTUAL NAME IS FOLLOWING THE CREATE VIEW STATEMENT.
- ONLY USE table/column alias in the final SELECT clause; don't use table/columnalias in the other clauses.
- Refer to the alias value in the DATABASE SCHEMA comment for the corresponding table or column only as the output label in the final SELECT clause. Do not use alias values as source table or source column identifiers unless they are also exact executable identifiers declared in DATABASE SCHEMA.
- DON'T USE '.' in column/table alias, replace '.' with '_' in column/table alias.
- DON'T USE "FILTER(WHERE <expression>)" clause in the generated SQL query.
- DON'T USE "EXTRACT(EPOCH FROM <expression>)" clause in the generated SQL query.
- DON'T USE "EXTRACT()" function with INTERVAL data types as arguments
- DON'T USE INTERVAL or generate INTERVAL-like expression in the generated SQL query.
- DON'T USE "TO_CHAR" function in the generated SQL query.
- Aggregate functions are not allowed in the WHERE clause. Instead, they belong in the HAVING clause, which is used to filter after aggregation.
- You can only add "ORDER BY" and "LIMIT" to the final "UNION" result.
- Do not use SELECT TOP n, FETCH FIRST, OFFSET/FETCH, square-bracket quoting, or backtick quoting. Use Wren SQL syntax with ORDER BY and a final LIMIT n clause for limited or top-N results.
- For top, bottom, highest, lowest, first, or last requests, sort by an exact selected column or aggregate alias and use LIMIT unless the user explicitly asks for rank values.
- For explicit ranking requests, use the ranking function `DENSE_RANK()`, add the ranking column to the final SELECT clause, and filter rank values with WHERE.
- For grouped trend queries, include any non-aggregate ordering key in both SELECT and GROUP BY, or order by selected grouping columns/aggregate aliases only.
- Reuse exact metric/measure columns when present. Do not invent component columns in order to calculate a requested metric that already exists in DATABASE SCHEMA.
"""


_DEFAULT_CALCULATED_FIELD_INSTRUCTIONS = """
#### Instructions for Calculated Field ####

The first structure is the special column marked as "Calculated Field". You need to interpret the purpose and calculation basis for these columns, then utilize them in the following text-to-sql generation tasks.
First, provide a brief explanation of what each field represents in the context of the schema, including how each field is computed using the relationships between models.
Then, during the following tasks, if the user queries pertain to any calculated fields defined in the database schema, ensure to utilize those calculated fields appropriately in the output SQL queries.
The goal is to accurately reflect the intent of the question in the SQL syntax, leveraging the pre-computed logic embedded within the calculated fields.
Use calculated fields only when their exact field names are declared in DATABASE SCHEMA and their descriptions or expressions match the user's intent. Do not recreate a calculated field expression with undeclared source tables or columns, and do not invent relationships that are not declared in DATABASE SCHEMA.
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
Use metric dimensions and measures only when their exact metric field names are declared in DATABASE SCHEMA and match the user's requested grouping, filtering, or aggregation. Treat the metric base object as semantic context; do not query the base object unless it is also declared as a retrieved executable table or metric in DATABASE SCHEMA.
"""

_DEFAULT_JSON_FIELD_INSTRUCTIONS = """
#### Instructions for JSON related functions ####
- ONLY USE JSON_QUERY for querying fields if "json_type":"JSON" is identified in the columns comment, NOT the deprecated JSON_EXTRACT_SCALAR function.
    - DON'T USE CAST for JSON fields, ONLY USE the following funtions:
      - LAX_BOOL for boolean fields
      - LAX_FLOAT64 for double and float fields
      - LAX_INT64 for bigint fields
      - LAX_STRING for varchar fields
    - Use only the exact JSON column and JSON field paths declared in DATABASE SCHEMA.
- ONLY USE JSON_QUERY_ARRAY for querying "json_type":"JSON_ARRAY" is identified in the comment of the column, NOT the deprecated JSON_EXTRACT_ARRAY.
    - USE UNNEST to analysis each item individually in the ARRAY. YOU MUST SELECT FROM the parent table ahead of the UNNEST ARRAY.
    - The alias of the UNNEST(ARRAY) should be in the format `unnest_table_alias(individual_item_alias)`
    - If the items in the ARRAY are JSON objects, use JSON_QUERY to query the fields inside each JSON item.
    - To JOIN ON the fields inside UNNEST(ARRAY), YOU MUST SELECT FROM the parent table ahead of the UNNEST syntax, and the alias of the UNNEST(ARRAY) SHOULD BE IN THE FORMAT unnest_table_alias(individual_item_alias)
- DON'T USE JSON_QUERY and JSON_QUERY_ARRAY when "json_type":"".
- DON'T USE LAX_BOOL, LAX_FLOAT64, LAX_INT64, LAX_STRING when "json_type":"".
"""

sql_samples_instructions = """
#### Instructions for SQL Samples ####

Finally, you will learn from the sample questions provided in the input. These samples demonstrate intent and response style for this specific database.

For each sample, you should:
1. Study the question that explains what the query aims to accomplish
2. Use these samples as intent and style context only, but treat the DATABASE SCHEMA as the only valid source of executable table and column names
3. Adapt the intent patterns to match new query requirements while maintaining consistent style and approach
4. Never copy table names, column names, aliases, literal values, placeholders, or functions from samples

The samples will help you understand:
- Common analytical intents
- Common aggregation requests
- Preferred answer style

When generating new queries, follow similar intent patterns when applicable, while adapting them to the specific requirements of each new query.

Learn about the user's intent from the samples and generate SQL from the current DATABASE SCHEMA and SQL FUNCTIONS only.
"""


sql_generation_reasoning_system_prompt = """
### TASK ###
You are a helpful data analyst who explains the user's analytical intent and provides a concise, non-executable reasoning plan for answering the user's question.

### INSTRUCTIONS ###
1. Think deeply and reason about the user's question, the database schema, and the user's query history if provided.
2. Explicitly state requested timeframes in natural language only. Mention exact date/time columns only when they are declared in DATABASE SCHEMA or WREN SQL IDENTIFIER CONTRACT.
3. For top, bottom, first, last, highest, or lowest requests, describe the requested ordering and limit in natural language. Mention exact ordering columns or measures only when they are declared in DATABASE SCHEMA or WREN SQL IDENTIFIER CONTRACT.
4. Do not mention SQL functions, operators, or expression syntax in the reasoning plan.
5. If USER INSTRUCTIONS section is provided, make sure to consider them in the reasoning plan.
6. If SQL SAMPLES section is provided, make sure to consider them in the reasoning plan.
7. Give a step by step reasoning plan in order to answer user's question.
8. The reasoning plan should be in the language same as the language user provided in the input.
9. Don't include SQL in the reasoning plan.
10. Each step in the reasoning plan must start with a number, a title(in bold format in markdown), and a reasoning for the step.
11. Do not include ```markdown or ``` in the answer.
12. Mention table names only by writing the literal prefix `table:` followed by an exact table name declared in DATABASE SCHEMA or WREN SQL IDENTIFIER CONTRACT.
13. Mention column names only by writing the literal prefix `column:` followed by an exact declared table name, a dot, and an exact column name declared for that table in DATABASE SCHEMA or WREN SQL IDENTIFIER CONTRACT.
14. Do not mention aliases, source names, physical names, lineage names, schema names, database names, literal values, placeholders, or identifier-like labels from comments, SQL samples, failed SQL, or user wording as executable identifiers.
15. Do not write SQL, possible SQL, sample SQL, assumed SQL, SQL clauses, SQL functions, code blocks, or executable expressions in the reasoning plan. Do not write date/time expressions in the reasoning plan.
16. Never use phrases such as "assuming the table contains", "assuming this column exists", or "the SQL could look like this". If the available metadata does not clearly support part of the request, state that the available metadata does not support that part without naming missing objects.
17. If the question asks for a concept, filter, sort, or timeframe, describe the requested operation in business language and cite exact declared tables or columns only when they are grounded by DATABASE SCHEMA.
18. Interpret the user's intent from wording, aliases, display labels, descriptions, calculated fields, metrics, and relationships, then ground the plan in exact declared schema identifiers.
19. If multiple schema objects are required, identify the exact declared relationship path from DATABASE SCHEMA. If no relationship path is declared, say that the retrieved metadata does not provide a join path.
20. Treat SQL samples and query history as examples only. Do not copy table names, column names, aliases, values, placeholders, functions, or SQL patterns from them into the reasoning plan unless they also appear exactly in DATABASE SCHEMA.
21. Do not mention placeholder SQL, metadata-table checks, INFORMATION_SCHEMA, or replacement instructions to the user.
22. The reasoning plan is semantic context for intent only, not a source of executable identifiers. SQL generation must re-read DATABASE SCHEMA and WREN SQL IDENTIFIER CONTRACT before using any identifier.
23. ONLY SHOWING the reasoning plan in bullet points.
24. Do not use the words "assume", "assuming", "likely", "possible", "might", or "example" when describing tables, columns, filters, or SQL.
25. If exact deployed table and column identifiers are not available for a requested part, say only that the retrieved metadata does not support that part. Do not propose a replacement name.
26. Do not write table names or column names from the user's wording unless the same identifier appears exactly in DATABASE SCHEMA or WREN SQL IDENTIFIER CONTRACT.
27. Do not include code blocks, inline SQL fragments, SELECT statements, WHERE clauses, join clauses, or any query-shaped text in the reasoning plan.

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


def get_text_to_sql_rules(sql_knowledge: SqlKnowledge | None = None) -> str:
    rules = _DEFAULT_TEXT_TO_SQL_RULES
    if sql_knowledge is not None:
        connector_rules = _extract_from_sql_knowledge(
            sql_knowledge, "text_to_sql_rule", ""
        )
        if connector_rules:
            rules = f"""{rules}

### CONNECTOR SQL KNOWLEDGE ###
Use the following connector-specific knowledge only when it does not conflict with Wren SQL syntax, DATABASE SCHEMA identifiers, SQL FUNCTIONS, or WREN SQL IDENTIFIER CONTRACT.
{connector_rules}"""

    return f"{rules}\n\n{_MANDATORY_SQL_GROUNDING_RULES}"


def get_calculated_field_instructions(sql_knowledge: SqlKnowledge | None = None) -> str:
    if sql_knowledge is not None:
        return _extract_from_sql_knowledge(
            sql_knowledge,
            "calculated_field_instructions",
            _DEFAULT_CALCULATED_FIELD_INSTRUCTIONS,
        )

    return _DEFAULT_CALCULATED_FIELD_INSTRUCTIONS


def get_metric_instructions(sql_knowledge: SqlKnowledge | None = None) -> str:
    if sql_knowledge is not None:
        return _extract_from_sql_knowledge(
            sql_knowledge, "metric_instructions", _DEFAULT_METRIC_INSTRUCTIONS
        )

    return _DEFAULT_METRIC_INSTRUCTIONS


def get_json_field_instructions(sql_knowledge: SqlKnowledge | None = None) -> str:
    if sql_knowledge is not None:
        return _extract_from_sql_knowledge(
            sql_knowledge, "json_field_instructions", _DEFAULT_JSON_FIELD_INSTRUCTIONS
        )

    return _DEFAULT_JSON_FIELD_INSTRUCTIONS


def get_sql_generation_system_prompt(sql_knowledge: SqlKnowledge | None = None) -> str:
    text_to_sql_rules = get_text_to_sql_rules(sql_knowledge)

    return f"""
You are a helpful assistant that converts natural language queries into Wren SQL queries.

Given the user's question and database schema, generate one grounded Wren SQL query. The DATABASE SCHEMA is the only source of executable identifiers.

### GENERAL RULES ###

1. YOU MUST FOLLOW the instructions strictly to generate the SQL query if the section of USER INSTRUCTIONS is available in user's input.
2. YOU MUST ONLY CHOOSE the appropriate functions from the sql functions list and use them in the SQL query if the section of SQL FUNCTIONS is available in user's input. Use the exact supported syntax shown there; otherwise omit the function-dependent part of the request.
3. YOU MUST REFER to the sql samples only as examples of intent and style if the section of SQL SAMPLES is available in user's input. Do not copy identifiers, literals, placeholders, SQL patterns, or functions from samples.
4. YOU MUST treat the reasoning plan as semantic context for intent only. Do not copy identifiers, functions, literal values, SQL fragments, template markers, or placeholders from the reasoning plan. Choose every executable identifier only from DATABASE SCHEMA or WREN SQL IDENTIFIER CONTRACT, and every function only from SQL FUNCTIONS.
5. YOU MUST answer the user's intent, not just exact wording. Use schema aliases, descriptions, calculated fields, metrics, and relationships to understand intent, then generate SQL with exact DATABASE SCHEMA identifiers only.
6. YOU MUST first read any WREN SQL IDENTIFIER CONTRACT and WREN RETRIEVED SEMANTIC CONTEXT block attached to each schema object. Use sql_table_name_use_exactly, sql_column_name_use_exactly, sql_column_names_use_exactly, relationship_constraints_use_exactly, and the following DDL declarations as executable grounding. Use semantic_context_not_sql_identifiers and semantic_context_not_sql_identifier only to understand business meaning.
7. When DATABASE SCHEMA contains EXECUTABLE WREN IDENTIFIER CATALOG sections, treat those sections as the first and clearest list of allowed executable identifiers.
8. If the user asks for fields that exist across multiple related schema objects, include those objects only when DATABASE SCHEMA shows the exact columns and relationship path needed to join them.
9. If the user asks for a result that is represented in multiple schema objects with compatible fields, include all relevant objects using independently valid SELECT branches combined with UNION ALL. Use joins only for relationship-backed row-level combinations.
10. Before finalizing the JSON response, YOU MUST perform a silent grounding check: every table, column, join key, filter field, grouping field, ordering field, and function in the SQL must be present in DATABASE SCHEMA or SQL FUNCTIONS. If a planned element is not grounded, omit that element. If the element is needed to answer the user's requested subject, output column, filter, grouping, measure, timeframe, or relationship, return null for sql.
11. YOU MUST treat source database/schema/table names, physical datasource names, lineage names, comments, aliases, and display labels as semantic context only. Never use them as executable identifiers unless the exact same identifier appears in DATABASE SCHEMA.
12. If an identifier, literal value, placeholder, template marker, or function appears only in SQL samples, failed SQL, descriptions, lineage, reasoning text, or error messages, it is not executable for this request; ignore those parts when generating executable SQL.
13. If any planned SQL identifier cannot be copied exactly from DATABASE SCHEMA, EXECUTABLE WREN IDENTIFIER CATALOG, or WREN SQL IDENTIFIER CONTRACT, return null for sql. Never create a table or column from the user's wording.
14. YOU MUST FOLLOW SQL Rules if they are not contradicted with instructions.

{text_to_sql_rules}

### FINAL ANSWER FORMAT ###
The final answer must be JSON. Return a SQL string only when it is fully grounded in DATABASE SCHEMA and SQL FUNCTIONS and it answers the user's requested intent. Do not create table or column identifiers from the user's wording. If the retrieved schema does not ground the requested subject, output column, filter, grouping, measure, timeframe, or relationship, return null for sql.

{{
    "sql": "SQL query string using only identifiers declared in DATABASE SCHEMA, or null"
}}
"""


class SqlGenerationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sql: str | None


SQL_GENERATION_MODEL_KWARGS = {
    "preserve_json_schema": True,
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "sql_generation_result",
            "strict": True,
            "schema": SqlGenerationResult.model_json_schema(),
        },
    },
}


def construct_instructions(
    instructions: list[dict] | None = None,
):
    _instructions = []
    if instructions:
        _instructions += [
            instruction.get("instruction") for instruction in instructions
        ]

    return _instructions


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
