import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional

import aiohttp
import orjson
import pandas as pd
from hamilton import base
from hamilton.experimental.h_async import AsyncDriver
from haystack import component
from langfuse.decorators import observe
from pandasai import SmartDataframe
from pandasai.llm import OpenAI

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline, async_validate
from src.utils import (
    async_timer,
)

logger = logging.getLogger("wren-ai-service")


def _get_llm() -> Dict[str, Any]:
    llm_provider = os.getenv("LLM_PROVIDER", "openai_llm")

    if llm_provider == "openai_llm":
        return OpenAI(
            api_token=os.getenv("LLM_OPENAI_API_KEY"),
            model=os.getenv("GENERATION_MODEL"),
            temperature=0,
        )
    elif llm_provider == "azure_openai_llm":
        raise NotImplementedError
    elif llm_provider == "ollama_llm":
        raise NotImplementedError


@component
class DataFetcher:
    def __init__(self, engine: Engine):
        self._engine = engine

    @component.output_types(
        results=Optional[Dict[str, Any]],
    )
    async def run(
        self,
        sql: str,
        project_id: str | None = None,
    ):
        async with aiohttp.ClientSession() as session:
            _, response = await self._engine.execute_sql(
                sql,
                session,
                project_id=project_id,
                dry_run=False,
            )

            return {"results": response}


@component
class AnswerGenerator:
    def __init__(self, llm: Any):
        self._llm = llm

    @component.output_types(
        answer=str,
    )
    async def run(
        self,
        data: dict,
        query: str,
        sql_summary: str,
    ) -> dict:
        try:
            data = orjson.loads(data)
            df_data = pd.DataFrame(
                {_col: _data for _col, _data in zip(data["columns"], data["data"])}
            ).astype(data["dtypes"])
            logger.info(f"df dtypes: {df_data.dtypes}")

            df = SmartDataframe(
                df_data, description=sql_summary, config={"llm": self._llm}
            )
            answer = df.chat(query, output_type="string")

            logger.info(f"SQL Answer: {answer}")
            return {"answer": str(answer)}
        except Exception as e:
            return {"answer": f"Error: {e}"}


## Start of Pipeline
@async_timer
@observe(capture_input=False)
async def execute_sql(
    sql: str, data_fetcher: DataFetcher, project_id: str | None = None
) -> dict:
    logger.debug(f"Executing SQL: {sql}")

    return await data_fetcher.run(sql=sql, project_id=project_id)


@async_timer
@observe(capture_input=False)
async def generate_answer(
    query: str, sql_summary: str, execute_sql: dict, answer_generator: AnswerGenerator
) -> str:
    logger.debug(f"Generating answer: {execute_sql}")

    return (
        await answer_generator.run(
            data=execute_sql["results"], query=query, sql_summary=sql_summary
        )
    )["answer"]


## End of Pipeline


class Generation(BasicPipeline):
    def __init__(
        self,
        engine: Engine,
    ):
        self.data_fetcher = DataFetcher(engine=engine)
        self.answer_generator = AnswerGenerator(llm=_get_llm())

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def visualize(
        self, query: str, sql: str, sql_summary: str, project_id: str | None = None
    ) -> None:
        destination = "outputs/pipelines/sql_answer"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            ["generate_answer"],
            output_file_path=f"{destination}/generation.dot",
            inputs={
                "query": query,
                "sql": sql,
                "sql_summary": sql_summary,
                "project_id": project_id,
                "data_fetcher": self.data_fetcher,
                "answer_generator": self.answer_generator,
            },
            show_legend=True,
            orient="LR",
        )

    @async_timer
    @observe(name="SQL Answer Generation")
    async def run(
        self, query: str, sql: str, sql_summary: str, project_id: str | None = None
    ) -> dict:
        logger.info("Sql_Answer Generation pipeline is running...")
        return await self._pipe.execute(
            ["generate_answer"],
            inputs={
                "query": query,
                "sql": sql,
                "sql_summary": sql_summary,
                "project_id": project_id,
                "data_fetcher": self.data_fetcher,
                "answer_generator": self.answer_generator,
            },
        )


if __name__ == "__main__":
    from langfuse.decorators import langfuse_context

    from src.core.engine import EngineConfig
    from src.core.pipeline import async_validate
    from src.utils import init_langfuse, init_providers, load_env_vars

    load_env_vars()
    init_langfuse()

    _, _, _, engine = init_providers(EngineConfig())
    pipeline = Generation(
        engine=engine,
    )

    pipeline.visualize("SELECT * FROM table_name")
    async_validate(lambda: pipeline.run("SELECT * FROM table_name"))

    langfuse_context.flush()
