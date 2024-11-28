import logging
import sys
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import orjson
from hamilton import base
from hamilton.async_driver import AsyncDriver
from hamilton.function_modifiers import extract_fields
from haystack import Document, component
from haystack.components.writers import DocumentWriter
from haystack.document_stores.types import DuplicatePolicy
from langfuse.decorators import observe
from tqdm import tqdm

from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider, EmbedderProvider
from src.pipelines.indexing import AsyncDocumentWriter, DocumentCleaner, MDLValidator

logger = logging.getLogger("wren-ai-service")


@component
class DDLChunker:
    @component.output_types(documents=List[Document])
    def run(
        self,
        mdl: Dict[str, Any],
        column_batch_size: int,
        project_id: Optional[str] = None,
    ):
        def _additional_meta() -> Dict[str, Any]:
            return {"project_id": project_id} if project_id else {}

        chunks = [
            {
                "id": str(uuid.uuid4()),
                "meta": {
                    "type": "TABLE_SCHEMA",
                    "name": chunk["name"],
                    **_additional_meta(),
                },
                "content": chunk["payload"],
            }
            for chunk in self._get_ddl_commands(mdl, column_batch_size)
        ]

        return {
            "documents": [
                Document(**chunk)
                for chunk in tqdm(
                    chunks,
                    desc=f"Project ID: {project_id}, Chunking DDL commands into documents",
                )
            ]
        }

    def _get_ddl_commands(
        self, mdl: Dict[str, Any], column_batch_size: int = 50
    ) -> List[dict]:
        semantics = {
            "models": [],
            "relationships": mdl["relationships"],
            "views": mdl["views"],
            "metrics": mdl["metrics"],
        }

        for model in mdl["models"]:
            columns = []
            for column in model.get("columns", []):
                ddl_column = {
                    "name": column.get("name", ""),
                    "type": column.get("type", ""),
                }
                if "properties" in column:
                    ddl_column["properties"] = column["properties"]
                if "relationship" in column:
                    ddl_column["relationship"] = column["relationship"]
                if "expression" in column:
                    ddl_column["expression"] = column["expression"]
                if "isCalculated" in column:
                    ddl_column["isCalculated"] = column["isCalculated"]

                columns.append(ddl_column)

            semantics["models"].append(
                {
                    "name": model.get("name", ""),
                    "properties": model.get("properties", {}),
                    "columns": columns,
                    "primaryKey": model.get("primaryKey", ""),
                }
            )

        return (
            self._convert_models_and_relationships(
                semantics["models"],
                semantics["relationships"],
                column_batch_size,
            )
            + self._convert_views(semantics["views"])
            + self._convert_metrics(semantics["metrics"])
        )

    # TODO: refactor this method
    def _convert_models_and_relationships(
        self,
        models: List[Dict[str, Any]],
        relationships: List[Dict[str, Any]],
        column_batch_size: int,
    ) -> List[str]:
        ddl_commands = []

        # A map to store model primary keys for foreign key relationships
        primary_keys_map = {model["name"]: model["primaryKey"] for model in models}

        for model in models:
            table_name = model["name"]
            columns_ddl = []
            for column in model["columns"]:
                if "relationship" not in column:
                    if "properties" in column:
                        column_properties = {
                            "alias": column["properties"].get("displayName", ""),
                            "description": column["properties"].get("description", ""),
                        }
                        nested_cols = {
                            k: v
                            for k, v in column["properties"].items()
                            if k.startswith("nested")
                        }
                        if nested_cols:
                            column_properties["nested_columns"] = nested_cols
                        comment = (
                            f"-- {orjson.dumps(column_properties).decode("utf-8")}\n  "
                        )
                    else:
                        comment = ""
                    if "isCalculated" in column and column["isCalculated"]:
                        comment = (
                            comment
                            + f"-- This column is a Calculated Field\n  -- column expression: {column["expression"]}\n  "
                        )

                    columns_ddl.append(
                        {
                            "type": "COLUMN",
                            "comment": comment,
                            "name": column["name"],
                            "data_type": column["type"],
                            "is_primary_key": column["name"] == model["primaryKey"],
                        }
                    )

            # Add foreign key constraints based on relationships
            for relationship in relationships:
                condition = relationship.get("condition", "")
                join_type = relationship.get("joinType", "")
                models = relationship.get("models", [])

                if len(models) == 2:
                    comment = (
                        f'-- {{"condition": {condition}, "joinType": {join_type}}}\n  '
                    )
                    should_add_fk = False
                    if table_name == models[0] and join_type.upper() == "MANY_TO_ONE":
                        related_table = models[1]
                        fk_column = condition.split(" = ")[0].split(".")[1]
                        fk_constraint = f"FOREIGN KEY ({fk_column}) REFERENCES {related_table}({primary_keys_map[related_table]})"
                        should_add_fk = True
                    elif table_name == models[1] and join_type.upper() == "ONE_TO_MANY":
                        related_table = models[0]
                        fk_column = condition.split(" = ")[1].split(".")[1]
                        fk_constraint = f"FOREIGN KEY ({fk_column}) REFERENCES {related_table}({primary_keys_map[related_table]})"
                        should_add_fk = True
                    elif table_name in models and join_type.upper() == "ONE_TO_ONE":
                        index = models.index(table_name)
                        related_table = [m for m in models if m != table_name][0]
                        fk_column = condition.split(" = ")[index].split(".")[1]
                        fk_constraint = f"FOREIGN KEY ({fk_column}) REFERENCES {related_table}({primary_keys_map[related_table]})"
                        should_add_fk = True

                    if should_add_fk:
                        columns_ddl.append(
                            {
                                "type": "FOREIGN_KEY",
                                "comment": comment,
                                "constraint": fk_constraint,
                                "tables": models,
                            }
                        )

            if "properties" in model:
                model_properties = {
                    "alias": model["properties"].get("displayName", ""),
                    "description": model["properties"].get("description", ""),
                }
                comment = f"\n/* {orjson.dumps(model_properties).decode("utf-8")} */\n"
            else:
                comment = ""

            ddl_commands.append(
                {
                    "name": table_name,
                    "payload": str(
                        {
                            "type": "TABLE",
                            "comment": comment,
                            "name": table_name,
                        }
                    ),
                }
            )
            column_ddl_commands = [
                {
                    "name": table_name,
                    "payload": str(
                        {
                            "type": "TABLE_COLUMNS",
                            "columns": columns_ddl[i : i + column_batch_size],
                        }
                    ),
                }
                for i in range(0, len(columns_ddl), column_batch_size)
            ]
            ddl_commands += column_ddl_commands

        return ddl_commands

    def _convert_views(self, views: List[Dict[str, Any]]) -> List[str]:
        def _format(view: Dict[str, Any]) -> dict:
            return {
                "type": "VIEW",
                "comment": f"/* {view['properties']} */\n"
                if "properties" in view
                else "",
                "name": view["name"],
                "statement": view["statement"],
            }

        return [{"name": view["name"], "payload": str(_format(view))} for view in views]

    def _convert_metrics(self, metrics: List[Dict[str, Any]]) -> List[str]:
        ddl_commands = []

        for metric in metrics:
            table_name = metric.get("name", "")
            columns_ddl = []
            for dimension in metric.get("dimension", []):
                comment = "-- This column is a dimension\n  "
                name = dimension.get("name", "")
                columns_ddl.append(
                    {
                        "type": "COLUMN",
                        "comment": comment,
                        "name": name,
                        "data_type": dimension.get("type", ""),
                    }
                )

            for measure in metric.get("measure", []):
                comment = f"-- This column is a measure\n  -- expression: {measure["expression"]}\n  "
                name = measure.get("name", "")
                columns_ddl.append(
                    {
                        "type": "COLUMN",
                        "comment": comment,
                        "name": name,
                        "data_type": measure.get("type", ""),
                    }
                )

            comment = f"\n/* This table is a metric */\n/* Metric Base Object: {metric["baseObject"]} */\n"
            ddl_commands.append(
                {
                    "name": table_name,
                    "payload": str(
                        {
                            "type": "METRIC",
                            "comment": comment,
                            "name": table_name,
                            "columns": columns_ddl,
                        }
                    ),
                }
            )

        return ddl_commands


