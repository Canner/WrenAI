import argparse
import os
import sys
from pathlib import Path
from typing import Tuple

import dotenv
from deepeval import evaluate
from deepeval.evaluate import TestResult
from deepeval.test_case import LLMTestCase
from langfuse import Langfuse
from langfuse.decorators import langfuse_context, observe

sys.path.append(f"{Path().parent.resolve()}")
from eval.metrics.column import (
    AccuracyMetric,
    AnswerRelevancyMetric,
    ContextualPrecisionMetric,
    ContextualRecallMetric,
    ContextualRelevancyMetric,
    FaithfulnessMetric,
)
from eval.utils import parse_toml
from src import utils


def formatter(prediction: dict) -> dict:
    retrieval_context = [str(context) for context in prediction["retrieval_context"]]
    context = [str(context) for context in prediction["context"]]

    return {
        "input": prediction["input"],
        "actual_output": prediction["actual_output"]["sql"],
        "expected_output": prediction["expected_output"],
        "retrieval_context": retrieval_context,
        "context": context,
        "additional_metadata": {
            "trace_id": prediction["trace_id"],
            "trace_url": prediction["trace_url"],
        },
    }


def parse_args() -> Tuple[str]:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--file",
        "-F",
        type=str,
        help="Eval the prediction result in the outputs/predictions directory",
    )
    args = parser.parse_args()
    return f"outputs/predictions/{args.file}"


class Evaluator:
    def __init__(self, metrics: list):
        self._score_collector = {}
        self._langfuse = Langfuse()
        self._metrics = metrics

    def eval(self, meta: dict, predictions: list) -> None:
        for prediction in predictions:
            if prediction.get("type") != "shallow":
                continue

            test_case = LLMTestCase(**formatter(prediction))
            result = evaluate([test_case], self._metrics)[0]
            self._score_metrics(test_case, result)

        self._average_score(meta)

    def _score_metrics(self, test_case: LLMTestCase, result: TestResult) -> None:
        for metric in result.metrics_metadata:
            name = metric.metric
            score = metric.score

            self._langfuse.score(
                trace_id=test_case.additional_metadata["trace_id"],
                name=name,
                value=score,
                comment=metric.reason,
                source="eval",
            )

            if name not in self._score_collector:
                self._score_collector[name] = []

            self._score_collector[name].append(score)

    @observe(name="Summary Trace", capture_input=False, capture_output=False)
    def _average_score(self, meta: dict) -> None:
        langfuse_context.update_current_trace(
            session_id=meta["session_id"],
            user_id=meta["user_id"],
            metadata={
                "commit": meta["commit"],
                "dataset_id": meta["dataset_id"],
            },
        )

        summary = {
            "query_count": meta["query_count"],
        }

        for name, scores in self._score_collector.items():
            langfuse_context.score_current_trace(
                name=name,
                value=sum(scores) / len(scores),
                comment=f"Average score for {name}",
            )
            summary[name] = {
                "batch_size": len(scores),
            }

        langfuse_context.update_current_observation(
            output=summary,
        )


def metrics_initiator(mdl: dict) -> list:
    engine_config = {
        "mdl_json": mdl,
        "api_endpoint": os.getenv("WREN_ENGINE_ENDPOINT"),
        "timeout": 10,
    }

    return [
        AccuracyMetric(
            engine_config={
                "api_endpoint": os.getenv("WREN_IBIS_ENDPOINT"),
                "data_source": "bigquery",
                "mdl_json": mdl,
                "connection_info": {
                    "project_id": os.getenv("bigquery.project-id"),
                    "dataset_id": os.getenv("bigquery.dataset-id"),
                    "credentials": os.getenv("bigquery.credentials-key"),
                },
                "timeout": 10,
                "limit": 10,
            }
        ),
        AnswerRelevancyMetric(engine_config),
        FaithfulnessMetric(engine_config),
        ContextualRecallMetric(engine_config),
        ContextualRelevancyMetric(),
        ContextualPrecisionMetric(),
    ]


if __name__ == "__main__":
    path = parse_args()

    dotenv.load_dotenv()
    utils.load_env_vars()

    predicted_file = parse_toml(path)
    meta = predicted_file["meta"]
    predictions = predicted_file["predictions"]

    dataset = parse_toml(meta["evaluation_dataset"])
    metrics = metrics_initiator(dataset["mdl"])

    evaluator = Evaluator(metrics)
    evaluator.eval(meta, predictions)

    langfuse_context.flush()
