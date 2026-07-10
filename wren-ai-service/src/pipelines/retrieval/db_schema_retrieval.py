import ast
import logging
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
11. Populate `interpretations` when the request has more than one plausible schema interpretation. Rank interpretations by semantic relevance and mark the selected interpretation only when it is clearly the best supported one.
12. If a "." is included in columns, put the name before the first dot into chosen columns.
13. The number of columns chosen must match the number of reasoning.
14. Final chosen columns must be only column names, don't prefix it with table names.
15. If the chosen column is a child column of a STRUCT type column, choose the parent column instead of the child column.
16. If the schema cannot answer the question, return the closest directly relevant schema objects only if they explain the limitation. Do not select unrelated fallback tables.

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
        retrieval_payload = orjson.loads(filter_columns_in_tables["replies"][0])
        columns_and_tables_needed = retrieval_payload.get("results", [])
        semantic_analysis = retrieval_payload.get("semantic_analysis") or {}

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
