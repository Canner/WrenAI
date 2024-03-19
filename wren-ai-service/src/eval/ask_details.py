# todo: implement the following steps
#    2. implement the evaluation pipeline
#      a. implement with ragas evaluator
#      b. according to the evaluation result to run the CTE query to ensure it is equal to the input query
#    3. aggregate the evaluation result and generate the evaluation report
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

    generator = init_generator()
    generation_pipeline = Generation(
        generator=generator,
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


if __name__ == "__main__":
    load_env_vars()
    _prepare_ask_details_eval_data(
        input_path="./data/baseball_1_data.json",
        output_path="./data/ask_details/baseball_1_eval_context.json",
    )

    # pipeline = Pipeline()
    # evaluator = RagasEvaluator(
    #     metric=RagasMetric.CONTEXT_RELEVANCY,
    # )
    # pipeline.add_component("evaluator", evaluator)
    #
    # results = pipeline.run(
    #     {
    #         "evaluator": {
    #             "questions": [
    #                 "When was the Rhodes Statue built?",
    #                 "Where is the Pyramid of Giza?",
    #             ],
    #             "contexts": [["Context for question 1"], ["Context for question 2"]],
    #         }
    #     }
    # )
    #
    # print(results)
    pass
