import ast
import asyncio
import logging
import re
import sys
from typing import Any, Optional

import orjson
import tiktoken
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack import Document
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider, EmbedderProvider, LLMProvider
from src.pipelines.common import (
    build_project_deploy_filter,
    build_table_ddl,
    clean_up_new_lines,
    get_engine_supported_data_type,
)
from src.pipelines.generation.utils.query_intent import (
    analyze_query,
    explicit_table_name_candidates,
    identifier_terms,
)
from src.utils import trace_cost
from src.web.v1.services.ask import AskHistory

logger = logging.getLogger("wren-ai-service")


table_columns_selection_system_prompt = """
### TASK ###
You are a highly skilled data analyst. Your goal is to examine the provided database schema, interpret the posed question, and identify the specific columns from the relevant tables required to construct an accurate SQL query.

The database schema includes tables, columns, primary keys, foreign keys, relationships, and any relevant constraints.
The same business concept is represented by multiple modeled datasets in some projects; preserve each relevant dataset when it can answer the requested intent.

### INSTRUCTIONS ###
1. Carefully analyze the schema and identify the essential tables and columns needed to answer the question.
2. For each table, provide a clear and concise reasoning for why specific columns are selected.
3. List each reason as part of a step-by-step chain of thought, justifying the inclusion of each column.
4. If a "." is included in columns, put the name before the first dot into chosen columns.
5. The number of columns chosen must match the number of reasoning.
6. Final chosen columns must be only column names, don't prefix it with table names.
7. If the chosen column is a child column of a STRUCT type column, choose the parent column instead of the child column.
8. If multiple schema objects provide compatible fields for the same requested result shape, include all of those schema objects instead of choosing only one.

### FINAL ANSWER FORMAT ###
Please provide your response as a JSON object, structured as follows:

{
    "results": [
        {
            "table_selection_reason": "Reason for selecting tablename1",
            "table_contents": {
              "chain_of_thought_reasoning": [
                  "Reason 1 for selecting column1",
                  "Reason 2 for selecting column2",
                  ...
              ],
              "columns": ["column1", "column2", ...]
            },
            "table_name":"tablename1",
        },
        {
            "table_selection_reason": "Reason for selecting tablename2",
            "table_contents":
            {
              "chain_of_thought_reasoning": [
                  "Reason 1 for selecting column1",
                  "Reason 2 for selecting column2",
                  ...
              ],
              "columns": ["column1", "column2", ...]
            },
            "table_name":"tablename2"
        },
        ...
    ]
}

### ADDITIONAL NOTES ###
- Each table key must list only the columns relevant to answering the question.
- Provide a reasoning list (`chain_of_thought_reasoning`) for each table, explaining why each column is necessary.
- Provide the reason of selecting the table in (`table_selection_reason`) for each table.
- Be logical, concise, and ensure the output strictly follows the required JSON format.
- Use table name used in the "Create Table" statement, don't use "alias".
- Match Column names with the definition in the "Create Table" statement.
- Match Table names with the definition in the "Create Table" statement.

Good luck!

"""

table_columns_selection_user_prompt_template = """
### Database Schema ###

{% for db_schema in db_schemas %}
    {{ db_schema }}
{% endfor %}

### INPUT ###
{{ question }}
"""


_QUERY_TERM_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "by",
    "for",
    "from",
    "give",
    "in",
    "is",
    "last",
    "list",
    "me",
    "month",
    "of",
    "on",
    "placed",
    "show",
    "the",
    "this",
    "to",
    "week",
    "with",
}

_MAX_SCHEMA_SEMANTIC_TABLE_CANDIDATES = 5
_MAX_SCHEMA_RELATIONSHIP_TABLE_CANDIDATES = 12
_MAX_RELATED_SCHEMA_TABLE_CANDIDATES = 5
_MAX_RELATED_SCHEMA_RELATIONSHIP_CANDIDATES = 12
_MAX_SQL_GENERATION_SCHEMA_RESULTS = 10
_MAX_SQL_GENERATION_COLUMNS_PER_TABLE = 16
_MAX_SQL_GENERATION_ROLE_COLUMNS = 4
_DATE_TIME_TYPE_TERMS = {
    "date",
    "datetime",
    "timestamp",
    "time",
}
_NUMERIC_TYPE_TERMS = {
    "bigint",
    "decimal",
    "double",
    "float",
    "int",
    "integer",
    "numeric",
    "real",
    "smallint",
}
_DATE_TIME_NAME_PATTERN = re.compile(r"(date|time|timestamp|period|month|year)", re.I)
_IDENTIFIER_NAME_PATTERN = re.compile(r"(^id$|[_\s-]?id$|key|code|number|num|no$)", re.I)
_TIME_QUERY_PATTERN = re.compile(
    r"\b(date|day|week|month|quarter|year|today|yesterday|last|next|from|to|between|period|recent)\b",
    re.I,
)
_MEASURE_QUERY_PATTERN = re.compile(
    r"\b(total|sum|average|avg|mean|count|number|top|highest|lowest|most|least)\b",
    re.I,
)
_DETAIL_QUERY_PATTERN = re.compile(r"\b(show|list|detail|details|records|rows)\b", re.I)


def _normalize_terms(value: str | None) -> set[str]:
    value = "" if value is None else str(value)
    terms = {
        term
        for term in re.findall(r"[a-zA-Z0-9]+", value.lower())
        if len(term) >= 3 and term not in _QUERY_TERM_STOPWORDS
    }
    singular_terms = {
        term[:-1]
        for term in terms
        if term.endswith("s") and len(term) > 3
    }
    return terms | singular_terms


def _relationship_constraints(content: dict) -> list[str]:
    return [
        column.get("constraint", "")
        for column in content.get("columns", [])
        if column.get("type") == "FOREIGN_KEY" and column.get("constraint")
    ]


def _schema_semantic_text(content: dict) -> str:
    parts = [
        str(content.get("name", "") or ""),
        str(content.get("comment", "") or ""),
        str(content.get("properties", {}) or ""),
    ]

    for column in content.get("columns", []):
        parts.extend(
            [
                str(column.get("name", "") or ""),
                str(column.get("data_type", "") or ""),
                str(column.get("comment", "") or ""),
                str(column.get("constraint", "") or ""),
                str(column.get("referenced_table", "") or ""),
                str(column.get("referenced_column", "") or ""),
                " ".join(str(table) for table in column.get("tables", []) or []),
            ]
        )

    return " ".join(part for part in parts if part)


