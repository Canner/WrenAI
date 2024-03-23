import json
from typing import Any

import pytest

from src.pipelines.ask.components.document_store import init_document_store
from src.pipelines.ask.components.embedder import init_embedder
from src.pipelines.ask.components.generator import init_generator
from src.pipelines.ask.components.retriever import init_retriever
from src.pipelines.ask.generation_pipeline import Generation
from src.pipelines.ask.indexing_pipeline import Indexing
from src.pipelines.ask.retrieval_pipeline import Retrieval
from src.pipelines.ask.sql_correction_pipeline import SQLCorrection
from src.web.v1.services.ask import AskResultResponse

from ..conftest import ValueStorage


@pytest.fixture
def mdl_str():
    with open("tests/data/book_2_mdl.json", "r") as f:
        return json.dumps(json.load(f))


@pytest.fixture
def document_store():
    return init_document_store(dataset_name="book_2")


def test_indexing_pipeline(mdl_str: str, document_store: Any):
    indexing_pipeline = Indexing(
        document_store=document_store,
    )

    indexing_pipeline.run(mdl_str)

    assert document_store.count_documents() == 2


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

    ValueStorage.contexts = retrieval_result["retriever"]["documents"]


def test_generation_pipeline():
    generation_pipeline = Generation(
        text_to_sql_generator=init_generator(),
    )
    generation_result = generation_pipeline.run(
        "How many authors are there?",
        contexts=ValueStorage.contexts,
    )

    assert AskResultResponse.AskResult(
        **generation_result["post_processor"]["valid_generation_results"][0]
    )


def test_sql_correction_pipeline():
    sql_correction_pipeline = SQLCorrection(
        sql_correction_generator=init_generator(),
    )

    sql_correction_result = sql_correction_pipeline.run(
        contexts=ValueStorage.contexts,
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
