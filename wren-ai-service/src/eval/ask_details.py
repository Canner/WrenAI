import json
import os
import time
from typing import Any, Dict

from haystack import Pipeline
from haystack_integrations.components.evaluators.ragas import (
    RagasEvaluator,
    RagasMetric,
)

from src.eval.utils import get_generation_model_pricing
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
            f"File {
            output_path} already exists. Skipping generation of evaluation data."
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
            "ragas": {
                "answer_correctness": 0.0,
            },
            "wren": {
                # todo: r2: connect wren-engine to compare the result
                "execution_correct": False,
                # r3: if the result is the subset of the answer, then the answer is correct
                # todo: LLM judge to review the output and give it a score from 0 to 1
                "llm_judge": 0.0,
            },
        },
        "latency": 0.0,
        "cost": 0.0,
        "model": None,
        "usage": {},
        "question": {},
        "response": {},
        "ground_truth": {},
    }

    def __init__(self, element: Dict[str, Any]):
        self._result["question"] = element["input"]
        self._result["ground_truth"] = element["output"]
        self._ragas_eval_pipeline = _prepare_ragas_eval_pipeline()

    def eval(self, pipeline: Pipeline):
        start = time.perf_counter()
        response = pipeline.run(
            sql=self._result["question"]["sql"],
        )
        self._result["latency"] = time.perf_counter() - start
        self._result["response"] = json.loads(response["generator"]["replies"][0])

        meta = response["generator"]["meta"][0]
        self._result["model"] = meta["model"]
        self._result["usage"] = meta["usage"]
        self._cost_analysis()

        self._ragas_eval()
        self._execution_correctness_eval()
        self._llm_judge()

    def _cost_analysis(self):
        model_pricing = get_generation_model_pricing(self._result["model"])
        prompt_cost = (
            model_pricing["prompt_tokens"] * self._result["usage"]["prompt_tokens"]
        )
        completion_cost = (
            model_pricing["completion_tokens"]
            * self._result["usage"]["completion_tokens"]
        )

        self._result["cost"] = prompt_cost + completion_cost

    def _ragas_eval(self):
        response = self._ragas_eval_pipeline.run(
            {
                "evaluator_context": {
                    "questions": [self._result["question"]["sql"]],
                    "responses": [str(self._result["response"])],
                    "ground_truths": [str(self._result["ground_truth"])],
                },
            }
        )
        results = response["evaluator_context"]["results"]
        score = results[0][0]["score"]

        self._result["accuracy"]["ragas"]["answer_correctness"] = score

    def _execution_correctness_eval(self):
        self.result["accuracy"]["wren"]["execution_correct"] = False

    def _llm_judge(self):
        self.result["accuracy"]["wren"]["llm_judge"] = 0.0

    def result(self) -> Dict[str, Any]:
        return self._result


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

    # todo: generate the report for the evaluation process
    # the report includes the following information:
    # - average accuracy, cost, and latency
    # - the evaluation result for each question
    #   - is the answer correct?
    #   - display the input query
    #   - disopay the output answer
    #   - (optional) why the answer is correct or incorrect)
    for collector in collectors:
        collector.eval(pipeline)
        result = collector.result()
        print(result)
