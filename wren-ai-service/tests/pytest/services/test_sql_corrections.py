import pytest

from src.web.v1.services.sql_corrections import SqlCorrectionService

DEPLOYED_ORDER_MODEL = "deployed_order_model"
DEPLOYED_SHIP_COUNTRY = "ShipCountry"
DEPLOYED_SELECTED_DDL = (
    f"CREATE TABLE {DEPLOYED_ORDER_MODEL} ({DEPLOYED_SHIP_COUNTRY} VARCHAR)"
)
DEPLOYED_COUNT_SQL = f"SELECT COUNT(*) FROM {DEPLOYED_ORDER_MODEL}"
DEPLOYED_PREVIEW_SQL = f"SELECT * FROM {DEPLOYED_ORDER_MODEL}"


class _CapturingRetrievalPipeline:
    def __init__(self):
        self.calls = []

    async def run(self, **kwargs):
        self.calls.append(kwargs)
        return {
            "construct_retrieval_results": {
                "retrieval_results": [
                    {
                        "table_name": DEPLOYED_ORDER_MODEL,
                        "table_ddl": DEPLOYED_SELECTED_DDL,
                    }
                ]
            }
        }


class _CapturingSqlCorrectionPipeline:
    def __init__(self):
        self.calls = []

    async def run(self, **kwargs):
        self.calls.append(kwargs)
        return {
            "post_process": {
                "valid_generation_result": {"sql": DEPLOYED_COUNT_SQL},
                "invalid_generation_result": {},
            }
        }


@pytest.mark.asyncio
async def test_sql_correction_retrieves_ddl_context_and_preserves_mdl_hash():
    retrieval = _CapturingRetrievalPipeline()
    correction = _CapturingSqlCorrectionPipeline()
    service = SqlCorrectionService(
        {
            "db_schema_retrieval": retrieval,
            "sql_correction": correction,
        },
        allow_sql_knowledge_retrieval=False,
    )

    request = SqlCorrectionService.CorrectionRequest(
        event_id="event-1",
        sql=DEPLOYED_PREVIEW_SQL,
        error="dry run failed",
        retrieved_tables=[DEPLOYED_ORDER_MODEL],
        mdl_hash="deploy-hash",
    )

    await service.correct(request)

    assert retrieval.calls[0]["tables"] == [DEPLOYED_ORDER_MODEL]
    assert retrieval.calls[0]["mdl_hash"] == "deploy-hash"
    assert correction.calls[0]["contexts"] == [DEPLOYED_SELECTED_DDL]
    assert correction.calls[0]["mdl_hash"] == "deploy-hash"
