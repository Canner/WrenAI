import logging
import sys
import uuid
from typing import Any, Optional

from hamilton import base
from hamilton.async_driver import AsyncDriver
from hamilton.function_modifiers import extract_fields
from haystack import Document
from haystack.components.writers import DocumentWriter
from haystack.document_stores.types import DuplicatePolicy
from langfuse.decorators import observe

from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider
from src.pipelines.indexing import AsyncDocumentWriter, DocumentCleaner, MDLValidator

logger = logging.getLogger("wren-ai-service")


## Start of Pipeline
@observe(capture_input=False, capture_output=False)
@extract_fields(dict(mdl=dict[str, Any]))
def validate_mdl(mdl_str: str, validator: MDLValidator) -> dict[str, Any]:
    res = validator.run(mdl=mdl_str)
    return dict(mdl=res["mdl"])


@observe(capture_input=False)
def chunk(
    mdl: dict[str, Any],
    project_id: Optional[str] = None,
) -> dict[str, Any]:
    addition = {"project_id": project_id} if project_id else {}
    data_source = mdl.get("dataSource", "local_file").lower()

    if data_source == "duckdb":
        # fix duckdb to local_file due to wren-ibis implementation at the moment
        data_source = "local_file"

    document = Document(
        id=str(uuid.uuid4()),
        meta={"data_source": data_source, **addition},
    )
    return {"documents": [document]}


@observe(capture_input=False, capture_output=False)
async def clean(
    chunk: dict[str, Any],
    cleaner: DocumentCleaner,
    project_id: Optional[str] = None,
) -> dict[str, Any]:
    await cleaner.run(project_id=project_id)
    return chunk


@observe(capture_input=False)
async def write(clean: dict[str, Any], writer: DocumentWriter) -> None:
    return await writer.run(documents=clean["documents"])


## End of Pipeline


class ProjectMeta(BasicPipeline):
    def __init__(
        self,
        document_store_provider: DocumentStoreProvider,
        **kwargs,
    ) -> None:
        store = document_store_provider.get_store(dataset_name="project_meta")

        self._components = {
            "validator": MDLValidator(),
            "cleaner": DocumentCleaner([store]),
            "writer": AsyncDocumentWriter(
                document_store=store,
                policy=DuplicatePolicy.OVERWRITE,
            ),
        }
        self._final = "write"

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Project Meta Indexing")
    async def run(
        self, mdl_str: str, project_id: Optional[str] = None
    ) -> dict[str, Any]:
        logger.info(
            f"Project ID: {project_id}, Project Meta Indexing pipeline is running..."
        )
        return await self._pipe.execute(
            [self._final],
            inputs={
                "mdl_str": mdl_str,
                "project_id": project_id,
                **self._components,
            },
        )

    @observe(name="Clean Documents for Project Meta")
    async def clean(self, project_id: Optional[str] = None) -> None:
        await self._components["cleaner"].run(project_id=project_id)


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        ProjectMeta,
        "project_meta_indexing",
        mdl_str='{"data_source": "local_file"}',
        project_id="test",
    )
