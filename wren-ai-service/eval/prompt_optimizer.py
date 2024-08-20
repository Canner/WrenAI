import argparse
import os
import re
import sys
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
        help="Eval dataset file name in the eval/dataset folder",
    )
    args = parser.parse_args()
    return f"eval/dataset/{args.file}"


def configure_llm_provider(llm: str, api_key: str):
    dspy.settings.configure(lm=dspy.OpenAI(model=llm, api_key=api_key))


def clean_sql(sql: str) -> str:
    return re.sub("[ \t\n]+", " ", sql)


def prepare_dataset(path: str, train_ratio: float = 0.5):
    eval_dataset = parse_toml(path)["eval_dataset"]

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
    answer_EM = dspy.evaluate.answer_exact_match(example, pred)
    answer_PM = dspy.evaluate.answer_passage_match(example, pred)
    return answer_EM and answer_PM


def optimize(
    module: dspy.Module,
    teleprompter: dspy.teleprompt.Teleprompter,
    trainset: list,
    validation_logic: Callable = validate_context_and_answer,
):
    teleprompter = teleprompter(metric=validation_logic)
    return teleprompter.compile(module(), trainset=trainset)


if __name__ == "__main__":
    path = parse_args()

    dotenv.load_dotenv()
    utils.load_env_vars()

    configure_llm_provider(
        os.getenv("GENERATION_MODEL"), os.getenv("LLM_OPENAI_API_KEY")
    )

    trainset, devset = prepare_dataset(path)

    optimized_module = optimize(
        AskGenerationV1,
        dspy.teleprompt.BootstrapFewShot,
        trainset=trainset,
    )

    print(optimized_module)
