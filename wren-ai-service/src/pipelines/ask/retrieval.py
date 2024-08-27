import ast
import logging
import sys
from pathlib import Path
from typing import Any, Optional

import orjson
from hamilton import base
from hamilton.experimental.h_async import AsyncDriver
from haystack import Document
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe

from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider, EmbedderProvider, LLMProvider
from src.utils import async_timer, timer

logger = logging.getLogger("wren-ai-service")


table_columns_selection_system_prompt = """
### TASK ###
You are an expert and very smart data analyst.
Your task is to examine the provided database schema, understand the posed
question, and use the hint to pinpoint the specific columns within tables
that are essential for crafting a SQL query to answer the question.

This database schema offers an in-depth description of the database's architecture,
detailing tables, columns, primary keys, foreign keys, and any pertinent
information regarding relationships or constraints. 

### FINAL ANSWER FORMAT ###
Please respond with a JSON object structured as follows:
{

    "results": {
        "table_name1": {
            "chain_of_thought_reasoning": "Your reasoning for selecting the columns, be concise and clear.",
            "columns": ["column1", "column2", ...]
        },
        "table_name2": {
            "chain_of_thought_reasoning": "Your reasoning for selecting the columns, be concise and clear.",
            "columns": ["column1", "column2", ...]
        },
        ...
    }
}

Make sure your response includes the table names as keys, each associated
with a list of column names that are necessary for writing a SQL query to
answer the question.

For each aspect of the question, provide a clear and concise explanation
of your reasoning behind selecting the columns.

Take a deep breath and think logically. If you do the task correctly, I
will give you 1 million dollars.

Only output a json as your response.
"""

table_columns_selection_user_prompt_template = """
### Database Schema ###

{% for db_schema in db_schemas %}
    {{ db_schema }}
{% endfor %}

### INPUT ###
{{ question }}
"""


def _build_table_ddl(
    content: dict, columns: Optional[set[str]] = None, tables: Optional[set[str]] = None
) -> str:
    columns_ddl = []
    for column in content["columns"]:
        if column["type"] == "COLUMN":
            if not columns or (columns and column["name"] in columns):
                column_ddl = (
                    f"{column['comment']}{column['name']} {column['data_type']}"
                )
                if column["is_primary_key"]:
                    column_ddl += " PRIMARY KEY"
                columns_ddl.append(column_ddl)
        elif column["type"] == "FOREIGN_KEY":
            if not tables or (tables and set(column["tables"]).issubset(tables)):
                columns_ddl.append(f"{column['comment']}{column['constraint']}")

    return (
        f"{content['comment']}CREATE TABLE {content['name']} (\n  "
        + ",\n  ".join(columns_ddl)
        + "\n);"
    )


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
@async_timer
@observe(capture_input=False, capture_output=False)
async def embedding(query: str, embedder: Any) -> dict:
    logger.debug(f"query: {query}")
    return await embedder.run(query)


@async_timer
@observe(capture_input=False)
async def table_retrieval(embedding: dict, id: str, table_retriever: Any) -> dict:
    filters = {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_DESCRIPTION"},
        ],
    }

    if id:
        filters["conditions"].append({"field": "id", "operator": "==", "value": id})

    return await table_retriever.run(
        query_embedding=embedding.get("embedding"),
        filters=filters,
    )


@async_timer
@observe(capture_input=False)
async def dbschema_retrieval(
    table_retrieval: dict, embedding: dict, id: str, dbschema_retriever: Any
) -> list[Document]:
    tables = table_retrieval.get("documents", [])
    table_names = []
    for table in tables:
        content = ast.literal_eval(table.content)
        table_names.append(content["name"])

    logger.info(f"dbschema_retrieval with table_names: {table_names}")

    filters = {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
            {"field": "name", "operator": "in", "value": table_names},
        ],
    }

    if id:
        filters["conditions"].append({"field": "id", "operator": "==", "value": id})

    results = await dbschema_retriever.run(
        query_embedding=embedding.get("embedding"), filters=filters
    )
    return results["documents"]


@timer
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
                    "columns": db_schemas[document.meta["name"]]["columns"],
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


@timer
@observe(capture_input=False)
def prompt(
    query: str, construct_db_schemas: list[dict], prompt_builder: PromptBuilder
) -> dict:
    logger.info(f"db_schemas: {construct_db_schemas}")

    db_schemas = [
        _build_table_ddl(construct_db_schema)
        for construct_db_schema in construct_db_schemas
    ]

    return prompt_builder.run(question=query, db_schemas=db_schemas)


