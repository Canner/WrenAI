import logging
import sys
from typing import Dict, Optional

import aiohttp
from cachetools import TTLCache
from hamilton import base
from hamilton.async_driver import AsyncDriver
from langfuse.decorators import observe

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider
from src.pipelines.common import retrieve_metadata
from src.providers.engine.wren import WrenIbis

logger = logging.getLogger("wren-ai-service")


class SqlKnowledge:
    def __init__(self, sql_knowledge: dict):
        self._data: Dict = sql_knowledge

    @classmethod
    def empty(cls, sql_knowledge: dict):
        return (
            not sql_knowledge
            or not sql_knowledge.get("text_to_sql_rule")
            or not sql_knowledge.get("instructions")
        )

    @property
    def text_to_sql_rule(self) -> str:
        return self._data.get("text_to_sql_rule", "")

    @property
    def instructions(self) -> dict:
        return self._data.get("instructions", {})

    @property
    def calculated_field_instructions(self) -> str:
        return self.instructions.get("calculated_field_instructions", "")

    @property
    def metric_instructions(self) -> str:
        return self.instructions.get("metric_instructions", "")

    @property
    def json_field_instructions(self) -> str:
        return self.instructions.get("json_field_instructions", "")

    def __str__(self):
        return f"text_to_sql_rule: {self.text_to_sql_rule}, instructions: {self.instructions}"

    def __repr__(self):
        return self.__str__()


## Start of Pipeline
@observe(capture_input=False)
async def get_knowledge(
    engine: WrenIbis,
    data_source: str,
) -> Optional[SqlKnowledge]:
    async with aiohttp.ClientSession() as session:
        knowledge_dict = await engine.get_sql_knowledge(
            session=session,
            data_source=data_source,
        )

        if not knowledge_dict or SqlKnowledge.empty(knowledge_dict):
            return None

        return SqlKnowledge(sql_knowledge=knowledge_dict)


@observe(capture_input=False)
def cache(
    data_source: str,
    get_knowledge: Optional[SqlKnowledge],
    ttl_cache: TTLCache,
) -> Optional[SqlKnowledge]:
    if get_knowledge:
        ttl_cache[data_source] = get_knowledge

    return get_knowledge


## End of Pipeline


class SqlKnowledges(BasicPipeline):
    def __init__(
        self,
        engine: Engine,
        document_store_provider: DocumentStoreProvider,
        ttl: int = 60 * 60 * 24,
        **kwargs,
    ) -> None:
        self._retriever = document_store_provider.get_retriever(
            document_store_provider.get_store("project_meta")
        )
        self._cache = TTLCache(maxsize=100, ttl=ttl)
        self._components = {
            "engine": engine,
            "ttl_cache": self._cache,
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="SQL Knowledge Retrieval")
    async def run(
        self,
        project_id: Optional[str] = None,
    ) -> Optional[SqlKnowledge]:
        logger.info(
            f"Project ID: {project_id} SQL Knowledge Retrieval pipeline is running..."
        )

        metadata = await retrieve_metadata(project_id or "", self._retriever)
        _data_source = metadata.get("data_source", "local_file")

        if _data_source in self._cache:
            logger.info(f"Hit cache of SQL Knowledge for {_data_source}")
            return self._cache[_data_source]

        input = {
            "data_source": _data_source,
            "project_id": project_id,
            **self._components,
        }
        result = await self._pipe.execute(["cache"], inputs=input)
        return result["cache"]
