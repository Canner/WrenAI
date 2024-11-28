import asyncio
import json
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
from haystack.document_stores.types import DocumentStore, DuplicatePolicy
from langfuse.decorators import observe
from tqdm import tqdm

from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider, EmbedderProvider

logger = logging.getLogger("wren-ai-service")


@component
class DocumentCleaner:
    """
    This component is used to clear all the documents in the specified document store(s).

    """

    def __init__(self, stores: List[DocumentStore]) -> None:
        self._stores = stores

    @component.output_types(mdl=str)
    async def run(self, mdl: str, project_id: Optional[str] = None) -> str:
        async def _clear_documents(
            store: DocumentStore, project_id: Optional[str] = None
        ) -> None:
            filters = (
                {
                    "operator": "AND",
                    "conditions": [
                        {"field": "project_id", "operator": "==", "value": project_id},
                    ],
                }
                if project_id
                else None
            )
            await store.delete_documents(filters)

        logger.info("Ask Indexing pipeline is clearing old documents...")
        await asyncio.gather(
            *[_clear_documents(store, project_id) for store in self._stores]
        )
        return {"mdl": mdl}


@component
class MDLValidator:
    """
    Validate the MDL to check if it is a valid JSON and contains the required keys.
    """

    @component.output_types(mdl=Dict[str, Any])
    def run(self, mdl: str) -> str:
        try:
            mdl_json = orjson.loads(mdl)
            logger.debug(f"MDL JSON: {mdl_json}")
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON: {e}")
        if "models" not in mdl_json:
            mdl_json["models"] = []
        if "views" not in mdl_json:
            mdl_json["views"] = []
        if "relationships" not in mdl_json:
            mdl_json["relationships"] = []
        if "metrics" not in mdl_json:
            mdl_json["metrics"] = []

        return {"mdl": mdl_json}


@component
class TableDescriptionConverter:
    @component.output_types(documents=List[Document])
    def run(self, mdl: Dict[str, Any], project_id: Optional[str] = None):
        logger.info(
            "Ask Indexing pipeline is writing new documents for table descriptions..."
        )

        table_descriptions = self._get_table_descriptions(mdl)

        return {
            "documents": [
                Document(
                    id=str(uuid.uuid4()),
                    meta=(
                        {"project_id": project_id, "type": "TABLE_DESCRIPTION"}
                        if project_id
                        else {"type": "TABLE_DESCRIPTION"}
                    ),
                    content=table_description,
                )
                for table_description in tqdm(
                    table_descriptions,
                    desc="indexing table descriptions into the table description store",
                )
            ]
        }

    def _get_table_descriptions(self, mdl: Dict[str, Any]) -> List[str]:
        table_descriptions = []
        mdl_data = [
            {
                "mdl_type": "MODEL",
                "payload": mdl["models"],
            },
            {
                "mdl_type": "METRIC",
                "payload": mdl["metrics"],
            },
            {
                "mdl_type": "VIEW",
                "payload": mdl["views"],
            },
        ]

        for data in mdl_data:
            payload = data["payload"]
            for unit in payload:
                if name := unit.get("name", ""):
                    table_description = {
                        "name": name,
                        "mdl_type": data["mdl_type"],
                        "description": unit.get("properties", {}).get(
                            "description", ""
                        ),
                    }
                    table_descriptions.append(str(table_description))

        return table_descriptions


@component
class AsyncDocumentWriter(DocumentWriter):
    @component.output_types(documents_written=int)
    async def run(
        self, documents: List[Document], policy: Optional[DuplicatePolicy] = None
    ):
        if policy is None:
            policy = self.policy

        documents_written = await self.document_store.write_documents(
            documents=documents, policy=policy
        )
        return {"documents_written": documents_written}


## Start of Pipeline
@observe(capture_input=False, capture_output=False)
async def clean_document_store(
    mdl_str: str, cleaner: DocumentCleaner, project_id: Optional[str] = None
) -> Dict[str, Any]:
    return await cleaner.run(mdl=mdl_str, project_id=project_id)


@observe(capture_input=False, capture_output=False)
@extract_fields(dict(mdl=Dict[str, Any]))
def validate_mdl(
    clean_document_store: Dict[str, Any], validator: MDLValidator
) -> Dict[str, Any]:
    mdl = clean_document_store.get("mdl")
    res = validator.run(mdl=mdl)
    return dict(mdl=res["mdl"])


@observe(capture_input=False)
def covert_to_table_descriptions(
    mdl: Dict[str, Any],
    table_description_converter: TableDescriptionConverter,
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    return table_description_converter.run(mdl=mdl, project_id=project_id)


@observe(capture_input=False, capture_output=False)
async def embed_table_descriptions(
    covert_to_table_descriptions: Dict[str, Any],
    document_embedder: Any,
) -> Dict[str, Any]:
    return await document_embedder.run(covert_to_table_descriptions["documents"])


@observe(capture_input=False)
async def write_table_description(
    embed_table_descriptions: Dict[str, Any], table_description_writer: DocumentWriter
) -> None:
    return await table_description_writer.run(
        documents=embed_table_descriptions["documents"]
    )


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
            "document_embedder": embedder_provider.get_document_embedder(),
            "table_description_converter": TableDescriptionConverter(),
            "table_description_writer": AsyncDocumentWriter(
                document_store=table_description_store,
                policy=DuplicatePolicy.OVERWRITE,
            ),
        }

        self._configs = {}

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def visualize(self, mdl_str: str, project_id: Optional[str] = None) -> None:
        destination = "outputs/pipelines/indexing"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            ["write_table_description"],
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
        logger.info("Table Description Indexing pipeline is running...")
        return await self._pipe.execute(
            ["write_table_description"],
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
        TableDescription,
        "table_description",
        mdl_str='{"models": [], "views": [], "relationships": [], "metrics": []}',
    )
