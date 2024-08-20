import argparse
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
import traceback

import eval.pipelines as pipelines
from eval.utils import parse_toml, trace_metadata
from src import utils


def formatter(prediction: dict) -> dict:
    retrieval_context = [str(context) for context in prediction["retrieval_context"]]
    context = [str(context) for context in prediction["context"]]

    return {
        "input": prediction["input"],
        "actual_output": prediction.get("actual_output", {}).get("sql", ""),
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
    def __init__(self, metrics: list, **kwargs):
        self._score_collector = {}
        self._langfuse = Langfuse()
        self._metrics = metrics
        self._failed_count = 0
        self._post_metrics = kwargs.get("post_metrics", [])

    def eval(self, meta: dict, predictions: list) -> None:
        for prediction in predictions:
            if prediction.get("type") != "shallow":
                continue

            try:
                test_case = LLMTestCase(**formatter(prediction))
                result = evaluate([test_case], self._metrics, ignore_errors=True)[0]
                self._score_metrics(test_case, result)
                [metric.collect(test_case, result) for metric in self._post_metrics]
            except Exception:
                self._failed_count += 1
                traceback.print_exc()

        self._average_score(meta)

    def _score_metrics(self, test_case: LLMTestCase, result: TestResult) -> None:
        for metric in result.metrics_data:
            name = metric.name
            score = metric.score or 0

            self._langfuse.score(
                trace_id=test_case.additional_metadata["trace_id"],
                name=name,
                value=score,
                comment=metric.reason or metric.error,
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
            metadata=trace_metadata(meta, type="summary"),
        )

        summary = {
            "query_count": meta["query_count"],
            "expected_batch_size": meta["expected_batch_size"],
            "actual_batch_size": meta["actual_batch_size"],
            "valid_eval_count": meta["actual_batch_size"] - self._failed_count,
        }
        langfuse_context.update_current_observation(output=summary)

        for name, scores in self._score_collector.items():
            langfuse_context.score_current_trace(
                name=name,
                value=sum(scores) / len(scores),
                comment=f"Average score for {name}",
            )

        for metric in self._post_metrics:
            langfuse_context.score_current_trace(
                name=metric.__name__,
                value=metric.measure(),
                comment=f"Average score for {metric.__name__}",
            )


if __name__ == "__main__":
    path = parse_args()

    dotenv.load_dotenv()
    utils.load_env_vars()

    predicted_file = parse_toml(path)
    meta = predicted_file["meta"]
    predictions = predicted_file["predictions"]

    dataset = parse_toml(meta["evaluation_dataset"])
    metrics = pipelines.metrics_initiator(meta["pipeline"], dataset["mdl"])

    evaluator = Evaluator(**metrics)
    evaluator.eval(meta, predictions)

    langfuse_context.flush()

    if meta["langfuse_url"]:
        print(
            f"\n\nYou can view the evaluation result in Langfuse at {meta['langfuse_url']}/sessions/{meta['session_id']}"
        )
