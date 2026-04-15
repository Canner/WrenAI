import logging
import sys
import uuid
from typing import Any, Dict, List, Literal, Optional

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack import Document, component
from haystack.document_stores.types import DocumentStore, DuplicatePolicy
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider, EmbedderProvider
from src.pipelines.common import (
    build_runtime_scope_filters,
    build_runtime_scope_meta,
    resolve_pipeline_runtime_scope_id,
)
from src.pipelines.indexing import AsyncDocumentWriter

logger = logging.getLogger("wren-ai-service")


class Instruction(BaseModel):
    id: str
    instruction: str = ""
    question: str = ""
    # This is used to identify the default instruction needed to be retrieved for the project
    is_default: bool = False
    scope: Literal["sql", "answer", "chart"] = "sql"


@component
class InstructionsConverter:
    @component.output_types(documents=List[Document])
    def run(self, instructions: list[Instruction], runtime_scope_id: str = ""):
        runtime_scope_id = resolve_pipeline_runtime_scope_id(runtime_scope_id)
        logger.info(
            f"Runtime scope: {runtime_scope_id} Converting instructions to documents..."
        )

        addition = build_runtime_scope_meta(runtime_scope_id)

        return {
            "documents": [
                Document(
                    id=str(uuid.uuid4()),
                    meta={
                        "instruction_id": instruction.id,
                        "instruction": instruction.instruction,
                        "is_default": instruction.is_default,
                        "scope": instruction.scope,
                        **addition,
                    },
                    content="this is a global instruction, so no question is provided"
                    if instruction.is_default
                    else instruction.question,
                )
                for instruction in instructions
            ]
        }


@component
class InstructionsCleaner:
    def __init__(self, instructions_store: DocumentStore) -> None:
        self.store = instructions_store

    @component.output_types()
    async def run(
        self, instruction_ids: List[str], runtime_scope_id: Optional[str] = None
    ) -> None:
        runtime_scope_id = resolve_pipeline_runtime_scope_id(runtime_scope_id)
        if not runtime_scope_id:
            raise ValueError(
                "InstructionsCleaner requires runtime_scope_id when deleting documents"
            )
        conditions = (
            [{"field": "instruction_id", "operator": "in", "value": instruction_ids}]
            if instruction_ids
            else None
        )
        filter = build_runtime_scope_filters(
            runtime_scope_id,
            conditions=conditions,
        )

        return await self.store.delete_documents(filter)


## Start of Pipeline


@observe(capture_input=False)
def to_documents(
    instructions: List[Instruction],
    document_converter: InstructionsConverter,
    runtime_scope_id: str = "",
) -> Dict[str, Any]:
    runtime_scope_id = resolve_pipeline_runtime_scope_id(runtime_scope_id)
    return document_converter.run(
        instructions=instructions, runtime_scope_id=runtime_scope_id
    )


@observe(capture_input=False, capture_output=False)
async def embedding(
    to_documents: Dict[str, Any],
    embedder: Any,
) -> Dict[str, Any]:
    return await embedder.run(documents=to_documents["documents"])


@observe(capture_input=False, capture_output=False)
async def clean(
    cleaner: InstructionsCleaner,
    instructions: List[Instruction],
    embedding: Dict[str, Any] = {},
    runtime_scope_id: str = "",
    delete_all: bool = False,
) -> Dict[str, Any]:
    runtime_scope_id = resolve_pipeline_runtime_scope_id(runtime_scope_id)
    instruction_ids = [instruction.id for instruction in instructions]
    if instruction_ids or delete_all:
        await cleaner.run(
            instruction_ids=instruction_ids,
            runtime_scope_id=runtime_scope_id,
        )

    return embedding


@observe(capture_input=False)
async def write(
    clean: Dict[str, Any],
    writer: AsyncDocumentWriter,
) -> None:
    return await writer.run(documents=clean["documents"])


## End of Pipeline


class Instructions(BasicPipeline):
    def __init__(
        self,
        embedder_provider: EmbedderProvider,
        document_store_provider: DocumentStoreProvider,
        **kwargs,
    ) -> None:
        store = document_store_provider.get_store(dataset_name="instructions")

        self._components = {
            "cleaner": InstructionsCleaner(store),
            "embedder": embedder_provider.get_document_embedder(),
            "document_converter": InstructionsConverter(),
            "writer": AsyncDocumentWriter(
                document_store=store,
                policy=DuplicatePolicy.OVERWRITE,
            ),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Instructions Indexing")
    async def run(
        self,
        instructions: list[Instruction],
        runtime_scope_id: str = "",
        bridge_scope_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        runtime_scope_id = resolve_pipeline_runtime_scope_id(
            runtime_scope_id, bridge_scope_id=bridge_scope_id
        )
        logger.info(
            f"Runtime scope: {runtime_scope_id} Instructions Indexing pipeline is running..."
        )

        input = {
            "runtime_scope_id": runtime_scope_id,
            "instructions": instructions,
            **self._components,
        }

        return await self._pipe.execute(["write"], inputs=input)

    @observe(name="Clean Documents for Instructions")
    async def clean(
        self,
        instructions: Optional[List[Instruction]] = None,
        runtime_scope_id: Optional[str] = None,
        delete_all: bool = False,
        bridge_scope_id: Optional[str] = None,
    ) -> None:
        runtime_scope_id = resolve_pipeline_runtime_scope_id(
            runtime_scope_id, bridge_scope_id=bridge_scope_id
        )
        await clean(
            instructions=instructions or [],
            cleaner=self._components["cleaner"],
            runtime_scope_id=runtime_scope_id,
            delete_all=delete_all,
        )
