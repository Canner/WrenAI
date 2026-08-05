import pytest

from src.web.v1.services.semantics_preparation import (
    SemanticsPreparationService,
    SemanticsPreparationStatusRequest,
    SemanticsPreparationStatusResponse,
)


class CountPipeline:
    def __init__(self, count: int):
        self.count = count
        self.calls = []

    async def count_documents(self, project_id=None, mdl_hash=None):
        self.calls.append({"project_id": project_id, "mdl_hash": mdl_hash})
        return self.count


@pytest.mark.asyncio
async def test_prepare_semantics_status_fails_when_exact_schema_documents_are_missing():
    db_schema = CountPipeline(0)
    table_description = CountPipeline(1)
    service = SemanticsPreparationService(
        {
            "db_schema": db_schema,
            "table_description": table_description,
        }
    )
    service._prepare_semantics_statuses["deploy-1"] = SemanticsPreparationStatusResponse(
        status="finished"
    )
    service._prepare_semantics_project_ids["deploy-1"] = "project-1"

    status = await service.get_prepare_semantics_status(
        SemanticsPreparationStatusRequest(mdl_hash="deploy-1")
    )

    assert status.status == "failed"
    assert status.error.message == "Prepared schema documents are missing for this deployment"
    assert db_schema.calls == [{"project_id": "project-1", "mdl_hash": "deploy-1"}]
    assert table_description.calls == [
        {"project_id": "project-1", "mdl_hash": "deploy-1"}
    ]


@pytest.mark.asyncio
async def test_prepare_semantics_status_stays_finished_when_exact_schema_documents_exist():
    service = SemanticsPreparationService(
        {
            "db_schema": CountPipeline(1),
            "table_description": CountPipeline(1),
        }
    )
    service._prepare_semantics_statuses["deploy-1"] = SemanticsPreparationStatusResponse(
        status="finished"
    )
    service._prepare_semantics_project_ids["deploy-1"] = "project-1"

    status = await service.get_prepare_semantics_status(
        SemanticsPreparationStatusRequest(mdl_hash="deploy-1")
    )

    assert status.status == "finished"
    assert status.error is None


@pytest.mark.asyncio
async def test_prepare_semantics_status_stays_finished_when_schema_documents_exist_without_descriptions():
    service = SemanticsPreparationService(
        {
            "db_schema": CountPipeline(1),
            "table_description": CountPipeline(0),
        }
    )
    service._prepare_semantics_statuses["deploy-1"] = SemanticsPreparationStatusResponse(
        status="finished"
    )
    service._prepare_semantics_project_ids["deploy-1"] = "project-1"

    status = await service.get_prepare_semantics_status(
        SemanticsPreparationStatusRequest(mdl_hash="deploy-1")
    )

    assert status.status == "finished"
    assert status.error is None


@pytest.mark.asyncio
async def test_prepare_semantics_status_recovers_when_status_cache_is_missing():
    db_schema = CountPipeline(1)
    table_description = CountPipeline(1)
    service = SemanticsPreparationService(
        {
            "db_schema": db_schema,
            "table_description": table_description,
        }
    )

    status = await service.get_prepare_semantics_status(
        SemanticsPreparationStatusRequest(mdl_hash="deploy-1", project_id="project-1")
    )

    assert status.status == "finished"
    assert status.error is None
    assert db_schema.calls == [{"project_id": "project-1", "mdl_hash": "deploy-1"}]
    assert table_description.calls == [
        {"project_id": "project-1", "mdl_hash": "deploy-1"}
    ]
