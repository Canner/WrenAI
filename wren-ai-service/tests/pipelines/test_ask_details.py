from src.pipelines.ask_details.generation_pipeline import Generation
from src.utils import init_providers
from src.web.v1.services.ask_details import (
    AskDetailsResultResponse,
)


def test_generation_pipeline_producing_executable_sqls():
    llm_provider, _ = init_providers()
    generation_pipeline = Generation(
        llm_provider=llm_provider,
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
        generation_result = generation_pipeline.run(
            candidate_sql_query,
        )

        assert AskDetailsResultResponse.AskDetailsResponseDetails(
            **generation_result["post_processor"]["results"]
        )
