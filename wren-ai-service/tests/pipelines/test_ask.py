import json
from typing import Any

import pytest
from haystack.document_stores.types import DocumentStore

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
def document_store():
    _, document_store_provider = init_providers()

    return document_store_provider.get_store(dataset_name="book_2")


@pytest.fixture
def view_store():
    _, document_store_provider = init_providers()

    return document_store_provider.get_store(dataset_name="view_questions")


def test_indexing_pipeline(
    mdl_str: str,
    llm_provider: LLMProvider,
    document_store: DocumentStore,
    view_store: DocumentStore,
):
    indexing_pipeline = Indexing(
        ddl_store=document_store,
        document_embedder=llm_provider.get_document_embedder(),
        view_store=view_store,
    )

    indexing_pipeline.run(mdl_str)

    assert document_store.count_documents() == 3
    assert view_store.count_documents() == 1


def test_clear_documents(mdl_str: str):
    llm_provider, document_store_provider = init_providers()
    store = document_store_provider.get_store(
        dataset_name="test_clear_documents",
        recreate_index=True,
    )

    indexing_pipeline = Indexing(
        ddl_store=store,
        document_embedder=llm_provider.get_document_embedder(),
        view_store=store,
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


def test_query_understanding_pipeline():
    llm_provider, _ = init_providers()
    query_understanding_pipeline = QueryUnderstanding(
        generator=llm_provider.get_generator(),
    )

    assert query_understanding_pipeline.run("How many books are there?")[
        "post_processor"
    ]["is_valid_query"]
    assert query_understanding_pipeline.run("select * from books")["post_processor"][
        "is_valid_query"
    ]
    assert not query_understanding_pipeline.run("i am cool")["post_processor"][
        "is_valid_query"
    ]
    assert not query_understanding_pipeline.run("fds dsio me")["post_processor"][
        "is_valid_query"
    ]


def test_retrieval_pipeline(document_store: Any):
    llm_provider, document_store_provider = init_providers()
    retrieval_pipeline = Retrieval(
        embedder=llm_provider.get_text_embedder(),
        retriever=document_store_provider.get_retriever(
            document_store=document_store,
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
