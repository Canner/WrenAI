import ast
import asyncio
import logging
import re
import sys
import time
from functools import lru_cache
from typing import Any, Optional

import orjson
import sqlparse
import tiktoken
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack import Document
from haystack.components.builders.prompt_builder import PromptBuilder
from pydantic import BaseModel, ConfigDict
from sqlparse.sql import Identifier, IdentifierList
from sqlparse.tokens import DML, Comment, Keyword

from langfuse.decorators import observe
from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider, EmbedderProvider, LLMProvider
from src.pipelines.common import (
    build_project_deploy_filter,
    build_table_ddl,
    clean_up_new_lines,
    get_engine_supported_data_type,
)
from src.utils import trace_cost
from src.web.v1.services.ask import AskHistory

logger = logging.getLogger("wren-ai-service")

_SEMANTIC_TABLE_NAME_MERGE_LIMIT = 8
_LEXICAL_SCHEMA_TABLE_NAME_MERGE_LIMIT = 8
_MAX_RETRIEVED_TABLE_NAMES = 24
_MAX_LLM_SCHEMA_CONTEXT_TABLES = 8
_MAX_LLM_SCHEMA_CONTEXT_TOKENS = 12_000
_MAX_RELATED_TABLE_EXPANSION_DEPTH = 1
_RANK_TOKEN = re.compile(r"[a-z0-9]+")
_RANK_GENERIC_QUERY_TOKENS = {
    "a",
    "across",
    "all",
    "an",
    "and",
    "as",
    "average",
    "avg",
    "between",
    "bottom",
    "breakdown",
    "bucket",
    "buckets",
    "by",
    "count",
    "counts",
    "date",
    "day",
    "descending",
    "distribution",
    "each",
    "for",
    "from",
    "group",
    "grouped",
    "groups",
    "has",
    "have",
    "highest",
    "how",
    "in",
    "is",
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
    "blank",
    "empty",
    "missing",
    "null",
    "month",
    "monthly",
    "most",
    "newest",
    "number",
    "of",
    "ordered",
    "per",
    "quarter",
    "recent",
    "record",
    "records",
    "result",
    "results",
    "row",
    "rows",
    "show",
    "sort",
    "sorted",
    "sum",
    "the",
    "there",
    "this",
    "to",
    "top",
    "total",
    "using",
    "was",
    "week",
    "were",
    "what",
    "where",
    "which",
    "with",
    "year",
}
_COMPOUND_IDENTIFIER_PART_TOKENS = {
    "account",
    "amount",
    "balance",
    "business",
    "buyer",
    "category",
    "client",
    "company",
    "count",
    "customer",
    "date",
    "division",
    "failure",
    "gross",
    "group",
    "invoice",
    "market",
    "material",
    "month",
    "name",
    "order",
    "person",
    "priority",
    "product",
    "quantity",
    "record",
    "repair",
    "sales",
    "salesperson",
    "severity",
    "status",
    "supplier",
    "ticket",
    "type",
    "unit",
    "value",
    "vendor",
    "year",
}
_COMPOUND_IDENTIFIER_ALIASES = {
    "acct": {"account"},
    "amt": {"amount"},
    "bu": {"business", "unit"},
    "cust": {"customer"},
    "gl": {"general", "ledger"},
    "ord": {"order"},
    "prod": {"product"},
    "qty": {"quantity"},
    "vend": {"vendor"},
}

_ALL_SCHEMA_DOCUMENTS_CACHE: dict[tuple[int, str, str], list[Document]] = {}
_ALL_SCHEMA_DOCUMENTS_CACHE_LOCKS: dict[tuple[int, str, str], asyncio.Lock] = {}
_SCHEMA_DOCUMENTS_CACHE: dict[
    tuple[int, str, str, tuple[str, ...]], list[Document]
] = {}
_SCHEMA_DOCUMENTS_CACHE_LOCKS: dict[
    tuple[int, str, str, tuple[str, ...]], asyncio.Lock
] = {}


def _elapsed_ms(started_at: float) -> float:
    return (time.perf_counter() - started_at) * 1000


def _log_retrieval_timing(
    stage: str,
    started_at: float,
    project_id: str | None = None,
    **fields: Any,
) -> None:
    suffix = " ".join(
        f"{key}={value}" for key, value in fields.items() if value is not None
    )
    logger.info(
        "Ask timing project_id=%s stage=%s elapsed_ms=%.1f%s%s",
        project_id or "",
        stage,
        _elapsed_ms(started_at),
        " " if suffix else "",
        suffix,
    )


