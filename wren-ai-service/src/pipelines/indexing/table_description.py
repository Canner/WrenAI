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
from src.pipelines.common import (
    build_runtime_scope_meta,
    resolve_pipeline_runtime_scope_id,
)
from src.pipelines.indexing import AsyncDocumentWriter, DocumentCleaner, MDLValidator

logger = logging.getLogger("wren-ai-service")


@component
class TableDescriptionChunker:
    @component.output_types(documents=List[Document])
    def run(self, mdl: Dict[str, Any], runtime_scope_id: Optional[str] = None):
        def _additional_meta() -> Dict[str, Any]:
            return build_runtime_scope_meta(runtime_scope_id)

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
                    desc=f"Runtime scope: {runtime_scope_id}, Chunking table descriptions into documents",
                )
            ]
        }

    def _get_table_descriptions(self, mdl: Dict[str, Any]) -> List[str]:
        def _structure_data(mdl_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
            return {
                "mdl_type": mdl_type,
                "name": payload.get("name"),
                "columns": [column["name"] for column in payload.get("columns", [])],
                "properties": payload.get("properties", {}),
            }

        resources = (
            [_structure_data("MODEL", model) for model in mdl["models"]]
            + [_structure_data("METRIC", metric) for metric in mdl["metrics"]]
            + [_structure_data("VIEW", view) for view in mdl["views"]]
        )

        return [
            {
                "name": resource["name"],
                "description": resource["properties"].get("description", ""),
                "columns": ", ".join(resource["columns"]),
            }
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
    runtime_scope_id: Optional[str] = None,
) -> Dict[str, Any]:
    return chunker.run(mdl=mdl, runtime_scope_id=runtime_scope_id)


@observe(capture_input=False, capture_output=False)
async def embedding(chunk: Dict[str, Any], embedder: Any) -> Dict[str, Any]:
    return await embedder.run(documents=chunk["documents"])


@observe(capture_input=False, capture_output=False)
async def clean(
    embedding: Dict[str, Any],
    cleaner: DocumentCleaner,
    runtime_scope_id: Optional[str] = None,
) -> Dict[str, Any]:
    await cleaner.run(runtime_scope_id=runtime_scope_id)
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
        self,
        mdl_str: str,
        runtime_scope_id: Optional[str] = None,
        bridge_scope_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        runtime_scope_id = resolve_pipeline_runtime_scope_id(
            runtime_scope_id, bridge_scope_id=bridge_scope_id
        )
        logger.info(
            f"Runtime scope: {runtime_scope_id}, Table Description Indexing pipeline is running..."
        )
        return await self._pipe.execute(
            [self._final],
            inputs={
                "mdl_str": mdl_str,
                "runtime_scope_id": runtime_scope_id,
                **self._components,
                **self._configs,
            },
        )

    @observe(name="Clean Documents for Table Description")
    async def clean(
        self,
        runtime_scope_id: Optional[str] = None,
        bridge_scope_id: Optional[str] = None,
    ) -> None:
        await clean(
            embedding={"documents": []},
            cleaner=self._components["cleaner"],
            runtime_scope_id=resolve_pipeline_runtime_scope_id(
                runtime_scope_id, bridge_scope_id=bridge_scope_id
            ),
        )
