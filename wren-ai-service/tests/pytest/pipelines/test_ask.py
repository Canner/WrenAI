import json

import orjson
import pytest

from src.core.engine import EngineConfig
from src.core.provider import DocumentStoreProvider, EmbedderProvider, LLMProvider
from src.pipelines.generation.followup_sql_generation import FollowUpSQLGeneration
from src.pipelines.generation.sql_correction import SQLCorrection
from src.pipelines.generation.sql_generation import SQLGeneration
from src.pipelines.indexing.indexing import Indexing
from src.pipelines.retrieval.retrieval import Retrieval
from src.utils import init_providers
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
def llm_provider():
    llm_provider, _, _, _ = init_providers(EngineConfig())

    return llm_provider


@pytest.fixture
def embedder_provider():
    _, embedder_provider, _, _ = init_providers(EngineConfig())

    return embedder_provider


@pytest.fixture
def document_store_provider():
    _, _, document_store_provider, _ = init_providers(EngineConfig())

    return document_store_provider


@pytest.mark.asyncio
async def test_clear_documents(mdl_str: str):
    _, embedder_provider, document_store_provider, _ = init_providers(EngineConfig())
    store = document_store_provider.get_store()

    indexing_pipeline = Indexing(
        embedder_provider=embedder_provider,
        document_store_provider=document_store_provider,
    )

    await indexing_pipeline.run(mdl_str)

    assert await store.count_documents() == 5

    await indexing_pipeline.run(
        """
        {
            "models": [],
            "relationships": [],
            "metrics": [],
            "views": [
                {
                    "name": "book",
                    "statement": "SELECT * FROM book",
                    "properties": {
                        "question": "How many books are there?",
                        "description": "Retrieve the number of books"
                    }
                }
            ]
        }
        """
    )

    assert await store.count_documents() == 1


@pytest.mark.asyncio
async def test_indexing_pipeline(
    mdl_str: str,
    embedder_provider: EmbedderProvider,
    document_store_provider: DocumentStoreProvider,
):
    indexing_pipeline = Indexing(
        embedder_provider=embedder_provider,
        document_store_provider=document_store_provider,
    )

    await indexing_pipeline.run(mdl_str)

    assert await document_store_provider.get_store().count_documents() == 5
    assert (
        await document_store_provider.get_store(
            dataset_name="view_questions",
        ).count_documents()
        == 1
    )


@pytest.mark.asyncio
async def test_retrieval_pipeline(
    llm_provider: LLMProvider,
    embedder_provider: EmbedderProvider,
    document_store_provider: DocumentStoreProvider,
):
    retrieval_pipeline = Retrieval(
        llm_provider=llm_provider,
        embedder_provider=embedder_provider,
        document_store_provider=document_store_provider,
    )

    retrieval_result = await retrieval_pipeline.run(
        "How many books are there?",
    )

    assert retrieval_result is not None
    assert len(retrieval_result["construct_retrieval_results"]) > 0

    GLOBAL_DATA["contexts"] = retrieval_result["construct_retrieval_results"]


@pytest.mark.asyncio
async def test_generation_pipeline():
    llm_provider, _, _, engine = init_providers(EngineConfig())
    generation_pipeline = SQLGeneration(llm_provider=llm_provider, engine=engine)
    generation_result = await generation_pipeline.run(
        "How many authors are there?",
        contexts=GLOBAL_DATA["contexts"],
        exclude=[],
    )

    # TODO: we'll refactor almost all test case with a mock server, thus temporarily only assert it is not None.
    assert generation_result["post_process"]["valid_generation_results"] is not None
    assert generation_result["post_process"]["invalid_generation_results"] is not None

    generation_result = await generation_pipeline.run(
        "How many authors are there?",
        contexts=GLOBAL_DATA["contexts"],
        exclude=[{"statement": "SELECT 1 FROM author"}],
    )

    assert generation_result["post_process"]["valid_generation_results"] is not None
    assert generation_result["post_process"]["invalid_generation_results"] is not None


@pytest.mark.asyncio
async def test_followup_generation_pipeline():
    llm_provider, _, _, engine = init_providers(EngineConfig())
    generation_pipeline = FollowUpSQLGeneration(
        llm_provider=llm_provider, engine=engine
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
    )

    # TODO: we'll refactor almost all test case with a mock server, thus temporarily only assert it is not None.
    assert generation_result["post_process"]["valid_generation_results"] is not None
    assert generation_result["post_process"]["invalid_generation_results"] is not None


@pytest.mark.asyncio
async def test_sql_correction_pipeline():
    llm_provider, _, _, engine = init_providers(EngineConfig())
    sql_correction_pipeline = SQLCorrection(llm_provider=llm_provider, engine=engine)

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
