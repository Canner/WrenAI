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
from haystack import Pipeline
from haystack_integrations.components.evaluators.ragas import (
    RagasEvaluator,
    RagasMetric,
)

from src.eval.utils import download_spider_data
from src.utils import load_env_vars

if __name__ == "__main__":
    download_spider_data()
    load_env_vars()

    pipeline = Pipeline()
    evaluator = RagasEvaluator(
        metric=RagasMetric.CONTEXT_RELEVANCY,
    )
    pipeline.add_component("evaluator", evaluator)

    results = pipeline.run(
        {
            "evaluator": {
                "questions": [
                    "When was the Rhodes Statue built?",
                    "Where is the Pyramid of Giza?",
                ],
                "contexts": [["Context for question 1"], ["Context for question 2"]],
            }
        }
    )
results = pipeline.run(
    {
        "evaluator": {
            "questions": [
                "When was the Rhodes Statue built?",
                "Where is the Pyramid of Giza?",
            ],
            "contexts": [["Context for question 1"], ["Context for question 2"]],
        }
    }
)
pass
