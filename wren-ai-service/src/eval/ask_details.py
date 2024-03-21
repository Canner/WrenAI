import json
import os

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
        f"WITH {step['cte_name']} AS ({step['sql']})\n"
        if step["cte_name"]
        else step["sql"]
        for step in steps
    )


if __name__ == "__main__":
    load_env_vars()
    _prepare_ask_details_eval_data(
        input_path="./data/baseball_1_data.json",
        output_path="./data/ask_details/baseball_1_eval_context.json",
    )

    # todo: implement the following steps
    #    2. implement the evaluation pipeline
    #      a. implement with ragas evaluator
    #      b. according to the evaluation result to run the CTE query to ensure it is equal to the input query
    #    3. aggregate the evaluation result and generate the evaluation report

    # read the evaluation data
    # with open("./data/ask_details/baseball_1_eval_context.json") as f:
    #     eval_context = json.load(f)
    #
    # pipeline = Generation(
    #     generator=init_generator(),
    # )
    #
    # for i, element in enumerate(eval_context):
    #     if i > 0:  # todo: remove the limit after the process is stable
    #         break
    #     response = pipeline.run(
    #         sql=element["input"]["sql"],
    #     )
    #     output = json.loads(response["generator"]["replies"][0])
    #
    #     # build the CTE query from response steps
    #     steps = output["steps"]
    #     print(steps)

    from haystack import Pipeline
    from haystack_integrations.components.evaluators.ragas import (
        RagasEvaluator,
        RagasMetric,
    )

    pipeline = Pipeline()
    evaluator_context = RagasEvaluator(
        metric=RagasMetric.CONTEXT_PRECISION,
    )
    pipeline.add_component("evaluator_context", evaluator_context)

    QUESTIONS = [
        "Which is the most popular global sport?",
        "Who created the Python language?",
    ]
    CONTEXTS = [
        [
            "The popularity of sports can be measured in various ways, including TV viewership, social media presence, number of participants, and economic impact. Football is undoubtedly the world's most popular sport with major events like the FIFA World Cup and sports personalities like Ronaldo and Messi, drawing a followership of more than 4 billion people."
        ],
        [
            "Python, created by Guido van Rossum in the late 1980s, is a high-level general-purpose programming language. Its design philosophy emphasizes code readability, and its language constructs aim to help programmers write clear, logical code for both small and large-scale software projects."
        ],
    ]
    GROUND_TRUTHS = [
        "Football is the most popular sport",
        "Python language was created by Guido van Rossum.",
    ]
    results = pipeline.run(
        {
            "evaluator_context": {
                "questions": QUESTIONS,
                "contexts": CONTEXTS,
                "ground_truths": GROUND_TRUTHS,
            },
        }
    )
    print(results)
    pass