## Start of Pipeline
@observe(capture_input=False, capture_output=False)
async def clean_documents(
    mdl_str: str, cleaner: DocumentCleaner, project_id: Optional[str] = None
) -> Dict[str, Any]:
    return await cleaner.run(mdl=mdl_str, project_id=project_id)


@observe(capture_input=False, capture_output=False)
@extract_fields(dict(mdl=Dict[str, Any]))
def validate_mdl(
    clean_documents: Dict[str, Any], validator: MDLValidator
) -> Dict[str, Any]:
    mdl = clean_documents.get("mdl")
    res = validator.run(mdl=mdl)
    return dict(mdl=res["mdl"])


@observe(capture_input=False)
def chunk(
    mdl: Dict[str, Any],
    chunker: DDLChunker,
    column_batch_size: int,
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    return chunker.run(
        mdl=mdl,
        column_batch_size=column_batch_size,
        project_id=project_id,
    )


@observe(capture_input=False, capture_output=False)
async def embedding(chunk: Dict[str, Any], embedder: Any) -> Dict[str, Any]:
    return await embedder.run(documents=chunk["documents"])


@observe(capture_input=False)
async def write(embedding: Dict[str, Any], writer: DocumentWriter) -> None:
    return await writer.run(documents=embedding["documents"])


## End of Pipeline


class DBSchema(BasicPipeline):
    def __init__(
        self,
        embedder_provider: EmbedderProvider,
        document_store_provider: DocumentStoreProvider,
        column_batch_size: Optional[int] = 50,
        **kwargs,
    ) -> None:
        dbschema_store = document_store_provider.get_store()

        self._components = {
            "cleaner": DocumentCleaner([dbschema_store]),
            "validator": MDLValidator(),
            "embedder": embedder_provider.get_document_embedder(),
            "chunker": DDLChunker(),
            "writer": AsyncDocumentWriter(
                document_store=dbschema_store,
                policy=DuplicatePolicy.OVERWRITE,
            ),
        }
        self._configs = {
            "column_batch_size": column_batch_size,
        }
        self._final = "write"

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def visualize(self, mdl_str: str, project_id: Optional[str] = None) -> None:
        destination = "outputs/pipelines/indexing"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            [self._final],
            output_file_path=f"{destination}/db_schema.dot",
            inputs={
                "mdl_str": mdl_str,
                "project_id": project_id,
                **self._components,
                **self._configs,
            },
            show_legend=True,
            orient="LR",
        )

    @observe(name="DB Schema Indexing")
    async def run(
        self, mdl_str: str, project_id: Optional[str] = None
    ) -> Dict[str, Any]:
        logger.info(
            f"Project ID: {project_id}, DB Schema Indexing pipeline is running..."
        )
        return await self._pipe.execute(
            [self._final],
            inputs={
                "mdl_str": mdl_str,
                "project_id": project_id,
                **self._components,
                **self._configs,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        DBSchema,
        "db_schema",
        mdl_str='{"models": [], "views": [], "relationships": [], "metrics": []}',
    )
