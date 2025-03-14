import logging
import sys
from typing import Any, Dict, List, Optional

import aiohttp
from hamilton import base
from hamilton.async_driver import AsyncDriver
from hamilton.function_modifiers import extract_fields
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline
from src.pipelines.indexing import MDLValidator
from src.providers.engine.wren import WrenIbis

logger = logging.getLogger("wren-ai-service")


class SqlFunction(BaseModel):
    definition: dict = None

    def __str__(self):
        def _extract() -> tuple[str, list, str]:
            name = self.definition["name"]

            _param_types = self.definition.get("param_types", "")
            param_types = _param_types.split(",") if _param_types else []

            return_type = self.definition.get("return_type", "")

            return name, param_types, return_type

        def _param_expr(param_type: str, index: int) -> str:
            param_type = param_type.strip()
            param_name = f"${index}"
            return f"{param_name}: {param_type}"

        name, param_types, return_type = _extract()

        params = [_param_expr(type, index) for index, type in enumerate(param_types)]
        param_str = ", ".join(params)

        return f"{name}({param_str}) -> {return_type}"

    def __repr__(self):
        return str(self)


## Start of Pipeline
@observe(capture_input=False, capture_output=False)
@extract_fields(dict(mdl=Dict[str, Any]))
def validate_mdl(mdl_str: str, validator: MDLValidator) -> Dict[str, Any]:
    res = validator.run(mdl=mdl_str)
    return dict(mdl=res["mdl"])


@observe(capture_input=False)
@extract_fields(dict(func_list=List[str], data_source=str))
async def get_functions(
    engine: WrenIbis,
    mdl: Dict[str, Any],
) -> Dict[str, Any]:
    async with aiohttp.ClientSession() as session:
        data_source = mdl.get("dataSource").lower()
        func_list = await engine.get_func_list(session=session, data_source=data_source)
        return {
            "data_source": data_source,
            "func_list": func_list,
        }


@observe(capture_input=False)
def sql_functions(
    func_list: List[str],
) -> List[SqlFunction]:
    return [SqlFunction(definition=func) for func in func_list]


@observe(capture_input=False)
def cache(
    sql_functions: List[SqlFunction],
    data_source: str,
) -> List[SqlFunction]:
    # todo: implement cache for sql functions
    return sql_functions


## End of Pipeline


class SqlFunctions(BasicPipeline):
    def __init__(
        self,
        engine: Engine,
        **kwargs,
    ) -> None:
        self._components = {
            "validator": MDLValidator(),
            "engine": engine,
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="SQL Functions Indexing")
    async def run(
        self,
        mdl_str: str,
        project_id: Optional[str] = None,
    ) -> dict[str, Any]:
        logger.info(
            f"Project ID: {project_id} SQL Functions Indexing pipeline is running..."
        )

        input = {
            "mdl_str": mdl_str,
            "project_id": project_id,
            **self._components,
        }

        return await self._pipe.execute(["cache"], inputs=input)


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        SqlFunctions,
        "sql_functions_indexing",
        mdl_str='{"dataSource": "postgres"}',
    )
