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
from src.web.v1.services.sql_pairs_preparation import SqlPair

logger = logging.getLogger("wren-ai-service")


sql_intention_generation_system_prompt = """
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

sql_intention_generation_user_prompt_template = """
### INPUT ###
SQL: {{sql}}

Please think step by step
"""


@component
class SqlPairsDescriptionConverter:
    @component.output_types(documents=List[Document])
    def run(self, sql_pairs: List[Dict[str, Any]], id: Optional[str] = None):
        logger.info("Converting SQL pairs to documents...")

        return {
            "documents": [
                Document(
                    id=str(uuid.uuid4()),
                    meta=(
                        {
                            "sql_pair_id": sql_pair.get("id"),
                            "project_id": id,
                            "sql": sql_pair.get("sql"),
                        }
                        if id
                        else {
                            "sql_pair_id": sql_pair.get("id"),
                            "sql": sql_pair.get("sql"),
                        }
                    ),
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
    sql_intention_generator: Any,
) -> List[dict]:
    async def _task(prompt: str, generator: Any):
        return await generator(prompt=prompt.get("prompt"))

    tasks = [_task(prompt, sql_intention_generator) for prompt in prompts]
    return await asyncio.gather(*tasks)


@observe()
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
def convert_sql_pairs_to_documents(
    post_process: List[Dict[str, Any]],
    sql_pairs_description_converter: SqlPairsDescriptionConverter,
    id: Optional[str] = None,
) -> Dict[str, Any]:
    return sql_pairs_description_converter.run(sql_pairs=post_process, id=id)


@observe(capture_input=False, capture_output=False)
async def embed_sql_pairs(
    convert_sql_pairs_to_documents: Dict[str, Any],
    document_embedder: Any,
) -> Dict[str, Any]:
    return await document_embedder.run(
        documents=convert_sql_pairs_to_documents["documents"]
    )


@observe(capture_input=False, capture_output=False)
async def delete_sql_pairs(
    sql_pairs_cleaner: SqlPairsCleaner,
    sql_pairs: List[SqlPair],
    embed_sql_pairs: Dict[str, Any],
    id: Optional[str] = None,
) -> List[SqlPair]:
    sql_pair_ids = [sql_pair.id for sql_pair in sql_pairs]
    await sql_pairs_cleaner.run(sql_pair_ids=sql_pair_ids, id=id)

    return embed_sql_pairs


@observe(capture_input=False)
async def write_sql_pairs(
    embed_sql_pairs: Dict[str, Any],
    sql_pairs_writer: AsyncDocumentWriter,
) -> None:
    return await sql_pairs_writer.run(documents=embed_sql_pairs["documents"])


## End of Pipeline
class SqlIntentionGenerationResult(BaseModel):
    intention: str


SQL_INTENTION_GENERATION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "sql_intention_results",
            "schema": SqlIntentionGenerationResult.model_json_schema(),
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
        sql_pairs_store = document_store_provider.get_store(dataset_name="sql_pairs")

        self._components = {
            "sql_pairs_cleaner": SqlPairsCleaner(sql_pairs_store),
            "prompt_builder": PromptBuilder(
                template=sql_intention_generation_user_prompt_template
            ),
            "sql_intention_generator": llm_provider.get_generator(
                system_prompt=sql_intention_generation_system_prompt,
                generation_kwargs=SQL_INTENTION_GENERATION_MODEL_KWARGS,
            ),
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

    @observe(name="SQL Pairs Preparation")
    async def run(
        self, sql_pairs: List[SqlPair], id: Optional[str] = None
    ) -> Dict[str, Any]:
        logger.info("SQL Pairs Preparation pipeline is running...")
        return await self._pipe.execute(
            ["write_sql_pairs"],
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
