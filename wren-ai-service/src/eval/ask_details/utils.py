import json
import os
import time
from typing import Any, Dict

from haystack import Pipeline
from haystack.components.generators import OpenAIGenerator
from haystack_integrations.components.evaluators.ragas import (
    RagasEvaluator,
    RagasMetric,
)

from src.eval.utils import get_generation_model_pricing
from src.pipelines.ask_details.generation_pipeline import Generation
from src.utils import init_providers


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

    llm_provider, _ = init_providers()
    generation_pipeline = Generation(
        generator=llm_provider.get_generator(),
    )

    def _generate_data(input: dict):
        response = generation_pipeline.run(
            sql=input["answer"],
        )

        output = json.loads(response["generator"]["replies"][0])

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
                "execution_correct": False,
                "llm_judge": {
                    "explanation": "",
                    "score": 0.0,
                },
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
        res = pipeline.run(
            sql=self._result["question"]["sql"],
        )
        self._result["latency"] = time.perf_counter() - start

        (response, meta) = self._destruct(res)

        self._result["response"] = response
        self._result["model"] = meta["model"]
        self._result["usage"] = meta["usage"]

        self._cost_analysis()
        self._ragas_eval()
        self._execution_correctness_eval()
        self._llm_judge()

    def _destruct(self, response: Dict[str, Any]):
        return (
            response["post_processor"]["results"],
            response["ask_details_generator"]["meta"][0],
        )

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
        steps = self._result["response"]["steps"]

        self._result["accuracy"]["wren"]["execution_correct"] = True if steps else False

    def _llm_judge(self):
        prompt = f"""
        **Task:** As a Judge with expertise in data analysis and SQL statement evaluation,
        you are tasked with assessing the quality of candidate SQL statements generated from natural language queries.
        Your evaluation will be based on a comparison with a ground truth description,
        focusing on the accuracy and fidelity of the candidate SQL in representing the user's intent.

        **Ground Truth Response:** [{self._result["ground_truth"]}]

        **Candidate SQL Response:** [{self._result["response"]}]

        **Evaluation Criteria:**

        1. **Accuracy of Representation:** Assess how accurately the candidate SQL captures the essence and
        specifics of the ground truth response. Consider the structure, selection of columns,
        and conditions specified in the candidate SQL.

        2. **Fidelity to User Intent:** Determine the degree to which the candidate SQL aligns
        with the original user intent as described by the ground truth. Pay special attention to
        any potential deviations that could affect the outcome of the query, such as incorrect filters,
        missing joins, or aggregation errors.

        3. **Execution Feasibility:** Evaluate the candidate SQL's feasibility of execution
        within a real database environment. Consider syntax correctness, reference to valid table/column names,
        and adherence to SQL best practices.

        4. **Score Assignment:** Based on your evaluation, assign a score from 0 to 3, where:
           - **3 = Perfect Match:** The candidate SQL perfectly aligns with the user's intent.
           - **2 = Good Match:** There are minor discrepancies that do not significantly alter the result.
           - **1 = Partial Match:** The candidate SQL captures part of the user's intent but misses key elements.
           - **0 = No Match:** The candidate SQL fails to represent the user's intent.

        **Evaluation Output:**

        Please provide your assessment in the following JSON dictionary format:
        {{
          "E": "Explanation of how the candidate SQL matches the user intent.
                Highlight both the strengths and weaknesses observed during the evaluation,
                providing specific examples from the SQL statement to support your analysis.",
          "S": "Numerical score indicating the level of match with the user intent (0-3)."
        }}

        **Your Expertise:** Remember, your role as a Judge in this scenario is pivotal.
        Your expertise not only helps in evaluating the fidelity of SQL statements to user intent
        but also guides improvements in the generation process.
        Your detailed feedback is invaluable for refining the RAG pipeline's accuracy and efficiency.
        """

        client = OpenAIGenerator()
        response = client.run(prompt=prompt)
        reply = json.loads(response["replies"][0])

        self._result["accuracy"]["wren"]["llm_judge"] = {
            "explanation": reply["E"],
            "score": float(reply["S"]),
        }

    def result(self) -> Dict[str, Any]:
        return self._result


class Summary:
    _accuracy = {
        "ragas": {
            "answer_correctness": 0.0,
        },
        "wren": {
            "execution_correct": {
                True: 0,
                False: 0,
            },
            "llm_judge": 0.0,
        },
    }
    _latency = 0.0
    _cost = 0.0
    _collection = []

    def append(self, collector: Collector):
        result = collector.result()
        self._accuracy["ragas"]["answer_correctness"] += result["accuracy"]["ragas"][
            "answer_correctness"
        ]
        self._accuracy["wren"]["execution_correct"][
            result["accuracy"]["wren"]["execution_correct"]
        ] += 1
        self._accuracy["wren"]["llm_judge"] += result["accuracy"]["wren"]["llm_judge"][
            "score"
        ]
        self._latency += result["latency"]
        self._cost += result["cost"]
        self._collection.append(result)

    def generate(self):
        total = len(self._collection)
        accuracy_ragas = self._accuracy["ragas"]["answer_correctness"] / total
        execution_correct = self._accuracy["wren"]["execution_correct"]
        llm_judge = self._accuracy["wren"]["llm_judge"] / total
        latency = self._latency / total
        cost = self._cost / total

        return {
            "total": total,
            "accuracy": {
                "ragas": {"answer_correctness": accuracy_ragas},
                "wren": {
                    "execution_correct": execution_correct,
                    "llm_judge": llm_judge,
                },
            },
            "latency": latency,
            "cost": cost,
            "collection": self._collection,
        }
