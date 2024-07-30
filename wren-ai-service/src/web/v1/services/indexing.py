import logging
from typing import Literal, Optional

from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import async_timer, trace_metadata

logger = logging.getLogger("wren-ai-service")


# POST /v1/semantics-preparations
class SemanticsPreparationRequest(BaseModel):
    mdl: str
    deploy_id: str  # deployment id
    project_id: Optional[str] = None


class SemanticsPreparationResponse(BaseModel):
    id: str


# GET /v1/semantics-preparations/{task_id}/status
class SemanticsPreparationStatusRequest(BaseModel):
    id: str


class SemanticsPreparationStatusResponse(BaseModel):
    class SemanticsPreparationError(BaseModel):
        code: Literal["OTHERS"]
        message: str

    status: Literal["indexing", "finished", "failed"]
    error: Optional[SemanticsPreparationError] = None


class IndexingService:
    def __init__(
        self,
        pipelines: dict[str, BasicPipeline],
    ):
        self._pipelines = pipelines
        self._prepare_semantics_statuses = {}

    @async_timer
    @observe(name="Prepare Semantics")
    @trace_metadata
    async def prepare_semantics(
        self, prepare_semantics_request: SemanticsPreparationRequest
    ):
        try:
            logger.info(f"MDL: {prepare_semantics_request.mdl}")
            await self._pipelines["indexing"].run(prepare_semantics_request.mdl)

            self._prepare_semantics_statuses[
                prepare_semantics_request.deploy_id
            ] = SemanticsPreparationStatusResponse(
                status="finished",
            )
        except Exception as e:
            logger.exception(f"ask pipeline - Failed to prepare semantics: {e}")

            self._prepare_semantics_statuses[
                prepare_semantics_request.deploy_id
            ] = SemanticsPreparationStatusResponse(
                status="failed",
                error=f"Failed to prepare semantics: {e}",
            )

    def get_prepare_semantics_status(
        self, prepare_semantics_status_request: SemanticsPreparationStatusRequest
    ) -> SemanticsPreparationStatusResponse:
        if (
            result := self._prepare_semantics_statuses.get(
                prepare_semantics_status_request.id
            )
        ) is None:
            logger.exception(
                f"ask pipeline - id is not found for SemanticsPreparation: {prepare_semantics_status_request.id}"
            )
            return SemanticsPreparationStatusResponse(
                status="failed",
                error=SemanticsPreparationStatusResponse.SemanticsPreparationError(
                    code="OTHERS",
                    message="{prepare_semantics_status_request.id} is not found",
                ),
            )

        return result