def _table_description_semantic_text(content: dict) -> str:
    parts = [
        str(content.get("name", "") or ""),
        str(content.get("displayName", "") or ""),
        str(content.get("description", "") or ""),
        str(content.get("columns", "") or ""),
        str(content.get("column_context", "") or ""),
        str(content.get("relationships", "") or ""),
        str(content.get("semantic_context", "") or ""),
    ]
    return " ".join(part for part in parts if part)


def _relationship_semantic_text(content: dict) -> str:
    parts = []
    for column in content.get("columns", []) or []:
        if column.get("type") != "FOREIGN_KEY":
            continue
        parts.extend(
            [
                str(column.get("comment", "") or ""),
                str(column.get("constraint", "") or ""),
                str(column.get("column", "") or ""),
                str(column.get("referenced_table", "") or ""),
                str(column.get("referenced_column", "") or ""),
                " ".join(str(table) for table in column.get("tables", []) or []),
            ]
        )

    return " ".join(part for part in parts if part)


def _object_type_priority(content: dict, query: str) -> int:
    resource_type = str(content.get("resource_type", "") or "").upper()
    intent = analyze_query(query)

    if resource_type == "METRIC":
        return 8 if intent.requests_aggregate else 4
    if resource_type == "VIEW":
        return 5
    if resource_type == "MODEL":
        return 3
    return 0


def _is_explicit_table_match(table_name: str, query: str) -> bool:
    requested_names = {
        name.lower() for name in explicit_table_name_candidates(query)
    }
    return bool(table_name and table_name.lower() in requested_names)


def _semantic_document_score(content: dict, query: str) -> int:
    query_terms = _normalize_terms(query)
    if not query_terms:
        return 0

    intent = analyze_query(query)
    name_terms = _normalize_terms(str(content.get("name", "") or ""))
    semantic_terms = _normalize_terms(_table_description_semantic_text(content))
    relationship_terms = _normalize_terms(str(content.get("relationships", "") or ""))
    requested_dimension_terms = intent.requested_dimension_terms

    score = 0
    if _is_explicit_table_match(str(content.get("name", "") or ""), query):
        score += 100
    score += 6 * len(query_terms & name_terms)
    score += 3 * len(query_terms & semantic_terms)
    score += 5 * len(requested_dimension_terms & semantic_terms)
    if intent.requests_relationship:
        score += 8 if content.get("relationships") else 0
        score += 6 * len(query_terms & relationship_terms)
        score += 5 * len(intent.business_terms & relationship_terms)
    score += _object_type_priority(content, query)
    return score


def _schema_document_score(document: Document, query: str) -> int:
    query_terms = _normalize_terms(query)
    if not query_terms:
        return 0

    try:
        content = ast.literal_eval(document.content)
    except Exception:
        return 0

    intent = analyze_query(query)
    table_name = document.meta.get("name", "")
    table_terms = _normalize_terms(table_name)
    schema_terms = _normalize_terms(_schema_semantic_text(content))
    relationship_terms = _normalize_terms(_relationship_semantic_text(content))

    score = 0
    if _is_explicit_table_match(table_name, query):
        score += 100
    score += 6 * len(query_terms & table_terms)
    score += 3 * len(query_terms & schema_terms)
    score += 5 * len(intent.business_terms & schema_terms)
    if intent.requests_relationship:
        score += 10 if relationship_terms else 0
        score += 7 * len(query_terms & relationship_terms)
        score += 6 * len(intent.business_terms & relationship_terms)
    return score


def _document_table_description_name(document: Document) -> str:
    try:
        content = ast.literal_eval(document.content)
    except Exception:
        return document.meta.get("name", "")

    return str(content.get("name") or document.meta.get("name", "") or "")


def _filter_explicit_table_documents(
    documents: list[Document], query: str
) -> list[Document]:
    requested_names = {
        name.lower() for name in explicit_table_name_candidates(query)
    }
    if not requested_names:
        return documents

    exact_documents = [
        document
        for document in documents
        if _document_table_description_name(document).lower() in requested_names
    ]
    return exact_documents or documents


def _rerank_table_description_documents(
    documents: list[Document], query: str
) -> list[Document]:
    scored_documents = []
    for index, document in enumerate(documents):
        try:
            content = ast.literal_eval(document.content)
        except Exception:
            scored_documents.append((0, -index, document))
            continue

        scored_documents.append(
            (_semantic_document_score(content, query), -index, document)
        )

    return [
        document
        for _, _, document in sorted(
            scored_documents, key=lambda item: (item[0], item[1]), reverse=True
        )
    ]


def _tables_matching_query_terms(
    query: str,
    construct_db_schemas: list[dict],
) -> set[str]:
    query_terms = _normalize_terms(query)
    if not query_terms:
        return set()

    matching_tables = set()
    for table_schema in construct_db_schemas:
        if table_schema.get("type") != "TABLE":
            continue

        table_name_terms = _normalize_terms(str(table_schema.get("name", "") or ""))
        schema_terms = _normalize_terms(_schema_semantic_text(table_schema))
        direct_table_match = bool(query_terms & table_name_terms)
        semantic_match_count = len(query_terms & schema_terms)
        if direct_table_match or semantic_match_count >= 2:
            matching_tables.add(table_schema["name"])

    return matching_tables


def _column_search_terms(column: dict) -> set[str]:
    return _normalize_terms(
        " ".join(
            [
                str(column.get("name", "") or ""),
                str(column.get("comment", "") or ""),
                str(column.get("data_type", "") or ""),
            ]
        )
    )


def _column_contract_terms(column: dict) -> list[str]:
    role_terms = {
        term for role in _column_roles(column) for term in identifier_terms(role)
    }
    return sorted(
        _normalize_terms(
            " ".join(
                [
                    str(column.get("name", "") or ""),
                    str(column.get("comment", "") or ""),
                    str(column.get("data_type", "") or ""),
                ]
            )
        )
        | role_terms
    )


