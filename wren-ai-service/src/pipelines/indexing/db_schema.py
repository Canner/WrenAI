import asyncio
import logging
import sys
import uuid
from typing import Any, Dict, List, Optional

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
from src.pipelines.indexing.utils import helper

logger = logging.getLogger("wren-ai-service")


@component
class DDLChunker:
    @component.output_types(documents=List[Document])
    async def run(
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
            for chunk in await self._get_ddl_commands(
                **mdl, column_batch_size=column_batch_size
            )
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

    async def _model_preprocessor(
        self, models: List[Dict[str, Any]], **kwargs
    ) -> List[Dict[str, Any]]:
        def _column_preprocessor(
            column: Dict[str, Any], addition: Dict[str, Any]
        ) -> Dict[str, Any]:
            addition = {
                key: helper(column, **addition)
                for key, helper in helper.COLUMN_PROPRECESSORS.items()
                if helper.condition(column, **addition)
            }

            return {
                "name": column.get("name", ""),
                "type": column.get("type", ""),
                **addition,
            }

        async def _preprocessor(model: Dict[str, Any], **kwargs) -> Dict[str, Any]:
            addition = {
                key: await helper(model, **kwargs)
                for key, helper in helper.MODEL_PREPROCESSORS.items()
                if helper.condition(model, **kwargs)
            }

            columns = [
                _column_preprocessor(column, addition)
                for column in model.get("columns", [])
            ]
            return {
                "name": model.get("name", ""),
                "properties": model.get("properties", {}),
                "columns": columns,
                "primaryKey": model.get("primaryKey", ""),
            }

        tasks = [_preprocessor(model, **kwargs) for model in models]

        return await asyncio.gather(*tasks)

    async def _get_ddl_commands(
        self,
        models: List[Dict[str, Any]],
        relationships: List[Dict[str, Any]],
        views: List[Dict[str, Any]],
        metrics: List[Dict[str, Any]],
        column_batch_size: int = 50,
        **kwargs,
    ) -> List[dict]:
        return (
            self._convert_models_and_relationships(
                await self._model_preprocessor(models, **kwargs),
                relationships,
                column_batch_size,
            )
            + self._convert_views(views)
            + self._convert_metrics(metrics)
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
            if column.get("relationship"):
                return None

            comments = [
                helper(column, model=model)
                for helper in helper.COLUMN_COMMENT_HELPERS.values()
                if helper.condition(column)
            ]

            return {
                "type": "COLUMN",
                "comment": "".join(comments),
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

            if len(models) != 2:
                return None

            if table_name not in models:
                return None

            if join_type not in ["MANY_TO_ONE", "ONE_TO_MANY", "ONE_TO_ONE"]:
                return None

            # Get related table and foreign key column
            is_source = table_name == models[0]
            related_table = models[1] if is_source else models[0]
            condition_parts = condition.split(" = ")
            fk_column = condition_parts[0 if is_source else 1].split(".")[1]

            # Build foreign key constraint
            fk_constraint = f"FOREIGN KEY ({fk_column}) REFERENCES {related_table}({primary_keys_map[related_table]})"

            return {
                "type": "FOREIGN_KEY",
                "comment": f'-- {{"condition": {condition}, "joinType": {join_type}}}\n  ',
                "constraint": fk_constraint,
                "tables": models,
            }

        def _column_batch(
            model: Dict[str, Any], primary_keys_map: Dict[str, str]
        ) -> List[dict]:
            commands = [
                _column_command(column, model) for column in model["columns"]
            ] + [
                _relationship_command(relationship, model["name"], primary_keys_map)
                for relationship in relationships
            ]

            filtered = [command for command in commands if command is not None]

            return [
                {
                    "name": model["name"],
                    "payload": str(
                        {
                            "type": "TABLE_COLUMNS",
                            "columns": filtered[i : i + column_batch_size],
                        }
                    ),
                }
                for i in range(0, len(filtered), column_batch_size)
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
@extract_fields(dict(mdl=Dict[str, Any]))
def validate_mdl(mdl_str: str, validator: MDLValidator) -> Dict[str, Any]:
    res = validator.run(mdl=mdl_str)
    return dict(mdl=res["mdl"])


@observe(capture_input=False)
async def chunk(
    mdl: Dict[str, Any],
    chunker: DDLChunker,
    column_batch_size: int,
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    return await chunker.run(
        mdl=mdl,
        column_batch_size=column_batch_size,
        project_id=project_id,
    )


@observe(capture_input=False, capture_output=False)
async def embedding(chunk: Dict[str, Any], embedder: Any) -> Dict[str, Any]:
    return await embedder.run(documents=chunk["documents"])


@observe(capture_input=False, capture_output=False)
async def clean(
    embedding: Dict[str, Any],
    cleaner: DocumentCleaner,
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    await cleaner.run(project_id=project_id)
    return embedding


@observe(capture_input=False)
async def write(clean: Dict[str, Any], writer: DocumentWriter) -> None:
    return await writer.run(documents=clean["documents"])


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

        helper.load_helpers()
        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
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
        await clean(
            embedding={"documents": []},
            cleaner=self._components["cleaner"],
            project_id=project_id,
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        DBSchema,
        "db_schema_indexing",
        mdl_str='{"models": [], "views": [], "relationships": [], "metrics": []}',
    )
