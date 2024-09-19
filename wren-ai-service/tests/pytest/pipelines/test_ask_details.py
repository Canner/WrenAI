import pytest

from src.core.engine import EngineConfig
from src.pipelines.generation import sql_breakdown
from src.utils import init_providers


@pytest.mark.asyncio
async def test_generation_pipeline_producing_executable_sqls():
    llm_provider, _, _, engine = init_providers(EngineConfig())
    generation_pipeline = sql_breakdown.SQLBreakdown(
        llm_provider=llm_provider,
        engine=engine,
    )

    candidate_sql_queries = [
        "SELECT COUNT(*) FROM book",
        "SELECT Writer FROM book ORDER BY Writer ASC NULLS FIRST",
        "SELECT Title FROM book ORDER BY Issues ASC NULLS FIRST",
        'SELECT Title FROM book WHERE Writer <> "Elaine Lee"',
        "SELECT Title, Issues FROM book",
        "SELECT Publication_Date FROM publication ORDER BY Price DESC",
        "SELECT DISTINCT Publisher FROM publication WHERE Price > 5000000",
        "SELECT Publisher FROM publication ORDER BY Price DESC LIMIT 1",
        "SELECT COUNT(DISTINCT Publication_Date) FROM publication",
        'SELECT Price FROM publication WHERE Publisher = "Person" OR Publisher = "Wiley"',
    ]

    for candidate_sql_query in candidate_sql_queries:
        assert await generation_pipeline.run(
            "",
            candidate_sql_query,
        )