def _table_contract_terms(content: dict) -> list[str]:
    return sorted(
        _normalize_terms(
            " ".join(
                [
                    str(content.get("name", "") or ""),
                    str(content.get("comment", "") or ""),
                    str(content.get("properties", {}) or ""),
                ]
            )
        )
    )


def _compact_sql_generation_columns(content: dict, query: str) -> Optional[set[str]]:
    columns = [
        column
        for column in content.get("columns", [])
        if column.get("type") == "COLUMN"
        and column.get("name")
        and (
            column.get("data_type") is None
            or get_engine_supported_data_type(column.get("data_type")).lower()
            != "unknown"
        )
    ]
    if len(columns) <= _MAX_SQL_GENERATION_COLUMNS_PER_TABLE:
        return None

    query_terms = _normalize_terms(query)
    wants_time = bool(_TIME_QUERY_PATTERN.search(query or ""))
    wants_measure = bool(_MEASURE_QUERY_PATTERN.search(query or ""))
    wants_detail = bool(_DETAIL_QUERY_PATTERN.search(query or ""))
    selected: list[str] = []

    def add(column: dict) -> None:
        name = column.get("name")
        if name and name not in selected:
            selected.append(name)

    for column in columns:
        if column.get("is_primary_key"):
            add(column)

    for column in columns:
        if query_terms and query_terms & _column_search_terms(column):
            add(column)

    def add_role(role: str, limit: int = _MAX_SQL_GENERATION_ROLE_COLUMNS) -> None:
        added = 0
        for column in columns:
            if role in _column_roles(column):
                add(column)
                added += 1
                if added >= limit:
                    return

    if wants_time:
        add_role("date_time_candidate")
    if wants_measure:
        add_role("numeric_measure_candidate")
    if wants_detail:
        add_role("identifier_candidate")

    if not selected:
        add_role("dimension_candidate")
        add_role("identifier_candidate")

    return set(selected[:_MAX_SQL_GENERATION_COLUMNS_PER_TABLE])


def _build_metric_ddl(content: dict) -> str:
    columns = [
        column
        for column in content["columns"]
        if column["data_type"].lower()
        != "unknown"  # quick fix: filtering out UNKNOWN column type
    ]
    context = _format_semantic_context(
        {
            "object_type": "metric",
            "sql_identifier_contract": {
                "sql_table_name_use_exactly": content["name"],
                "sql_column_names_use_exactly": [
                    column["name"] for column in columns
                ],
            },
            "semantic_context_not_sql_identifiers": {
                "role": "stable analytical aggregation interface",
                "description": content["comment"],
            },
            "columns": [
                {
                    "sql_column_name_use_exactly": column["name"],
                    "data_type": get_engine_supported_data_type(column["data_type"]),
                    "semantic_context_not_sql_identifier": column["comment"],
                    **_semantic_role_context(column),
                }
                for column in columns
            ],
        }
    )
    columns_ddl = [
        f"{column['name']} {get_engine_supported_data_type(column['data_type'])}"
        for column in columns
    ]

    return (
        f"{context}CREATE TABLE {content['name']} (\n  "
        + ",\n  ".join(columns_ddl)
        + "\n);"
    )


def _content_column_names(content: dict) -> list[str]:
    return [
        column.get("name", "")
        for column in content.get("columns", [])
        if column.get("name")
    ]


def _format_semantic_context(context: dict) -> str:
    return (
        "/*\n"
        "WREN RETRIEVED SEMANTIC CONTEXT\n"
        f"{orjson.dumps(context).decode('utf-8')}\n"
        f"{_format_identifier_contract(context)}"
        "Only values in sql_identifier_contract, sql_column_name_use_exactly, and identifiers declared in the following DDL are executable in Wren SQL.\n"
        "Values under semantic_context_not_sql_identifiers and semantic_context_not_sql_identifier explain meaning only and must not be copied, combined, or rewritten as executable SQL identifiers.\n"
        "Values under column_role_hints_not_identifiers and semantic_roles_not_identifiers are meaning only; use them to map intent to exact declared columns, not as executable identifiers.\n"
        "*/\n"
        f"{_format_executable_identifier_catalog(context)}"
    )


def _normalized_data_type(column: dict) -> str:
    return str(column.get("data_type", "") or "").lower()


def _has_data_type_term(data_type: str, terms: set[str]) -> bool:
    return any(term in data_type for term in terms)


def _column_roles(column: dict) -> list[str]:
    name = str(column.get("name", "") or "")
    comment = str(column.get("comment", "") or "")
    searchable_text = f"{name} {comment}"
    data_type = _normalized_data_type(column)
    roles: list[str] = []

    is_date_time = _has_data_type_term(data_type, _DATE_TIME_TYPE_TERMS) or bool(
        _DATE_TIME_NAME_PATTERN.search(searchable_text)
    )
    is_identifier = bool(column.get("is_primary_key")) or bool(
        _IDENTIFIER_NAME_PATTERN.search(name)
    )
    is_numeric = _has_data_type_term(data_type, _NUMERIC_TYPE_TERMS)
    is_measure = is_numeric and not is_identifier

    if is_date_time:
        roles.append("date_time_candidate")
    if is_measure:
        roles.append("numeric_measure_candidate")
    if is_identifier:
        roles.append("identifier_candidate")
    if not is_date_time and not is_measure and not is_identifier:
        roles.append("dimension_candidate")

    return roles


def _semantic_role_context(column: dict) -> dict:
    roles = _column_roles(column)
    return {"semantic_roles_not_identifiers": roles} if roles else {}


