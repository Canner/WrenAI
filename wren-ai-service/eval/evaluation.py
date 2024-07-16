from deepeval import evaluate
from deepeval.test_case import LLMTestCase
from langfuse import Langfuse
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


if __name__ == "__main__":
    # CLI input example will be replaced by the actual input
    path = (
        "outputs/predictions/prediction_eval_3de25021-abae-44a4-aa7d-876c4a3663c6.toml"
    )

    #

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
