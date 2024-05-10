import json
from typing import Any

import pytest
from haystack_integrations.document_stores.qdrant import QdrantDocumentStore

from src.pipelines.ask.components.document_store import init_document_store
from src.pipelines.ask.components.embedder import init_embedder
from src.pipelines.ask.components.generator import init_generator
from src.pipelines.ask.components.retriever import init_retriever
from src.pipelines.ask.followup_generation_pipeline import FollowUpGeneration
from src.pipelines.ask.generation_pipeline import Generation
from src.pipelines.ask.indexing_pipeline import Indexing
from src.pipelines.ask.query_understanding_pipeline import QueryUnderstanding
from src.pipelines.ask.retrieval_pipeline import Retrieval
from src.pipelines.ask.sql_correction_pipeline import SQLCorrection
from src.web.v1.services.ask import AskRequest, AskResultResponse, SQLExplanation

GLOBAL_DATA = {
    "contexts": None,
}


@pytest.fixture
def mdl_str():
    with open("tests/data/book_2_mdl.json", "r") as f:
        return json.dumps(json.load(f))


@pytest.fixture
def document_store():
    return init_document_store(dataset_name="book_2")


@pytest.fixture
def view_store():
    return init_document_store(dataset_name="view_questions")


def test_indexing_pipeline(mdl_str: str, document_store: Any, view_store: Any):
    indexing_pipeline = Indexing(
        ddl_store=document_store,
        view_store=view_store,
    )

    indexing_pipeline.run(mdl_str)

    assert document_store.count_documents() == 3
    assert view_store.count_documents() == 1


def test_clear_documents(mdl_str: str):
    store = QdrantDocumentStore(
        ":memory:",
        index="test_clear_documents",
        embedding_dim=3072,
        recreate_index=True,
        return_embedding=True,
        wait_result_from_api=True,
    )

    indexing_pipeline = Indexing(
        ddl_store=store,
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
    query_understanding_pipeline = QueryUnderstanding(
        generator=init_generator(),
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
    retrieval_pipeline = Retrieval(
        embedder=init_embedder(),
        retriever=init_retriever(document_store=document_store),
    )

    retrieval_result = retrieval_pipeline.run(
        "How many books are there?",
    )

    assert retrieval_result is not None
    assert len(retrieval_result["retriever"]["documents"]) > 0

    GLOBAL_DATA["contexts"] = retrieval_result["retriever"]["documents"]


def test_generation_pipeline():
    generation_pipeline = Generation(
        generator=init_generator(),
    )
    generation_result = generation_pipeline.run(
        "How many authors are there?",
        contexts=GLOBAL_DATA["contexts"],
    )

    assert AskResultResponse.AskResult(
        **generation_result["post_processor"]["valid_generation_results"][0]
    )


def test_followup_generation_pipeline():
    generation_pipeline = FollowUpGeneration(
        generator=init_generator(),
    )
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

    print(generation_result)

    assert AskResultResponse.AskResult(
        **generation_result["post_processor"]["valid_generation_results"][0]
    )


def test_sql_correction_pipeline():
    sql_correction_pipeline = SQLCorrection(
        generator=init_generator(),
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