def _format_executable_identifier_catalog(context: dict) -> str:
    contract = context.get("sql_identifier_contract", {})
    table_name = contract.get("sql_table_name_use_exactly")
    column_names = contract.get("sql_column_names_use_exactly") or [
        column["sql_column_name_use_exactly"]
        for column in context.get("columns", [])
        if column.get("sql_column_name_use_exactly")
    ]
    relationship_constraints = [
        relationship["sql_relationship_constraint_use_exactly"]
        for relationship in context.get("relationships", [])
        if relationship.get("sql_relationship_constraint_use_exactly")
    ]
    relationship_constraints = (
        contract.get("relationship_constraints_use_exactly")
        or relationship_constraints
    )

    lines = [
        "### EXECUTABLE WREN IDENTIFIER CATALOG ###",
        "Copy SQL identifiers only from this catalog or the following DDL.",
        "Do not create identifiers from user wording, semantic descriptions, display labels, source names, physical names, failed SQL, or reasoning text.",
        f"object_type: {context.get('object_type', '')}",
    ]
    if table_name:
        lines.append(f"table: {table_name}")
    if column_names:
        lines.append("columns:")
        lines.extend(f"- {column_name}" for column_name in column_names)
    role_hint_lines = [
        (
            column.get("sql_column_name_use_exactly"),
            column.get("semantic_roles_not_identifiers") or [],
        )
        for column in context.get("columns", [])
        if column.get("sql_column_name_use_exactly")
        and column.get("semantic_roles_not_identifiers")
    ]
    if role_hint_lines:
        lines.append("column_role_hints_not_identifiers:")
        lines.extend(
            f"- {column_name}: {', '.join(roles)}"
            for column_name, roles in role_hint_lines
        )
        lines.append(
            "Use role hints only to map question intent to exact columns listed above."
        )
    if relationship_constraints:
        lines.append("relationships:")
        lines.extend(f"- {constraint}" for constraint in relationship_constraints)
    lines.extend(
        [
            "If a needed table, column, or relationship is not listed here or declared in the following DDL, return null for sql.",
            "### END EXECUTABLE WREN IDENTIFIER CATALOG ###",
            "",
        ]
    )
    return "\n".join(lines)


def _format_identifier_contract(context: dict) -> str:
    contract = context.get("sql_identifier_contract", {})
    table_name = contract.get("sql_table_name_use_exactly")
    column_names = contract.get("sql_column_names_use_exactly") or [
        column["sql_column_name_use_exactly"]
        for column in context.get("columns", [])
        if column.get("sql_column_name_use_exactly")
    ]
    relationship_constraints = [
        relationship["sql_relationship_constraint_use_exactly"]
        for relationship in context.get("relationships", [])
        if relationship.get("sql_relationship_constraint_use_exactly")
    ]
    relationship_constraints = (
        contract.get("relationship_constraints_use_exactly")
        or relationship_constraints
    )

    lines = [
        "WREN SQL IDENTIFIER CONTRACT",
        f"object_type: {context.get('object_type', '')}",
    ]
    if table_name:
        lines.append(f"sql_table_name_use_exactly: {table_name}")
    if column_names:
        lines.append("sql_column_names_use_exactly:")
        lines.extend(f"- {column_name}" for column_name in column_names)
    if relationship_constraints:
        lines.append("relationship_constraints_use_exactly:")
        lines.extend(
            f"- {relationship_constraint}"
            for relationship_constraint in relationship_constraints
        )
    lines.extend(
        [
            "Only the identifiers listed in this contract and the identifiers declared in the following DDL are executable.",
            "Semantic descriptions, source names, aliases, examples, and user wording are not executable identifiers.",
            "END WREN SQL IDENTIFIER CONTRACT",
            "",
        ]
    )
    return "\n".join(lines)


def _included_relationship_columns(content: dict, tables: Optional[set[str]]) -> set:
    relationship_columns = {
        column.get("column")
        for column in content["columns"]
        if column["type"] == "FOREIGN_KEY"
        and (not tables or set(column.get("tables", [])).issubset(tables))
    }
    relationship_columns.discard(None)
    return relationship_columns


def _included_columns(
    content: dict, columns: Optional[set[str]], tables: Optional[set[str]]
) -> list[dict]:
    relationship_columns = _included_relationship_columns(content, tables)
    return [
        column
        for column in content["columns"]
        if column["type"] == "COLUMN"
        and (
            not columns
            or column["name"] in columns
            or column["name"] in relationship_columns
            or column["is_primary_key"]
        )
        and (
            column["data_type"] is None
            or get_engine_supported_data_type(column["data_type"]).lower()
            != "unknown"
        )
    ]


def _included_relationships(content: dict, tables: Optional[set[str]]) -> list[dict]:
    return [
        column
        for column in content["columns"]
        if column["type"] == "FOREIGN_KEY"
        and (not tables or set(column.get("tables", [])).issubset(tables))
    ]


def _build_table_context_ddl(
    content: dict,
    columns: Optional[set[str]] = None,
    tables: Optional[set[str]] = None,
) -> tuple[str, bool, bool, list[str]]:
    included_columns = _included_columns(content, columns, tables)
    included_relationships = _included_relationships(content, tables)
    column_names = [column["name"] for column in included_columns]
    ddl, has_calculated_field, has_json_field = build_table_ddl(
        content,
        columns=set(column_names) if column_names else columns,
        tables=tables,
        include_semantic_comments=False,
    )
    context = _format_semantic_context(
        {
            "object_type": "model",
            "sql_identifier_contract": {
                "sql_table_name_use_exactly": content["name"],
                "sql_column_names_use_exactly": column_names,
                "relationship_constraints_use_exactly": [
                    relationship["constraint"]
                    for relationship in included_relationships
                ],
            },
            "semantic_context_not_sql_identifiers": {
                "description": content.get("comment", ""),
            },
            "columns": [
                {
                    "sql_column_name_use_exactly": column["name"],
                    "data_type": get_engine_supported_data_type(column["data_type"]),
                    "is_primary_key": column["is_primary_key"],
                    "semantic_context_not_sql_identifier": column["comment"],
                    **_semantic_role_context(column),
                }
                for column in included_columns
            ],
            "relationships": [
                {
                    "semantic_context_not_sql_identifier": relationship["comment"],
                    "sql_relationship_constraint_use_exactly": relationship[
                        "constraint"
                    ],
                    "related_models_use_exactly": relationship.get("tables", []),
                }
                for relationship in included_relationships
            ],
        }
    )

    return context + ddl, has_calculated_field, has_json_field, column_names


