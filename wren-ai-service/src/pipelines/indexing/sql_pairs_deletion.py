import logging
import sys
from typing import Any, Dict, List, Optional

from hamilton import base
from hamilton.async_driver import AsyncDriver
from langfuse.decorators import observe

from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider
from src.pipelines.indexing import SqlPairsCleaner

logger = logging.getLogger("wren-ai-service")


## Start of Pipeline
@observe(capture_input=False, capture_output=False)
async def delete_sql_pairs(
    sql_pairs_cleaner: SqlPairsCleaner,
    sql_pair_ids: List[str],
    id: Optional[str] = None,
) -> None:
    return await sql_pairs_cleaner.run(sql_pair_ids=sql_pair_ids, project_id=id)


## End of Pipeline


# TODO: consider removing this pipeline and using the function in the sql_pairs_indexing pipeline instead like other indexing pipelines
class SqlPairsDeletion(BasicPipeline):
    def __init__(
        self,
        document_store_provider: DocumentStoreProvider,
        **kwargs,
    ) -> None:
        sql_pairs_store = document_store_provider.get_store(dataset_name="sql_pairs")

        self._components = {
            "sql_pairs_cleaner": SqlPairsCleaner(sql_pairs_store),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="SQL Pairs Deletion")
    async def run(
        self, sql_pair_ids: List[str], id: Optional[str] = None
    ) -> Dict[str, Any]:
        logger.info("SQL Pairs Deletion pipeline is running...")
        return await self._pipe.execute(
            ["delete_sql_pairs"],
            inputs={
                "sql_pair_ids": sql_pair_ids,
                "id": id or "",
                **self._components,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        SqlPairsDeletion,
        "sql_pairs_deletion",
        sql_pair_ids=[],
    )
