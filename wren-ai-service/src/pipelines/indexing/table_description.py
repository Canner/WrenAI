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

logger = logging.getLogger("wren-ai-service")


@component
class TableDescriptionChunker:
    def _properties(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        properties = payload.get("properties")
        return properties if isinstance(properties, dict) else {}

    @component.output_types(documents=List[Document])
    def run(self, mdl: Dict[str, Any], project_id: Optional[str] = None):
        def _additional_meta() -> Dict[str, Any]:
            return {"project_id": project_id} if project_id else {}

        chunks = [
            {
                "id": str(uuid.uuid4()),
                "meta": {
                    "type": "TABLE_DESCRIPTION",
                    "name": chunk["name"],
                    **_additional_meta(),
                },
                "content": str(chunk),
            }
            for chunk in self._get_table_descriptions(mdl)
        ]

        return {
            "documents": [
                Document(**chunk)
                for chunk in tqdm(
                    chunks,
                    desc=f"Project ID: {project_id}, Chunking table descriptions into documents",
                )
            ]
        }

    def _get_table_descriptions(self, mdl: Dict[str, Any]) -> List[Dict[str, Any]]:
        def _text(value: Any) -> str:
            return "" if value is None else str(value)

        def _source_context(payload: Dict[str, Any]) -> str:
            table_reference = payload.get("tableReference")
            if isinstance(table_reference, dict):
                reference_parts = [
                    _text(table_reference.get("catalog", "")),
                    _text(table_reference.get("schema", "")),
                    _text(table_reference.get("table", "")),
                ]
                return ".".join(part for part in reference_parts if part)

            return _text(payload.get("baseObject", ""))

        def _columns(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
            columns = payload.get("columns", [])
            if columns:
                return [
                    {**column, "role": _text(column.get("role", ""))}
                    for column in columns
                    if isinstance(column, dict)
                ]

            metric_columns = []
            for role, key in [("dimension", "dimension"), ("measure", "measure")]:
                metric_columns += [
                    {**column, "role": role}
                    for column in payload.get(key, []) or []
                    if isinstance(column, dict)
                ]

            return metric_columns

        def _structure_data(mdl_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
            properties = self._properties(payload)

            return {
                "mdl_type": mdl_type,
                "name": payload.get("name"),
                "displayName": _text(properties.get("displayName", "")),
                "source": _source_context(payload),
                "columns": [
                    {
                        "name": _text(column.get("name", "")),
                        "type": _text(column.get("type", "")),
                        "role": _text(column.get("role", "")),
                        "expression": _text(column.get("expression", "")),
                        "description": _text(
                            self._properties(column).get("description", "")
                        ),
                        "displayName": _text(
                            self._properties(column).get("displayName", "")
                        ),
                    }
                    for column in _columns(payload)
                ],
                "properties": properties,
            }

        def _relationship_context_by_model() -> Dict[str, List[str]]:
            relationships = {model.get("name"): [] for model in mdl.get("models", [])}

            for relationship in mdl.get("relationships", []) or []:
                models = relationship.get("models", [])
                if len(models) != 2:
                    continue

                properties = self._properties(relationship)
                summary = " ".join(
                    part
                    for part in [
                        _text(relationship.get("name", "")),
                        _text(relationship.get("joinType", "")),
                        _text(relationship.get("condition", "")),
                        _text(properties.get("description", "")),
                        f"models {' <-> '.join(_text(model) for model in models)}",
                    ]
                    if part
                )
                if not summary:
                    continue

                for model_name in models:
                    relationships.setdefault(model_name, []).append(summary)

            return relationships

        def _column_context(columns: List[Dict[str, Any]]) -> str:
            details = []

            for column in columns:
                semantic_parts = [
                    column["type"],
                    column["role"],
                    column["displayName"],
                    column["description"],
                    column["expression"],
                ]
                if not any(semantic_parts):
                    continue

                details.append(
                    " ".join(
                        part for part in [column["name"], *semantic_parts] if part
                    )
                )

            return "; ".join(detail for detail in details if detail)

        relationship_context = _relationship_context_by_model()
        resources = (
            [_structure_data("MODEL", model) for model in mdl["models"]]
            + [_structure_data("METRIC", metric) for metric in mdl["metrics"]]
            + [_structure_data("VIEW", view) for view in mdl["views"]]
        )

        def _resource_description(resource: Dict[str, Any]) -> Dict[str, str]:
            description = {
                "name": resource["name"],
                "resource_type": resource["mdl_type"],
                "description": resource["properties"].get("description", "") or "",
                "columns": ", ".join(
                    column["name"] for column in resource["columns"]
                ),
            }

            if resource["displayName"]:
                description["displayName"] = resource["displayName"]

            if resource["source"]:
                description["source"] = resource["source"]

            if column_context := _column_context(resource["columns"]):
                description["column_context"] = column_context

            if relationships := "; ".join(relationship_context.get(resource["name"], [])):
                description["relationships"] = relationships

            return description

        return [
            _resource_description(resource)
            for resource in resources
            if resource["name"] is not None
        ]


## Start of Pipeline
@observe(capture_input=False, capture_output=False)
@extract_fields(dict(mdl=Dict[str, Any]))
def validate_mdl(mdl_str: str, validator: MDLValidator) -> Dict[str, Any]:
    res = validator.run(mdl=mdl_str)
    return dict(mdl=res["mdl"])


@observe(capture_input=False)
def chunk(
    mdl: Dict[str, Any],
    chunker: TableDescriptionChunker,
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    return chunker.run(mdl=mdl, project_id=project_id)


@observe(capture_input=False, capture_output=False)
async def embedding(chunk: Dict[str, Any], embedder: Any) -> Dict[str, Any]:
    if not chunk["documents"]:
        return chunk

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


class TableDescription(BasicPipeline):
    def __init__(
        self,
        embedder_provider: EmbedderProvider,
        document_store_provider: DocumentStoreProvider,
        **kwargs,
    ) -> None:
        table_description_store = document_store_provider.get_store(
            dataset_name="table_descriptions"
        )

        self._components = {
            "cleaner": DocumentCleaner([table_description_store]),
            "validator": MDLValidator(),
            "embedder": embedder_provider.get_document_embedder(),
            "chunker": TableDescriptionChunker(),
            "writer": AsyncDocumentWriter(
                document_store=table_description_store,
                policy=DuplicatePolicy.OVERWRITE,
            ),
        }
        self._configs = {}
        self._final = "write"

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Table Description Indexing")
    async def run(
        self, mdl_str: str, project_id: Optional[str] = None
    ) -> Dict[str, Any]:
        logger.info(
            f"Project ID: {project_id}, Table Description Indexing pipeline is running..."
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

    @observe(name="Clean Documents for Table Description")
    async def clean(self, project_id: Optional[str] = None) -> None:
        await clean(
            embedding={"documents": []},
            cleaner=self._components["cleaner"],
            project_id=project_id,
        )