def _build_view_ddl(content: dict) -> str:
    columns = [
        column
        for column in content.get("columns", [])
        if column.get("name")
        and str(column.get("data_type", "")).lower() != "unknown"
    ]
    column_names = [column["name"] for column in columns]
    context = _format_semantic_context(
        {
            "object_type": "view",
            "sql_identifier_contract": {
                "sql_table_name_use_exactly": content["name"],
                "sql_column_names_use_exactly": column_names,
            },
            "semantic_context_not_sql_identifiers": {
                "role": "stable virtual table interface",
                "description": content.get("comment", ""),
                "definition_omitted_from_executable_schema": True,
            },
            "columns": [
                {
                    "sql_column_name_use_exactly": column["name"],
                    "data_type": get_engine_supported_data_type(
                        column.get("data_type")
                    ),
                    "semantic_context_not_sql_identifier": column.get("comment", ""),
                    **_semantic_role_context(column),
                }
                for column in columns
            ],
        }
    )
    columns_ddl = [
        f"{column['name']} {get_engine_supported_data_type(column.get('data_type'))}"
        for column in columns
    ]

    return (
        f"{context}CREATE TABLE {content['name']} (\n  "
        + ",\n  ".join(columns_ddl)
        + "\n);"
    )


def _build_retrieval_results_from_schemas(
    construct_db_schemas: list[dict],
    dbschema_retrieval: list[Document],
    query: str = "",
    compact_wide_tables: bool = False,
) -> dict[str, Any]:
    retrieval_results = []
    has_calculated_field = False
    has_metric = False
    has_json_field = False

    for table_schema in construct_db_schemas:
        if table_schema["type"] == "TABLE":
            compact_columns = (
                _compact_sql_generation_columns(table_schema, query)
                if compact_wide_tables
                else None
            )
            ddl, _has_calculated_field, _has_json_field, column_names = (
                _build_table_context_ddl(table_schema, columns=compact_columns)
            )
            retrieval_results.append(
                {
                    "table_name": table_schema["name"],
                    "table_ddl": ddl,
                    "column_names": column_names,
                    "manifest_column_names": column_names,
                    "table_semantic_terms": _table_contract_terms(table_schema),
                    "column_semantic_terms": {
                        column["name"]: _column_contract_terms(column)
                        for column in table_schema.get("columns", [])
                        if column.get("type") == "COLUMN"
                        and column.get("name") in column_names
                    },
                    "relationship_constraints": _relationship_constraints(
                        table_schema
                    ),
                }
            )
            if _has_calculated_field:
                has_calculated_field = True
            if _has_json_field:
                has_json_field = True

    for document in dbschema_retrieval:
        content = ast.literal_eval(document.content)

        if content["type"] == "METRIC":
            column_names = _content_column_names(content)
            retrieval_results.append(
                {
                    "table_name": content["name"],
                    "table_ddl": _build_metric_ddl(content),
                    "column_names": column_names,
                    "manifest_column_names": column_names,
                    "table_semantic_terms": _table_contract_terms(content),
                    "column_semantic_terms": {
                        column["name"]: _column_contract_terms(column)
                        for column in content.get("columns", [])
                        if column.get("name") in column_names
                    },
                    "relationship_constraints": [],
                }
            )
            has_metric = True
        elif content["type"] == "VIEW":
            column_names = _content_column_names(content)
            retrieval_results.append(
                {
                    "table_name": content["name"],
                    "table_ddl": _build_view_ddl(content),
                    "column_names": column_names,
                    "manifest_column_names": column_names,
                    "table_semantic_terms": _table_contract_terms(content),
                    "column_semantic_terms": {
                        column["name"]: _column_contract_terms(column)
                        for column in content.get("columns", [])
                        if column.get("name") in column_names
                    },
                    "relationship_constraints": [],
                }
            )

    return {
        "retrieval_results": retrieval_results,
        "has_calculated_field": has_calculated_field,
        "has_metric": has_metric,
        "has_json_field": has_json_field,
    }


def _retrieval_result_score(retrieval_result: dict, query: str) -> int:
    query_terms = _normalize_terms(query)
    if not query_terms:
        return 0

    intent = analyze_query(query)
    table_terms = set(retrieval_result.get("table_semantic_terms", []) or [])
    column_terms = {
        term
        for terms in (retrieval_result.get("column_semantic_terms", {}) or {}).values()
        for term in terms
    }
    relationship_text = " ".join(
        str(constraint)
        for constraint in retrieval_result.get("relationship_constraints", []) or []
    )
    relationship_terms = _normalize_terms(relationship_text)

    score = 0
    score += 5 * len(query_terms & table_terms)
    score += 3 * len(query_terms & column_terms)
    score += 5 * len(intent.business_terms & (table_terms | column_terms))
    if intent.requests_relationship:
        score += 8 if relationship_terms else 0
        score += 6 * len(query_terms & relationship_terms)
        score += 5 * len(intent.business_terms & relationship_terms)
    return score


def _limit_retrieval_results(
    retrieval_results: list[dict], query: str = ""
) -> list[dict]:
    if not query:
        return retrieval_results[:_MAX_SQL_GENERATION_SCHEMA_RESULTS]

    scored_results = [
        (_retrieval_result_score(retrieval_result, query), -index, retrieval_result)
        for index, retrieval_result in enumerate(retrieval_results)
    ]
    return [
        retrieval_result
        for _, _, retrieval_result in sorted(
            scored_results, key=lambda item: (item[0], item[1]), reverse=True
        )[:_MAX_SQL_GENERATION_SCHEMA_RESULTS]
    ]


## Start of Pipeline
@observe(capture_input=False)
async def active_mdl_hash(
    project_id: str,
    mdl_hash: str,
    table_description_store: Any,
    dbschema_store: Any,
) -> str:
    if not project_id or not mdl_hash:
        return mdl_hash

    filters = build_project_deploy_filter(project_id=project_id, mdl_hash=mdl_hash)
    table_description_count, dbschema_count = await asyncio.gather(
        table_description_store.count_documents(filters=filters),
        dbschema_store.count_documents(filters=filters),
    )

    if not dbschema_count:
        logger.warning(
            "Project ID: %s, MDL hash %s has no indexed schema documents; "
            "keeping hash scope to avoid stale project metadata reuse.",
            project_id,
            mdl_hash,
        )
    elif not table_description_count:
        logger.info(
            "Project ID: %s, MDL hash %s has indexed db schema documents but no table descriptions; "
            "using deployed db schema documents for retrieval.",
            project_id,
            mdl_hash,
        )

    return mdl_hash


