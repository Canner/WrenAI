import json

import orjson
import pytest

from src.pipelines.generation.followup_sql_generation import FollowUpSQLGeneration
from src.pipelines.generation.sql_correction import SQLCorrection
from src.pipelines.generation.sql_generation import SQLGeneration
from src.pipelines.retrieval.retrieval import Retrieval
from src.web.v1.services import Configuration
from src.web.v1.services.ask import AskHistory
from src.web.v1.services.ask_details import SQLBreakdown

GLOBAL_DATA = {
    "contexts": None,
}


@pytest.fixture
def mdl_str():
    with open("tests/data/book_2_mdl.json", "r") as f:
        return orjson.dumps(json.load(f)).decode("utf-8")


@pytest.fixture
def pipeline_components():
    from src.config import settings
    from src.providers import generate_components

    return generate_components(settings.components)


@pytest.mark.skip(
    reason="Temporarily disabled as it depends on vector store and other tests"
)
@pytest.mark.asyncio
async def test_retrieval_pipeline(pipeline_components):
    retrieval_pipeline = Retrieval(**pipeline_components["db_schema_retrieval"])

    retrieval_result = await retrieval_pipeline.run(
        "How many books are there?",
    )

    assert retrieval_result is not None
    assert len(retrieval_result["construct_retrieval_results"]) > 0

    GLOBAL_DATA["contexts"] = retrieval_result["construct_retrieval_results"]


@pytest.mark.skip(
    reason="Temporarily disabled as it depends on vector store and other tests"
)
@pytest.mark.asyncio
async def test_generation_pipeline():
    generation_pipeline = SQLGeneration(**pipeline_components["sql_generation"])
    generation_result = await generation_pipeline.run(
        "How many authors are there?",
        contexts=GLOBAL_DATA["contexts"],
        configuration=Configuration(),
    )

    # TODO: we'll refactor almost all test case with a mock server, thus temporarily only assert it is not None.
    assert generation_result["post_process"]["valid_generation_results"] is not None
    assert generation_result["post_process"]["invalid_generation_results"] is not None

    generation_result = await generation_pipeline.run(
        "How many authors are there?",
        contexts=GLOBAL_DATA["contexts"],
        configuration=Configuration(),
    )

    assert generation_result["post_process"]["valid_generation_results"] is not None
    assert generation_result["post_process"]["invalid_generation_results"] is not None


@pytest.mark.skip(
    reason="Temporarily disabled as it depends on vector store and other tests"
)
@pytest.mark.asyncio
async def test_followup_generation_pipeline():
    generation_pipeline = FollowUpSQLGeneration(
        **pipeline_components["followup_sql_generation"]
    )
    generation_result = await generation_pipeline.run(
        "What are names of the books?",
        contexts=GLOBAL_DATA["contexts"],
        history=AskHistory(
            sql="SELECT COUNT(*) FROM book",
            summary="Retrieve the number of books",
            steps=[
                SQLBreakdown(
                    sql="SELECT COUNT(*) FROM book",
                    summary="Retrieve the number of books",
                    cte_name="",
                )
            ],
        ),
        configuration=Configuration(),
    )

    # TODO: we'll refactor almost all test case with a mock server, thus temporarily only assert it is not None.
    assert generation_result["post_process"]["valid_generation_results"] is not None
    assert generation_result["post_process"]["invalid_generation_results"] is not None


@pytest.mark.skip(
    reason="Temporarily disabled as it depends on vector store and other tests"
)
@pytest.mark.asyncio
async def test_sql_correction_pipeline():
    sql_correction_pipeline = SQLCorrection(**pipeline_components["sql_correction"])

    sql_correction_result = await sql_correction_pipeline.run(
        contexts=GLOBAL_DATA["contexts"],
        invalid_generation_results=[
            {
                "sql": "Select count(*) from books",
                "summary": "Retrieve the number of books",
                "error": 'ERROR:  com.google.cloud.bigquery.BigQueryException: Table "books" must be qualified with a dataset (e.g. dataset.table).',
            }
        ],
    )

    assert isinstance(
        sql_correction_result["post_process"]["valid_generation_results"], list
    )
    assert isinstance(
        sql_correction_result["post_process"]["invalid_generation_results"], list
    )
