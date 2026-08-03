import ast
import asyncio
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


def _build_metric_ddl(content: dict) -> str:
    columns_ddl = [
        f"{column['comment']}{column['name']} {get_engine_supported_data_type(column['data_type'])}"
        for column in content["columns"]
        if column["data_type"].lower()
        != "unknown"  # quick fix: filtering out UNKNOWN column type
    ]

    return (
        f"{content['comment']}CREATE TABLE {content['name']} (\n  "
        + ",\n  ".join(columns_ddl)
        + "\n);"
    )


def _content_column_names(content: dict) -> list[str]:
    return [
        column.get("name", "")
        for column in content.get("columns", [])
        if column.get("name")
    ]


def _schema_column_names(content: dict) -> list[str]:
    return [
        column["name"]
        for column in content.get("columns", [])
        if column.get("type") == "COLUMN" and column.get("name")
    ]


def _identifier_catalog(table_name: str, column_names: list[str]) -> str:
    columns = "\n".join(f"- {column_name}" for column_name in column_names)
    return (
        "/* EXECUTABLE WREN IDENTIFIER CATALOG\n"
        f"table: {table_name}\n"
        "columns:\n"
        f"{columns}\n"
        "Do not create identifiers from user wording, comments, aliases, display labels, or source metadata.\n"
        "*/\n"
    )


def _semantic_context(content: dict, column_names: list[str]) -> str:
    table_name = content.get("name", "")
    semantic_parts = [
        str(content.get("comment", "") or "").strip(),
        str(content.get("properties", {}) or "").strip(),
    ]
    for column in content.get("columns", []):
        comment = str(column.get("comment", "") or "").strip()
        if comment:
            semantic_parts.append(f"{column.get('name', '')}: {comment}")

    relationship_constraints = [
        column.get("constraint", "")
        for column in content.get("columns", [])
        if column.get("type") == "FOREIGN_KEY" and column.get("constraint")
    ]

    block = [
        "/* WREN RETRIEVED SEMANTIC CONTEXT",
        f"sql_table_name_use_exactly: {table_name}",
        "sql_column_names_use_exactly:",
        *[f"- {column_name}" for column_name in column_names],
    ]
    for column_name in column_names:
        block.append(f"sql_column_name_use_exactly: {column_name}")

    if relationship_constraints:
        block.append("relationship_constraints_use_exactly:")
        block.extend(f"- {constraint}" for constraint in relationship_constraints)

    semantic_context = "\n".join(part for part in semantic_parts if part)
    if semantic_context:
        block.append("semantic_context_not_sql_identifiers:")
        block.append(semantic_context)

    block.append("*/")
    return "\n".join(block) + "\n"


def _build_table_context_ddl(
    content: dict,
    include_retrieved_semantic_context: bool = False,
) -> tuple[str, bool, bool, list[str]]:
    column_names = _schema_column_names(content)
    ddl, has_calculated_field, has_json_field = build_table_ddl(
        content,
        include_semantic_comments=False,
    )
    context = _identifier_catalog(content["name"], column_names)
    if include_retrieved_semantic_context:
        context += _semantic_context(content, column_names)

    return context + ddl, has_calculated_field, has_json_field, column_names


def _build_view_ddl(content: dict) -> str:
    columns = content.get("columns", [])
    column_names = _content_column_names(content)
    columns_ddl = [
        f"{column['name']} {get_engine_supported_data_type(column.get('data_type'))}"
        for column in columns
        if column.get("name")
        and str(column.get("data_type", "")).lower() != "unknown"
    ]

    return (
        _identifier_catalog(content["name"], column_names)
        + "/* WREN RETRIEVED SEMANTIC CONTEXT\n"
        + f"sql_table_name_use_exactly: {content['name']}\n"
        + "sql_column_names_use_exactly:\n"
        + "\n".join(f"- {column_name}" for column_name in column_names)
        + "\nsemantic_context_not_sql_identifier: view definition_omitted_from_executable_schema\n"
        + "*/\n"
        + f"CREATE TABLE {content['name']} (\n  "
        + ",\n  ".join(columns_ddl)
        + "\n);"
    )


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

    return mdl_hash if table_description_count or dbschema_count else ""


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
    active_mdl_hash: Optional[str] = None,
    mdl_hash: str = "",
) -> dict:
    effective_mdl_hash = active_mdl_hash if active_mdl_hash is not None else mdl_hash
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
    active_mdl_hash: Optional[str] = None,
    mdl_hash: str = "",
    embedding: Optional[dict] = None,
) -> list[Document]:
    effective_mdl_hash = active_mdl_hash if active_mdl_hash is not None else mdl_hash

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

        return related_names

    tables = table_retrieval.get("documents", [])
    table_names = []
    for table in tables:
        content = ast.literal_eval(table.content)
        table_name = content.get("name")
        if table_name and table_name not in table_names:
            table_names.append(table_name)

    documents = []
    if not table_names and embedding and embedding.get("embedding"):
        results = await dbschema_retriever.run(
            query_embedding=embedding.get("embedding"),
            filters=_base_filters(),
        )
        documents.extend(results["documents"])
        for document in results["documents"]:
            table_name = _document_name(document)
            if table_name and table_name not in table_names:
                table_names.append(table_name)

    visited = set(table_names)
    pending = list(table_names)
    while pending:
        current_names = pending
        pending = []
        current_documents = await _fetch_by_names(current_names)
        documents.extend(current_documents)
        pending.extend(_related_table_names(current_documents, visited))

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
) -> dict:
    retrieval_results = []
    has_calculated_field = False
    has_metric = False
    has_json_field = False

    for table_schema in construct_db_schemas:
        if table_schema["type"] == "TABLE":
            ddl, _has_calculated_field, _has_json_field, column_names = (
                _build_table_context_ddl(table_schema)
            )
            retrieval_results.append(
                {
                    "table_name": table_schema["name"],
                    "table_ddl": ddl,
                    "column_names": column_names,
                    "manifest_column_names": column_names,
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
                ddl, _has_calculated_field, _has_json_field, column_names = (
                    _build_table_context_ddl(
                        table_schema,
                        include_retrieved_semantic_context=True,
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
                        "column_names": column_names,
                        "manifest_column_names": column_names,
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