@observe(capture_input=False, capture_output=False)
async def embedding(
    query: str,
    embedder: Any,
    histories: list[AskHistory],
    project_id: str = "",
    mdl_hash: str = "",
    dbschema_store: Any = None,
    table_description_store: Any = None,
) -> dict:
    if project_id and mdl_hash and dbschema_store:
        schema_filters = {
            "operator": "AND",
            "conditions": [
                {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
                *build_project_deploy_filter(
                    project_id=project_id,
                    mdl_hash=mdl_hash,
                )["conditions"],
            ],
        }
        schema_count = await dbschema_store.count_documents(filters=schema_filters)
        if schema_count and table_description_store:
            table_description_filters = {
                "operator": "AND",
                "conditions": [
                    {
                        "field": "type",
                        "operator": "==",
                        "value": "TABLE_DESCRIPTION",
                    },
                    *build_project_deploy_filter(
                        project_id=project_id,
                        mdl_hash=mdl_hash,
                    )["conditions"],
                ],
            }
            table_description_count = await table_description_store.count_documents(
                filters=table_description_filters
            )
            if table_description_count:
                return await embedder.run(query) if query else {}

        if schema_count:
            return {}

    if query:
        return await embedder.run(query)

    return {}


@observe(capture_input=False)
async def table_retrieval(
    embedding: dict,
    project_id: str,
    tables: list[str],
    table_retriever: Any,
    active_mdl_hash: Optional[str] = None,
    mdl_hash: str = "",
    query: str = "",
) -> dict:
    effective_mdl_hash = active_mdl_hash or mdl_hash
    filters = {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_DESCRIPTION"},
        ],
    }

    if project_id:
        filters["conditions"].append(
            {"field": "project_id", "operator": "==", "value": project_id}
        )

    if effective_mdl_hash:
        filters["conditions"].append(
            {"field": "mdl_hash", "operator": "==", "value": effective_mdl_hash}
        )

    if embedding:
        result = await table_retriever.run(
            query_embedding=embedding.get("embedding"),
            filters=filters,
        )
        ranked_documents = _rerank_table_description_documents(
            result.get("documents", []), query=query
        )
        result["documents"] = _filter_explicit_table_documents(
            ranked_documents, query=query
        )
        return result

    if not tables:
        return {"documents": []}

    filters["conditions"].append({"field": "name", "operator": "in", "value": tables})

    return await table_retriever.run(
        query_embedding=[],
        filters=filters,
    )


