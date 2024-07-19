import json

import orjson
import pytest

from src.core.pipeline import async_validate
from src.core.provider import DocumentStoreProvider, EmbedderProvider
from src.pipelines.ask.followup_generation import FollowUpGeneration
from src.pipelines.ask.generation import Generation
from src.pipelines.ask.retrieval import Retrieval
from src.pipelines.ask.sql_correction import SQLCorrection
from src.pipelines.indexing.indexing import Indexing
from src.utils import EngineConfig, init_providers
from src.web.v1.services.ask import AskRequest, SQLExplanation

GLOBAL_DATA = {
    "contexts": None,
}


@pytest.fixture
def mdl_str():
    with open("tests/data/book_2_mdl.json", "r") as f:
        return orjson.dumps(json.load(f)).decode("utf-8")


@pytest.fixture
def llm_provider():
    llm_provider, _, _, _ = init_providers(EngineConfig(provider="wren_ui", config={}))

    return llm_provider


@pytest.fixture
def embedder_provider():
    _, embedder_provider, _, _ = init_providers(
        EngineConfig(provider="wren_ui", config={})
    )

    return embedder_provider


@pytest.fixture
def document_store_provider():
    _, _, document_store_provider, _ = init_providers(
        EngineConfig(provider="wren_ui", config={})
    )

    return document_store_provider


def test_clear_documents(mdl_str: str):
    _, embedder_provider, document_store_provider, _ = init_providers(
        EngineConfig(provider="wren_ui", config={})
    )
    store = document_store_provider.get_store()

    indexing_pipeline = Indexing(
        embedder_provider=embedder_provider,
        document_store_provider=document_store_provider,
    )

    async_validate(lambda: indexing_pipeline.run(mdl_str))

    assert store.count_documents() == 3

    async_validate(
        lambda: indexing_pipeline.run(
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
    )

    assert store.count_documents() == 1


def test_indexing_pipeline(
    mdl_str: str,
    embedder_provider: EmbedderProvider,
    document_store_provider: DocumentStoreProvider,
):
    indexing_pipeline = Indexing(
        embedder_provider=embedder_provider,
        document_store_provider=document_store_provider,
    )

    async_validate(lambda: indexing_pipeline.run(mdl_str))

    assert document_store_provider.get_store().count_documents() == 3
    assert (
        document_store_provider.get_store(
            dataset_name="view_questions",
        ).count_documents()
        == 1
    )


def test_retrieval_pipeline(
    embedder_provider: EmbedderProvider,
    document_store_provider: DocumentStoreProvider,
):
    retrieval_pipeline = Retrieval(
        embedder_provider=embedder_provider,
        document_store_provider=document_store_provider,
    )

    retrieval_result = async_validate(
        lambda: retrieval_pipeline.run(
            "How many books are there?",
        )
    )

    assert retrieval_result is not None
    assert len(retrieval_result["retrieval"]["documents"]) > 0

    GLOBAL_DATA["contexts"] = retrieval_result["retrieval"]["documents"]


def test_generation_pipeline():
    llm_provider, _, _, engine = init_providers(
        EngineConfig(provider="wren_ui", config={})
    )
    generation_pipeline = Generation(llm_provider=llm_provider, engine=engine)
    generation_result = async_validate(
        lambda: generation_pipeline.run(
            "How many authors are there?",
            contexts=GLOBAL_DATA["contexts"],
            exclude=[],
        )
    )

    # todo: we'll refactor almost all test case with a mock server, thus temporarily only assert it is not None.
    assert generation_result["post_process"]["valid_generation_results"] is not None
    assert generation_result["post_process"]["invalid_generation_results"] is not None

    generation_result = async_validate(
        lambda: generation_pipeline.run(
            "How many authors are there?",
            contexts=GLOBAL_DATA["contexts"],
            exclude=[{"statement": "SELECT 1 FROM author"}],
        )
    )

    assert generation_result["post_process"]["valid_generation_results"] is not None
    assert generation_result["post_process"]["invalid_generation_results"] is not None


def test_followup_generation_pipeline():
    llm_provider, _, _, engine = init_providers(
        EngineConfig(provider="wren_ui", config={})
    )
    generation_pipeline = FollowUpGeneration(llm_provider=llm_provider, engine=engine)
    generation_result = async_validate(
        lambda: generation_pipeline.run(
            "What are names of the books?",
            contexts=GLOBAL_DATA["contexts"],
            history=AskRequest.AskResponseDetails(
                sql="SELECT COUNT(*) FROM book",
                summary="Retrieve the number of books",
                steps=[
                    SQLExplanation(
                        sql="SELECT COUNT(*) FROM book",
                        summary="Retrieve the number of books",
                        cte_name="",
                    )
                ],
            ),
        )
    )

    # todo: we'll refactor almost all test case with a mock server, thus temporarily only assert it is not None.
    assert generation_result["post_process"]["valid_generation_results"] is not None
    assert generation_result["post_process"]["invalid_generation_results"] is not None


def test_sql_correction_pipeline():
    llm_provider, _, _, engine = init_providers(
        EngineConfig(provider="wren_ui", config={})
    )
    sql_correction_pipeline = SQLCorrection(llm_provider=llm_provider, engine=engine)

    sql_correction_result = async_validate(
        lambda: sql_correction_pipeline.run(
            contexts=GLOBAL_DATA["contexts"],
            invalid_generation_results=[
                {
                    "sql": "Select count(*) from books",
                    "summary": "Retrieve the number of books",
                    "error": 'ERROR:  com.google.cloud.bigquery.BigQueryException: Table "books" must be qualified with a dataset (e.g. dataset.table).',
                }
            ],
        )
    )

    assert isinstance(
        sql_correction_result["post_process"]["valid_generation_results"], list
    )
    assert isinstance(
        sql_correction_result["post_process"]["invalid_generation_results"], list
    )