table_columns_selection_system_prompt = """
### TASK ###
You are a highly skilled data analyst. Your goal is to examine the provided database schema, interpret the posed question, and identify the specific columns from the relevant tables required to construct an accurate SQL query.

The database schema includes structural, semantic, and business modeling metadata:
- Models are logical datasets backed by physical tables or SQL definitions.
- Columns are exposed fields, including renamed fields, expressions, primary keys, and calculated fields.
- Relationships are reusable join logic between models.
- Calculated fields are business logic defined once and reused across queries.
- Views are named SQL statements that behave like stable virtual tables.
- Metrics are structured aggregation objects with measures and dimensions.

### INSTRUCTIONS ###
1. Carefully analyze the schema and identify the essential tables and columns needed to answer the question.
2. For each table, provide a clear and concise reasoning for why specific columns are selected.
3. List each reason as part of a step-by-step chain of thought, justifying the inclusion of each column.
4. If a "." is included in columns, put the name before the first dot into chosen columns.
5. The number of columns chosen must match the number of reasoning.
6. Final chosen columns must be only column names, don't prefix it with table names.
7. If the chosen column is a child column of a STRUCT type column, choose the parent column instead of the child column.
8. Map the business question to the modeled datasets whose descriptions, aliases, columns, calculated fields, views, metrics, and relationships support the intent.
9. Prefer modeled analytical interfaces such as views and metrics when they expose the fields needed to answer the question.
10. If the answer needs fields, filters, time dimensions, ordering, aggregations, or relationship keys from multiple related datasets, include every required related dataset and the columns needed from each one.
11. Reuse calculated fields and metric measures or dimensions when they already represent the requested business concept.
12. Follow only the relationships shown in the provided schema when selecting columns across datasets.
13. Do not stop at a single top candidate when the question needs multiple related datasets.
14. If the same business concept is represented by multiple modeled datasets, select each relevant dataset and the fields needed to answer the shared intent.
15. If multiple modeled datasets expose compatible fields for the same requested result shape, keep each relevant dataset available so SQL generation can combine them as separate result rows instead of discarding all but one.
16. Prefer the set of deployed models, views, metrics, columns, and relationships that best support the current question.
17. If WREN RETRIEVED SEMANTIC CONTEXT is present, use sql_table_name_use_exactly and sql_column_name_use_exactly values as the exact names to return.
18. Use semantic_context_not_sql_identifiers and semantic_context_not_sql_identifier only to understand meaning. Do not return descriptions, labels, source metadata, or rewritten variants as table or column names.
19. Prefer tables and columns whose supplied names, descriptions, relationships, metrics, or sample values directly support the requested entities, measures, filters, dates, identifiers, and dimensions. Do not answer from generic log, file, JSON, payload, text, or app-metric columns when retrieved schema metadata provides specific modeled columns for the same requested concept.
20. Compare the user's requested entities, measures, filters, dates, and dimensions only with schema metadata supplied for the active project. Do not use built-in business synonym lists.
21. If a table only contains generic data/payload/text fields and another table exposes exact business columns that match the request, choose the business table instead of searching the generic field with LIKE.
22. Never return placeholder table or column names or any user-worded identifier unless the exact same identifier appears in the provided CREATE TABLE statement or identifier contract.
23. If a requested measure, dimension, filter, or time field is not represented by retrieved schema metadata, leave it unsupported instead of substituting a similar-looking field.
24. Metric intent such as count, sum, average, minimum, maximum, ranking, date bucketing, and grouping must be satisfied by declared columns or metric fields from the retrieved schema.

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


def _project_filter_conditions(
    project_id: str | None,
    mdl_hash: str | None = None,
) -> list[dict[str, Any]]:
    project_deploy_filter = build_project_deploy_filter(
        project_id=project_id,
        mdl_hash=mdl_hash,
    )
    return project_deploy_filter["conditions"] if project_deploy_filter else []


def _build_metric_ddl(content: dict) -> str:
    columns = [
        column
        for column in content["columns"]
        if column["data_type"].lower() != "unknown"
    ]
    context = _format_semantic_context(
        {
            "object_type": "metric",
            "sql_identifier_contract": {
                "sql_table_name_use_exactly": content["name"],
                "sql_column_names_use_exactly": [column["name"] for column in columns],
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


def _strip_identifier_quotes(identifier: str | None) -> str | None:
    if not identifier:
        return identifier

    return identifier.strip().strip('"`[]')


def _view_columns_from_statement(statement: str) -> list[dict]:
    if not statement:
        return []

    parsed = sqlparse.parse(statement)
    if not parsed:
        return []

    statement_tokens = parsed[0].tokens
    select_seen = False
    output_columns: list[str] = []

    for token in statement_tokens:
        if token.is_whitespace or token.ttype in Comment:
            continue

        if token.ttype is DML and token.normalized == "SELECT":
            select_seen = True
            continue

        if not select_seen:
            continue

        if token.ttype is Keyword and token.normalized == "FROM":
            break

        identifiers: list[Identifier] = []
        if isinstance(token, IdentifierList):
            identifiers.extend(
                identifier
                for identifier in token.get_identifiers()
                if isinstance(identifier, Identifier)
            )
        elif isinstance(token, Identifier):
            identifiers.append(token)

        for identifier in identifiers:
            column_name = _strip_identifier_quotes(
                identifier.get_alias() or identifier.get_real_name()
            )
            if column_name and column_name != "*":
                output_columns.append(column_name)

    deduplicated_columns = list(dict.fromkeys(output_columns))
    return [
        {
            "name": column_name,
            "data_type": "VARCHAR",
            "comment": "Output column declared by the view statement.",
        }
        for column_name in deduplicated_columns
    ]


def _source_table_identifier(table_reference: dict | None) -> str:
    if not isinstance(table_reference, dict):
        return ""

    parts = [
        str(table_reference.get(part, "")).strip()
        for part in ("schema", "table")
    ]
    parts = [part for part in parts if part]
    return ".".join(parts)


def _build_view_ddl(content: dict) -> str:
    columns = [
        column
        for column in content.get("columns", [])
        if column.get("name") and column.get("data_type", "").lower() != "unknown"
    ]
    statement = content.get("statement", "")
    if not columns:
        columns = _view_columns_from_statement(statement)

    context = _format_semantic_context(
        {
            "object_type": "view",
            "sql_identifier_contract": {
                "sql_table_name_use_exactly": content["name"],
                "sql_column_names_use_exactly": [column["name"] for column in columns],
            },
            "semantic_context_not_sql_identifiers": {
                "role": "stable virtual table interface",
                "description": content["comment"],
            },
            "columns": [
                {
                    "sql_column_name_use_exactly": column["name"],
                    "data_type": get_engine_supported_data_type(
                        column.get("data_type")
                    ),
                    "semantic_context_not_sql_identifier": column.get("comment", ""),
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


def _format_semantic_context(context: dict) -> str:
    return (
        "/*\n"
        "WREN RETRIEVED SEMANTIC CONTEXT\n"
        f"{orjson.dumps(context).decode('utf-8')}\n"
        f"{_format_identifier_contract(context)}"
        "Only values in sql_identifier_contract, sql_column_name_use_exactly, and identifiers declared in the following DDL are executable in Wren SQL.\n"
        "Values under semantic_context_not_sql_identifiers and semantic_context_not_sql_identifier explain meaning only and must not be copied, combined, or rewritten as executable SQL identifiers.\n"
        "*/\n"
        f"{_format_executable_identifier_catalog(context)}"
    )


def _format_executable_identifier_catalog(context: dict) -> str:
    contract = context.get("sql_identifier_contract", {})
    table_name = contract.get("sql_table_name_use_exactly")
    column_names = contract.get("sql_column_names_use_exactly") or [
        column["sql_column_name_use_exactly"]
        for column in context.get("columns", [])
        if column.get("sql_column_name_use_exactly")
    ]
    relationship_constraints = contract.get("relationship_constraints_use_exactly") or [
        relationship["sql_relationship_constraint_use_exactly"]
        for relationship in context.get("relationships", [])
        if relationship.get("sql_relationship_constraint_use_exactly")
    ]

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
    relationship_constraints = contract.get("relationship_constraints_use_exactly") or [
        relationship["sql_relationship_constraint_use_exactly"]
        for relationship in context.get("relationships", [])
        if relationship.get("sql_relationship_constraint_use_exactly")
    ]

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
        and column["data_type"].lower() != "unknown"
    ]


def _included_relationships(content: dict, tables: Optional[set[str]]) -> list[dict]:
    return [
        column
        for column in content["columns"]
        if column["type"] == "FOREIGN_KEY"
        and (not tables or set(column.get("tables", [])).issubset(tables))
    ]


def _build_table_retrieval_context(
    content: dict, columns: Optional[set[str]] = None, tables: Optional[set[str]] = None
) -> tuple[str, bool, bool]:
    ddl, has_calculated_field, has_json_field = build_table_ddl(
        content,
        columns=columns,
        tables=tables,
        include_semantic_comments=False,
    )
    included_columns = _included_columns(content, columns, tables)
    included_relationships = _included_relationships(content, tables)
    table_properties = content.get("properties") or {}
    table_reference = content.get("tableReference") or {}
    context = _format_semantic_context(
        {
            "object_type": "model",
            "sql_identifier_contract": {
                "sql_table_name_use_exactly": content["name"],
                "sql_column_names_use_exactly": [
                    column["name"] for column in included_columns
                ],
                "relationship_constraints_use_exactly": [
                    relationship["constraint"]
                    for relationship in included_relationships
                ],
            },
            "semantic_context_not_sql_identifiers": {
                "description": content["comment"],
                "display_name": table_properties.get("displayName"),
                "source_table_name": _source_table_identifier(table_reference),
                "source_table_reference": table_reference,
            },
            "columns": [
                {
                    "sql_column_name_use_exactly": column["name"],
                    "data_type": get_engine_supported_data_type(column["data_type"]),
                    "is_primary_key": column["is_primary_key"],
                    "semantic_context_not_sql_identifier": column["comment"],
                    "display_name": (column.get("properties") or {}).get(
                        "displayName"
                    ),
                    "source_column_name": (column.get("properties") or {}).get(
                        "sourceColumnName"
                    ),
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
    return f"{context}{ddl}", has_calculated_field, has_json_field


def _identifier_context(table_name: str, column_names: list[str]) -> str:
    return "\n".join(
        [f"table: {table_name}", "columns:", *[f"- {name}" for name in column_names]]
    )


def _build_retrieval_item(table_schema: dict) -> tuple[dict[str, str], bool, bool]:
    ddl, has_calculated_field, has_json_field = _build_table_retrieval_context(
        table_schema
    )
    return (
        {
            "table_name": table_schema["name"],
            "table_ddl": ddl,
            "identifier_context": _identifier_context(
                table_schema["name"],
                [
                    column["name"]
                    for column in _included_columns(table_schema, None, None)
                ],
            ),
        },
        has_calculated_field,
        has_json_field,
    )


def _build_pruning_context(content: dict) -> str:
    if content["type"] == "TABLE":
        return _build_table_retrieval_context(content)[0]
    if content["type"] == "METRIC":
        return _build_metric_ddl(content)
    if content["type"] == "VIEW":
        return _build_view_ddl(content)
    return ""


def _fallback_retrieval_results(
    construct_db_schemas: list[dict],
    dbschema_retrieval: list[Document],
) -> dict[str, Any]:
    retrieval_results = []
    has_calculated_field = False
    has_metric = False
    has_json_field = False

    for table_schema in construct_db_schemas:
        if table_schema["type"] == "TABLE":
            retrieval_item, _has_calculated_field, _has_json_field = (
                _build_retrieval_item(table_schema)
            )
            retrieval_results.append(retrieval_item)
            if _has_calculated_field:
                has_calculated_field = True
            if _has_json_field:
                has_json_field = True

    for document in dbschema_retrieval:
        content = ast.literal_eval(document.content)

        if content["type"] == "METRIC":
            retrieval_results.append(
                {
                    "table_name": content["name"],
                    "table_ddl": _build_metric_ddl(content),
                    "identifier_context": _identifier_context(
                        content["name"],
                        [
                            column["name"]
                            for column in content["columns"]
                            if column["data_type"].lower() != "unknown"
                        ],
                    ),
                }
            )
            has_metric = True
        elif content["type"] == "VIEW":
            retrieval_results.append(
                {
                    "table_name": content["name"],
                    "table_ddl": _build_view_ddl(content),
                    "identifier_context": _identifier_context(
                        content["name"],
                        [
                            column["name"]
                            for column in content.get("columns", [])
                            if column.get("name")
                            and column.get("data_type", "").lower() != "unknown"
                        ],
                    ),
                }
            )

    return {
        "retrieval_results": retrieval_results,
        "has_calculated_field": has_calculated_field,
        "has_metric": has_metric,
        "has_json_field": has_json_field,
    }


def _empty_retrieval_results() -> dict[str, Any]:
    return {
        "retrieval_results": [],
        "has_calculated_field": False,
        "has_metric": False,
        "has_json_field": False,
    }


def _merge_names(*name_lists: list[str]) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()
    for names in name_lists:
        for name in names:
            if name in seen:
                continue
            merged.append(name)
            seen.add(name)
    return merged


## Start of Pipeline
@observe(capture_input=False, capture_output=False)
async def embedding(query: str, embedder: Any, histories: list[AskHistory]) -> dict:
    if query:
        return await embedder.run(_augment_retrieval_query(query))
    else:
        return {}


@observe(capture_input=False)
async def table_retrieval(
    embedding: dict,
    project_id: str,
    tables: list[str],
    table_retriever: Any,
    mdl_hash: str | None = None,
) -> dict:
    filters = {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_DESCRIPTION"},
        ],
    }

    filters["conditions"].extend(_project_filter_conditions(project_id, mdl_hash))

    if embedding:
        return await table_retriever.run(
            query_embedding=embedding.get("embedding"),
            filters=filters,
        )
    else:
        filters["conditions"].append(
            {"field": "name", "operator": "in", "value": tables}
        )

        return await table_retriever.run(
            query_embedding=[],
            filters=filters,
        )


@observe(capture_input=False)
async def dbschema_retrieval(
    table_retrieval: dict,
    project_id: str,
    dbschema_retriever: Any,
    query: str | None = None,
    embedding: dict | None = None,
    mdl_hash: str | None = None,
    include_related_models: bool = True,
) -> list[Document]:
    table_names = _table_names_from_description_documents(
        table_retrieval.get("documents", [])
    )
    documents = []
    if embedding:
        semantic_started_at = time.perf_counter()
        semantic_documents = await _retrieve_semantic_schema_documents(
            embedding, project_id, mdl_hash, dbschema_retriever
        )
        _log_retrieval_timing(
            "schema_retrieval_semantic",
            semantic_started_at,
            project_id,
            document_count=len(semantic_documents),
        )
        semantic_table_names = _table_names_from_schema_documents(semantic_documents)[
            :_SEMANTIC_TABLE_NAME_MERGE_LIMIT
        ]
        table_names = _merge_names(table_names, semantic_table_names)[
            :_MAX_RETRIEVED_TABLE_NAMES
        ]
        lexical_started_at = time.perf_counter()
        lexical_documents, lexical_table_names = await _retrieve_lexical_schema_hits(
            query=query,
            project_id=project_id,
            mdl_hash=mdl_hash,
            dbschema_retriever=dbschema_retriever,
            existing_table_names=set(table_names),
        )
        _log_retrieval_timing(
            "schema_retrieval_lexical_scan",
            lexical_started_at,
            project_id,
            document_count=len(lexical_documents),
            table_count=len(lexical_table_names),
        )
        table_names = _merge_names(table_names, lexical_table_names)[
            :_MAX_RETRIEVED_TABLE_NAMES
        ]
        ranking_started_at = time.perf_counter()
        table_names = _rank_table_names_by_query(
            table_names,
            _dedupe_documents(semantic_documents + lexical_documents),
            query,
        )
        _log_retrieval_timing(
            "candidate_ranking",
            ranking_started_at,
            project_id,
            candidate_count=len(table_names),
        )
        selected_semantic_table_names = set(semantic_table_names)
        documents = [
            document
            for document in semantic_documents
            if document.meta.get("name") in selected_semantic_table_names
        ]
        documents = _dedupe_documents(documents + lexical_documents)

    if table_names:
        if include_related_models:
            expansion_started_at = time.perf_counter()
            retrieved_table_names = set()
            pending_table_names = table_names
            remaining_expansion_depth = _MAX_RELATED_TABLE_EXPANSION_DEPTH

            while pending_table_names:
                retrieved_table_names.update(pending_table_names)
                retrieved_documents = await _retrieve_schema_documents(
                    pending_table_names, project_id, mdl_hash, dbschema_retriever
                )
                documents = _dedupe_documents(documents + retrieved_documents)
                if remaining_expansion_depth <= 0:
                    break
                remaining_expansion_depth -= 1
                remaining_slots = _MAX_RETRIEVED_TABLE_NAMES - len(
                    retrieved_table_names
                )
                if remaining_slots <= 0:
                    break
                pending_table_names = [
                    table_name
                    for table_name in _related_table_names(documents)
                    if table_name not in retrieved_table_names
                ][:remaining_slots]

            ranking_started_at = time.perf_counter()
            ranked_documents = _rank_documents_for_query(documents, table_names, query)
            _log_retrieval_timing(
                "schema_retrieval_related_expansion",
                expansion_started_at,
                project_id,
                table_count=len(retrieved_table_names),
                document_count=len(documents),
            )
            _log_retrieval_timing(
                "candidate_ranking",
                ranking_started_at,
                project_id,
                candidate_count=len(ranked_documents),
            )
            logger.info(
                "Ask schema retrieval project_id=%s retrieved_tables=%s",
                project_id,
                [
                    {
                        "table": document.meta.get("name"),
                        "score": getattr(document, "score", None),
                    }
                    for document in ranked_documents
                ],
            )
            return ranked_documents

        named_started_at = time.perf_counter()
        retrieved_documents = await _retrieve_schema_documents(
            table_names, project_id, mdl_hash, dbschema_retriever
        )
        _log_retrieval_timing(
            "schema_retrieval_named_fetch",
            named_started_at,
            project_id,
            table_count=len(table_names),
            document_count=len(retrieved_documents),
        )
        documents = _dedupe_documents(documents + retrieved_documents)
        ranking_started_at = time.perf_counter()
        ranked_documents = _rank_documents_for_query(documents, table_names, query)
        _log_retrieval_timing(
            "candidate_ranking",
            ranking_started_at,
            project_id,
            candidate_count=len(ranked_documents),
        )
        logger.info(
            "Ask schema retrieval project_id=%s retrieved_tables=%s",
            project_id,
            [
                {
                    "table": document.meta.get("name"),
                    "score": getattr(document, "score", None),
                }
                for document in ranked_documents
            ],
        )
        return ranked_documents

    logger.info("Ask schema retrieval project_id=%s retrieved_tables=[]", project_id)
    return []


def _tokenize_schema_text(value: Any) -> set[str]:
    if value is None:
        return set()
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", str(value))
    return _expand_schema_token_variants(set(_RANK_TOKEN.findall(text.lower())))


def _normalized_schema_mention_text(value: Any) -> str:
    if value is None:
        return ""
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", str(value))
    tokens = _RANK_TOKEN.findall(text.lower())
    return f" {' '.join(tokens)} " if tokens else ""


def _schema_identifier_mention_variants(identifier: str) -> set[str]:
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", str(identifier))
    tokens = _RANK_TOKEN.findall(text.lower())
    variants = {" ".join(tokens)} if tokens else set()
    if len(tokens) > 1:
        variants.add(" ".join(tokens[1:]))
    return {variant for variant in variants if variant}


def _query_mentions_schema_identifier(normalized_query: str, identifier: str) -> bool:
    if not normalized_query:
        return False
    return any(
        f" {variant} " in normalized_query
        for variant in _schema_identifier_mention_variants(identifier)
    )


def _rank_content_tokens(query_tokens: set[str]) -> set[str]:
    return {
        token
        for token in query_tokens
        if token not in _RANK_GENERIC_QUERY_TOKENS and not token.isdigit()
    }


def _schema_token_variants(token: str) -> set[str]:
    token = token.lower()
    variants = {token}
    if len(token) > 4 and token.endswith("ies"):
        variants.add(token[:-3] + "y")
    elif len(token) > 4 and token.endswith("es"):
        if token.endswith(("ches", "shes", "sses", "uses", "xes", "zes")):
            variants.add(token[:-2])
        else:
            variants.add(token[:-1])
    elif len(token) > 3 and token.endswith("s") and not token.endswith(("ss", "us")):
        variants.add(token[:-1])
    return {variant for variant in variants if variant}


def _expand_schema_token_variants(tokens: set[str]) -> set[str]:
    expanded: set[str] = set()
    for token in tokens:
        expanded.update(_schema_token_variants(token))
    return expanded


def _compound_identifier_tokens(token: str) -> set[str]:
    if len(token) < 5:
        return set()

    tokens: set[str] = set()
    for part in _COMPOUND_IDENTIFIER_PART_TOKENS:
        if part != token and len(part) >= 4 and part in token:
            tokens.add(part)

    for alias, expansions in _COMPOUND_IDENTIFIER_ALIASES.items():
        if alias != token and (token.startswith(alias) or token.endswith(alias)):
            tokens.add(alias)
            tokens.update(expansions)

    return tokens


def _tokenize_schema_identifier_text(value: Any) -> set[str]:
    tokens = _tokenize_schema_text(value)
    for token in list(tokens):
        tokens.update(_compound_identifier_tokens(token))
    return _expand_schema_token_variants(tokens)


def _tokenize_nested_schema_identifier_text(value: Any) -> set[str]:
    if value is None:
        return set()
    if isinstance(value, dict):
        tokens: set[str] = set()
        for nested_key, nested_value in value.items():
            tokens.update(_tokenize_schema_identifier_text(nested_key))
            tokens.update(_tokenize_nested_schema_identifier_text(nested_value))
        return tokens
    if isinstance(value, (list, tuple, set)):
        tokens: set[str] = set()
        for nested_value in value:
            tokens.update(_tokenize_nested_schema_identifier_text(nested_value))
        return tokens
    return _tokenize_schema_identifier_text(value)


def _tokenize_nested_schema_text(value: Any) -> set[str]:
    if value is None:
        return set()
    if isinstance(value, dict):
        tokens: set[str] = set()
        for nested_key, nested_value in value.items():
            tokens.update(_tokenize_schema_text(nested_key))
            tokens.update(_tokenize_nested_schema_text(nested_value))
        return tokens
    if isinstance(value, (list, tuple, set)):
        tokens: set[str] = set()
        for nested_value in value:
            tokens.update(_tokenize_nested_schema_text(nested_value))
        return tokens
    return _tokenize_schema_text(value)


def _schema_rank_document_key(documents: list[Document]) -> tuple[tuple[str, str, str], ...]:
    return tuple(
        (
            str(document.meta.get("type", "")),
            str(document.meta.get("name", "")),
            str(document.content),
        )
        for document in documents
    )


def _schema_rank_text_by_table(documents: list[Document]) -> dict[str, dict[str, set[str]]]:
    return _cached_schema_rank_text_by_table(_schema_rank_document_key(documents))


@lru_cache(maxsize=128)
def _cached_schema_rank_text_by_table(
    document_key: tuple[tuple[str, str, str], ...],
) -> dict[str, dict[str, set[str]]]:
    table_text: dict[str, dict[str, set[str]]] = {}

    def ensure(table_name: str) -> dict[str, set[str]]:
        if table_name not in table_text:
            table_text[table_name] = {
                "table": set(),
                "columns": set(),
                "comments": set(),
            }
        return table_text[table_name]

    for _, meta_name, content_text in document_key:
        try:
            content = ast.literal_eval(content_text)
        except (SyntaxError, ValueError):
            continue

        table_name = meta_name or content.get("name")
        if not table_name:
            continue

        bucket = ensure(table_name)
        bucket["table"].update(_tokenize_schema_identifier_text(table_name))
        bucket["table"].update(_tokenize_schema_identifier_text(content.get("name")))
        bucket["table"].update(
            _tokenize_nested_schema_identifier_text(content.get("properties"))
        )
        bucket["table"].update(
            _tokenize_nested_schema_identifier_text(content.get("tableReference"))
        )
        bucket["comments"].update(_tokenize_schema_text(content.get("comment")))
        bucket["comments"].update(_tokenize_schema_text(content.get("description")))
        bucket["comments"].update(_tokenize_nested_schema_text(content.get("refSql")))

        for column in content.get("columns", []) or []:
            bucket["columns"].update(
                _tokenize_schema_identifier_text(column.get("name"))
            )
            bucket["columns"].update(
                _tokenize_schema_identifier_text(column.get("column"))
            )
            bucket["columns"].update(
                _tokenize_schema_identifier_text(column.get("display_name"))
            )
            bucket["columns"].update(
                _tokenize_schema_identifier_text(column.get("displayName"))
            )
            bucket["columns"].update(
                _tokenize_nested_schema_identifier_text(column.get("properties"))
            )
            bucket["comments"].update(_tokenize_schema_text(column.get("comment")))
            bucket["comments"].update(_tokenize_schema_text(column.get("description")))

    return table_text


def _rank_table_names_by_query(
    table_names: list[str],
    semantic_documents: list[Document],
    query: str | None,
    require_positive_score: bool = False,
) -> list[str]:
    if not query or not table_names:
        return [] if require_positive_score else table_names

    query_tokens = _tokenize_schema_text(_augment_retrieval_query(query))
    if not query_tokens:
        return [] if require_positive_score else table_names

    table_text = _schema_rank_text_by_table(semantic_documents)
    normalized_query = _normalized_schema_mention_text(query)
    content_tokens = _rank_content_tokens(query_tokens)

    def score(table_name: str) -> int:
        bucket = table_text.get(table_name, {})
        table_tokens = set(bucket.get("table", set())) | _tokenize_schema_identifier_text(
            table_name
        )
        column_tokens = set(bucket.get("columns", set()))
        comment_tokens = set(bucket.get("comments", set()))
        direct_table_matches = query_tokens & table_tokens
        direct_column_matches = query_tokens & column_tokens
        direct_comment_matches = query_tokens & comment_tokens
        covered_tokens = direct_table_matches | direct_column_matches | direct_comment_matches
        direct_content_matches = content_tokens & covered_tokens
        direct_content_column_matches = content_tokens & column_tokens

        value = (
            len(direct_table_matches) * 6
            + len(direct_column_matches) * 8
            + len(direct_comment_matches)
            + len(direct_content_matches) * 32
            + len(direct_content_column_matches) * 24
        )
        if _query_mentions_schema_identifier(normalized_query, table_name):
            value += 80
        value += len(
            direct_table_matches | direct_column_matches | direct_comment_matches
        ) ** 2
        if content_tokens and all(
            _schema_token_variants(token) & covered_tokens
            for token in content_tokens
        ):
            value += 80 + len(content_tokens) * 16

        if len(direct_column_matches) >= 2:
            value += 8
        if direct_table_matches and direct_column_matches:
            value += 8
        return value

    scored = [
        (index, table_name, score(table_name))
        for index, table_name in enumerate(table_names)
    ]
    if require_positive_score:
        scored = [item for item in scored if item[2] > 0]

    ranked = sorted(scored, key=lambda item: (-item[2], item[0]))
    return [table_name for _, table_name, _ in ranked]


def _rank_documents_by_table_names(
    documents: list[Document],
    table_names: list[str],
) -> list[Document]:
    table_rank = {table_name: index for index, table_name in enumerate(table_names)}
    return sorted(
        documents,
        key=lambda document: (
            table_rank.get(document.meta.get("name"), len(table_rank)),
            document.meta.get("type", ""),
        ),
    )


def _rank_documents_for_query(
    documents: list[Document],
    table_names: list[str],
    query: str | None,
) -> list[Document]:
    ranked_table_names = _rank_table_names_by_query(
        _merge_names(_table_names_from_schema_documents(documents), table_names),
        documents,
        query,
    )
    return _rank_documents_by_table_names(documents, ranked_table_names)


def _augment_retrieval_query(query: str) -> str:
    return query


async def _retrieve_semantic_schema_documents(
    embedding: dict,
    project_id: str,
    mdl_hash: str | None,
    dbschema_retriever: Any,
) -> list[Document]:
    filters = {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
        ],
    }

    filters["conditions"].extend(_project_filter_conditions(project_id, mdl_hash))

    results = await dbschema_retriever.run(
        query_embedding=embedding.get("embedding"),
        filters=filters,
    )
    return results["documents"]


async def _retrieve_all_schema_documents(
    project_id: str,
    mdl_hash: str | None,
    dbschema_retriever: Any,
) -> list[Document]:
    cache_key = (id(dbschema_retriever), project_id, mdl_hash or "")
    if cache_key in _ALL_SCHEMA_DOCUMENTS_CACHE:
        logger.info(
            "Ask schema document cache hit project_id=%s mdl_hash=%s scope=all count=%s",
            project_id,
            mdl_hash or "",
            len(_ALL_SCHEMA_DOCUMENTS_CACHE[cache_key]),
        )
        return list(_ALL_SCHEMA_DOCUMENTS_CACHE[cache_key])

    lock = _ALL_SCHEMA_DOCUMENTS_CACHE_LOCKS.setdefault(cache_key, asyncio.Lock())
    async with lock:
        if cache_key in _ALL_SCHEMA_DOCUMENTS_CACHE:
            logger.info(
                "Ask schema document cache hit project_id=%s mdl_hash=%s scope=all count=%s",
                project_id,
                mdl_hash or "",
                len(_ALL_SCHEMA_DOCUMENTS_CACHE[cache_key]),
            )
            return list(_ALL_SCHEMA_DOCUMENTS_CACHE[cache_key])

        started_at = time.perf_counter()
        documents = await _retrieve_all_schema_documents_uncached(
            project_id,
            mdl_hash,
            dbschema_retriever,
        )
        if len(_ALL_SCHEMA_DOCUMENTS_CACHE) >= 64:
            _ALL_SCHEMA_DOCUMENTS_CACHE.pop(next(iter(_ALL_SCHEMA_DOCUMENTS_CACHE)))
        _ALL_SCHEMA_DOCUMENTS_CACHE[cache_key] = documents
        _log_retrieval_timing(
            "schema_retrieval_all_documents",
            started_at,
            project_id,
            cache_hit=False,
            document_count=len(documents),
        )
        return list(documents)


async def _retrieve_all_schema_documents_uncached(
    project_id: str,
    mdl_hash: str | None,
    dbschema_retriever: Any,
) -> list[Document]:
    filters = {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
        ],
    }

    filters["conditions"].extend(_project_filter_conditions(project_id, mdl_hash))

    results = await dbschema_retriever.run(query_embedding=[], filters=filters)
    return results["documents"]


async def _retrieve_lexical_schema_hits(
    query: str | None,
    project_id: str,
    mdl_hash: str | None,
    dbschema_retriever: Any,
    existing_table_names: set[str],
) -> tuple[list[Document], list[str]]:
    if not query:
        return [], []

    documents = await _retrieve_all_schema_documents(
        project_id,
        mdl_hash,
        dbschema_retriever,
    )
    candidate_table_names = [
        table_name
        for table_name in _rank_table_names_by_query(
            _table_names_from_schema_documents(documents),
            documents,
            query,
            require_positive_score=True,
        )
        if table_name not in existing_table_names
    ][:_LEXICAL_SCHEMA_TABLE_NAME_MERGE_LIMIT]
    if not candidate_table_names:
        return [], []

    logger.info(
        "Ask schema lexical project scan project_id=%s mdl_hash=%s retrieved_tables=%s",
        project_id,
        mdl_hash or "",
        candidate_table_names,
    )
    candidate_table_name_set = set(candidate_table_names)
    return [
        document
        for document in documents
        if document.meta.get("name") in candidate_table_name_set
    ], candidate_table_names


def _table_names_from_schema_documents(documents: list[Document]) -> list[str]:
    table_names = []
    seen = set()

    for document in documents:
        table_name = document.meta.get("name")
        if not table_name:
            content = ast.literal_eval(document.content)
            table_name = content.get("name")

        if table_name and table_name not in seen:
            table_names.append(table_name)
            seen.add(table_name)

    return table_names


def _table_names_from_description_documents(documents: list[Document]) -> list[str]:
    table_names = []
    seen = set()

    for document in documents:
        content = ast.literal_eval(document.content)
        table_name = content["name"]
        if table_name not in seen:
            table_names.append(table_name)
            seen.add(table_name)

    return table_names


async def _retrieve_schema_documents(
    table_names: list[str],
    project_id: str,
    mdl_hash: str | None,
    dbschema_retriever: Any,
) -> list[Document]:
    table_names = list(dict.fromkeys(table_names))
    table_name_conditions = [
        {"field": "name", "operator": "==", "value": table_name}
        for table_name in table_names
    ]

    if not table_name_conditions:
        return []

    cache_key = (
        id(dbschema_retriever),
        project_id,
        mdl_hash or "",
        tuple(table_names),
    )
    if cache_key in _SCHEMA_DOCUMENTS_CACHE:
        logger.info(
            "Ask schema document cache hit project_id=%s mdl_hash=%s scope=named table_count=%s document_count=%s",
            project_id,
            mdl_hash or "",
            len(table_names),
            len(_SCHEMA_DOCUMENTS_CACHE[cache_key]),
        )
        return list(_SCHEMA_DOCUMENTS_CACHE[cache_key])

    lock = _SCHEMA_DOCUMENTS_CACHE_LOCKS.setdefault(cache_key, asyncio.Lock())
    async with lock:
        if cache_key in _SCHEMA_DOCUMENTS_CACHE:
            logger.info(
                "Ask schema document cache hit project_id=%s mdl_hash=%s scope=named table_count=%s document_count=%s",
                project_id,
                mdl_hash or "",
                len(table_names),
                len(_SCHEMA_DOCUMENTS_CACHE[cache_key]),
            )
            return list(_SCHEMA_DOCUMENTS_CACHE[cache_key])

        started_at = time.perf_counter()
        documents = await _retrieve_schema_documents_uncached(
            table_names,
            project_id,
            mdl_hash,
            dbschema_retriever,
            table_name_conditions,
        )
        if len(_SCHEMA_DOCUMENTS_CACHE) >= 128:
            _SCHEMA_DOCUMENTS_CACHE.pop(next(iter(_SCHEMA_DOCUMENTS_CACHE)))
        _SCHEMA_DOCUMENTS_CACHE[cache_key] = documents
        _log_retrieval_timing(
            "schema_retrieval_named_documents",
            started_at,
            project_id,
            cache_hit=False,
            table_count=len(table_names),
            document_count=len(documents),
        )
        return list(documents)


async def _retrieve_schema_documents_uncached(
    table_names: list[str],
    project_id: str,
    mdl_hash: str | None,
    dbschema_retriever: Any,
    table_name_conditions: list[dict[str, Any]],
) -> list[Document]:
    filters = {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
            {"operator": "OR", "conditions": table_name_conditions},
        ],
    }

    filters["conditions"].extend(_project_filter_conditions(project_id, mdl_hash))

    results = await dbschema_retriever.run(query_embedding=[], filters=filters)
    return results["documents"]


def _related_table_names(documents: list[Document]) -> list[str]:
    related_table_names = []
    seen = set()

    for document in documents:
        content = ast.literal_eval(document.content)
        if content.get("type") != "TABLE_COLUMNS":
            continue

        for column in content.get("columns", []):
            if column.get("type") != "FOREIGN_KEY":
                continue

            for table_name in column.get("tables", []):
                if table_name not in seen:
                    related_table_names.append(table_name)
                    seen.add(table_name)

    return related_table_names


def _dedupe_documents(documents: list[Document]) -> list[Document]:
    deduped = []
    seen = set()

    for document in documents:
        identity = (
            document.meta.get("type"),
            document.meta.get("name"),
            document.content,
        )
        if identity in seen:
            continue
        deduped.append(document)
        seen.add(identity)

    return deduped


def _limit_retrieval_results_for_generation(
    retrieval_results: list[dict[str, Any]],
    encoding: tiktoken.Encoding,
) -> tuple[list[dict[str, Any]], int, int, str | None]:
    if not retrieval_results:
        return retrieval_results, 0, 0, None

    original_tokens = len(
        encoding.encode(
            " ".join(
                retrieval_result.get("table_ddl", "")
                for retrieval_result in retrieval_results
            )
        )
    )
    limited_results: list[dict[str, Any]] = []
    limited_tokens = 0
    skipped_for_token_budget = False

    for retrieval_result in retrieval_results:
        if len(limited_results) >= _MAX_LLM_SCHEMA_CONTEXT_TABLES:
            break

        table_tokens = len(encoding.encode(retrieval_result.get("table_ddl", "")))
        if table_tokens > _MAX_LLM_SCHEMA_CONTEXT_TOKENS:
            skipped_for_token_budget = True
            continue
        if limited_tokens + table_tokens > _MAX_LLM_SCHEMA_CONTEXT_TOKENS:
            skipped_for_token_budget = True
            continue

        limited_results.append(retrieval_result)
        limited_tokens += table_tokens

    if not limited_results:
        return [], original_tokens, 0, "all_tables_exceed_token_budget"

    if len(limited_results) == len(retrieval_results):
        return retrieval_results, original_tokens, original_tokens, None

    reason = "ranked_top_k_skipped_token_budget" if skipped_for_token_budget else "ranked_top_k"
    return limited_results, original_tokens, limited_tokens, reason


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
        elif content["type"] in {"VIEW", "METRIC"}:
            db_schemas[document.meta["name"]] = content

    # remove incomplete schemas
    db_schemas = {
        k: v
        for k, v in db_schemas.items()
        if v.get("type") in {"VIEW", "METRIC"}
        or (v.get("type") == "TABLE" and "columns" in v)
    }

    return list(db_schemas.values())


@observe(capture_input=False)
def check_using_db_schemas_without_pruning(
    construct_db_schemas: list[dict],
    dbschema_retrieval: list[Document],
    encoding: tiktoken.Encoding,
    enable_column_pruning: bool,
    context_window_size: int,
) -> dict:
    retrieval_results = []
    has_calculated_field = False
    has_metric = False
    has_json_field = False

    for table_schema in construct_db_schemas:
        if table_schema["type"] == "TABLE":
            ddl, _has_calculated_field, _has_json_field = (
                _build_table_retrieval_context(table_schema)
            )
            retrieval_results.append(
                {
                    "table_name": table_schema["name"],
                    "table_ddl": ddl,
                    "identifier_context": _identifier_context(
                        table_schema["name"],
                        [
                            column["name"]
                            for column in _included_columns(table_schema, None, None)
                        ],
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
            retrieval_results.append(
                {
                    "table_name": content["name"],
                    "table_ddl": _build_metric_ddl(content),
                    "identifier_context": _identifier_context(
                        content["name"],
                        [
                            column["name"]
                            for column in content["columns"]
                            if column["data_type"].lower() != "unknown"
                        ],
                    ),
                }
            )
            has_metric = True
        elif content["type"] == "VIEW":
            retrieval_results.append(
                {
                    "table_name": content["name"],
                    "table_ddl": _build_view_ddl(content),
                    "identifier_context": _identifier_context(
                        content["name"],
                        [
                            column["name"]
                            for column in content.get("columns", [])
                            if column.get("name")
                            and column.get("data_type", "").lower() != "unknown"
                        ],
                    ),
                }
            )

    table_ddls = [
        retrieval_result["table_ddl"] for retrieval_result in retrieval_results
    ]
    _token_count = len(encoding.encode(" ".join(table_ddls)))
    if _token_count > context_window_size or enable_column_pruning:
        return {
            "db_schemas": [],
            "tokens": _token_count,
            "has_calculated_field": has_calculated_field,
            "has_metric": has_metric,
            "has_json_field": has_json_field,
        }

    (
        limited_retrieval_results,
        original_token_count,
        limited_token_count,
        limit_reason,
    ) = _limit_retrieval_results_for_generation(retrieval_results, encoding)
    if limit_reason:
        if not limited_retrieval_results:
            logger.info(
                "Ask retrieval selected schema context exceeded generation budget; using column pruning reason=%s original_tables=%s original_tokens=%s token_budget=%s",
                limit_reason,
                len(retrieval_results),
                original_token_count,
                _MAX_LLM_SCHEMA_CONTEXT_TOKENS,
            )
            return {
                "db_schemas": [],
                "tokens": original_token_count,
                "has_calculated_field": has_calculated_field,
                "has_metric": has_metric,
                "has_json_field": has_json_field,
            }
        logger.info(
            "Ask retrieval capped generation schema context reason=%s original_tables=%s selected_tables=%s original_tokens=%s selected_tokens=%s table_budget=%s token_budget=%s",
            limit_reason,
            len(retrieval_results),
            len(limited_retrieval_results),
            original_token_count,
            limited_token_count,
            _MAX_LLM_SCHEMA_CONTEXT_TABLES,
            _MAX_LLM_SCHEMA_CONTEXT_TOKENS,
        )
        retrieval_results = limited_retrieval_results
        _token_count = limited_token_count

    return {
        "retrieval_results": retrieval_results,
        "has_calculated_field": has_calculated_field,
        "has_metric": has_metric,
        "has_json_field": has_json_field,
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
        db_schemas = list(
            filter(
                None,
                [
                    _build_pruning_context(construct_db_schema)
                    for construct_db_schema in construct_db_schemas
                ],
            )
        )

    for table_name, table_contents in secondary.items():
        if table_name not in merged:
            merged[table_name] = {
                **table_contents,
                "columns": list(table_contents.get("columns", [])),
            }
            continue

        columns = list(merged[table_name].get("columns", []))
        for column in table_contents.get("columns", []):
            if column not in columns:
                columns.append(column)
        merged[table_name]["columns"] = columns

    return merged


def _lexical_columns_and_tables_needed(
    construct_db_schemas: list[dict],
    query: str | None,
    max_tables: int = 4,
    max_columns_per_table: int = 12,
) -> dict[str, dict]:
    if not query:
        return {}

    query_tokens = _tokenize_schema_text(_augment_retrieval_query(query))
    if not query_tokens:
        return {}

    scored_tables = []
    for table_schema in construct_db_schemas:
        if table_schema.get("type") != "TABLE":
            continue

        table_tokens = _tokenize_schema_text(
            table_schema.get("name")
        ) | _tokenize_schema_text(
            table_schema.get("comment")
        )
        table_score = len(query_tokens & table_tokens) * 6
        column_scores = []

@observe()
def construct_retrieval_results(
    check_using_db_schemas_without_pruning: dict,
    filter_columns_in_tables: dict,
    construct_db_schemas: list[dict],
    dbschema_retrieval: list[Document],
    query: str | None = None,
) -> dict[str, Any]:
    if filter_columns_in_tables:
        columns_and_tables_needed = _parse_column_selection_response(
            filter_columns_in_tables
        )
        lexical_columns_and_tables_needed = _lexical_columns_and_tables_needed(
            construct_db_schemas,
            query,
        )
        columns_and_tables_needed = _merge_column_selection(
            columns_and_tables_needed,
            lexical_columns_and_tables_needed,
        )
        if not columns_and_tables_needed:
            logger.warning(
                "Column pruning did not return grounded schema selections; "
                "skipping broad schema fallback."
            )
            return _empty_retrieval_results()

        tables = set(columns_and_tables_needed.keys())
        retrieval_results = []
        selected_schema_log = []
        has_calculated_field = False
        has_metric = False
        has_json_field = False

        for table_schema in construct_db_schemas:
            if table_schema["type"] == "TABLE" and table_schema["name"] in tables:
                selected_columns = set(
                    columns_and_tables_needed[table_schema["name"]]["columns"]
                )
                executable_columns = {
                    column["name"]
                    for column in table_schema["columns"]
                    if column["type"] == "COLUMN"
                    and column["data_type"].lower() != "unknown"
                }
                columns = selected_columns.intersection(executable_columns)
                if selected_columns and not columns:
                    logger.warning(
                        "Column pruning selected no executable columns for %s; "
                        "including the full model schema to preserve grounding.",
                        table_schema["name"],
                    )
                    columns = None
                ddl, _has_calculated_field, _has_json_field = (
                    _build_table_retrieval_context(
                        table_schema,
                        columns=columns,
                        tables=tables,
                    )
                )
                if _has_calculated_field:
                    has_calculated_field = True
                if _has_json_field:
                    has_json_field = True

                retrieval_results.append(
                    {
                        "table_name": table_schema["name"],
                        "table_ddl": ddl,
                        "identifier_context": _identifier_context(
                            table_schema["name"],
                            [
                                column["name"]
                                for column in _included_columns(
                                    table_schema, columns, tables
                                )
                            ],
                        ),
                    }
                )
                selected_schema_log.append(
                    {
                        "table": table_schema["name"],
                        "columns": sorted(selected_columns),
                    }
                )

        if not retrieval_results:
            logger.warning(
                "Column-selection output did not match retrieved schemas; "
                "falling back to unpruned retrieved schema context."
            )
            return _build_unpruned_retrieval_results(
                construct_db_schemas, dbschema_retrieval
            )

        for document in dbschema_retrieval:
            try:
                content = ast.literal_eval(document.content)
            except (ValueError, SyntaxError):
                logger.warning(
                    "Skipping malformed retrieved schema document during schema pruning: %s",
                    document.meta,
                )
                continue

            if not isinstance(content, dict):
                logger.warning(
                    "Skipping non-object retrieved schema document during schema pruning: %s",
                    document.meta,
                )
                continue

            content_name = content.get("name")
            content_type = content.get("type")
            if not content_name:
                logger.warning(
                    "Skipping retrieved schema document without name during schema pruning: %s",
                    document.meta,
                )
                continue

            if content_name not in tables:
                continue

            if content_type == "METRIC":
                retrieval_results.append(
                    {
                        "table_name": content_name,
                        "table_ddl": _build_metric_ddl(content),
                        "identifier_context": _identifier_context(
                            content_name,
                            [
                                column["name"]
                                for column in content.get("columns", [])
                                if column.get("name")
                                and column.get("data_type", "").lower() != "unknown"
                            ],
                        ),
                    }
                )
                has_metric = True
            elif content_type == "VIEW":
                retrieval_results.append(
                    {
                        "table_name": content_name,
                        "table_ddl": _build_view_ddl(content),
                        "identifier_context": _identifier_context(
                            content_name,
                            [
                                column["name"]
                                for column in content.get("columns", [])
                                if column.get("name")
                                and column.get("data_type", "").lower() != "unknown"
                            ],
                        ),
                    }
                )

        logger.info("Ask retrieval selected schema objects=%s", selected_schema_log)
        return {
            "retrieval_results": retrieval_results,
            "has_calculated_field": has_calculated_field,
            "has_metric": has_metric,
            "has_json_field": has_json_field,
        }
    else:
        retrieval_results = check_using_db_schemas_without_pruning["db_schemas"]
        logger.info(
            "Ask retrieval selected schema objects=%s",
            [
                {"table": retrieval_result.get("table_name"), "columns": "all"}
                for retrieval_result in retrieval_results
            ],
        )

        scored_tables.append((total_score, table_schema["name"], selected_columns))

    scored_tables.sort(key=lambda item: (-item[0], item[1]))
    return {
        table_name: {"columns": columns}
        for _, table_name, columns in scored_tables[:max_tables]
        if columns
    }


def _normalize_column_selection_results(parsed_response: Any) -> list[dict]:
    if isinstance(parsed_response, list):
        return [item for item in parsed_response if isinstance(item, dict)]

    if not isinstance(parsed_response, dict):
        return []

    for key in (
        "results",
        "tables",
        "selected_tables",
        "retrieval_results",
        "matches",
        "data",
        "result",
        "output",
    ):
        if key in parsed_response:
            normalized = _normalize_column_selection_results(parsed_response[key])
            if normalized:
                return normalized

    if "table_name" in parsed_response and (
        "table_contents" in parsed_response or "columns" in parsed_response
    ):
        return [parsed_response]

    keyed_tables = []
    for table_name, table_contents in parsed_response.items():
        if not isinstance(table_name, str) or not isinstance(table_contents, dict):
            continue
        if "table_contents" in table_contents:
            keyed_tables.append(
                {
                    "table_name": table_name,
                    "table_contents": table_contents["table_contents"],
                }
            )
        elif "columns" in table_contents:
            keyed_tables.append(
                {"table_name": table_name, "table_contents": table_contents}
            )

    return keyed_tables


def _parse_column_selection_response(filter_columns_in_tables: dict) -> dict:
    raw_reply = (filter_columns_in_tables.get("replies") or [""])[0]
    try:
        parsed_response = orjson.loads(raw_reply)
    except orjson.JSONDecodeError as exc:
        logger.warning("Unable to parse column-selection JSON response: %s", exc)
        return {}

    normalized_tables = _normalize_column_selection_results(parsed_response)
    reformatted_json = {}
    for table in normalized_tables:
        table_name = table.get("table_name") or table.get("name")
        table_contents = table.get("table_contents") or {}
        if not table_contents and "columns" in table:
            table_contents = table

        columns = (
            table_contents.get("columns") if isinstance(table_contents, dict) else None
        )
        if not isinstance(table_name, str) or not isinstance(columns, list):
            continue

        reformatted_json[table_name] = {
            **table_contents,
            "columns": [column for column in columns if isinstance(column, str)],
        }

    if not reformatted_json:
        response_shape = (
            f"keys={list(parsed_response.keys())[:8]}"
            if isinstance(parsed_response, dict)
            else type(parsed_response).__name__
        )
        logger.warning(
            "Column-selection response did not include usable table columns (%s).",
            response_shape,
        )

    return reformatted_json


def _build_unpruned_retrieval_results(
    construct_db_schemas: list[dict],
    dbschema_retrieval: list[Document],
) -> dict:
    retrieval_results = []
    has_calculated_field = False
    has_metric = False
    has_json_field = False

    for table_schema in construct_db_schemas:
        if table_schema["type"] == "TABLE":
            ddl, _has_calculated_field, _has_json_field = (
                _build_table_retrieval_context(table_schema)
            )
            retrieval_results.append(
                {
                    "table_name": table_schema["name"],
                    "table_ddl": ddl,
                }
            )
            if _has_calculated_field:
                has_calculated_field = True
            if _has_json_field:
                has_json_field = True

    for document in dbschema_retrieval:
        content = ast.literal_eval(document.content)

        if content["type"] == "METRIC":
            retrieval_results.append(
                {
                    "table_name": content["name"],
                    "table_ddl": _build_metric_ddl(content),
                }
            )
            has_metric = True
        elif content["type"] == "VIEW":
            retrieval_results.append(
                {
                    "table_name": content["name"],
                    "table_ddl": _build_view_ddl(content),
                }
            )

    return {
        "retrieval_results": retrieval_results,
        "has_calculated_field": has_calculated_field,
        "has_metric": has_metric,
        "has_json_field": has_json_field,
    }


def _merge_column_selection(
    primary: dict[str, dict],
    secondary: dict[str, dict],
) -> dict[str, dict]:
    merged = {
        table_name: {
            **table_contents,
            "columns": list(table_contents.get("columns", [])),
        }
        for table_name, table_contents in primary.items()
    }

    for table_name, table_contents in secondary.items():
        if table_name not in merged:
            merged[table_name] = {
                **table_contents,
                "columns": list(table_contents.get("columns", [])),
            }
            continue

        columns = list(merged[table_name].get("columns", []))
        for column in table_contents.get("columns", []):
            if column not in columns:
                columns.append(column)
        merged[table_name]["columns"] = columns

    return merged


def _lexical_columns_and_tables_needed(
    construct_db_schemas: list[dict],
    query: str | None,
    max_tables: int = 4,
    max_columns_per_table: int = 12,
) -> dict[str, dict]:
    if not query:
        return {}

    query_tokens = _tokenize_schema_text(_augment_retrieval_query(query))
    if not query_tokens:
        return {}

    scored_tables = []
    for table_schema in construct_db_schemas:
        if table_schema.get("type") != "TABLE":
            continue

        table_tokens = (
            _tokenize_schema_identifier_text(table_schema.get("name"))
            | _tokenize_schema_text(table_schema.get("comment"))
            | _tokenize_nested_schema_identifier_text(table_schema.get("properties"))
            | _tokenize_nested_schema_identifier_text(table_schema.get("tableReference"))
        )
        table_matches = query_tokens & table_tokens
        table_score = len(table_matches) * 6
        column_scores = []
        column_match_union: set[str] = set()

        for column in table_schema.get("columns", []):
            if (
                column.get("type") != "COLUMN"
                or column.get("data_type", "").lower() == "unknown"
            ):
                continue

            column_tokens = _tokenize_schema_identifier_text(column.get("name"))
            column_tokens.update(
                _tokenize_schema_identifier_text(column.get("display_name"))
            )
            column_tokens.update(
                _tokenize_schema_identifier_text(column.get("displayName"))
            )
            column_tokens.update(
                _tokenize_nested_schema_identifier_text(column.get("properties"))
            )
            comment_tokens = _tokenize_schema_text(
                column.get("comment")
            ) | _tokenize_schema_text(column.get("description"))
            column_matches = query_tokens & column_tokens
            comment_matches = query_tokens & comment_tokens
            score = len(column_matches) * 10
            score += len(comment_matches) * 2
            if score > 0:
                column_match_union.update(column_matches | comment_matches)
                column_scores.append(
                    (score, column["name"], column.get("is_primary_key"))
                )

        if not column_scores and table_score <= 0:
            continue

        total_score = table_score + sum(score for score, _, _ in column_scores)
        total_score += len(table_matches | column_match_union) ** 2
        if total_score <= 0:
            continue

        selected_columns = []
        for _, column_name, _ in sorted(
            column_scores,
            key=lambda item: (-item[0], item[1]),
        ):
            if column_name not in selected_columns:
                selected_columns.append(column_name)
            if len(selected_columns) >= max_columns_per_table:
                break
        for _, column_name, is_primary_key in column_scores:
            if is_primary_key and column_name not in selected_columns:
                selected_columns.append(column_name)

        scored_tables.append((total_score, table_schema["name"], selected_columns))

    scored_tables.sort(key=lambda item: (-item[0], item[1]))
    return {
        table_name: {"columns": columns}
        for _, table_name, columns in scored_tables[:max_tables]
        if columns
    }


## End of Pipeline
class MatchingTableContents(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chain_of_thought_reasoning: list[str]
    columns: list[str]


class MatchingTable(BaseModel):
    model_config = ConfigDict(extra="forbid")

    table_name: str
    table_contents: MatchingTableContents
    table_selection_reason: str


class RetrievalResults(BaseModel):
    model_config = ConfigDict(extra="forbid")

    results: list[MatchingTable]


RETRIEVAL_MODEL_KWARGS = {
    "preserve_json_schema": True,
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "retrieval_schema",
            "strict": True,
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
        table_retrieval_size: int = 50,
        table_column_retrieval_size: int = 100,
        include_related_models: bool = False,
        **kwargs,
    ):
        self._components = {
            "embedder": embedder_provider.get_text_embedder(),
            "table_retriever": document_store_provider.get_retriever(
                document_store_provider.get_store(dataset_name="table_descriptions"),
                top_k=table_retrieval_size,
            ),
            "dbschema_retriever": document_store_provider.get_retriever(
                document_store_provider.get_store(),
                top_k=table_column_retrieval_size,
            ),
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
            "include_related_models": include_related_models,
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
        logger.info(
            "Ask Retrieval pipeline is running for project_id=%s mdl_hash=%s",
            project_id or "",
            mdl_hash or "",
        )
        started_at = time.perf_counter()
        result = await self._pipe.execute(
            ["construct_retrieval_results"],
            inputs={
                "query": query,
                "tables": tables,
                "project_id": project_id or "",
                "mdl_hash": mdl_hash,
                "histories": histories or [],
                "enable_column_pruning": enable_column_pruning,
                **self._components,
                **self._configs,
            },
        )
        retrieval_results = result.get("construct_retrieval_results", {}).get(
            "retrieval_results",
            [],
        )
        _log_retrieval_timing(
            "schema_retrieval_total",
            started_at,
            project_id,
            retrieval_result_count=len(retrieval_results),
        )
        return result