@observe(capture_input=False)
async def dbschema_retrieval(
    table_retrieval: dict,
    project_id: str,
    dbschema_retriever: Any,
    active_mdl_hash: Optional[str] = None,
    mdl_hash: str = "",
    embedding: Optional[dict] = None,
    query: str = "",
) -> list[Document]:
    effective_mdl_hash = active_mdl_hash or mdl_hash
    intent = analyze_query(query)

    def _base_filters() -> dict:
        project_deploy_filter = build_project_deploy_filter(
            project_id=project_id,
            mdl_hash=effective_mdl_hash,
        )
        filters = {
            "operator": "AND",
            "conditions": [
                {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
            ],
        }

        if project_deploy_filter:
            filters["conditions"] += project_deploy_filter["conditions"]

        return filters

    def _filters_for_names(table_names: list[str]) -> dict:
        filters = _base_filters()
        filters["conditions"].insert(
            1,
            {
                "operator": "OR",
                "conditions": [
                    {"field": "name", "operator": "==", "value": table_name}
                    for table_name in table_names
                ],
            },
        )
        return filters

    async def _fetch_by_names(table_names: list[str]) -> list[Document]:
        if not table_names:
            return []

        results = await dbschema_retriever.run(
            query_embedding=[],
            filters=_filters_for_names(table_names),
        )
        return results["documents"]

    def _document_name(document: Document) -> str:
        return document.meta.get("name", "")

    def _related_table_names(documents: list[Document], visited: set[str]) -> list[str]:
        limit = (
            _MAX_RELATED_SCHEMA_RELATIONSHIP_CANDIDATES
            if intent.requests_relationship
            else _MAX_RELATED_SCHEMA_TABLE_CANDIDATES
        )
        related_names = []
        for document in documents:
            content = ast.literal_eval(document.content)
            if content.get("type") != "TABLE_COLUMNS":
                continue

            for column in content.get("columns", []):
                if column.get("type") != "FOREIGN_KEY":
                    continue

                candidates = list(column.get("tables", []) or [])
                if column.get("referenced_table"):
                    candidates.append(column["referenced_table"])

                for table_name in candidates:
                    if table_name and table_name not in visited:
                        visited.add(table_name)
                        related_names.append(table_name)
                        if len(related_names) >= limit:
                            return related_names

        return related_names

    def _document_key(document: Document) -> tuple[str, str]:
        return document.meta.get("name", ""), document.content or ""

    def _extend_unique_documents(
        target: list[Document],
        source: list[Document],
        seen: set[tuple[str, str]],
    ) -> None:
        for document in source:
            key = _document_key(document)
            if key in seen:
                continue

            seen.add(key)
            target.append(document)

    tables = table_retrieval.get("documents", [])
    table_names = []
    for table in tables:
        content = ast.literal_eval(table.content)
        table_name = content.get("name")
        if table_name and table_name not in table_names:
            table_names.append(table_name)

    documents = []
    seen_documents = set()
    if not table_names and not (embedding and embedding.get("embedding")):
        results = await dbschema_retriever.run(
            query_embedding=[],
            filters=_base_filters(),
        )
        return results["documents"]

    if embedding and embedding.get("embedding"):
        results = await dbschema_retriever.run(
            query_embedding=embedding.get("embedding"),
            filters=_base_filters(),
        )
        semantic_limit = (
            _MAX_SCHEMA_RELATIONSHIP_TABLE_CANDIDATES
            if intent.requests_relationship
            else _MAX_SCHEMA_SEMANTIC_TABLE_CANDIDATES
        )
        added_schema_table_names = 0
        semantic_documents = (
            sorted(
                results["documents"],
                key=lambda document: _schema_document_score(document, query),
                reverse=True,
            )
            if query
            else results["documents"]
        )
        for document in semantic_documents:
            table_name = _document_name(document)
            if table_name and table_name not in table_names:
                table_names.append(table_name)
                added_schema_table_names += 1
                if added_schema_table_names >= semantic_limit:
                    break

    visited = set(table_names)
    current_documents = await _fetch_by_names(table_names)
    _extend_unique_documents(documents, current_documents, seen_documents)

    related_names = _related_table_names(current_documents, visited)
    related_documents = await _fetch_by_names(related_names)
    _extend_unique_documents(documents, related_documents, seen_documents)

    if intent.requests_relationship:
        second_hop_related_names = _related_table_names(related_documents, visited)
        second_hop_related_documents = await _fetch_by_names(second_hop_related_names)
        _extend_unique_documents(
            documents, second_hop_related_documents, seen_documents
        )

    return documents



@observe()
def construct_db_schemas(dbschema_retrieval: list[Document]) -> list[dict]:
    db_schemas = {}
    for document in dbschema_retrieval:
        content = ast.literal_eval(document.content)
        if content["type"] == "TABLE":
            if document.meta["name"] not in db_schemas:
                db_schemas[document.meta["name"]] = content
            else:
                db_schemas[document.meta["name"]] = {
                    **content,
                    "columns": db_schemas[document.meta["name"]].get("columns", []),
                }
        elif content["type"] == "TABLE_COLUMNS":
            if document.meta["name"] not in db_schemas:
                db_schemas[document.meta["name"]] = {"columns": content["columns"]}
            else:
                if "columns" not in db_schemas[document.meta["name"]]:
                    db_schemas[document.meta["name"]]["columns"] = content["columns"]
                else:
                    db_schemas[document.meta["name"]]["columns"] += content["columns"]

    # remove incomplete schemas
    db_schemas = {k: v for k, v in db_schemas.items() if "type" in v and "columns" in v}

    return list(db_schemas.values())


@observe(capture_input=False)
def check_using_db_schemas_without_pruning(
    construct_db_schemas: list[dict],
    dbschema_retrieval: list[Document],
    encoding: tiktoken.Encoding,
    enable_column_pruning: bool,
    context_window_size: int,
    query: str = "",
) -> dict:
    built_results = _build_retrieval_results_from_schemas(
        construct_db_schemas=construct_db_schemas,
        dbschema_retrieval=dbschema_retrieval,
        query=query,
        compact_wide_tables=False,
    )
    retrieval_results = built_results["retrieval_results"]

    table_ddls = [
        retrieval_result["table_ddl"] for retrieval_result in retrieval_results
    ]
    _token_count = len(encoding.encode(" ".join(table_ddls)))
    if _token_count > context_window_size or enable_column_pruning:
        return {
            "db_schemas": [],
            "tokens": _token_count,
            "has_calculated_field": built_results["has_calculated_field"],
            "has_metric": built_results["has_metric"],
            "has_json_field": built_results["has_json_field"],
        }

    return {
        "db_schemas": _limit_retrieval_results(retrieval_results, query=query),
        "tokens": _token_count,
        "has_calculated_field": built_results["has_calculated_field"],
        "has_metric": built_results["has_metric"],
        "has_json_field": built_results["has_json_field"],
    }


@observe(capture_input=False)
def prompt(
    query: str,
    construct_db_schemas: list[dict],
    prompt_builder: PromptBuilder,
    check_using_db_schemas_without_pruning: dict,
    histories: list[AskHistory],
) -> dict:
    if not check_using_db_schemas_without_pruning["db_schemas"]:
        db_schemas = [
            _build_table_context_ddl(construct_db_schema)[0]
            for construct_db_schema in construct_db_schemas
        ]

        _prompt = prompt_builder.run(question=query, db_schemas=db_schemas)
        return {"prompt": clean_up_new_lines(_prompt.get("prompt"))}
    else:
        return {}


@observe(as_type="generation", capture_input=False)
@trace_cost
async def filter_columns_in_tables(
    prompt: dict, table_columns_selection_generator: Any, generator_name: str
) -> dict:
    if prompt:
        try:
            return await table_columns_selection_generator(
                prompt=prompt.get("prompt")
            ), generator_name
        except Exception:
            logger.exception(
                "Column-selection generation failed; falling back to schema retrieval without LLM pruning."
            )
            return {}, generator_name
    else:
        return {}, generator_name


@observe()
def construct_retrieval_results(
    check_using_db_schemas_without_pruning: dict,
    filter_columns_in_tables: dict,
    construct_db_schemas: list[dict],
    dbschema_retrieval: list[Document],
    query: str = "",
) -> dict[str, Any]:
    def _fallback_results() -> dict[str, Any]:
        fallback_results = _build_retrieval_results_from_schemas(
            construct_db_schemas=construct_db_schemas,
            dbschema_retrieval=dbschema_retrieval,
            query=query,
            compact_wide_tables=True,
        )
        return {
            "retrieval_results": _limit_retrieval_results(
                fallback_results["retrieval_results"],
                query=query,
            ),
            "has_calculated_field": fallback_results["has_calculated_field"],
            "has_metric": fallback_results["has_metric"],
            "has_json_field": fallback_results["has_json_field"],
        }

    if filter_columns_in_tables:
        try:
            column_selection = orjson.loads(filter_columns_in_tables["replies"][0])
        except Exception:
            logger.exception(
                "Column-selection response was invalid; falling back to schema retrieval without LLM pruning."
            )
            return _fallback_results()

        columns_and_tables_needed = (
            column_selection.get("results")
            if isinstance(column_selection, dict)
            else column_selection
        )
        if not isinstance(columns_and_tables_needed, list):
            logger.warning(
                "Column-selection response did not include a results list; falling back to schema retrieval without LLM pruning."
            )
            return _fallback_results()

        # we need to change the below code to match the new schema of structured output
        # the objective of this loop is to change the structure of JSON to match the needed format
        reformated_json = {}
        for table in columns_and_tables_needed:
            if (
                not isinstance(table, dict)
                or not isinstance(table.get("table_name"), str)
                or not isinstance(table.get("table_contents"), dict)
            ):
                logger.warning(
                    "Column-selection response contained an invalid table item; falling back to schema retrieval without LLM pruning."
                )
                return _fallback_results()
            reformated_json[table["table_name"]] = table["table_contents"]
        columns_and_tables_needed = reformated_json
        tables = set(columns_and_tables_needed.keys())
        tables.update(_tables_matching_query_terms(query, construct_db_schemas))
        retrieval_results = []
        has_calculated_field = False
        has_metric = False
        has_json_field = False

        for table_schema in construct_db_schemas:
            if table_schema["type"] == "TABLE" and table_schema["name"] in tables:
                ddl, _has_calculated_field, _has_json_field, column_names = (
                    _build_table_context_ddl(table_schema)
                )
                if _has_calculated_field:
                    has_calculated_field = True
                if _has_json_field:
                    has_json_field = True

                retrieval_results.append(
                    {
                        "table_name": table_schema["name"],
                        "table_ddl": ddl,
                        "column_names": column_names,
                        "manifest_column_names": column_names,
                        "table_semantic_terms": _table_contract_terms(table_schema),
                        "column_semantic_terms": {
                            column["name"]: _column_contract_terms(column)
                            for column in table_schema.get("columns", [])
                            if column.get("type") == "COLUMN"
                            and column.get("name") in column_names
                        },
                        "relationship_constraints": _relationship_constraints(
                            table_schema
                        ),
                    }
                )

        for document in dbschema_retrieval:
            content = ast.literal_eval(document.content)

            if content["type"] == "METRIC":
                column_names = _content_column_names(content)
                retrieval_results.append(
                    {
                        "table_name": content["name"],
                        "table_ddl": _build_metric_ddl(content),
                        "column_names": column_names,
                        "manifest_column_names": column_names,
                        "table_semantic_terms": _table_contract_terms(content),
                        "column_semantic_terms": {
                            column["name"]: _column_contract_terms(column)
                            for column in content.get("columns", [])
                            if column.get("name") in column_names
                        },
                        "relationship_constraints": [],
                    }
                )
                has_metric = True
            elif content["type"] == "VIEW":
                column_names = _content_column_names(content)
                retrieval_results.append(
                    {
                        "table_name": content["name"],
                        "table_ddl": _build_view_ddl(content),
                        "column_names": column_names,
                        "manifest_column_names": column_names,
                        "table_semantic_terms": _table_contract_terms(content),
                        "column_semantic_terms": {
                            column["name"]: _column_contract_terms(column)
                            for column in content.get("columns", [])
                            if column.get("name") in column_names
                        },
                        "relationship_constraints": [],
                    }
                )

        return {
            "retrieval_results": _limit_retrieval_results(
                retrieval_results, query=query
            ),
            "has_calculated_field": has_calculated_field,
            "has_metric": has_metric,
            "has_json_field": has_json_field,
        }
    else:
        if check_using_db_schemas_without_pruning["db_schemas"]:
            retrieval_results = _limit_retrieval_results(
                check_using_db_schemas_without_pruning["db_schemas"],
                query=query,
            )
            has_calculated_field = check_using_db_schemas_without_pruning[
                "has_calculated_field"
            ]
            has_metric = check_using_db_schemas_without_pruning["has_metric"]
            has_json_field = check_using_db_schemas_without_pruning["has_json_field"]
        else:
            fallback_results = _build_retrieval_results_from_schemas(
                construct_db_schemas=construct_db_schemas,
                dbschema_retrieval=dbschema_retrieval,
                query=query,
                compact_wide_tables=True,
            )
            retrieval_results = _limit_retrieval_results(
                fallback_results["retrieval_results"],
                query=query,
            )
            has_calculated_field = fallback_results["has_calculated_field"]
            has_metric = fallback_results["has_metric"]
            has_json_field = fallback_results["has_json_field"]

        return {
            "retrieval_results": retrieval_results,
            "has_calculated_field": has_calculated_field,
            "has_metric": has_metric,
            "has_json_field": has_json_field,
        }


## End of Pipeline
class MatchingTableContents(BaseModel):
    chain_of_thought_reasoning: list[str]
    columns: list[str]


class MatchingTable(BaseModel):
    table_name: str
    table_contents: MatchingTableContents
    table_selection_reason: str


class RetrievalResults(BaseModel):
    results: list[MatchingTable]


RETRIEVAL_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "retrieval_schema",
            "schema": RetrievalResults.model_json_schema(),
        },
    }
}


