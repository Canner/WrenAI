import ast
import logging
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
from src.utils import trace_cost
from src.web.v1.services.ask import AskHistory

logger = logging.getLogger("wren-ai-service")


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
13. Do not stop at a single top candidate when the question requires multiple related datasets.
14. If the same business concept is represented by multiple modeled datasets, select only the dataset or related dataset set whose declared fields and relationships best support the current question.
15. If WREN RETRIEVED SEMANTIC CONTEXT is present, use sql_table_name_use_exactly and sql_column_name_use_exactly/sql_column_names_use_exactly as the exact names to return.
16. Use semantic_context_not_sql_identifiers only to understand meaning; do not return labels, source metadata, aliases, lineage names, or rewritten variants as table or column names.

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


def _build_view_ddl(content: dict) -> str:
    columns = [
        column
        for column in content.get("columns", [])
        if column.get("name") and column.get("data_type", "").lower() != "unknown"
    ]
    context = _format_semantic_context(
        {
            "object_type": "view",
            "sql_identifier_contract": {
                "sql_table_name_use_exactly": content["name"],
                "sql_column_names_use_exactly": [
                    column["name"] for column in columns
                ],
            },
            "semantic_context_not_sql_identifiers": {
                "role": "stable virtual table interface",
                "description": content["comment"],
                "definition_omitted_from_executable_schema": True,
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
            "If a needed business concept is described here, use the corresponding exact table or column identifier listed here or declared in the following DDL.",
            "If a word appears only in the user question and is not represented by this catalog, semantic context, or DDL, do not create an identifier from that word.",
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
        lines.extend(f"- {constraint}" for constraint in relationship_constraints)
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


def _selected_columns_are_executable(content: dict, columns: set[str]) -> bool:
    executable_columns = {
        column["name"]
        for column in content["columns"]
        if column["type"] == "COLUMN" and column["data_type"].lower() != "unknown"
    }
    return bool(columns) and columns.issubset(executable_columns)


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
                    if relationship.get("constraint")
                ],
            },
            "semantic_context_not_sql_identifiers": {
                "description": content["comment"],
            },
            "columns": [
                {
                    "sql_column_name_use_exactly": column["name"],
                    "data_type": get_engine_supported_data_type(column["data_type"]),
                    "is_primary_key": column["is_primary_key"],
                    "semantic_context_not_sql_identifier": column["comment"],
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
                if relationship.get("constraint")
            ],
        }
    )
    return f"{context}{ddl}", has_calculated_field, has_json_field


## Start of Pipeline
@observe(capture_input=False, capture_output=False)
async def embedding(query: str, embedder: Any, histories: list[AskHistory]) -> dict:
    if query:
        return await embedder.run(query)
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
    embedding: dict | None = None,
    mdl_hash: str | None = None,
) -> list[Document]:
    table_names = _table_names_from_description_documents(
        table_retrieval.get("documents", [])
    )
    documents = []
    if embedding and not table_names:
        documents = await _retrieve_semantic_schema_documents(
            embedding, project_id, dbschema_retriever, mdl_hash
        )
        table_names = _table_names_from_schema_documents(documents)

    if table_names:
        retrieved_table_names = set()
        pending_table_names = table_names

        while pending_table_names:
            retrieved_table_names.update(pending_table_names)
            retrieved_documents = await _retrieve_schema_documents(
                pending_table_names, project_id, dbschema_retriever, mdl_hash
            )
            documents = _dedupe_documents(documents + retrieved_documents)
            pending_table_names = [
                table_name
                for table_name in _related_table_names(documents)
                if table_name not in retrieved_table_names
            ]

        return documents

    return []


async def _retrieve_semantic_schema_documents(
    embedding: dict,
    project_id: str,
    dbschema_retriever: Any,
    mdl_hash: str | None = None,
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


def _merge_names(*name_groups: list[str]) -> list[str]:
    merged = []
    seen = set()

    for names in name_groups:
        for name in names:
            if name in seen:
                continue
            merged.append(name)
            seen.add(name)

    return merged


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
    dbschema_retriever: Any,
    mdl_hash: str | None = None,
) -> list[Document]:
    table_name_conditions = [
        {"field": "name", "operator": "==", "value": table_name}
        for table_name in table_names
    ]

    if not table_name_conditions:
        return []

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

    return {
        "db_schemas": retrieval_results,
        "tokens": _token_count,
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
        db_schemas = [
            _build_table_retrieval_context(construct_db_schema)[0]
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
        return await table_columns_selection_generator(
            prompt=prompt.get("prompt")
        ), generator_name
    else:
        return {}, generator_name


@observe()
def construct_retrieval_results(
    check_using_db_schemas_without_pruning: dict,
    filter_columns_in_tables: dict,
    construct_db_schemas: list[dict],
    dbschema_retrieval: list[Document],
) -> dict[str, Any]:
    if filter_columns_in_tables:
        columns_and_tables_needed = orjson.loads(
            filter_columns_in_tables["replies"][0]
        )["results"]

        # we need to change the below code to match the new schema of structured output
        # the objective of this loop is to change the structure of JSON to match the needed format
        reformated_json = {}
        for table in columns_and_tables_needed:
            reformated_json[table["table_name"]] = table["table_contents"]
        columns_and_tables_needed = reformated_json
        tables = set(columns_and_tables_needed.keys())
        retrieval_results = []
        has_calculated_field = False
        has_metric = False
        has_json_field = False

        for table_schema in construct_db_schemas:
            if table_schema["type"] == "TABLE" and table_schema["name"] in tables:
                selected_columns = set(
                    columns_and_tables_needed[table_schema["name"]]["columns"]
                )
                columns = (
                    selected_columns
                    if _selected_columns_are_executable(
                        table_schema, selected_columns
                    )
                    else None
                )
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
                    }
                )

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
    else:
        retrieval_results = check_using_db_schemas_without_pruning["db_schemas"]

        return {
            "retrieval_results": retrieval_results,
            "has_calculated_field": check_using_db_schemas_without_pruning[
                "has_calculated_field"
            ],
            "has_metric": check_using_db_schemas_without_pruning["has_metric"],
            "has_json_field": check_using_db_schemas_without_pruning["has_json_field"],
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
        table_retrieval_size: int = 50,
        table_column_retrieval_size: int = 100,
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
                "mdl_hash": mdl_hash,
                "histories": histories or [],
                "enable_column_pruning": enable_column_pruning,
                **self._components,
                **self._configs,
            },
        )
