import argparse
from typing import Tuple

from deepeval import evaluate
from deepeval.test_case import LLMTestCase
from langfuse import Langfuse
from langfuse.decorators import langfuse_context
from tomlkit import parse

from eval.metrics.example import ExampleMetric
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


def score_metrics(test_case, result, langfuse_client) -> None:
    for metric in result.metrics_metadata:
        langfuse_client.score(
            trace_id=test_case.additional_metadata["trace_id"],
            name=metric.metric,
            value=metric.score,
            comment=metric.reason,
        )


def parse_args() -> Tuple[str]:
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", "-P", type=str, help="Path to eval the prediction")
    args = parser.parse_args()
    return f"outputs/predictions/{args.path}"


if __name__ == "__main__":
    path = parse_args()
    utils.load_env_vars()

    predicted_file = parse(open(path).read())
    meta = predicted_file["meta"]
    predictions = predicted_file["predictions"]

    langfuse_client = Langfuse()
    metrics = [ExampleMetric()]
    for prediction in predictions:
        test_case = LLMTestCase(**formatter(prediction))
        result = evaluate([test_case], metrics)[0]
        score_metrics(test_case, result, langfuse_client)

    langfuse_context.flush()
