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


if __name__ == "__main__":
    pass
