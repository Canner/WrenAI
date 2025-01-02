import asyncio
import logging
import sys
import uuid
from typing import Any, Dict, List, Optional

import orjson
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack import Document, component
from haystack.components.builders.prompt_builder import PromptBuilder
from haystack.document_stores.types import DuplicatePolicy
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider, EmbedderProvider, LLMProvider
from src.pipelines.indexing import AsyncDocumentWriter, SqlPairsCleaner

logger = logging.getLogger("wren-ai-service")


_system_prompt = """
### TASK ###

You are a data analyst great at generating the concise and readable summary of a SQL query.

### INSTRUCTIONS ###

- Summary should be concise and readable.
- Summary should be no longer than 20 words.
- Don't rephrase keywords in the SQL query, just use them as they are.

### OUTPUT ###

You need to output a JSON object as following:
{
    "intention": "<CONCISE_AND_READABLE_SUMMARY_STRING>"
}
"""

_user_prompt_template = """
### INPUT ###
SQL: {{sql}}

Please think step by step
"""


class SqlPair(BaseModel):
    sql: str
    id: str


@component
class SqlPairsConverter:
    @component.output_types(documents=List[Document])
    def run(self, sql_pairs: List[Dict[str, Any]], project_id: Optional[str] = ""):
        logger.info(f"Project ID: {project_id} Converting SQL pairs to documents...")

        addition = {"project_id": project_id} if project_id else {}

        return {
            "documents": [
                Document(
                    id=sql_pair.get("id", str(uuid.uuid4())),
                    meta={
                        "sql_pair_id": sql_pair.get("id"),
                        "sql": sql_pair.get("sql"),
                        **addition,
                    },
                    content=sql_pair.get("intention"),
                )
                for sql_pair in sql_pairs
            ]
        }


## Start of Pipeline
@observe(capture_input=False)
def prompts(
    sql_pairs: List[SqlPair],
    prompt_builder: PromptBuilder,
) -> List[dict]:
    return [prompt_builder.run(sql=sql_pair.sql) for sql_pair in sql_pairs]


@observe(as_type="generation", capture_input=False)
async def generate_sql_intention(
    prompts: List[dict],
    generator: Any,
) -> List[dict]:
    async def _task(prompt: str, generator: Any):
        return await generator(prompt=prompt.get("prompt"))

    tasks = [_task(prompt, generator) for prompt in prompts]
    return await asyncio.gather(*tasks)


@observe(capture_input=False)
def post_process(
    generate_sql_intention: List[dict],
    sql_pairs: List[SqlPair],
) -> List[Dict[str, Any]]:
    intentions = [
        orjson.loads(result["replies"][0])["intention"]
        for result in generate_sql_intention
    ]

    return [
        {"id": sql_pair.id, "sql": sql_pair.sql, "intention": intention}
        for sql_pair, intention in zip(sql_pairs, intentions)
    ]


@observe(capture_input=False)
def to_documents(
    post_process: List[Dict[str, Any]],
    document_converter: SqlPairsConverter,
    project_id: Optional[str] = "",
) -> Dict[str, Any]:
    return document_converter.run(sql_pairs=post_process, project_id=project_id)


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
class SqlIntentionResult(BaseModel):
    intention: str


_GENERATION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "sql_intention_results",
            "schema": SqlIntentionResult.model_json_schema(),
        },
    }
}


class SqlPairsPreparation(BasicPipeline):
    def __init__(
        self,
        embedder_provider: EmbedderProvider,
        llm_provider: LLMProvider,
        document_store_provider: DocumentStoreProvider,
        **kwargs,
    ) -> None:
        store = document_store_provider.get_store(dataset_name="sql_pairs")

        self._components = {
            "cleaner": SqlPairsCleaner(store),
            "prompt_builder": PromptBuilder(template=_user_prompt_template),
            "generator": llm_provider.get_generator(
                system_prompt=_system_prompt,
                generation_kwargs=_GENERATION_MODEL_KWARGS,
            ),
            "embedder": embedder_provider.get_document_embedder(),
            "document_converter": SqlPairsConverter(),
            "writer": AsyncDocumentWriter(
                document_store=store,
                policy=DuplicatePolicy.OVERWRITE,
            ),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="SQL Pairs Preparation")
    async def run(
        self, sql_pairs: List[SqlPair], project_id: Optional[str] = ""
    ) -> Dict[str, Any]:
        logger.info(
            f"Project ID: {project_id} SQL Pairs Preparation pipeline is running..."
        )

        return await self._pipe.execute(
            ["write"],
            inputs={
                "sql_pairs": sql_pairs,
                "project_id": project_id,
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
