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

    def _convert_models_and_relationships(
        self,
        models: List[Dict[str, Any]],
        relationships: List[Dict[str, Any]],
        column_batch_size: int,
    ) -> List[str]:
        def _model_command(model: Dict[str, Any]) -> dict:
            properties = model.get("properties", {})

            model_properties = {
                "alias": properties.get("displayName", ""),
                "description": properties.get("description", ""),
            }
            comment = f"\n/* {str(model_properties)} */\n"

            table_name = model["name"]
            payload = {
                "type": "TABLE",
                "comment": comment,
                "name": table_name,
            }
            return {"name": table_name, "payload": str(payload)}

        def _column_command(column: Dict[str, Any], model: Dict[str, Any]) -> dict:
            # Build column properties
            props = column["properties"]
            column_properties = {
                "alias": props.get("displayName", ""),
                "description": props.get("description", ""),
            }

            # Add any nested columns if they exist
            nested = {k: v for k, v in props.items() if k.startswith("nested")}
            if nested:
                column_properties["nested_columns"] = nested

            # Build comment string
            comment = f"-- {orjson.dumps(column_properties).decode('utf-8')}\n  "
            if column.get("isCalculated"):
                comment += f"-- This column is a Calculated Field\n  -- column expression: {column['expression']}\n  "

            return {
                "type": "COLUMN",
                "comment": comment,
                "name": column["name"],
                "data_type": column["type"],
                "is_primary_key": column["name"] == model["primaryKey"],
            }

        def _relationship_command(
            relationship: Dict[str, Any],
            table_name: str,
            primary_keys_map: Dict[str, str],
        ) -> dict:
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
                    return {
                        "type": "FOREIGN_KEY",
                        "comment": comment,
                        "constraint": fk_constraint,
                        "tables": models,
                    }

        def _column_batch(
            model: Dict[str, Any], primary_keys_map: Dict[str, str]
        ) -> List[dict]:
            commands = [
                _column_command(column, model)
                for column in model["columns"]
                if column.get("relationship") is None  # Ignore relationship columns
            ] + [
                _relationship_command(relationship, model["name"], primary_keys_map)
                for relationship in relationships
            ]
            return [
                {
                    "name": model["name"],
                    "payload": str(commands[i : i + column_batch_size]),
                }
                for i in range(0, len(commands), column_batch_size)
            ]

        # A map to store model primary keys for foreign key relationships
        primary_keys_map = {model["name"]: model["primaryKey"] for model in models}

        return [
            command
            for model in models
            for command in _column_batch(model, primary_keys_map)
            + [_model_command(model)]
        ]

    def _convert_views(self, views: List[Dict[str, Any]]) -> List[str]:
        def _payload(view: Dict[str, Any]) -> dict:
            return {
                "type": "VIEW",
                "comment": f"/* {view['properties']} */\n"
                if "properties" in view
                else "",
                "name": view["name"],
                "statement": view["statement"],
            }

        return [
            {"name": view["name"], "payload": str(_payload(view))} for view in views
        ]

    def _convert_metrics(self, metrics: List[Dict[str, Any]]) -> List[str]:
        def _create_column(name: str, data_type: str, comment: str) -> dict:
            return {
                "type": "COLUMN",
                "comment": comment,
                "name": name,
                "data_type": data_type,
            }

        def _dimensions(metric: Dict[str, Any]) -> List[dict]:
            return [
                _create_column(
                    name=dim.get("name", ""),
                    data_type=dim.get("type", ""),
                    comment="-- This column is a dimension\n  ",
                )
                for dim in metric.get("dimension", [])
            ]

        def _measures(metric: Dict[str, Any]) -> List[dict]:
            return [
                _create_column(
                    name=measure.get("name", ""),
                    data_type=measure.get("type", ""),
                    comment=f"-- This column is a measure\n  -- expression: {measure['expression']}\n  ",
                )
                for measure in metric.get("measure", [])
            ]

        def _payload(metric: Dict[str, Any]) -> dict:
            return {
                "type": "METRIC",
                "comment": f"\n/* This table is a metric */\n/* Metric Base Object: {metric['baseObject']} */\n",
                "name": metric["name"],
                "columns": _dimensions(metric) + _measures(metric),
            }

        return [
            {"name": metric["name"], "payload": str(_payload(metric))}
            for metric in metrics
        ]


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

    @observe(name="Clean Documents for DB Schema")
    async def clean(self, project_id: Optional[str] = None) -> None:
        await self._pipe.execute(
            ["clean_documents"],
            inputs={"project_id": project_id, "mdl_str": "", **self._components},
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        DBSchema,
        "db_schema",
        mdl_str='{"models": [], "views": [], "relationships": [], "metrics": []}',
    )
