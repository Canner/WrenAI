import logging
import sys
from typing import List, Optional, Sequence

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


class SqlFunction:
    _expr: str = None

    def __init__(self, definition: dict):
        def _extract() -> tuple[
            str,
            str | Sequence[str | None] | None,
            str | None,
            str | None,
        ]:
            return (
                definition.get("name", ""),
                definition.get("param_types"),
                definition.get("return_type"),
                definition.get("description", ""),
            )

        name, param_types, return_type, description = _extract()
        params = self._format_params(param_types)
        return_type = self._format_return_type(return_type, param_types)

        self._expr = f"{name}({params}) -> {return_type}"
        if description:
            self._expr = f"{self._expr}: {description}"

    @staticmethod
    def _format_params(param_types: str | Sequence[str | None] | None) -> str:
        if not param_types:
            return "any"

        if isinstance(param_types, str):
            param_types = param_types.split(",")

        return ", ".join(
            f"${index}: {param_type.strip()}"
            for index, param_type in enumerate(param_types)
            if param_type and param_type.strip()
        )

    @staticmethod
    def _format_return_type(
        return_type: str | None,
        param_types: str | Sequence[str | None] | None,
    ) -> str:
        if not return_type:
            return "any"

        if return_type == "same as arg types" and param_types:
            if isinstance(param_types, str):
                param_types = param_types.split(",")

            return str(
                [
                    param_type.strip()
                    for param_type in param_types
                    if param_type and param_type.strip()
                ]
            )

        return return_type

    @classmethod
    def empty(cls, definition: dict):
        return not definition.get("name", "")

    def __str__(self):
        return self._expr

    def __repr__(self):
        return self._expr


## Start of Pipeline
@observe(capture_input=False)
async def get_functions(
    engine: WrenIbis,
    data_source: str,
) -> List[SqlFunction]:
    async with aiohttp.ClientSession() as session:
        func_list = await engine.get_func_list(
            session=session,
            data_source=data_source,
        )

        return [
            SqlFunction(definition=func)
            for func in func_list
            if not SqlFunction.empty(func)
        ]


@observe(capture_input=False)
def cache(
    data_source: str,
    get_functions: List[SqlFunction],
    ttl_cache: TTLCache,
) -> List[SqlFunction]:
    ttl_cache[data_source] = get_functions
    return get_functions


## End of Pipeline


class SqlFunctions(BasicPipeline):
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

    @observe(name="SQL Functions Retrieval")
    async def run(
        self,
        project_id: Optional[str] = None,
        mdl_hash: Optional[str] = None,
    ) -> List[SqlFunction]:
        logger.info(
            f"Project ID: {project_id} SQL Functions Retrieval pipeline is running..."
        )

        metadata = await retrieve_metadata(
            project_id or "",
            self._retriever,
            mdl_hash=mdl_hash,
        )
        _data_source = metadata.get("data_source", "local_file").lower()

        if _data_source in self._cache:
            logger.info(f"Hit cache of SQL Functions for {_data_source}")
            return self._cache[_data_source]

        input = {
            "data_source": _data_source,
            "project_id": project_id,
            **self._components,
        }
        result = await self._pipe.execute(["cache"], inputs=input)
        return result["cache"]
