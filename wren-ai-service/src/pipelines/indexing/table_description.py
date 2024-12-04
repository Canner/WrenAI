import logging
import sys
import uuid
from pathlib import Path
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
    @component.output_types(documents=List[Document])
    def run(self, mdl: Dict[str, Any], project_id: Optional[str] = None):
        def _additional_meta() -> Dict[str, Any]:
            return {"project_id": project_id} if project_id else {}

        chunks = [
            {
                "id": str(uuid.uuid4()),
                "meta": {
                    "type": "TABLE_DESCRIPTION",
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

    def _get_table_descriptions(self, mdl: Dict[str, Any]) -> List[str]:
        def _structure_data(mdl_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
            return {
                "mdl_type": mdl_type,
                "name": payload.get("name"),
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
                "mdl_type": resource["mdl_type"],
                "description": resource["properties"].get("description", ""),
            }
            for resource in resources
            if resource["name"] is not None
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
    chunker: TableDescriptionChunker,
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    return chunker.run(mdl=mdl, project_id=project_id)


@observe(capture_input=False, capture_output=False)
async def embedding(chunk: Dict[str, Any], embedder: Any) -> Dict[str, Any]:
    return await embedder.run(documents=chunk["documents"])


@observe(capture_input=False)
async def write(
    embedding: Dict[str, Any],
    writer: DocumentWriter,
) -> None:
    return await writer.run(documents=embedding["documents"])


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

    def visualize(self, mdl_str: str, project_id: Optional[str] = None) -> None:
        destination = "outputs/pipelines/indexing"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            [self._final],
            output_file_path=f"{destination}/table_description.dot",
            inputs={
                "mdl_str": mdl_str,
                "project_id": project_id,
                **self._components,
                **self._configs,
            },
            show_legend=True,
            orient="LR",
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
        await self._pipe.execute(
            ["clean_documents"],
            inputs={"project_id": project_id, "mdl_str": "", **self._components},
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        TableDescription,
        "table_description_indexing",
        mdl_str='{"models": [], "views": [], "relationships": [], "metrics": []}',
    )
