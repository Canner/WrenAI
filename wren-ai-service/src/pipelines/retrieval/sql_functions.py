import logging
import sys
from typing import Any, Dict, List, Optional

import aiohttp
from cachetools import TTLCache
from hamilton import base
from hamilton.async_driver import AsyncDriver
from hamilton.function_modifiers import extract_fields
from langfuse.decorators import observe

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider
from src.providers.engine.wren import WrenIbis

logger = logging.getLogger("wren-ai-service")


class SqlFunction:
    _expr: str = None

    def __init__(self, definition: dict):
        def _extract() -> tuple[str, list, str]:
            return (
                definition.get("name", "").upper(),
                definition.get("function_type", ""),
                definition.get("description", ""),
            )

        def _param_expr(param_type: str, index: int) -> str:
            if param_type == "any":
                return "any"

            param_type = param_type.strip()
            param_name = f"${index}"
            return f"{param_name}: {param_type}"

        name, function_type, description = _extract()

        self._expr = f"type: {function_type}, name: {name}, description: {description}"

    @classmethod
    def empty(cls, definition: dict):
        return (
            not definition.get("name", "")
            or not definition.get("function_type", "")
            or not definition.get("description", "")
        )

    def __str__(self):
        return self._expr

    def __repr__(self):
        return self._expr


## Start of Pipeline
@observe(capture_input=False)
@extract_fields(dict(func_list=List[dict]))
async def get_functions(
    engine: WrenIbis,
    data_source: str,
    engine_timeout: float = 30.0,
) -> Dict[str, Any]:
    async with aiohttp.ClientSession() as session:
        func_list = await engine.get_func_list(
            session=session,
            data_source=data_source,
            timeout=engine_timeout,
        )
        return {"func_list": func_list}


@observe(capture_input=False)
def sql_functions(
    func_list: List[dict],
) -> List[SqlFunction]:
    return [
        SqlFunction(definition=func)
        for func in func_list
        if not SqlFunction.empty(func)
    ]


@observe(capture_input=False)
def cache(
    data_source: str,
    sql_functions: List[SqlFunction],
    ttl_cache: TTLCache,
) -> List[SqlFunction]:
    ttl_cache[data_source] = sql_functions
    return sql_functions


## End of Pipeline


class SqlFunctions(BasicPipeline):
    def __init__(
        self,
        engine: Engine,
        document_store_provider: DocumentStoreProvider,
        engine_timeout: float = 30.0,
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

        self._configs = {
            "engine_timeout": engine_timeout,
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(capture_input=False)
    async def _retrieve_metadata(self, project_id: str) -> dict[str, Any]:
        filters = None
        if project_id:
            filters = {
                "operator": "AND",
                "conditions": [
                    {"field": "project_id", "operator": "==", "value": project_id},
                ],
            }

        result = await self._retriever.run(query_embedding=[], filters=filters)
        documents = result["documents"]

        # only one document for a project, thus we can return the first one
        if documents:
            doc = documents[0]
            return doc.meta
        else:
            return {}

    @observe(name="SQL Functions Retrieval")
    async def run(
        self,
        project_id: Optional[str] = None,
    ) -> List[SqlFunction]:
        logger.info(
            f"Project ID: {project_id} SQL Functions Retrieval pipeline is running..."
        )

        metadata = await self._retrieve_metadata(project_id or "")
        _data_source = metadata.get("data_source", "local_file")

        if _data_source in self._cache:
            logger.info(f"Hit cache of SQL Functions for {_data_source}")
            return self._cache[_data_source]

        input = {
            "data_source": _data_source,
            "project_id": project_id,
            **self._components,
            **self._configs,
        }
        result = await self._pipe.execute(["cache"], inputs=input)
        return result["cache"]


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        SqlFunctions,
        "sql_functions_retrieval",
        project_id="test",
    )
