import sys
from pathlib import Path

import pandas as pd
import pytest
from aioresponses import aioresponses
from deepeval.test_case import LLMTestCase

sys.path.append(f"{Path().parent.resolve()}")
from eval.metrics import (
    AccuracyMetric,
    AnswerRelevancyMetric,
    ContextualPrecisionMetric,
    ContextualRecallMetric,
    ContextualRelevancyMetric,
    FaithfulnessMetric,
)


@pytest.fixture
def engine_config():
    return {
        "mdl_json": {},
        "api_endpoint": "http://example.com/endpoint",
        "timeout": 10,
    }


@pytest.fixture
def test_case():
    return LLMTestCase(
        input="This is a test case",
        actual_output="select foo, boo from t",
        expected_output="select foo, boo from t",
        context=["t.foo", "t.boo"],
        retrieval_context=["t.foo", "t.boo"],
        additional_metadata={},
    )


@pytest.fixture
def mocker():
    with aioresponses() as m:
        yield m


def _success_analysis_sql(m, engine_config, repeat=1):
    for _ in range(repeat):
        m.get(
            f"{engine_config['api_endpoint']}/v2/analysis/sql",
            payload=[
                {
                    "selectItems": [
                        {
                            "exprSources": [
                                {"sourceDataset": "t", "sourceColumn": "foo"},
                                {"sourceDataset": "t", "sourceColumn": "boo"},
                            ]
                        }
                    ]
                }
            ],
        )


def _success_retrive_data(m, ibis_config, repeat=1):
    df = pd.DataFrame({"foo": ["a", "b"], "boo": [1, 2]}).to_dict(orient="split")
    for _ in range(repeat):
        m.post(
            f"{ibis_config['api_endpoint']}/v2/connector/{ibis_config['data_source']}/query?limit={ibis_config['limit']}",
            payload={
                "data": df.get("data"),
                "columns": df.get("columns"),
            },
        )


def test_accuracy_metric(test_case, mocker):
    ibis_config = {
        "api_endpoint": "http://example.com/endpoint",
        "data_source": "bigquery",
        "mdl_json": {},
        "connection_info": {
            "project_id": "fake-id",
            "dataset_id": "fake-id",
            "credentials": "fake-credentials",
        },
        "timeout": 10,
        "limit": 10,
    }
    _success_retrive_data(mocker, ibis_config, 2)

    metric = AccuracyMetric(ibis_config)
    metric.measure(test_case)
    assert metric.is_successful()
    assert metric.score == 1.0


def test_answer_relevancy_metric(engine_config, test_case, mocker):
    _success_analysis_sql(mocker, engine_config, 2)

    metric = AnswerRelevancyMetric(engine_config)
    metric.measure(test_case)
    assert metric.is_successful()
    assert metric.score == 1.0


def test_faithfulness_metric(engine_config, test_case, mocker):
    _success_analysis_sql(mocker, engine_config)

    metric = FaithfulnessMetric(engine_config)
    metric.measure(test_case)
    assert metric.is_successful()
    assert metric.score == 1.0


def test_contextual_relevancy_metric(test_case):
    metric = ContextualRelevancyMetric()
    metric.measure(test_case)
    assert metric.is_successful()
    assert metric.score == 1.0


def test_contextual_recall_metric(engine_config, test_case, mocker):
    _success_analysis_sql(mocker, engine_config)

    metric = ContextualRecallMetric(engine_config)
    metric.measure(test_case)
    assert metric.is_successful()
    assert metric.score == 1.0


def test_contextual_precision_metric(test_case):
    metric = ContextualPrecisionMetric()
    metric.measure(test_case)
    assert metric.is_successful()
    assert metric.score == 1.0
