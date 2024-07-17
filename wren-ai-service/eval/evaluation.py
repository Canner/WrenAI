import argparse
import sys
from pathlib import Path
from typing import Tuple

from deepeval import evaluate
from deepeval.test_case import LLMTestCase
from langfuse import Langfuse
from langfuse.decorators import langfuse_context, observe
from tomlkit import parse

from eval.metrics.example import ExampleMetric

sys.path.append(f"{Path().parent.resolve()}")
from src import utils


def formatter(prediction: dict) -> dict:
    actual_output = str(prediction["actual_output"].get("post_process", {}))
    retrieval_context = [str(context) for context in prediction["retrieval_context"]]
    return {
        "input": prediction["input"],
        "actual_output": actual_output,
        "expected_output": prediction["expected_output"],
        "retrieval_context": retrieval_context,
        "context": prediction["context"],
        "additional_metadata": {
            "trace_id": prediction["trace_id"],
            "trace_url": prediction["trace_url"],
        },
    }


def parse_args() -> Tuple[str]:
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", "-P", type=str, help="Path to eval the prediction")
    args = parser.parse_args()
    return f"outputs/predictions/{args.path}"


class Evaluator:
    def __init__(self, metrics: list):
        self._score_collector = {}
        self._langfuse = Langfuse()
        self._metrics = metrics

    def eval(self, meta: dict, predictions: list) -> None:
        for prediction in predictions:
            test_case = LLMTestCase(**formatter(prediction))
            result = evaluate([test_case], self._metrics)[0]
            self._score_metrics(test_case, result)

        self._average_score(meta)

    def _score_metrics(self, test_case, result) -> None:
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

    def _average_score(self, meta: dict) -> None:
        @observe(name="Average Score", capture_input=False, capture_output=False)
        def wrapper():
            langfuse_context.update_current_trace(
                session_id=meta["session_id"],
                user_id=meta["user_id"],
            )

            for name, scores in self._score_collector.items():
                langfuse_context.score_current_trace(
                    name=name,
                    value=sum(scores) / len(scores),
                    comment=f"Average score for {name}",
                )

        wrapper()


if __name__ == "__main__":
    path = parse_args()
    utils.load_env_vars()

    predicted_file = parse(open(path).read())
    meta = predicted_file["meta"]
    predictions = predicted_file["predictions"]

    evaluator = Evaluator([ExampleMetric()])
    evaluator.eval(meta, predictions)

    langfuse_context.flush()
