import asyncio
import logging
from typing import Any, Dict, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
import orjson
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

    def _parse_mdl(self, mdl: str) -> dict[str, Any]:
        parsed = orjson.loads(mdl)
        parsed.setdefault("models", [])
        parsed.setdefault("views", [])
        parsed.setdefault("metrics", [])
        parsed.setdefault("relationships", [])
        return parsed

    def _validate_mdl_integrity(self, mdl: dict[str, Any]) -> None:
        model_names = set()
        for model in mdl["models"]:
            model_name = model.get("name")
            if not model_name:
                raise ValueError("MDL contains a model without a name")

            normalized_model_name = model_name.lower()
            if normalized_model_name in model_names:
                raise ValueError(f'MDL contains duplicate model name "{model_name}"')
            model_names.add(normalized_model_name)

            column_names = set()
            for column in model.get("columns", []):
                column_name = column.get("name")
                if not column_name:
                    raise ValueError(
                        f'MDL model "{model_name}" contains a column without a name'
                    )

                normalized_column_name = column_name.lower()
                if normalized_column_name in column_names:
                    raise ValueError(
                        f'MDL model "{model_name}" contains duplicate column name "{column_name}"'
                    )
                column_names.add(normalized_column_name)

        for relationship in mdl["relationships"]:
            for model_name in relationship.get("models", []):
                if not model_name:
                    raise ValueError(
                        f'MDL relationship "{relationship.get("name", "")}" references an empty model name'
                    )
                if model_name.lower() not in model_names:
                    raise ValueError(
                        f'MDL relationship "{relationship.get("name", "")}" references missing model "{model_name}"'
                    )

    def _project_filter(
        self, project_id: Optional[str], *conditions: dict[str, Any]
    ) -> dict[str, Any] | None:
        all_conditions = list(conditions)
        if project_id:
            all_conditions.append(
                {"field": "project_id", "operator": "==", "value": project_id}
            )
        if not all_conditions:
            return None
        return {"operator": "AND", "conditions": all_conditions}

    async def _count_indexed_documents(
        self,
        pipeline_name: str,
        project_id: Optional[str],
        *conditions: dict[str, Any],
    ) -> int:
        pipeline = self._pipelines[pipeline_name]
        writer = pipeline._components["writer"]
        return await writer.document_store.count_documents(
            filters=self._project_filter(project_id, *conditions)
        )

    async def _validate_index_integrity(
        self, mdl: dict[str, Any], project_id: Optional[str]
    ) -> None:
        resource_count = (
            len(mdl["models"]) + len(mdl["views"]) + len(mdl["metrics"])
        )
        expected_schema_documents = len(mdl["views"]) + len(mdl["metrics"])
        for model in mdl["models"]:
            expected_schema_documents += 1
            if model.get("columns") or mdl["relationships"]:
                expected_schema_documents += 1

        schema_count, table_description_count, project_meta_count = await asyncio.gather(
            self._count_indexed_documents(
                "db_schema",
                project_id,
                {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
            ),
            self._count_indexed_documents(
                "table_description",
                project_id,
                {"field": "type", "operator": "==", "value": "TABLE_DESCRIPTION"},
            ),
            self._count_indexed_documents("project_meta", project_id),
        )

        if schema_count < expected_schema_documents:
            raise ValueError(
                "Incomplete DB schema index: "
                f"expected at least {expected_schema_documents} documents, found {schema_count}"
            )

        if table_description_count < resource_count:
            raise ValueError(
                "Incomplete table-description index: "
                f"expected at least {resource_count} documents, found {table_description_count}"
            )

        if project_meta_count < 1:
            raise ValueError("Project metadata was not indexed")

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
            mdl = self._parse_mdl(prepare_semantics_request.mdl)
            self._validate_mdl_integrity(mdl)
            logger.info(f"MDL: {prepare_semantics_request.mdl}")

            input = {
                "mdl_str": prepare_semantics_request.mdl,
                "project_id": prepare_semantics_request.project_id,
            }

            tasks = [
                self._pipelines[name].run(**input)
                for name in [
                    "db_schema",
                    "historical_question",
                    "table_description",
                    "sql_pairs",
                    "project_meta",
                ]
            ]

            await asyncio.gather(*tasks)
            await self._validate_index_integrity(
                mdl,
                prepare_semantics_request.project_id,
            )

            self._prepare_semantics_statuses[
                prepare_semantics_request.mdl_hash
            ] = SemanticsPreparationStatusResponse(
                status="finished",
            )
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

    def get_prepare_semantics_status(
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

        return result

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
