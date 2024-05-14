import json

import pytest

from src.core.document_store_provider import DocumentStoreProvider
from src.core.llm_provider import LLMProvider
from src.pipelines.ask.followup_generation_pipeline import FollowUpGeneration
from src.pipelines.ask.generation_pipeline import Generation
from src.pipelines.ask.indexing_pipeline import Indexing
from src.pipelines.ask.query_understanding_pipeline import QueryUnderstanding
from src.pipelines.ask.retrieval_pipeline import Retrieval
from src.pipelines.ask.sql_correction_pipeline import SQLCorrection
from src.utils import init_providers
from src.web.v1.services.ask import AskRequest, AskResultResponse, SQLExplanation

GLOBAL_DATA = {
    "contexts": None,
}


@pytest.fixture
def mdl_str():
    with open("tests/data/book_2_mdl.json", "r") as f:
        return json.dumps(json.load(f))


@pytest.fixture
def llm_provider():
    llm_provider, _ = init_providers()

    return llm_provider


@pytest.fixture
def store_provider():
    _, store_provider = init_providers()

    return store_provider


def test_clear_documents(mdl_str: str):
    llm_provider, document_store_provider = init_providers()
    store = document_store_provider.get_store()

    indexing_pipeline = Indexing(
        llm_provider=llm_provider,
        store_provider=document_store_provider,
    )

    indexing_pipeline.run(mdl_str)
    assert store.count_documents() == 3

    indexing_pipeline.run(
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
    assert store.count_documents() == 1


def test_indexing_pipeline(
    mdl_str: str,
    llm_provider: LLMProvider,
    store_provider: DocumentStoreProvider,
):
    indexing_pipeline = Indexing(
        llm_provider=llm_provider,
        store_provider=store_provider,
    )

    indexing_pipeline.run(mdl_str)

    assert store_provider.get_store().count_documents() == 3
    assert (
        store_provider.get_store(dataset_name="view_questions").count_documents() == 1
    )


def test_query_understanding_pipeline():
    llm_provider, _ = init_providers()
    query_understanding_pipeline = QueryUnderstanding(
        generator=llm_provider.get_generator(),
    )

    assert query_understanding_pipeline.run("How many books are there?")[
        "post_processor"
    ]["is_valid_query"]
    assert not query_understanding_pipeline.run("fds dsio me")["post_processor"][
        "is_valid_query"
    ]


def test_retrieval_pipeline(
    llm_provider: LLMProvider,
    store_provider: DocumentStoreProvider,
):
    retrieval_pipeline = Retrieval(
        embedder=llm_provider.get_text_embedder(),
        retriever=store_provider.get_retriever(
            document_store=store_provider.get_store(),
        ),
    )

    retrieval_result = retrieval_pipeline.run(
        "How many books are there?",
    )

    assert retrieval_result is not None
    assert len(retrieval_result["retriever"]["documents"]) > 0

    GLOBAL_DATA["contexts"] = retrieval_result["retriever"]["documents"]


def test_generation_pipeline():
    llm_provider, _ = init_providers()
    generation_pipeline = Generation(generator=llm_provider.get_generator())
    generation_result = generation_pipeline.run(
        "How many authors are there?",
        contexts=GLOBAL_DATA["contexts"],
    )

    assert AskResultResponse.AskResult(
        **generation_result["post_processor"]["valid_generation_results"][0]
    )


def test_followup_generation_pipeline():
    llm_provider, _ = init_providers()
    generation_pipeline = FollowUpGeneration(generator=llm_provider.get_generator())
    generation_result = generation_pipeline.run(
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

    assert AskResultResponse.AskResult(
        **generation_result["post_processor"]["valid_generation_results"][0]
    )


def test_sql_correction_pipeline():
    llm_provider, _ = init_providers()
    sql_correction_pipeline = SQLCorrection(
        generator=llm_provider.get_generator(),
    )

    sql_correction_result = sql_correction_pipeline.run(
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
        sql_correction_result["post_processor"]["valid_generation_results"], list
    )
    assert isinstance(
        sql_correction_result["post_processor"]["invalid_generation_results"], list
    )
