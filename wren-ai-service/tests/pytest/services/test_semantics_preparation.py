import pytest

from src.web.v1.services.semantics_preparation import (
    SemanticsPreparationRequest,
    SemanticsPreparationService,
)


class _RecordingPipeline:
    def __init__(self):
        self.run_calls = []

    async def run(self, **kwargs):
        self.run_calls.append(kwargs)


@pytest.mark.asyncio
async def test_prepare_semantics_reindexes_default_sql_pairs_after_cleanup():
    pipelines = {
        name: _RecordingPipeline()
        for name in [
            "db_schema",
            "historical_question",
            "table_description",
            "project_meta",
            "sql_pairs",
        ]
    }
    service = SemanticsPreparationService(pipelines)

    await service.prepare_semantics(
        SemanticsPreparationRequest(
            mdl='{"models": []}',
            mdl_hash="mdl-hash",
            project_id="project-id",
        )
    )

    assert pipelines["sql_pairs"].run_calls == [
        {
            "mdl_str": '{"models": []}',
            "project_id": "project-id",
            "delete_all": True,
        }
    ]
