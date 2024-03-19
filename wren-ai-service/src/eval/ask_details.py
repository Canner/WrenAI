# todo: implement the following steps
#    1. generate the evaluation data from any data in the spider dataset
#      a. convert the input(query, answer) to the the ask details input as following
#         {
#           "description": <SHORT_SQL_QUERY_DESCRIPTION>,
#           "steps: [{
#               "sql": <SQL_QUERY_STRING>,
#               "summary": <SUMMARY_STRING>,
#               "cte_name": <CTE_NAME_STRING>
#           }] # list of steps
#         }
#      b. review the result to make sure these evaluation data are correct and make sense
#    2. implement the evaluation pipeline
#      a. implement with ragas evaluator
#      b. according to the evaluation result to run the CTE query to ensure it is equal to the input query
#    3. aggregate the evaluation result and generate the evaluation report
import json
import os

from src.utils import load_env_vars


def _prepare_ask_details_eval_data():
    with open("./data/baseball_1_data.json") as f:
        inputs = [json.loads(line) for line in f]

    eval_context = [
        {
            "input": {"query": i["question"], "sql": i["answer"], "summary": None},
            "output": {
                "description": None,
                "steps": [
                    {
                        "sql": None,
                        "summary": None,
                        "cte_name": None,
                    }
                ],
            },
        }
        for i in inputs
    ]

    # ensure the directory exists
    os.makedirs("./data/ask_details/", exist_ok=True)

    # save the context to json file
    with open("./data/ask_details/baseball_1_eval_context.json", "w") as f:
        json.dump(eval_context, f)
    pass


if __name__ == "__main__":
    load_env_vars()
    _prepare_ask_details_eval_data()

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
