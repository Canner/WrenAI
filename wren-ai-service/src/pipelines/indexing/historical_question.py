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
class ViewChunker:
    """
    A component that processes views from an MDL (Model Definition Language) file and converts them into Document objects.

    The component takes views in the following MDL format:
    {
        "views": [
            {
                "statement": "SELECT * FROM employees",
                "properties": {
                    "historical_queries": [], # List of previous related queries
                    "question": "What is the average salary of employees?", # Current query
                    "summary": "The average salary of employees is $50,000.", # Summary for the query
                    "viewId": "1234567890" # Unique identifier
                }
            }
        ]
    }

    And converts each view into a Document with:
    - content: Concatenated string of historical queries and current question
    - meta: Dictionary containing:
        {
            "summary": "Generated description/answer",
            "statement": "SQL statement",
            "viewId": "Unique view identifier",
            "project_id": "Optional project identifier"
        }

    The Documents are then stored in the document store for later retrieval.
    """

    @component.output_types(documents=List[Document])
    def run(self, mdl: Dict[str, Any], project_id: Optional[str] = None) -> None:
        def _get_content(view: Dict[str, Any]) -> str:
            properties = view.get("properties", {})
            historical_queries = properties.get("historical_queries", [])
            question = properties.get("question", "")

            return " ".join(historical_queries + [question])

        def _get_meta(view: Dict[str, Any]) -> Dict[str, Any]:
            properties = view.get("properties", {})
            return {
                "summary": properties.get("summary", ""),
                "statement": view.get("statement", ""),
                "viewId": properties.get("viewId", ""),
            }

        def _additional_meta() -> Dict[str, Any]:
            return {"project_id": project_id} if project_id else {}

        chunks = [
            {
                "id": str(uuid.uuid4()),
                "content": _get_content(view),
                "meta": {**_get_meta(view), **_additional_meta()},
            }
            for view in mdl["views"]
        ]

        return {
            "documents": [
                Document(**chunk)
                for chunk in tqdm(
                    chunks,
                    desc=f"Project ID: {project_id}, Chunking views into documents",
                )
            ]
        }


## Start of Pipeline
@observe(capture_input=False, capture_output=False)
@extract_fields(dict(mdl=Dict[str, Any]))
def validate_mdl(mdl_str: str, validator: MDLValidator) -> Dict[str, Any]:
    res = validator.run(mdl=mdl_str)
    return dict(mdl=res["mdl"])


@observe(capture_input=False)
def chunk(
    mdl: Dict[str, Any],
    chunker: ViewChunker,
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    return chunker.run(mdl=mdl, project_id=project_id)


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


class HistoricalQuestion(BasicPipeline):
    def __init__(
        self,
        embedder_provider: EmbedderProvider,
        document_store_provider: DocumentStoreProvider,
        **kwargs,
    ) -> None:
        # keep the store name as it is for now, might change in the future
        store = document_store_provider.get_store(dataset_name="view_questions")

        self._components = {
            "cleaner": DocumentCleaner([store]),
            "validator": MDLValidator(),
            "embedder": embedder_provider.get_document_embedder(),
            "chunker": ViewChunker(),
            "writer": AsyncDocumentWriter(
                document_store=store,
                policy=DuplicatePolicy.OVERWRITE,
            ),
        }
        self._configs = {}
        self._final = "write"

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Historical Question Indexing")
    async def run(
        self, mdl_str: str, project_id: Optional[str] = None
    ) -> Dict[str, Any]:
        logger.info(
            f"Project ID: {project_id}, Historical Question Indexing pipeline is running..."
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

    @observe(name="Clean Documents for Historical Question")
    async def clean(self, project_id: Optional[str] = None) -> None:
        await clean(
            embedding={"documents": []},
            cleaner=self._components["cleaner"],
            project_id=project_id,
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        HistoricalQuestion,
        "historical_question_indexing",
        mdl_str='{"models": [], "views": [], "relationships": [], "metrics": []}',
    )
