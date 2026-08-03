import asyncio
import logging
from typing import Dict, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import AliasChoices, BaseModel, Field

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import BaseRequest

logger = logging.getLogger("wren-ai-service")


# POST /v1/semantics-preparations
class SemanticsPreparationRequest(BaseRequest):
    mdl: str
    # don't recommend to use id as a field name, but it's used in the API spec
    # so we need to support as a choice, and will remove it in the future
    mdl_hash: str = Field(validation_alias=AliasChoices("mdl_hash", "id"))


class SemanticsPreparationResponse(BaseModel):
    # don't recommend to use id as a field name, but it's used in the API spec
    # so we need to support as a choice, and will remove it in the future
    mdl_hash: str = Field(serialization_alias="id")


# GET /v1/semantics-preparations/{mdl_hash}/status
class SemanticsPreparationStatusRequest(BaseModel):
    # don't recommend to use id as a field name, but it's used in the API spec
    # so we need to support as a choice, and will remove it in the future
    mdl_hash: str = Field(validation_alias=AliasChoices("mdl_hash", "id"))


class SemanticsPreparationStatusResponse(BaseModel):
    class SemanticsPreparationError(BaseModel):
        code: Literal["OTHERS"]
        message: str

    status: Literal["indexing", "finished", "failed"]
    error: Optional[SemanticsPreparationError] = None


class SemanticsPreparationService:
    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._prepare_semantics_statuses: Dict[
            str, SemanticsPreparationStatusResponse
        ] = TTLCache(maxsize=maxsize, ttl=ttl)
        self._prepare_semantics_project_ids: Dict[str, str] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )

    @observe(name="Prepare Semantics")
    @trace_metadata
    async def prepare_semantics(
        self,
        prepare_semantics_request: SemanticsPreparationRequest,
        **kwargs,
    ):
        results = {
            "metadata": {
                "error_type": "",
                "error_message": "",
                "request_from": prepare_semantics_request.request_from,
            },
        }

        try:
            logger.info(f"MDL: {prepare_semantics_request.mdl}")

            input = {
                "mdl_str": prepare_semantics_request.mdl,
                "project_id": prepare_semantics_request.project_id,
                "mdl_hash": prepare_semantics_request.mdl_hash,
            }
            project_scoped_index_names = [
                "db_schema",
                "historical_question",
                "table_description",
                "sql_pairs",
                "project_meta",
            ]

            await asyncio.gather(
                *[
                    self._pipelines[name].clean(
                        project_id=prepare_semantics_request.project_id,
                        delete_all=True,
                    )
                    if name == "sql_pairs"
                    else self._pipelines[name].clean(
                        project_id=prepare_semantics_request.project_id
                    )
                    for name in project_scoped_index_names
                ]
            )

            tasks = [
                self._pipelines[name].run(**input)
                for name in project_scoped_index_names
            ]

            await asyncio.gather(*tasks)

            if not await self._has_indexed_schema_documents(
                prepare_semantics_request.project_id,
                prepare_semantics_request.mdl_hash,
            ):
                raise RuntimeError(
                    "No indexed schema documents were found for the prepared deployment"
                )

            self._prepare_semantics_statuses[
                prepare_semantics_request.mdl_hash
            ] = SemanticsPreparationStatusResponse(
                status="finished",
            )
            self._prepare_semantics_project_ids[
                prepare_semantics_request.mdl_hash
            ] = prepare_semantics_request.project_id or ""
        except Exception as e:
            logger.exception(f"Failed to prepare semantics: {e}")

            self._prepare_semantics_statuses[
                prepare_semantics_request.mdl_hash
            ] = SemanticsPreparationStatusResponse(
                status="failed",
                error=SemanticsPreparationStatusResponse.SemanticsPreparationError(
                    code="OTHERS",
                    message=f"Failed to prepare semantics: {e}",
                ),
            )

            results["metadata"]["error_type"] = "INDEXING_FAILED"
            results["metadata"]["error_message"] = str(e)

        return results

    async def _has_indexed_schema_documents(
        self,
        project_id: str,
        mdl_hash: str,
    ) -> bool:
        dbschema_count, table_description_count = await asyncio.gather(
            self._pipelines["db_schema"].count_documents(
                project_id=project_id,
                mdl_hash=mdl_hash,
            ),
            self._pipelines["table_description"].count_documents(
                project_id=project_id,
                mdl_hash=mdl_hash,
            ),
        )
        return dbschema_count > 0 and table_description_count > 0

    async def get_prepare_semantics_status(
        self, prepare_semantics_status_request: SemanticsPreparationStatusRequest
    ) -> SemanticsPreparationStatusResponse:
        if (
            result := self._prepare_semantics_statuses.get(
                prepare_semantics_status_request.mdl_hash
            )
        ) is None:
            logger.exception(
                f"id is not found for SemanticsPreparation: {prepare_semantics_status_request.mdl_hash}"
            )
            return SemanticsPreparationStatusResponse(
                status="failed",
                error=SemanticsPreparationStatusResponse.SemanticsPreparationError(
                    code="OTHERS",
                    message="{prepare_semantics_status_request.id} is not found",
                ),
            )

        if result.status != "finished":
            return result

        project_id = self._prepare_semantics_project_ids.get(
            prepare_semantics_status_request.mdl_hash
        )
        if project_id is None:
            return result

        if await self._has_indexed_schema_documents(
            project_id,
            prepare_semantics_status_request.mdl_hash,
        ):
            return result

        return SemanticsPreparationStatusResponse(
            status="failed",
            error=SemanticsPreparationStatusResponse.SemanticsPreparationError(
                code="OTHERS",
                message="Prepared schema documents are missing for this deployment",
            ),
        )

    @observe(name="Delete Semantics Documents")
    @trace_metadata
    async def delete_semantics(self, project_id: str, **kwargs):
        logger.info(f"Project ID: {project_id}, Deleting semantics documents...")

        tasks = [
            self._pipelines[name].clean(project_id=project_id)
            for name in [
                "db_schema",
                "historical_question",
                "table_description",
                "project_meta",
            ]
        ] + [
            self._pipelines[name].clean(
                project_id=project_id,
                delete_all=True,
            )
            for name in ["sql_pairs", "instructions"]
        ]

        await asyncio.gather(*tasks)
