import pytest

from src.web.v1.services.schema_context import RetrievedSchemaContext
from src.web.v1.services.sql_corrections import SqlCorrectionService

DEPLOYED_ORDER_MODEL = "deployed_order_model"
DEPLOYED_SHIP_COUNTRY = "ShipCountry"
DEPLOYED_ORDER_DATE = "OrderDate"
DEPLOYED_SELECTED_DDL = (
    f"CREATE TABLE {DEPLOYED_ORDER_MODEL} ({DEPLOYED_SHIP_COUNTRY} VARCHAR)"
)
DEPLOYED_UNPRUNED_DDL = (
    f"CREATE TABLE {DEPLOYED_ORDER_MODEL} "
    f"({DEPLOYED_SHIP_COUNTRY} VARCHAR, {DEPLOYED_ORDER_DATE} TIMESTAMP)"
)
DEPLOYED_SELECTED_GROUNDING = (
    f'- model/table: "{DEPLOYED_ORDER_MODEL}"\n'
    "  columns:\n"
    f'    - "{DEPLOYED_SHIP_COUNTRY}"'
)
DEPLOYED_COUNT_SQL = f"SELECT COUNT(*) FROM {DEPLOYED_ORDER_MODEL}"
DEPLOYED_PREVIEW_SQL = f"SELECT * FROM {DEPLOYED_ORDER_MODEL}"
LEGACY_RETRIEVED_TABLE = "raw_user_word"


class _FailingRetrievalPipeline:
    async def run(self, **_):
        raise AssertionError("db_schema_retrieval should not run with exact context")


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
async def test_sql_correction_uses_exact_retrieved_schema_context_without_reretrieval():
    correction = _CapturingSqlCorrectionPipeline()
    service = SqlCorrectionService(
        {
            "db_schema_retrieval": _FailingRetrievalPipeline(),
            "sql_correction": correction,
        },
        allow_sql_knowledge_retrieval=False,
    )
    schema_context = RetrievedSchemaContext(
        documents=[
            {
                "table_name": DEPLOYED_ORDER_MODEL,
                "table_ddl": DEPLOYED_SELECTED_DDL,
                "unpruned_table_ddl": DEPLOYED_UNPRUNED_DDL,
                "column_names": [DEPLOYED_SHIP_COUNTRY],
                "manifest_column_names": [
                    DEPLOYED_SHIP_COUNTRY,
                    DEPLOYED_ORDER_DATE,
                ],
                "relationship_constraints": [],
            }
        ],
        table_names=[DEPLOYED_ORDER_MODEL],
        contexts=[DEPLOYED_SELECTED_DDL],
        unpruned_contexts=[DEPLOYED_UNPRUNED_DDL],
        grounding=DEPLOYED_SELECTED_GROUNDING,
    )

    request = SqlCorrectionService.CorrectionRequest(
        event_id="event-1",
        sql=DEPLOYED_PREVIEW_SQL,
        error="dry run failed",
        retrieved_tables=[LEGACY_RETRIEVED_TABLE],
        retrieved_schema_context=schema_context,
    )

    await service.correct(request)

    assert correction.calls[0]["contexts"] == schema_context.sql_generation_contexts
    assert correction.calls[0]["schema_grounding"] == schema_context.grounding
