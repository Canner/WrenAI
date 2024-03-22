import json
import os
import time
from typing import Any, Dict

from haystack import Pipeline
from haystack_integrations.components.evaluators.ragas import (
    RagasEvaluator,
    RagasMetric,
)

from src.pipelines.ask_details.components.generator import init_generator
from src.pipelines.ask_details.generation_pipeline import Generation
from src.utils import load_env_vars


def _prepare_ask_details_eval_data(input_path: str, output_path: str):
    """
    This function prepares the evaluation data for the ask_details pipeline.
    However, the initial data will be produced by the pipeline itself. So, the file have to be reviewed and corrected
    manually.
    """

    if os.path.exists(output_path):
        print(
            f"File {output_path} already exists. Skipping generation of evaluation data."
        )
        return

    generation_pipeline = Generation(
        generator=init_generator(),
    )

    def _generate_data(input: dict):
        response = generation_pipeline.run(
            sql=input["answer"],
        )

        output = json.loads(response["generator"]["replies"][0])
        # consider to add a LLM judge to review the output
        print(output)
        return {
            "input": {
                "query": input["question"],
                "sql": input["answer"],
                "summary": None,
            },
            "output": output,
        }

    with open(input_path) as f:
        eval_context = [_generate_data(json.loads(line)) for line in f]

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    with open(output_path, "w") as f:
        json.dump(eval_context, f)


def _build_cte_query(steps) -> str:
    return "".join(
        (
            f"WITH {step['cte_name']} AS ({step['sql']})\n"
            if step["cte_name"]
            else step["sql"]
        )
        for step in steps
    )


def _prepare_ragas_eval_pipeline() -> Pipeline:
    pipeline = Pipeline()
    evaluator_context = RagasEvaluator(
        metric=RagasMetric.ANSWER_CORRECTNESS,
        metric_params={
            "weights": (0.5, 0.5),
        },
    )
    pipeline.add_component("evaluator_context", evaluator_context)
    return pipeline


class Collector:
    _result = {
        "accuracy": {
            "ragas": 0.0,
        },
        "token": 0,
        "cost": 0.0,
        "latency": 0.0,
    }

    def __init__(self, element: Dict[str, Any]):
        self._element = element
        self._ragas_eval_pipeline = _prepare_ragas_eval_pipeline()

    def eval(self, pipeline: Pipeline):
        start = time.perf_counter()
        self._response = pipeline.run(
            sql=self._element["input"]["sql"],
        )
        self._result["latency"] = time.perf_counter() - start
        self._run_ragas_eval()

    def _run_ragas_eval(self):
        replies = self._response["generator"]["replies"]
        meta = self._response["generator"]["meta"]
        print(replies)
        print(meta)

        results = self._ragas_eval_pipeline.run(
            {
                "evaluator_context": {
                    "questions": [self._element["input"]["sql"]],
                    "responses": [str(json.loads(replies[0]))],
                    "ground_truths": [str(self._element["output"])],
                },
            }
        )
        print(results)


if __name__ == "__main__":
    load_env_vars()
    _prepare_ask_details_eval_data(
        input_path="./data/baseball_1_data.json",
        output_path="./data/ask_details/baseball_1_eval_context.json",
    )

    # read the evaluation data
    eval_context = None
    with open("./data/ask_details/baseball_1_eval_context_1.json") as f:
        eval_context = json.load(f)

    collectors = [Collector(element=element) for element in eval_context]

    pipeline = Generation(
        generator=init_generator(),
    )

    for collector in collectors:
        collector.eval(pipeline)

# todo: r1: compare the cte query with the the correct answer

# todo: r2: connect wren-engine to compare the result
# r3: if the result is the subset of the answer, then the answer is correct

# todo: LLM judge to review the output and give it a score from 0 to 1

# todo: generate the report for the evaluation process
# the report includes the following information:
# - average accuracy, cost, and latency
# - the evaluation result for each question
#   - is the answer correct?
#   - display the input query
#   - disopay the output answer
#   - (optional) why the answer is correct or incorrect)
# - save the report to a file
