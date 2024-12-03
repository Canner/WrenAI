import logging
import sys
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack import Document, component
from haystack.document_stores.types import DuplicatePolicy
from langfuse.decorators import observe

from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider, EmbedderProvider
from src.pipelines.indexing import AsyncDocumentWriter
from src.web.v1.services.sql_pairs_preparation import SqlPair

logger = logging.getLogger("wren-ai-service")


@component
class SqlPairsDescriptionConverter:
    @component.output_types(documents=List[Document])
    def run(self, sql_pairs: List[SqlPair], id: Optional[str] = None):
        logger.info("Converting SQL pairs to documents...")

        return {
            "documents": [
                Document(
                    id=str(uuid.uuid4()),
                    meta=(
                        {"sql_pair_id": sql_pair.id, "project_id": id}
                        if id
                        else {"sql_pair_id": sql_pair.id}
                    ),
                    content=sql_pair.sql,
                )
                for sql_pair in sql_pairs
            ]
        }


## Start of Pipeline
@observe(capture_input=False)
def convert_sql_pairs_to_documents(
    sql_pairs: List[SqlPair],
    sql_pairs_description_converter: SqlPairsDescriptionConverter,
    id: Optional[str] = None,
) -> Dict[str, Any]:
    return sql_pairs_description_converter.run(sql_pairs=sql_pairs, id=id)


@observe(capture_input=False, capture_output=False)
async def embed_sql_pairs(
    convert_sql_pairs_to_documents: Dict[str, Any],
    document_embedder: Any,
) -> Dict[str, Any]:
    return await document_embedder.run(
        documents=convert_sql_pairs_to_documents["documents"]
    )


@observe(capture_input=False)
async def write_sql_pairs(
    embed_sql_pairs: Dict[str, Any],
    sql_pairs_writer: AsyncDocumentWriter,
) -> None:
    return await sql_pairs_writer.run(documents=embed_sql_pairs["documents"])


## End of Pipeline


class SqlPairsPreparation(BasicPipeline):
    def __init__(
        self,
        embedder_provider: EmbedderProvider,
        document_store_provider: DocumentStoreProvider,
        **kwargs,
    ) -> None:
        sql_pairs_store = document_store_provider.get_store(dataset_name="sql_pairs")

        self._components = {
            "document_embedder": embedder_provider.get_document_embedder(),
            "sql_pairs_description_converter": SqlPairsDescriptionConverter(),
            "sql_pairs_writer": AsyncDocumentWriter(
                document_store=sql_pairs_store,
                policy=DuplicatePolicy.OVERWRITE,
            ),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def visualize(self, sql_pairs: List[SqlPair], id: Optional[str] = None) -> None:
        destination = "outputs/pipelines/indexing"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            [],
            output_file_path=f"{destination}/sql_pairs_preparation.dot",
            inputs={
                "sql_pairs": sql_pairs,
                "id": id or "",
                **self._components,
            },
            show_legend=True,
            orient="LR",
        )

    @observe(name="SQL Pairs Preparation")
    async def run(
        self, sql_pairs: List[SqlPair], id: Optional[str] = None
    ) -> Dict[str, Any]:
        logger.info("SQL Pairs Preparation pipeline is running...")
        return await self._pipe.execute(
            [],
            inputs={
                "sql_pairs": sql_pairs,
                "id": id or "",
                **self._components,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        SqlPairsPreparation,
        "sql_pairs_preparation",
        sql_pairs=[],
    )