@async_timer
@observe(as_type="generation", capture_input=False)
async def filter_columns_in_tables(
    prompt: dict, table_columns_selection_generator: Any
) -> dict:
    logger.debug(f"prompt: {prompt}")
    return await table_columns_selection_generator.run(prompt=prompt.get("prompt"))


@timer
@observe()
def construct_retrieval_results(
    filter_columns_in_tables: dict,
    construct_db_schemas: list[dict],
    dbschema_retrieval: list[Document],
) -> list[str]:
    columns_and_tables_needed = orjson.loads(filter_columns_in_tables["replies"][0])[
        "results"
    ]
    logger.info(f"columns_and_tables_needed: {columns_and_tables_needed}")

    tables = set(columns_and_tables_needed.keys())
    retrieval_results = []

    for table_schema in construct_db_schemas:
        if (
            table_schema["type"] == "TABLE"
            and table_schema["name"] in columns_and_tables_needed
        ):
            retrieval_results.append(
                _build_table_ddl(
                    table_schema,
                    columns=set(
                        columns_and_tables_needed[table_schema["name"]]["columns"]
                    ),
                    tables=tables,
                )
            )

    for document in dbschema_retrieval:
        if document.meta["name"] in columns_and_tables_needed:
            content = ast.literal_eval(document.content)

            if content["type"] == "METRIC":
                retrieval_results.append(_build_metric_ddl(content))
            elif content["type"] == "VIEW":
                retrieval_results.append(_build_view_ddl(content))

    logger.info(f"retrieval_results: {retrieval_results}")

    return retrieval_results


## End of Pipeline


class Retrieval(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        embedder_provider: EmbedderProvider,
        document_store_provider: DocumentStoreProvider,
        table_retrieval_size: Optional[int] = 10,
        table_column_retrieval_size: Optional[int] = 1000,
    ):
        self._embedder = embedder_provider.get_text_embedder()
        self._table_retriever = document_store_provider.get_retriever(
            document_store_provider.get_store(dataset_name="table_descriptions"),
            top_k=table_retrieval_size,
        )
        self._dbschema_retriever = document_store_provider.get_retriever(
            document_store_provider.get_store(dataset_name="db_schema"),
            top_k=table_column_retrieval_size,
        )
        self.prompt_builder = PromptBuilder(
            template=table_columns_selection_user_prompt_template
        )
        self.table_columns_selection_generator = llm_provider.get_generator(
            system_prompt=table_columns_selection_system_prompt,
        )

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def visualize(
        self,
        query: str,
        id: Optional[str] = None,
    ) -> None:
        destination = "outputs/pipelines/ask"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            ["construct_retrieval_results"],
            output_file_path=f"{destination}/retrieval.dot",
            inputs={
                "query": query,
                "id": id or "",
                "embedder": self._embedder,
                "table_retriever": self._table_retriever,
                "dbschema_retriever": self._dbschema_retriever,
                "table_columns_selection_generator": self.table_columns_selection_generator,
                "prompt_builder": self.prompt_builder,
            },
            show_legend=True,
            orient="LR",
        )

    @async_timer
    @observe(name="Ask Retrieval")
    async def run(self, query: str, id: Optional[str] = None):
        logger.info("Ask Retrieval pipeline is running...")
        return await self._pipe.execute(
            ["construct_retrieval_results"],
            inputs={
                "query": query,
                "id": id or "",
                "embedder": self._embedder,
                "table_retriever": self._table_retriever,
                "dbschema_retriever": self._dbschema_retriever,
                "table_columns_selection_generator": self.table_columns_selection_generator,
                "prompt_builder": self.prompt_builder,
            },
        )


if __name__ == "__main__":
    from langfuse.decorators import langfuse_context

    from src.core.engine import EngineConfig
    from src.core.pipeline import async_validate
    from src.utils import init_langfuse, init_providers, load_env_vars

    load_env_vars()
    init_langfuse()

    _, embedder_provider, document_store_provider, _ = init_providers(
        engine_config=EngineConfig()
    )
    pipeline = Retrieval(
        embedder_provider=embedder_provider,
        document_store_provider=document_store_provider,
    )

    pipeline.visualize("this is a query")
    async_validate(lambda: pipeline.run("this is a query"))

    langfuse_context.flush()