class DbSchemaRetrieval(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        embedder_provider: EmbedderProvider,
        document_store_provider: DocumentStoreProvider,
        table_retrieval_size: int = 10,
        table_column_retrieval_size: int = 100,
        **kwargs,
    ):
        table_description_store = document_store_provider.get_store(
            dataset_name="table_descriptions"
        )
        dbschema_store = document_store_provider.get_store()

        self._components = {
            "embedder": embedder_provider.get_text_embedder(),
            "table_retriever": document_store_provider.get_retriever(
                table_description_store,
                top_k=table_retrieval_size,
            ),
            "dbschema_retriever": document_store_provider.get_retriever(
                dbschema_store,
                top_k=table_column_retrieval_size,
            ),
            "table_description_store": table_description_store,
            "dbschema_store": dbschema_store,
            "table_columns_selection_generator": llm_provider.get_generator(
                system_prompt=table_columns_selection_system_prompt,
                generation_kwargs=RETRIEVAL_MODEL_KWARGS,
            ),
            "generator_name": llm_provider.get_model(),
            "prompt_builder": PromptBuilder(
                template=table_columns_selection_user_prompt_template
            ),
        }

        # for the first time, we need to load the encodings
        _model = llm_provider.get_model()
        if "gpt-4o" in _model or "gpt-4o-mini" in _model:
            _encoding = tiktoken.get_encoding("o200k_base")
        else:
            _encoding = tiktoken.get_encoding("cl100k_base")

        self._configs = {
            "encoding": _encoding,
            "context_window_size": llm_provider.get_context_window_size(),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Ask Retrieval")
    async def run(
        self,
        query: str = "",
        tables: Optional[list[str]] = None,
        project_id: Optional[str] = None,
        mdl_hash: Optional[str] = None,
        histories: Optional[list[AskHistory]] = None,
        enable_column_pruning: bool = False,
    ):
        logger.info("Ask Retrieval pipeline is running...")
        return await self._pipe.execute(
            ["construct_retrieval_results"],
            inputs={
                "query": query,
                "tables": tables,
                "project_id": project_id or "",
                "mdl_hash": mdl_hash or "",
                "histories": histories or [],
                "enable_column_pruning": enable_column_pruning,
                **self._components,
                **self._configs,
            },
        )
