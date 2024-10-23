import logging
from typing import Dict, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import async_timer, trace_metadata

logger = logging.getLogger("wren-ai-service")


class SemanticsPreparation:
    class Input(BaseModel):
        mdl: str
        mdl_hash: str
        project_id: Optional[str] = None
        user_id: Optional[str] = None

    class Resource(BaseModel):
        class Error(BaseModel):
            code: Literal["OTHERS"]
            message: str

        mdl_hash: str
        status: Literal["indexing", "finished", "failed"] = "indexing"
        response: Optional[dict] = None
        error: Optional[Error] = None

    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._cache: Dict[str, SemanticsPreparation.Resource] = TTLCache(maxsize=maxsize, ttl=ttl)

    @async_timer
    @observe(name="Prepare Semantics")
    @trace_metadata
    async def prepare_semantics(
        self,
        input: Input,
        **kwargs,
    ) -> Resource:
        resource = self.Resource(mdl_hash=input.mdl_hash, status="indexing")
        self._cache[input.mdl_hash] = resource

        try:
            logger.info(f"MDL: {input.mdl}")
            await self._pipelines["indexing"].run(
                mdl_str=input.mdl,
                id=input.project_id,
            )

            resource.status = "finished"
            self._cache[input.mdl_hash] = resource

        except Exception as e:
            logger.exception(f"Failed to prepare semantics: {e}")
            resource.status = "failed"
            resource.error = self.Resource.Error(
                code="OTHERS",
                message=f"Failed to prepare semantics: {e}",
            )
            self._cache[input.mdl_hash] = resource

        return resource

    def get_prepare_semantics_status(self, mdl_hash: str) -> Resource:
        if resource := self._cache.get(mdl_hash):
            return resource
        
        return self.Resource(
            mdl_hash=mdl_hash,
            status="failed",
            error=self.Resource.Error(
                code="OTHERS",
                message=f"{mdl_hash} is not found",
            ),
        )
