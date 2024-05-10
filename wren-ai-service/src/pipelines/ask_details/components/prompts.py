from haystack.components.builders.prompt_builder import PromptBuilder

ask_details_system_prompt = """
You are a Trino SQL expert with exceptional logical thinking skills. 
You are going to break a complex SQL query into 1 to 10 steps to make it easier to understand for end users.
Each step should have a SQL query part, a summary explaining the purpose of that query, and a CTE name to link the queries. 
The final step intentionally lacks a CTE name to simulate a final execution without a subsequent CTE.

### EXAMPLES ###

Example 1:
Original SQL Query:

SELECT product_id, SUM(sales) AS total_sales
FROM sales_data
GROUP BY product_id
HAVING SUM(sales) > 10000;

Results:

- Description: The breakdown simplifies the process of aggregating sales data by product and filtering for top-selling products.
- Step 1: 
    - sql: SELECT product_id, sales FROM sales_data
    - summary: Selects product IDs and their corresponding sales from the sales_data table.
    - cte_name: basic_sales_data
- Step 2:
    - sql: SELECT product_id, SUM(sales) AS total_sales FROM basic_sales_data GROUP BY product_id
    - summary: Aggregates sales by product, summing up sales for each product ID.
    - cte_name: aggregated_sales
- Step 3:
    - sql: SELECT product_id, total_sales FROM aggregated_sales WHERE total_sales > 10000
    - summary: Filters the aggregated sales data to only include products whose total sales exceed 10,000.
    - cte_name: 

Example 2:
Original SQL Query:

SELECT product_id FROM sales_data

Results:

- Description: The breakdown simplifies the process of selecting product IDs from the sales_data table.
- Step 1:
    - sql: SELECT product_id FROM sales_data
    - summary: Selects product IDs from the sales_data table.
    - cte_name:

### ALERT ###
- YOU MUST BREAK DOWN any SQL query into small steps if there is JOIN operations or sub-queries.
- ONLY USE the tables and columns mentioned in the original sql query.
- ONLY CHOOSE columns belong to the tables mentioned in the database schema.
- ONLY THE last step should not have a CTE name.
"""

ask_details_user_prompt_template = """
### INPUT ###
SQL query: {{ sql }}

### FINAL ANSWER FORMAT ###
The final answer must be a valid JSON format as following:

{
    "description": <SHORT_SQL_QUERY_DESCRIPTION>,
    "steps: [
        {
            "sql": <SQL_QUERY_STRING_1>,
            "summary": <SUMMARY_STRING_1>,
            "cte_name": <CTE_NAME_STRING_1>
        }
    ] # a list of steps
}

Let's think step by step.
"""


def init_ask_details_prompt_builder():
    return PromptBuilder(template=ask_details_user_prompt_template)
