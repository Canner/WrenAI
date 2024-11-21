import argparse
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Callable, Tuple

import dotenv
import dspy
import dspy.evaluate
import dspy.teleprompt

sys.path.append(f"{Path().parent.resolve()}")
import src.utils as utils
from eval.dspy_modules.ask_generation import AskGenerationV1
from eval.utils import parse_toml


def parse_args() -> Tuple[str]:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--file",
        "-F",
        type=str,
        required=True,
        help="Eval dataset file name in the eval/dataset folder",
    )
    parser.add_argument(
        "--program_file",
        "-P",
        type=str,
        help="Optimized program file name in the eval/optimized folder",
    )
    parser.add_argument(
        "--optimize",
        action=argparse.BooleanOptionalAction,
        help="Whether to optimize the program or not",
    )
    parser.add_argument(
        "--eval",
        action=argparse.BooleanOptionalAction,
        help="Whether to evaluate the program or not based on the devset of eval dataset",
    )

    return parser.parse_args()

optimizer_parameters = {
    "evaluator": None,
    "metrics": None,
    "meta": None,
    "predictions": None
}


def configure_llm_provider(llm: str, api_key: str):
    dspy.settings.configure(lm=dspy.LM(model=llm, api_key=api_key))


def clean_sql(sql: str) -> str:
    return re.sub("[ \t\n]+", " ", sql)


def prepare_dataset(path: str, train_ratio: float = 0.5):
    eval_dataset = parse_toml(f"eval/dataset/{path}")["eval_dataset"]

    dspy_dataset = []
    for data in eval_dataset:
        dspy_dataset.append(
            dspy.Example(
                context=[str(doc["content"]) for doc in data["document"]],
                question=str(data["question"]),
                answer=clean_sql(str(data["sql"])),
            ).with_inputs("question", "context")
        )

    train_size = int(len(dspy_dataset) * train_ratio)
    _train = dspy_dataset[:train_size]
    _dev = dspy_dataset[train_size:]
    return _train, _dev


# Validation logic: check that the predicted answer is correct.
# Also check that the retrieved context does actually contain that answer.
def validate_context_and_answer(example, pred, trace=None):
    if optimizer_parameters["predictions"] is None:
        # if we don't have metric from eval module, we use the default metric
        answer_EM = dspy.evaluate.answer_exact_match(example, pred)
        answer_PM = dspy.evaluate.answer_passage_match(example, pred)
        return answer_EM and answer_PM
    else:
      prediction = optimizer_parameters["predictions"][0]
      prediction.input = example.question
      prediction.expected_output = example.answer
      prediction.context = example.context
      prediction["type"] = "shallow"
      prediction.actual_output = pred.answer
      # reuse the first predict result to optimize the dspy module
      optimizer_parameters["evaluator"].eval(optimizer_parameters["meta"], [prediction])
      sum_score = 0
      for metric in optimizer_parameters["metrics"].get("metrics"):
        sum_score += metric.score
      return sum_score

def optimize(
    module: dspy.Module,
    optimizer: dspy.teleprompt.Teleprompter,
    trainset: list,
    metric: Callable,
):
    optimizer = optimizer(metric=metric)
    return optimizer.compile(module(), trainset=trainset)


def build_optimizing_module(trainset):
    module = optimize(
            AskGenerationV1,
            dspy.teleprompt.BootstrapFewShot,
            trainset=trainset,
            metric=validate_context_and_answer,
        )
    path = f"eval/optimized/{AskGenerationV1.__name__}_optimized_{datetime.now().strftime("%Y_%m_%d_%H%M%S")}.json"
    directory = os.path.dirname(path)
    if directory and not os.path.exists(directory):
        os.makedirs(directory)
    module.save(path)
    return module


if __name__ == "__main__":
    args = parse_args()
    path = f"eval/dataset/{args.file}"
    optimized_program_file = args.program_file
    should_optimize = args.optimize
    should_eval = args.eval

    dotenv.load_dotenv()
    utils.load_env_vars()

    configure_llm_provider(
        os.getenv("GENERATION_MODEL"), os.getenv("LLM_OPENAI_API_KEY")
    )

    trainset, devset = prepare_dataset(path)

    if optimized_program_file:
        module = AskGenerationV1()
        module.load(f"eval/optimized/{optimized_program_file}")
    elif should_optimize:
        module = build_optimizing_module(trainset)
    else:
        module = AskGenerationV1()

    if should_eval:
        evaluator = dspy.evaluate.Evaluate(
            devset=devset,
            metric=validate_context_and_answer,
            display_progress=True,
            display_table=True,
            return_outputs=True,
        )

        results = evaluator(module, metric=validate_context_and_answer,display_progress=True, display_table=True, return_all_scores=True, return_outputs=True)
        for result in results:
          if isinstance(result, list):
            for item in result:
              if isinstance(item, tuple):
                if len(item) == 3:
                  print(item[0])
                  print(f"Question: {item[0].get('question')}")
                  print(f"Context: {item[0].get('context')}")
                  print(item[1])
                  print(f"Answer: {item[1].get('answer')}")
                  print(f"Context: {item[1].get('context')}")

