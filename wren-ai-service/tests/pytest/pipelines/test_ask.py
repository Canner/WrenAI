import json

import orjson
import pytest

from src.core.pipeline import async_validate
from src.core.provider import DocumentStoreProvider, LLMProvider
from src.pipelines.ask.followup_generation import FollowUpGeneration
from src.pipelines.ask.generation import Generation
from src.pipelines.ask.indexing import Indexing
from src.pipelines.ask.query_understanding import QueryUnderstanding
from src.pipelines.ask.retrieval import Retrieval
from src.pipelines.ask.sql_correction import SQLCorrection
from src.utils import init_providers
from src.web.v1.services.ask import AskRequest, AskResultResponse, SQLExplanation

GLOBAL_DATA = {
    "contexts": None,
}


@pytest.fixture
def mdl_str():
    with open("tests/data/book_2_mdl.json", "r") as f:
        return orjson.dumps(json.load(f)).decode("utf-8")


@pytest.fixture
def mdl_structure():
    with open("tests/data/book_2_mdl.json", "r") as f:
        mdl_dict = json.load(f)
        return {
            model["name"]: {column["name"] for column in model["columns"]}
            for model in mdl_dict["models"]
        }


@pytest.fixture
def llm_provider():
    llm_provider, _ = init_providers()

    return llm_provider


@pytest.fixture
def document_store_provider():
    _, document_store_provider = init_providers()

    return document_store_provider


def test_clear_documents(mdl_str: str):
    llm_provider, document_store_provider = init_providers()
    store = document_store_provider.get_store()

    indexing_pipeline = Indexing(
        llm_provider=llm_provider,
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
    llm_provider: LLMProvider,
    document_store_provider: DocumentStoreProvider,
):
    indexing_pipeline = Indexing(
        llm_provider=llm_provider,
        document_store_provider=document_store_provider,
    )

    async_validate(lambda: indexing_pipeline.run(mdl_str))

    assert document_store_provider.get_store().count_documents() == 3
    assert (
        document_store_provider.get_store(
            dataset_name="view_questions"
        ).count_documents()
        == 1
    )


def test_query_understanding_pipeline():
    llm_provider, _ = init_providers()
    pipeline = QueryUnderstanding(llm_provider=llm_provider)

    assert async_validate(lambda: pipeline.run("How many books are there?"))[
        "post_process"
    ]["is_valid_query"]
    assert not async_validate(lambda: pipeline.run("fds dsio me"))["post_process"][
        "is_valid_query"
    ]


def test_retrieval_pipeline(
    llm_provider: LLMProvider,
    document_store_provider: DocumentStoreProvider,
):
    retrieval_pipeline = Retrieval(
        llm_provider=llm_provider,
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
    llm_provider, _ = init_providers()
    generation_pipeline = Generation(llm_provider=llm_provider)
    generation_result = async_validate(
        lambda: generation_pipeline.run(
            "How many authors are there?",
            contexts=GLOBAL_DATA["contexts"],
            exclude=[],
        )
    )

    assert AskResultResponse.AskResult(
        **generation_result["post_process"]["valid_generation_results"][0]
    )

    generation_result = async_validate(
        lambda: generation_pipeline.run(
            "How many authors are there?",
            contexts=GLOBAL_DATA["contexts"],
            exclude=[{"statement": "SELECT 1 FROM author"}],
        )
    )

    assert AskResultResponse.AskResult(
        **generation_result["post_process"]["valid_generation_results"][0]
    )


def test_followup_generation_pipeline():
    llm_provider, _ = init_providers()
    generation_pipeline = FollowUpGeneration(llm_provider=llm_provider)
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

    assert AskResultResponse.AskResult(
        **generation_result["post_process"]["valid_generation_results"][0]
    )


def test_sql_correction_pipeline(mdl_structure: dict):
    llm_provider, _ = init_providers()
    sql_correction_pipeline = SQLCorrection(
        llm_provider=llm_provider,
    )

    sql_correction_result = async_validate(
        lambda: sql_correction_pipeline.run(
            contexts=GLOBAL_DATA["contexts"],
            mdl_structure=mdl_structure,
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
