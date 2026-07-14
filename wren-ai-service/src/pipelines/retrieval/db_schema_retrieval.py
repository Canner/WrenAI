import ast
import logging
import re
import sys
from typing import TYPE_CHECKING, Any, Optional

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
    build_table_ddl,
    clean_up_new_lines,
    get_engine_supported_data_type,
    normalize_data_type,
)
from src.utils import trace_cost
if TYPE_CHECKING:
    from src.web.v1.services.ask import AskHistory
else:
    AskHistory = Any

logger = logging.getLogger("wren-ai-service")

MAX_RELEVANT_TABLE_CANDIDATES = 5


table_columns_selection_system_prompt = """
### TASK ###
You are a highly skilled data analyst. Your goal is to examine the provided database schema, interpret the posed question, and identify the specific columns from the relevant tables required to construct an accurate SQL query.

The database schema includes tables, columns, primary keys, foreign keys, relationships, and any relevant constraints.

### INSTRUCTIONS ###
1. Carefully analyze the schema and identify the essential tables and columns needed to answer the question.
2. For each table, provide a clear and concise reasoning for why specific columns are selected.
3. List each reason as part of a step-by-step chain of thought, justifying the inclusion of each column.
4. If a "." is included in columns, put the name before the first dot into chosen columns.
5. The number of columns chosen must match the number of reasoning.
6. Final chosen columns must be only column names, don't prefix it with table names.
7. If the chosen column is a child column of a STRUCT type column, choose the parent column instead of the child column.

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
        f"{column['comment']}{column['name']} {get_engine_supported_data_type(normalize_data_type(column.get('data_type')))}"
        for column in content["columns"]
        if normalize_data_type(column.get("data_type")).lower()
        != "unknown"  # quick fix: filtering out UNKNOWN column type
    ]

    return (
        f"{content['comment']}CREATE TABLE {content['name']} (\n  "
        + ",\n  ".join(columns_ddl)
        + "\n);"
    )


def _build_view_ddl(content: dict) -> str:
    return (
        f"{content['comment']}CREATE VIEW {content['name']}\nAS {content['statement']}"
    )


## Start of Pipeline
def expand_business_terms_for_retrieval(query: str) -> str:
    normalized = (query or "").lower()
    expansions: list[str] = []

    if any(
        term in normalized
        for term in (
            "amount",
            "currency",
            "currencies",
            "customer",
            "customers",
            "invoice",
            "invoices",
            "market",
            "markets",
            "order",
            "orders",
            "product",
            "products",
            "category",
            "categories",
            "quantity",
            "qty",
            "region",
            "regions",
            "sales",
            "salesperson",
            "sales person",
            "sold",
            "value",
        )
    ):
        expansions.append(
            "transaction purchase billing account geography area representative product item category sku quantity units sold amount value total metric money exchange currency"
        )

    if any(
        term in normalized
        for term in ("defect", "failure", "issue", "repair", "resolved", "status")
    ):
        expansions.append(
            "issue defect category status resolved created updated date timestamp event"
        )

    if any(term in normalized for term in ("throughput", "production", "manufacturing")):
        expansions.append(
            "rate volume output capacity process unit group completed timestamp date"
        )

    if not expansions:
        return query

    return f"{query}\n" + "\n".join(expansions)


def _normalize_retrieval_token(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def _retrieval_terms(value: str) -> set[str]:
    stop_words = {
        "about",
        "across",
        "and",
        "are",
        "ask",
        "bar",
        "chart",
        "create",
        "different",
        "for",
        "from",
        "how",
        "in",
        "is",
        "of",
        "show",
        "the",
        "to",
        "top",
        "what",
        "which",
        "with",
    }
    terms: set[str] = set()
    for raw_token in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", value or ""):
        split_token = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", raw_token)
        for token in re.findall(r"[A-Za-z0-9]+", split_token):
            if len(token) <= 2 or token.lower() in stop_words:
                continue
            normalized_token = _normalize_retrieval_token(token)
            if normalized_token:
                terms.add(normalized_token)
    return {term for term in terms if term}


def _query_mentions_any(query: str, terms: tuple[str, ...]) -> bool:
    normalized = (query or "").lower()
    return any(re.search(rf"\b{re.escape(term)}\b", normalized) for term in terms)


def _source_text(document: Document) -> str:
    return " ".join(
        str(part or "")
        for part in (
            document.meta.get("name"),
            document.meta.get("description"),
            document.content,
        )
    ).lower()


def _source_shape_score(query: str, document: Document) -> int:
    normalized_query = (query or "").lower()
    source_text = _source_text(document)
    source_terms = _retrieval_terms(source_text)

    score = 0
    weak_non_production_terms = (
        "stage",
        "staging",
    )
    strong_non_production_terms = (
        "archive",
        "backup",
        "copy",
        "dev",
        "development",
        "duplicate",
        "sample",
        "temp",
        "test",
        "tmp",
    )
    if source_terms & set(strong_non_production_terms) and not _query_mentions_any(
        normalized_query, strong_non_production_terms
    ):
        score -= 240
    if source_terms & set(weak_non_production_terms) and not _query_mentions_any(
        normalized_query, weak_non_production_terms
    ):
        score -= 40

    aggregation_terms = (
        "amount",
        "average",
        "avg",
        "count",
        "distribution",
        "metric",
        "revenue",
        "sum",
        "total",
        "trend",
        "value",
        "volume",
    )
    transaction_source_terms = (
        "activity",
        "detail",
        "event",
        "fact",
        "history",
        "invoice",
        "line",
        "order",
        "sale",
        "sales",
        "transaction",
    )
    reference_source_terms = (
        "account",
        "catalog",
        "dimension",
        "directory",
        "entity",
        "lookup",
        "master",
        "profile",
        "reference",
    )
    entity_listing_pattern = re.search(
        r"\b(?:list|show|display|get|find)\b.*\b(?:accounts?|customers?|"
        r"employees?|entities|items?|names?|products?|suppliers?|users?|vendors?)\b",
        normalized_query,
    )
    asks_for_aggregation = _query_mentions_any(normalized_query, aggregation_terms) or bool(
        re.search(r"\b(?:by|per|each|top|bottom|rank|ranking)\b", normalized_query)
    )
    asks_for_entity_listing = bool(entity_listing_pattern) and not asks_for_aggregation

    if asks_for_entity_listing:
        if source_terms & set(reference_source_terms):
            score += 35
        if source_terms & set(transaction_source_terms):
            score -= 12
    elif asks_for_aggregation:
        if source_terms & set(transaction_source_terms):
            score += 25
        if source_terms & set(reference_source_terms):
            score += 5

    return score


def _document_relevance_score(document: Document, query_terms: set[str]) -> int:
    if not query_terms:
        return 0

    document_terms = _retrieval_terms(
        " ".join(
            str(part or "")
            for part in (
                document.meta.get("name"),
                document.meta.get("description"),
                document.content,
            )
        )
    )
    if not document_terms:
        return 0

    score = 0
    for query_term in query_terms:
        if query_term in document_terms:
            score += 20
            continue
        for document_term in document_terms:
            if query_term in document_term or document_term in query_term:
                score += 8
                break
    return score


def _semantic_score(document: Document) -> float:
    score = getattr(document, "score", None)
    if isinstance(score, (int, float)):
        return float(score)
    score = document.meta.get("score")
    if isinstance(score, (int, float)):
        return float(score)
    return 0.0


def _score_table_documents(
    query: str, documents: list[Document]
) -> list[tuple[float, int, Document, int, float]]:
    if not documents:
        return []

    query_terms = _retrieval_terms(expand_business_terms_for_retrieval(query))
    if not query_terms:
        return [
            (_semantic_score(document), -index, document, 0, _semantic_score(document))
            for index, document in enumerate(documents)
        ]

    scored_documents: list[tuple[float, int, Document, int, float]] = []
    for index, document in enumerate(documents):
        lexical_score = _document_relevance_score(document, query_terms)
        semantic_score = _semantic_score(document)
        source_shape_score = _source_shape_score(query, document)
        combined_score = semantic_score + lexical_score + source_shape_score
        scored_documents.append(
            (combined_score, -index, document, lexical_score, semantic_score)
        )

    return sorted(scored_documents, key=lambda item: (item[0], item[1]), reverse=True)


def _rerank_table_documents(query: str, documents: list[Document]) -> list[Document]:
    if not documents:
        return documents

    reranked = _score_table_documents(query, documents)
    if not reranked:
        return documents

    logger.info(
        "Top table candidates after retrieval rerank: %s",
        [
            {
                "name": document.meta.get("name"),
                "semantic_score": round(semantic_score, 4),
                "lexical_score": lexical_score,
                "combined_score": round(combined_score, 4),
            }
            for combined_score, _index, document, lexical_score, semantic_score in reranked[
                :5
            ]
        ],
    )
    return [document for _score, _index, document, _lexical, _semantic in reranked]


def _select_relevant_table_documents(
    query: str,
    documents: list[Document],
    *,
    max_tables: int = MAX_RELEVANT_TABLE_CANDIDATES,
) -> list[Document]:
    if not documents or max_tables <= 0:
        return []

    reranked = _score_table_documents(query, documents)
    if not reranked:
        return documents[:max_tables]

    candidate_pool = [item for item in reranked if item[3] > 0] or reranked
    selected = [
        document
        for _score, _index, document, _lexical, _semantic in candidate_pool[:max_tables]
    ]
    if len(selected) < len(documents):
        logger.info(
            "Scoped table candidates for schema loading from %s to %s tables: %s",
            len(documents),
            len(selected),
            [document.meta.get("name") for document in selected],
        )
    return selected


def _is_project_wide_analysis_query(query: str) -> bool:
    normalized = (query or "").lower()
    if not normalized:
        return False

    analysis_terms = {
        "average",
        "avg",
        "bar chart",
        "breakdown",
        "chart",
        "completed",
        "compare",
        "count",
        "counts",
        "distribution",
        "group by",
        "grouped",
        "highest",
        "line chart",
        "lowest",
        "maximum",
        "minimum",
        "monthly",
        "most common",
        "number of",
        "pie chart",
        "quarter",
        "rank",
        "ranking",
        "recommend",
        "recommended",
        "show",
        "status",
        "sum",
        "total",
        "totals",
        "top",
        "trend",
        "volume",
    }
    return any(term in normalized for term in analysis_terms)


def _dedupe_documents(documents: list[Document]) -> list[Document]:
    deduped: list[Document] = []
    seen: set[tuple[str, str, str]] = set()
    for document in documents:
        key = (
            str(document.meta.get("name", "")),
            str(document.meta.get("type", "")),
            document.content,
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(document)
    return deduped


def _normalize_table_names(table_names: Optional[list[str]]) -> list[str]:
    normalized: list[str] = []
    for table_name in table_names or []:
        if not isinstance(table_name, str):
            continue
        table_name = table_name.strip()
        if table_name and table_name not in normalized:
            normalized.append(table_name)
    return normalized


def _extract_table_names_from_table_retrieval(
    table_retrieval: dict, explicit_tables: Optional[list[str]] = None
) -> list[str]:
    table_names = _normalize_table_names(explicit_tables)
    for document in table_retrieval.get("documents") or []:
        if not isinstance(document, Document):
            continue
        table_name = document.meta.get("name")
        if not isinstance(table_name, str):
            try:
                content = ast.literal_eval(document.content)
            except (SyntaxError, ValueError):
                content = {}
            table_name = content.get("name") if isinstance(content, dict) else None
        if isinstance(table_name, str):
            table_name = table_name.strip()
            if table_name and table_name not in table_names:
                table_names.append(table_name)
    return table_names


@observe(capture_input=False, capture_output=False)
async def embedding(
    query: str,
    embedder: Any,
    histories: list[AskHistory],
    tables: Optional[list[str]] = None,
) -> dict:
    if tables:
        logger.info("Skipping embedding retrieval for explicit tables: %s", tables)
        return {}

    if query:
        if histories:
            previous_query_summaries = [history.question for history in histories]
        else:
            previous_query_summaries = []

        query = "\n".join(previous_query_summaries) + "\n" + query
        query = expand_business_terms_for_retrieval(query)

        return await embedder.run(query)
    else:
        return {}


@observe(capture_input=False)
async def table_retrieval(
    query: str,
    embedding: dict,
    project_id: str,
    tables: list[str],
    table_retriever: Any,
) -> dict:
    base_filters = {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_DESCRIPTION"},
        ],
    }

    if project_id:
        base_filters["conditions"].append(
            {"field": "project_id", "operator": "==", "value": project_id}
        )

    if embedding:
        results = await table_retriever.run(
            query_embedding=embedding.get("embedding"),
            filters=base_filters,
        )
        results["documents"] = _select_relevant_table_documents(
            query, results.get("documents") or []
        )
        return results

    if tables:
        normalized_tables = _normalize_table_names(tables)
        logger.info(
            "Using explicit table names without table-description lookup: %s",
            normalized_tables,
        )
        return {
            "documents": [
                Document(
                    content=str({"name": table_name}),
                    meta={"type": "TABLE_DESCRIPTION", "name": table_name},
                )
                for table_name in normalized_tables
            ]
        }

    return {"documents": []}


@observe(capture_input=False)
async def dbschema_retrieval(
    query: str,
    table_retrieval: dict,
    project_id: str,
    dbschema_retriever: Any,
    tables: Optional[list[str]] = None,
    embedding: Optional[dict] = None,
) -> list[Document]:
    selected_table_names = _extract_table_names_from_table_retrieval(
        table_retrieval, tables
    )

    filters = {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
        ],
    }
    if project_id:
        filters["conditions"].append(
            {"field": "project_id", "operator": "==", "value": project_id}
        )

    if selected_table_names:
        filters["conditions"].append(
            {"field": "name", "operator": "in", "value": selected_table_names}
        )
        logger.info(
            "Loading selected deployed schema metadata for active project_id %s tables=%s",
            project_id,
            selected_table_names,
        )
    elif not query:
        logger.info(
            "Loading complete deployed schema metadata for active project_id %s",
            project_id,
        )
    else:
        query_embedding = (
            embedding.get("embedding") if isinstance(embedding, dict) else None
        )
        if query_embedding:
            logger.info(
                "No table-description candidates found for active project_id %s; "
                "falling back to deployed schema vector retrieval for query=%s",
                project_id,
                query,
            )
            candidate_results = await dbschema_retriever.run(
                query_embedding=query_embedding,
                filters=filters,
            )
            selected_table_names = _extract_table_names_from_table_retrieval(
                candidate_results
            )[:MAX_RELEVANT_TABLE_CANDIDATES]
            if selected_table_names:
                filters["conditions"].append(
                    {"field": "name", "operator": "in", "value": selected_table_names}
                )
                logger.info(
                    "Loading deployed schema metadata from fallback candidates for "
                    "active project_id %s tables=%s",
                    project_id,
                    selected_table_names,
                )
            else:
                documents = candidate_results.get("documents") or []
                logger.info(
                    "No deployed schema fallback candidates found for active "
                    "project_id %s query=%s",
                    project_id,
                    query,
                )
                return documents
        else:
            logger.info(
                "No relevant table-description candidates found for active project_id %s; "
                "skipping full schema loading for query=%s",
                project_id,
                query,
            )
            return []

    results = await dbschema_retriever.run(query_embedding=[], filters=filters)
    return results.get("documents", [])


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
            ddl, _has_calculated_field, _has_json_field = build_table_ddl(table_schema)
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
            build_table_ddl(construct_db_schema)[0]
            for construct_db_schema in construct_db_schemas
        ]

        previous_query_summaries = (
            [history.question for history in histories] if histories else []
        )

        query = "\n".join(previous_query_summaries) + "\n" + query

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
                ddl, _has_calculated_field, _has_json_field = build_table_ddl(
                    table_schema,
                    columns=set(
                        columns_and_tables_needed[table_schema["name"]]["columns"]
                    ),
                    tables=tables,
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
            if document.meta["name"] in columns_and_tables_needed:
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
        table_retrieval_size: int = 10,
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
                "histories": histories or [],
                "enable_column_pruning": enable_column_pruning,
                **self._components,
                **self._configs,
            },
        )
