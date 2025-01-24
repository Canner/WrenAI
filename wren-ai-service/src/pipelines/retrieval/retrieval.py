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
from src.pipelines.common import build_table_ddl
from src.web.v1.services.ask import AskHistory

logger = logging.getLogger("wren-ai-service")


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
        f"{column['comment']}{column['name']} {column['data_type']}"
        for column in content["columns"]
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
@observe(capture_input=False, capture_output=False)
async def embedding(
    query: str, embedder: Any, history: Optional[AskHistory] = None
) -> dict:
    if history:
        previous_query_summaries = [
            step.summary for step in history.steps if step.summary
        ]
    else:
        previous_query_summaries = []

    query = "\n".join(previous_query_summaries) + "\n" + query

    return await embedder.run(query)


@observe(capture_input=False)
async def table_retrieval(embedding: dict, id: str, table_retriever: Any) -> dict:
    filters = {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_DESCRIPTION"},
        ],
    }

    if id:
        filters["conditions"].append(
            {"field": "project_id", "operator": "==", "value": id}
        )

    return await table_retriever.run(
        query_embedding=embedding.get("embedding"),
        filters=filters,
    )


@observe(capture_input=False)
async def dbschema_retrieval(
    table_retrieval: dict, embedding: dict, id: str, dbschema_retriever: Any
) -> list[Document]:
    tables = table_retrieval.get("documents", [])
    table_names = []
    for table in tables:
        content = ast.literal_eval(table.content)
        table_names.append(content["name"])

    table_name_conditions = [
        {"field": "name", "operator": "==", "value": table_name}
        for table_name in table_names
    ]

    filters = {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
            {"operator": "OR", "conditions": table_name_conditions},
        ],
    }

    if id:
        filters["conditions"].append(
            {"field": "project_id", "operator": "==", "value": id}
        )

    results = await dbschema_retriever.run(
        query_embedding=embedding.get("embedding"), filters=filters
    )
    return results["documents"]


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
    allow_using_db_schemas_without_pruning: bool,
) -> dict:
    retrieval_results = []
    has_calculated_field = False
    has_metric = False

    for table_schema in construct_db_schemas:
        if table_schema["type"] == "TABLE":
            ddl, _has_calculated_field = build_table_ddl(table_schema)
            retrieval_results.append(ddl)
            has_calculated_field = has_calculated_field or _has_calculated_field

    for document in dbschema_retrieval:
        content = ast.literal_eval(document.content)

        if content["type"] == "METRIC":
            retrieval_results.append(_build_metric_ddl(content))
            has_metric = True
        elif content["type"] == "VIEW":
            retrieval_results.append(_build_view_ddl(content))

    _token_count = len(encoding.encode(" ".join(retrieval_results)))
    if _token_count > 100_000 or not allow_using_db_schemas_without_pruning:
        return {
            "db_schemas": [],
            "tokens": _token_count,
            "has_calculated_field": has_calculated_field,
            "has_metric": has_metric,
        }

    return {
        "db_schemas": retrieval_results,
        "tokens": _token_count,
        "has_calculated_field": has_calculated_field,
        "has_metric": has_metric,
    }


@observe(capture_input=False)
def prompt(
    query: str,
    construct_db_schemas: list[dict],
    prompt_builder: PromptBuilder,
    check_using_db_schemas_without_pruning: dict,
    history: Optional[AskHistory] = None,
) -> dict:
    if not check_using_db_schemas_without_pruning["db_schemas"]:
        logger.info(
            "db_schemas token count is greater than 100,000, so we will prune columns"
        )
        db_schemas = [
            build_table_ddl(construct_db_schema)[0]
            for construct_db_schema in construct_db_schemas
        ]

        if history:
            previous_query_summaries = [
                step.summary for step in history.steps if step.summary
            ]
        else:
            previous_query_summaries = []

        query = "\n".join(previous_query_summaries) + "\n" + query
        return prompt_builder.run(question=query, db_schemas=db_schemas)
    else:
        return {}


@observe(as_type="generation", capture_input=False)
async def filter_columns_in_tables(
    prompt: dict, table_columns_selection_generator: Any
) -> dict:
    if prompt:
        return await table_columns_selection_generator(prompt=prompt.get("prompt"))
    else:
        return {}


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

        for table_schema in construct_db_schemas:
            if table_schema["type"] == "TABLE" and table_schema["name"] in tables:
                ddl, _has_calculated_field = build_table_ddl(
                    table_schema,
                    columns=set(
                        columns_and_tables_needed[table_schema["name"]]["columns"]
                    ),
                    tables=tables,
                )
                has_calculated_field = has_calculated_field or _has_calculated_field
                retrieval_results.append(ddl)

        for document in dbschema_retrieval:
            if document.meta["name"] in columns_and_tables_needed:
                content = ast.literal_eval(document.content)

                if content["type"] == "METRIC":
                    retrieval_results.append(_build_metric_ddl(content))
                    has_metric = True
                elif content["type"] == "VIEW":
                    retrieval_results.append(_build_view_ddl(content))

        return {
            "retrieval_results": retrieval_results,
            "has_calculated_field": has_calculated_field,
            "has_metric": has_metric,
        }
    else:
        retrieval_results = check_using_db_schemas_without_pruning["db_schemas"]

        return {
            "retrieval_results": retrieval_results,
            "has_calculated_field": check_using_db_schemas_without_pruning[
                "has_calculated_field"
            ],
            "has_metric": check_using_db_schemas_without_pruning["has_metric"],
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


class Retrieval(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        embedder_provider: EmbedderProvider,
        document_store_provider: DocumentStoreProvider,
        table_retrieval_size: Optional[int] = 10,
        table_column_retrieval_size: Optional[int] = 100,
        allow_using_db_schemas_without_pruning: Optional[bool] = False,
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
            "allow_using_db_schemas_without_pruning": allow_using_db_schemas_without_pruning,
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Ask Retrieval")
    async def run(
        self,
        query: str,
        id: Optional[str] = None,
        history: Optional[AskHistory] = None,
    ):
        logger.info("Ask Retrieval pipeline is running...")
        return await self._pipe.execute(
            ["construct_retrieval_results"],
            inputs={
                "query": query,
                "id": id or "",
                "history": history,
                **self._components,
                **self._configs,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        Retrieval,
        "db_schema_retrieval",
        query="this is a test query",
    )
