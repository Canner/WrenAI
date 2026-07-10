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
from pydantic import BaseModel, Field

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


table_columns_selection_system_prompt = """
### TASK ###
You are a highly skilled data analyst. Your goal is to examine the provided active deployed database schema, interpret the posed question, and identify the specific tables, columns, metrics, views, and relationships required to construct an accurate SQL query.

The database schema includes tables, columns, primary keys, foreign keys, relationships, and any relevant constraints.

### INSTRUCTIONS ###
1. First perform a semantic analysis of the user's request. Identify intended business entities, identifiers, descriptive attributes, metrics, dimensions, filters, aggregations, relationships, time constraints, ranking requirements, and analytical intent such as retrieval, detailed records, summary, comparison, trend analysis, dashboard, KPI, ranking, or record count.
2. Map each business term to explicit schema objects only when the active schema directly supports that term. Distinguish entities such as customer/order/invoice/product from identifiers such as order ID or invoice number, descriptive attributes, and measurable metrics such as amount, quantity, cost, profit, revenue, or duration.
3. Select tables and columns by semantic fit to the full request, not by isolated keyword overlap or commonly used default tables.
4. Include join keys and relationship columns needed to connect selected tables. Do not invent relationships or foreign keys.
5. If the schema does not support a requested entity, metric, dimension, filter, time range, aggregation, or ranking requirement, record it in `missing_requirements`.
6. If multiple schema interpretations are equally plausible and the question does not disambiguate them, record them in `ambiguous_requirements`.
7. Set `is_fully_supported` to false when any required request component is missing or ambiguous.
8. For each selected table, provide a concise reason for why the table is semantically relevant.
9. For each selected column, provide a concise reason for why the column is necessary.
10. Populate `concept_mappings` for every important concept in the request. Each mapping must classify the concept, list only directly supporting schema objects, state whether it must appear in SQL, and include a confidence score between 0 and 1.
11. Broad business entities can be satisfied by the selected table plus the best descriptive or identifier column for that entity. For example, an entity such as customer may map to a customer name, customer number, account, client, or similar descriptive/identifier column when that is the active schema's representation. Do not leave an entity unmapped when a selected dimension or identifier column represents it.
12. When the user asks for a top/bottom/ranking query, map the ranked dimension and ranked metric separately. The SQL generator must be able to ORDER BY the metric and limit rows.
13. Do not add filters or time constraints that are not requested or implied by the user. Only map date/time concepts when the user asks for a time period, trend, date filter, or date dimension.
14. Populate `interpretations` when the request has more than one plausible schema interpretation. Rank interpretations by semantic relevance, confidence, and schema support; mark the selected interpretation only when it is clearly the best supported one. Keep non-selected high-confidence interpretations so the SQL pipeline can retry the next-best mapping if validation fails.
15. Populate `candidate_schema_scores` with ranked candidates. Score each candidate by full concept coverage, semantic fit, relationship viability, metric validity, and whether it satisfies filters/time/ranking/aggregation requirements. Reject partial lexical matches even when a table or column name looks similar.
16. Select only the highest-confidence candidate whose mappings completely cover all required concepts. If no candidate fully covers the request, set `is_fully_supported` to false and list missing or ambiguous requirements instead of selecting a partial mapping.
17. If RETRY CONTEXT is provided, treat rejected schema objects as failed mappings. Do not select those objects again unless every complete candidate is exhausted; explain any reuse in `support_reasoning`.
18. If a "." is included in columns, put the name before the first dot into chosen columns.
19. The number of columns chosen must match the number of reasoning.
20. Final chosen columns must be only column names, don't prefix it with table names.
21. If the chosen column is a child column of a STRUCT type column, choose the parent column instead of the child column.
22. If the schema cannot answer the question, return the closest directly relevant schema objects only if they explain the limitation. Do not select unrelated fallback tables.

### FINAL ANSWER FORMAT ###
Please provide your response as a JSON object, structured as follows:

{
    "semantic_analysis": {
        "analytical_intent": "retrieval | detailed_records | summary | comparison | trend | dashboard | kpi | ranking | record_count | other",
        "entities": ["business entities requested by the user"],
        "identifiers": ["identifier fields requested by the user"],
        "metrics": ["business metrics or measures requested by the user"],
        "dimensions": ["grouping or descriptive dimensions requested by the user"],
        "filters": ["filters or predicates requested by the user"],
        "aggregations": ["aggregation or calculation requirements"],
        "relationships": ["required joins or relationships"],
        "time_constraints": ["time filters, grains, or trend requirements"],
        "ranking": ["top/bottom/order/limit requirements"],
        "supported_schema_objects": ["table.column or metric names that directly support the request"],
        "candidate_schema_scores": [
            {
                "candidate_id": "candidate-1",
                "schema_objects": ["table.column objects included in this candidate"],
                "covered_concepts": ["request concepts this candidate supports"],
                "missing_concepts": ["request concepts this candidate cannot support"],
                "confidence": 0.0,
                "is_complete": true,
                "selection_reason": "Why this candidate is accepted or rejected"
            }
        ],
        "concept_mappings": [
            {
                "request_concept": "business concept from the user request",
                "concept_type": "entity | identifier | dimension | metric | filter | time | aggregation | ranking | relationship | comparison",
                "schema_objects": ["table.column, table, view, metric, or relationship object that directly supports the concept"],
                "required_in_sql": true,
                "confidence": 0.0,
                "mapping_reason": "Why these schema objects semantically support the concept"
            }
        ],
        "interpretations": [
            {
                "description": "Possible interpretation of the request",
                "schema_objects": ["schema objects used by this interpretation"],
                "confidence": 0.0,
                "is_selected": true
            }
        ],
        "missing_requirements": ["required request components not supported by the schema"],
        "ambiguous_requirements": ["request components with multiple equally plausible schema mappings"],
        "is_fully_supported": true,
        "support_reasoning": "Concise explanation of whether the selected schema fully supports the request"
    },
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
- Populate `semantic_analysis` before `results`; use it to verify the selected schema directly supports the request.
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

{% if semantic_candidate_context %}
### PRE-RANKED SEMANTIC SCHEMA CANDIDATES ###
These candidates were scored generically from the active datasource schema metadata and the user's full request.
Use them as retrieval evidence, but still verify complete concept coverage before selecting a contract.
Prefer candidates that cover all requested entities, identifiers, metrics, dimensions, filters, time constraints, aggregations, and ranking requirements.
Do not select a high lexical match when it misses a required business concept.

{% for candidate in semantic_candidate_context %}
- candidate_id: {{ candidate.candidate_id }}
  table_name: {{ candidate.table_name }}
  confidence: {{ candidate.confidence }}
  coverage_score: {{ candidate.coverage_score }}
  matched_query_terms: {{ candidate.matched_query_terms }}
  missing_query_terms: {{ candidate.missing_query_terms }}
  rejected_by_retry: {{ candidate.rejected_by_retry }}
  selection_reason: {{ candidate.selection_reason }}
  matched_columns:
{% for column in candidate.matched_columns %}
    - {{ column.column_name }} (score={{ column.score }}, data_type={{ column.data_type }}, matched_terms={{ column.matched_terms }})
{% endfor %}
{% endfor %}
{% endif %}

### INPUT ###
{{ question }}

{% if semantic_retry_context %}
### RETRY CONTEXT ###
Previous semantic SQL validation failed. Discard the previous contract and do not reuse rejected schema mappings unless no other complete candidate exists.
Validation failure: {{ semantic_retry_context.validation_error }}
Retry attempt: {{ semantic_retry_context.retry_attempt }}
Rejected schema objects:
{% for schema_object in semantic_retry_context.rejected_schema_objects %}
- {{ schema_object }}
{% endfor %}
{% endif %}
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
    return query


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


_SEMANTIC_TOKEN_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "give",
    "have",
    "how",
    "in",
    "is",
    "me",
    "of",
    "on",
    "or",
    "show",
    "that",
    "the",
    "to",
    "with",
    "dbo",
    "tbl",
    "table",
    "view",
    "dim",
    "fact",
    "stage",
    "stg",
}

_NUMERIC_SCHEMA_TERMS = {
    "amount",
    "avg",
    "average",
    "balance",
    "cost",
    "count",
    "gross",
    "margin",
    "measure",
    "metric",
    "net",
    "price",
    "profit",
    "quantity",
    "rate",
    "revenue",
    "sales",
    "sum",
    "total",
    "value",
}

_TEMPORAL_SCHEMA_TERMS = {
    "date",
    "day",
    "month",
    "monthly",
    "quarter",
    "time",
    "week",
    "year",
}

_RANKING_SCHEMA_TERMS = {
    "bottom",
    "highest",
    "least",
    "lowest",
    "most",
    "rank",
    "ranking",
    "top",
}

_GENERIC_SEMANTIC_SYNONYMS = {
    "acct": {"account", "customer"},
    "account": {"acct", "customer", "client"},
    "accounts": {"acct", "account", "customer", "client"},
    "amt": {"amount", "value", "total"},
    "amount": {"amt", "value", "total"},
    "bill": {"invoice"},
    "billing": {"invoice"},
    "client": {"account", "customer"},
    "clients": {"account", "customer"},
    "cust": {"customer", "client", "account"},
    "customer": {"cust", "client", "account"},
    "customers": {"cust", "client", "account", "customer"},
    "desc": {"description", "name"},
    "description": {"desc", "name"},
    "inv": {"invoice"},
    "invoice": {"inv", "bill", "billing"},
    "invoices": {"inv", "invoice", "bill", "billing"},
    "name": {"description", "label"},
    "no": {"number", "identifier", "id"},
    "num": {"number", "identifier", "id"},
    "number": {"no", "num", "identifier", "id"},
    "qty": {"quantity"},
    "quantity": {"qty"},
    "total": {"amount", "value", "sum"},
    "value": {"amount", "total"},
}


def _semantic_tokens(value: Any) -> set[str]:
    text = str(value or "")
    if not text:
        return set()

    text = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", text)
    text = re.sub(r"[^A-Za-z0-9]+", " ", text)
    tokens = {
        token.lower()
        for token in text.split()
        if len(token) > 1 and token.lower() not in _SEMANTIC_TOKEN_STOPWORDS
    }
    for token in list(tokens):
        if token.endswith("ies") and len(token) > 4:
            tokens.add(f"{token[:-3]}y")
        elif token.endswith("s") and len(token) > 3:
            tokens.add(token[:-1])
    for token in list(tokens):
        tokens.update(_GENERIC_SEMANTIC_SYNONYMS.get(token, set()))
    return tokens


def _schema_comment_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return " ".join(_schema_comment_text(item) for item in value)
    if isinstance(value, dict):
        return " ".join(_schema_comment_text(item) for item in value.values())
    return str(value)


def _column_tokens(column: dict[str, Any]) -> set[str]:
    tokens = set()
    for key in ("name", "display_name", "alias", "comment", "description", "data_type"):
        tokens.update(_semantic_tokens(column.get(key)))
    tokens.update(_semantic_tokens(_schema_comment_text(column.get("properties"))))
    return tokens


def _table_tokens(table_schema: dict[str, Any]) -> set[str]:
    tokens = set()
    for key in ("name", "display_name", "alias", "comment", "description"):
        tokens.update(_semantic_tokens(table_schema.get(key)))
    for column in table_schema.get("columns", []) or []:
        if isinstance(column, dict):
            tokens.update(_column_tokens(column))
    return tokens


def _query_semantic_terms(query: str) -> dict[str, set[str]]:
    tokens = _semantic_tokens(query)
    return {
        "all": tokens,
        "metric": tokens & _NUMERIC_SCHEMA_TERMS,
        "time": tokens & _TEMPORAL_SCHEMA_TERMS,
        "ranking": tokens & _RANKING_SCHEMA_TERMS,
    }


def _is_numeric_column(column: dict[str, Any]) -> bool:
    data_type = str(column.get("data_type") or "").lower()
    return bool(
        re.search(
            r"\b(?:int|integer|bigint|smallint|tinyint|decimal|numeric|number|double|float|real|money)\b",
            data_type,
        )
    )


def _is_identifier_column(column: dict[str, Any]) -> bool:
    tokens = _column_tokens(column)
    return bool(tokens & {"code", "id", "identifier", "key", "no", "number"})


def _is_temporal_column(column: dict[str, Any]) -> bool:
    data_type = str(column.get("data_type") or "").lower()
    return bool(re.search(r"\b(?:date|time|timestamp|datetime)\b", data_type))


def _normalized_schema_object(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _rejected_schema_objects(semantic_retry_context: dict[str, Any] | None) -> set[str]:
    if not isinstance(semantic_retry_context, dict):
        return set()

    rejected = semantic_retry_context.get("rejected_schema_objects")
    if not isinstance(rejected, list):
        return set()

    return {
        _normalized_schema_object(item)
        for item in rejected
        if item is not None and str(item).strip()
    }


def _schema_object_was_rejected(
    table_name: str,
    column_name: str | None,
    rejected_schema_objects: set[str],
) -> bool:
    if not rejected_schema_objects:
        return False

    table_key = _normalized_schema_object(table_name)
    object_key = _normalized_schema_object(
        f"{table_name}.{column_name}" if column_name else table_name
    )
    return any(
        rejected_key
        and (
            rejected_key == table_key
            or rejected_key == object_key
            or rejected_key.endswith(object_key)
            or object_key.endswith(rejected_key)
        )
        for rejected_key in rejected_schema_objects
    )


def rank_semantic_schema_candidates(
    query: str,
    construct_db_schemas: list[dict],
    semantic_retry_context: dict[str, Any] | None = None,
    max_candidates: int = 15,
    max_columns_per_candidate: int = 8,
) -> list[dict[str, Any]]:
    query_terms = _query_semantic_terms(query)
    all_query_terms = query_terms["all"]
    if not all_query_terms:
        return []

    rejected_schema_objects = _rejected_schema_objects(semantic_retry_context)
    candidates: list[dict[str, Any]] = []

    for table_schema in construct_db_schemas:
        if table_schema.get("type") != "TABLE":
            continue

        table_name = str(table_schema.get("name") or "").strip()
        if not table_name:
            continue

        table_term_matches = _table_tokens(table_schema) & all_query_terms
        matched_columns = []
        table_rejected = _schema_object_was_rejected(
            table_name, None, rejected_schema_objects
        )

        for column in table_schema.get("columns", []) or []:
            if not isinstance(column, dict):
                continue

            column_name = str(column.get("name") or "").strip()
            if not column_name:
                continue

            tokens = _column_tokens(column)
            matched_terms = sorted(tokens & all_query_terms)
            score = float(len(matched_terms) * 3)

            if query_terms["metric"] and _is_numeric_column(column):
                score += 0.3 if _is_identifier_column(column) else 1.5
                if tokens & query_terms["metric"]:
                    score += 2.0
            if query_terms["time"] and _is_temporal_column(column):
                score += 1.5
                if tokens & query_terms["time"]:
                    score += 2.0
            if query_terms["ranking"] and matched_terms:
                score += 0.5

            rejected = _schema_object_was_rejected(
                table_name, column_name, rejected_schema_objects
            )
            if rejected:
                score -= 5.0

            if score > 0 or matched_terms:
                matched_columns.append(
                    {
                        "column_name": column_name,
                        "score": round(max(score, 0.0), 3),
                        "matched_terms": matched_terms,
                        "data_type": str(column.get("data_type") or ""),
                        "rejected_by_retry": rejected,
                    }
                )

        matched_columns.sort(
            key=lambda item: (item["score"], len(item["matched_terms"])),
            reverse=True,
        )
        matched_columns = matched_columns[:max_columns_per_candidate]

        covered_terms = set(table_term_matches)
        for column in matched_columns:
            covered_terms.update(column["matched_terms"])

        if not covered_terms and not table_rejected:
            continue

        coverage_score = len(covered_terms) / max(len(all_query_terms), 1)
        raw_score = (
            len(table_term_matches) * 2.0
            + sum(column["score"] for column in matched_columns)
            + coverage_score * 4.0
        )
        if table_rejected:
            raw_score -= 6.0
        column_lookup = {
            str(column.get("name") or ""): column
            for column in table_schema.get("columns", []) or []
            if isinstance(column, dict)
        }
        has_metric_support = any(
            query_terms["metric"] & set(column["matched_terms"])
            or (
                _is_numeric_column(column_lookup.get(column["column_name"], {}))
                and not _is_identifier_column(
                    column_lookup.get(column["column_name"], {})
                )
            )
            for column in matched_columns
        )
        if query_terms["metric"] and not has_metric_support:
            raw_score -= 2.0

        confidence = min(max(raw_score / 20.0, 0.0), 0.99)
        selection_reason = (
            "Covers "
            f"{len(covered_terms)} of {len(all_query_terms)} significant request terms"
        )
        if table_rejected:
            selection_reason += "; penalized because it was rejected by semantic validation"
        if query_terms["metric"] and not any(
            set(column["matched_terms"]) & query_terms["metric"]
            for column in matched_columns
        ):
            selection_reason += "; metric term coverage is weak"

        candidates.append(
            {
                "candidate_id": f"candidate-{len(candidates) + 1}",
                "table_name": table_name,
                "confidence": round(confidence, 3),
                "coverage_score": round(coverage_score, 3),
                "matched_query_terms": sorted(covered_terms),
                "missing_query_terms": sorted(all_query_terms - covered_terms),
                "matched_columns": matched_columns,
                "rejected_by_retry": table_rejected
                or any(column["rejected_by_retry"] for column in matched_columns),
                "selection_reason": selection_reason,
            }
        )

    candidates.sort(
        key=lambda item: (
            item["rejected_by_retry"] is False,
            item["confidence"],
            item["coverage_score"],
        ),
        reverse=True,
    )

    for index, candidate in enumerate(candidates[:max_candidates], start=1):
        candidate["candidate_id"] = f"candidate-{index}"

    return candidates[:max_candidates]


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
    embedding: dict, project_id: str, tables: list[str], table_retriever: Any
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
        result = await table_retriever.run(
            query_embedding=embedding.get("embedding"),
            filters=base_filters,
        )
        return result

    if tables:
        logger.info("Skipping table-description retrieval for explicit tables: %s", tables)
        return {"documents": []}

    return {"documents": []}


@observe(capture_input=False)
async def dbschema_retrieval(
    query: str,
    table_retrieval: dict,
    project_id: str,
    dbschema_retriever: Any,
    tables: Optional[list[str]] = None,
) -> list[Document]:
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

    logger.info(
        "Loading complete deployed schema metadata for active project_id %s",
        project_id,
    )
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
    if enable_column_pruning or _token_count > context_window_size:
        return {
            "db_schemas": [],
            "tokens": _token_count,
            "has_calculated_field": has_calculated_field,
            "has_metric": has_metric,
            "has_json_field": has_json_field,
            "semantic_analysis": {},
        }

    return {
        "db_schemas": retrieval_results,
        "tokens": _token_count,
        "has_calculated_field": has_calculated_field,
        "has_metric": has_metric,
        "has_json_field": has_json_field,
        "semantic_analysis": {},
    }


@observe(capture_input=False)
def prompt(
    query: str,
    construct_db_schemas: list[dict],
    prompt_builder: PromptBuilder,
    check_using_db_schemas_without_pruning: dict,
    histories: list[AskHistory],
    semantic_retry_context: dict[str, Any] | None = None,
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
        semantic_candidate_context = rank_semantic_schema_candidates(
            query=query,
            construct_db_schemas=construct_db_schemas,
            semantic_retry_context=semantic_retry_context,
        )
        logger.info(
            "semantic_retrieval_pre_ranked_candidates=%s",
            semantic_candidate_context,
        )

        _prompt = prompt_builder.run(
            question=query,
            db_schemas=db_schemas,
            semantic_candidate_context=semantic_candidate_context,
            semantic_retry_context=semantic_retry_context or {},
        )
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
        retrieval_payload = orjson.loads(filter_columns_in_tables["replies"][0])
        columns_and_tables_needed = retrieval_payload.get("results", [])
        semantic_analysis = retrieval_payload.get("semantic_analysis") or {}
        _log_semantic_retrieval_decision(semantic_analysis)

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
            "semantic_analysis": semantic_analysis,
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
            "semantic_analysis": check_using_db_schemas_without_pruning.get(
                "semantic_analysis", {}
            ),
        }


def _semantic_log_items(semantic_analysis: dict[str, Any], key: str) -> list[str]:
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


def _log_semantic_retrieval_decision(semantic_analysis: dict[str, Any]) -> None:
    if not isinstance(semantic_analysis, dict) or not semantic_analysis:
        logger.info("semantic_retrieval_decision=no_semantic_analysis")
        return

    concepts = {
        "intent": semantic_analysis.get("analytical_intent"),
        "entities": _semantic_log_items(semantic_analysis, "entities"),
        "identifiers": _semantic_log_items(semantic_analysis, "identifiers"),
        "metrics": _semantic_log_items(semantic_analysis, "metrics"),
        "dimensions": _semantic_log_items(semantic_analysis, "dimensions"),
        "filters": _semantic_log_items(semantic_analysis, "filters"),
        "time_constraints": _semantic_log_items(
            semantic_analysis, "time_constraints"
        ),
        "aggregations": _semantic_log_items(semantic_analysis, "aggregations"),
        "ranking": _semantic_log_items(semantic_analysis, "ranking"),
    }
    candidate_scores = semantic_analysis.get("candidate_schema_scores") or []
    selected_contract = {
        "supported_schema_objects": semantic_analysis.get(
            "supported_schema_objects", []
        ),
        "concept_mappings": semantic_analysis.get("concept_mappings", []),
        "is_fully_supported": semantic_analysis.get("is_fully_supported"),
        "support_reasoning": semantic_analysis.get("support_reasoning"),
    }
    logger.info("semantic_retrieval_concepts=%s", concepts)
    logger.info("semantic_retrieval_candidate_scores=%s", candidate_scores)
    logger.info("semantic_retrieval_selected_contract=%s", selected_contract)


## End of Pipeline
class MatchingTableContents(BaseModel):
    chain_of_thought_reasoning: list[str]
    columns: list[str]


class MatchingTable(BaseModel):
    table_name: str
    table_contents: MatchingTableContents
    table_selection_reason: str


class SemanticConceptMapping(BaseModel):
    request_concept: str = ""
    concept_type: str = ""
    schema_objects: list[str] = Field(default_factory=list)
    required_in_sql: bool = True
    confidence: float | None = None
    mapping_reason: str = ""


class SemanticInterpretation(BaseModel):
    description: str = ""
    schema_objects: list[str] = Field(default_factory=list)
    confidence: float | None = None
    is_selected: bool = False


class SemanticCandidateSchemaScore(BaseModel):
    candidate_id: str = ""
    schema_objects: list[str] = Field(default_factory=list)
    covered_concepts: list[str] = Field(default_factory=list)
    missing_concepts: list[str] = Field(default_factory=list)
    confidence: float | None = None
    is_complete: bool = False
    selection_reason: str = ""


class SemanticAnalysis(BaseModel):
    analytical_intent: str = ""
    entities: list[str] = Field(default_factory=list)
    identifiers: list[str] = Field(default_factory=list)
    metrics: list[str] = Field(default_factory=list)
    dimensions: list[str] = Field(default_factory=list)
    filters: list[str] = Field(default_factory=list)
    aggregations: list[str] = Field(default_factory=list)
    relationships: list[str] = Field(default_factory=list)
    time_constraints: list[str] = Field(default_factory=list)
    ranking: list[str] = Field(default_factory=list)
    supported_schema_objects: list[str] = Field(default_factory=list)
    candidate_schema_scores: list[SemanticCandidateSchemaScore] = Field(
        default_factory=list
    )
    concept_mappings: list[SemanticConceptMapping] = Field(default_factory=list)
    interpretations: list[SemanticInterpretation] = Field(default_factory=list)
    missing_requirements: list[str] = Field(default_factory=list)
    ambiguous_requirements: list[str] = Field(default_factory=list)
    is_fully_supported: bool | None = None
    support_reasoning: str = ""


class RetrievalResults(BaseModel):
    semantic_analysis: SemanticAnalysis | None = None
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
        semantic_retry_context: Optional[dict[str, Any]] = None,
    ):
        logger.info("Ask Retrieval pipeline is running...")
        if semantic_retry_context:
            logger.info("semantic_retrieval_retry_context=%s", semantic_retry_context)
        return await self._pipe.execute(
            ["construct_retrieval_results"],
            inputs={
                "query": query,
                "tables": tables,
                "project_id": project_id or "",
                "histories": histories or [],
                "enable_column_pruning": enable_column_pruning,
                "semantic_retry_context": semantic_retry_context or {},
                **self._components,
                **self._configs,
            },
        )
