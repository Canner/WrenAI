import logging
import os
import sys
import uuid
from typing import Any, Dict, List, Optional, Set

import orjson
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack import Document, component
from haystack.document_stores.types import DuplicatePolicy
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider, EmbedderProvider
from src.pipelines.indexing import AsyncDocumentWriter, SqlPairsCleaner

logger = logging.getLogger("wren-ai-service")


class SqlPair(BaseModel):
    id: str
    sql: str
    question: str


@component
class SqlPairsConverter:
    @component.output_types(documents=List[Document])
    def run(self, sql_pairs: List[SqlPair], project_id: Optional[str] = ""):
        logger.info(f"Project ID: {project_id} Converting SQL pairs to documents...")

        addition = {"project_id": project_id} if project_id else {}

        return {
            "documents": [
                Document(
                    id=str(uuid.uuid4()),
                    meta={
                        "sql_pair_id": sql_pair.id,
                        "sql": sql_pair.sql,
                        **addition,
                    },
                    content=sql_pair.question,
                )
                for sql_pair in sql_pairs
            ]
        }


## Start of Pipeline
@observe(capture_input=False)
def boilerplates(
    mdl_str: str,
) -> Set[str]:
    mdl = orjson.loads(mdl_str)

    return {
        boilerplate.lower()
        for model in mdl.get("models", [])
        if (boilerplate := model.get("properties", {}).get("boilerplate"))
    }


@observe(capture_input=False)
def sql_pairs(
    boilerplates: Set[str],
    external_pairs: Dict[str, Any],
) -> List[SqlPair]:
    return [
        SqlPair(
            id=pair.get("id"),
            question=pair.get("question"),
            sql=pair.get("sql"),
        )
        for boilerplate in boilerplates
        if boilerplate in external_pairs
        for pair in external_pairs[boilerplate]
    ]


@observe(capture_input=False)
def to_documents(
    sql_pairs: List[SqlPair],
    document_converter: SqlPairsConverter,
    project_id: Optional[str] = "",
) -> Dict[str, Any]:
    return document_converter.run(sql_pairs=sql_pairs, project_id=project_id)


@observe(capture_input=False, capture_output=False)
async def embedding(
    to_documents: Dict[str, Any],
    embedder: Any,
) -> Dict[str, Any]:
    return await embedder.run(documents=to_documents["documents"])


@observe(capture_input=False, capture_output=False)
async def clean(
    cleaner: SqlPairsCleaner,
    sql_pairs: List[SqlPair],
    embedding: Dict[str, Any],
    project_id: Optional[str] = "",
) -> Dict[str, Any]:
    sql_pair_ids = [sql_pair.id for sql_pair in sql_pairs]
    await cleaner.run(sql_pair_ids=sql_pair_ids, project_id=project_id)

    return embedding


@observe(capture_input=False)
async def write(
    clean: Dict[str, Any],
    writer: AsyncDocumentWriter,
) -> None:
    return await writer.run(documents=clean["documents"])


## End of Pipeline


def _load_sql_pairs(sql_pairs_path: str) -> Dict[str, Any]:
    if not sql_pairs_path:
        return {}

    if not os.path.exists(sql_pairs_path):
        logger.warning(f"SQL pairs file not found: {sql_pairs_path}")
        return {}

    try:
        with open(sql_pairs_path, "r") as file:
            return orjson.loads(file.read())
    except Exception as e:
        logger.error(f"Error loading SQL pairs file: {e}")
        return {}


class SqlPairs(BasicPipeline):
    def __init__(
        self,
        embedder_provider: EmbedderProvider,
        document_store_provider: DocumentStoreProvider,
        sql_pairs_path: Optional[str] = "sql_pairs.json",
        **kwargs,
    ) -> None:
        store = document_store_provider.get_store(dataset_name="sql_pairs")

        self._components = {
            "cleaner": SqlPairsCleaner(store),
            "embedder": embedder_provider.get_document_embedder(),
            "document_converter": SqlPairsConverter(),
            "writer": AsyncDocumentWriter(
                document_store=store,
                policy=DuplicatePolicy.OVERWRITE,
            ),
            "external_pairs": _load_sql_pairs(sql_pairs_path),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="SQL Pairs Indexing")
    async def run(
        self,
        mdl_str: str,
        project_id: Optional[str] = "",
    ) -> Dict[str, Any]:
        logger.info(
            f"Project ID: {project_id} SQL Pairs Indexing pipeline is running..."
        )

        return await self._pipe.execute(
            ["write"],
            inputs={
                "mdl_str": mdl_str,
                "project_id": project_id,
                **self._components,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        SqlPairs,
        "sql_pairs_indexing",
        mdl_str='{"models": [{"properties": {"boilerplate": "hubspot"}}]}',
    )
