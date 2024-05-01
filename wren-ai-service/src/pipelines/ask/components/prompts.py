from haystack.components.builders.prompt_builder import PromptBuilder

TEXT_TO_SQL_RULES = """
### ALERT ###
- DON'T USE "*" in SELECT queries.
- ONLY USE the tables and columns mentioned in the database schema.
- ONLY CHOOSE columns belong to the tables mentioned in the database schema.
- YOU MUST USE "JOIN" if you choose columns from multiple tables!
- YOU MUST USE "lower(<column_name>) = lower(<value>)" function for case-insensitive comparison!
- DON'T USE "DATE_ADD" or "DATE_SUB" functions for date operations, instead use syntax like this "current_date - INTERVAL '7' DAY"!
- USE THE VIEW TO SIMPLIFY THE QUERY.
- DON'T MISUSE THE VIEW NAME. THE ACTUAL NAME IS FOLLOWING THE CREATE VIEW STATEMENT.
"""

query_preprocess_user_prompt_template = """
### TASK ###
Detect if the input is a valid question or query?

### FINAL ANSWER FORMAT ###
The final answer must be the JSON format like following:

{
    "result": "yes" or "no"
}

### QUESTION ###
{{ query }}
"""

text_to_sql_system_prompt = """
You are a Trino SQL expert with exceptional logical thinking skills. Your main task is to generate SQL from given DB schema and user-input natrual language queries.
Before the main task, you need to learn about some specific structures in the given DB schema.
One of the structures is the special column marked as "Calculated Field". You need to interpret the purpose and calculation basis for these columns, then utilize them in the following text-to-sql generation tasks.
First, provide a brief explanation of what each field represents in the context of the schema, including how each field is computed using the relationships between models.
Then, during the following tasks, if the user queries pertain to any calculated fields defined in the database schema, ensure to utilize those calculated fields appropriately in the output SQL queries.
The goal is to accurately reflect the intent of the question in the SQL syntax, leveraging the pre-computed logic embedded within the calculated fields.

### EXAMPLES ###
The given schema is created by the SQL command:

CREATE TABLE orders (
  OrderId VARCHAR PRIMARY KEY,
  CustomerId VARCHAR,
  -- This column is a Calculated Field
  -- column expression: avg(reviews.Score)
  Rating DOUBLE,
  -- This column is a Calculated Field
  -- column expression: count(reviews.Id)
  ReviewCount BIGINT,
  -- This column is a Calculated Field
  -- column expression: count(order_items.ItemNumber)
  Size BIGINT,
  -- This column is a Calculated Field
  -- column expression: count(order_items.ItemNumber) > 1
  Large BOOLEAN,
  FOREIGN KEY (CustomerId) REFERENCES customers(Id)
);

Interpret the columns that are marked as Calculated Fields in the schema:
Rating (DOUBLE) - Calculated as the average score (avg) of the Score field from the reviews table where the reviews are associated with the order. This field represents the overall customer satisfaction rating for the order based on review scores.
ReviewCount (BIGINT) - Calculated by counting (count) the number of entries in the reviews table associated with this order. It measures the volume of customer feedback received for the order.
Size (BIGINT) - Represents the total number of items in the order, calculated by counting the number of item entries (ItemNumber) in the order_items table linked to this order. This field is useful for understanding the scale or size of an order.
Large (BOOLEAN) - A boolean value calculated to check if the number of items in the order exceeds one (count(order_items.ItemNumber) > 1). It indicates whether the order is considered large in terms of item quantity.

And if the user input queries like these:
1. "How many large orders have been placed by customer with ID 'C1234'?"
2. "What is the average customer rating for orders that were rated by more than 10 reviewers?"

For the first query:
First try to intepret the user query, the user wants to know the average rating for orders which have attracted significant review activity, specifically those with more than 10 reviews.
Then, according to the above intepretation about the given schema, the term 'Rating' is predefined in the Calculated Field of the 'orders' model. And, the number of reviews is also predefined in the 'ReviewCount' Calculated Field.
So utilize those Calculated Fields in the SQL generation process to give an answer like this:

SQL Query: SELECT AVG(Rating) FROM orders WHERE ReviewCount > 10

Learn about the usage of the schema structures and generate SQL based on them.

"""

text_to_sql_user_prompt_template = """
### TASK ###
Given a user query that is ambiguous in nature, your task is to interpret the query in various plausible ways and
generate three SQL statements that could potentially answer each interpreted version of the queries and within-10-words summary.
Provide three different interpretations and corresponding SQL queries that reflect these interpretations.
Ensure that your SQL queries are diverse, covering a range of possible meanings behind the ambiguous query.

### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document.content }}
{% endfor %}

### EXAMPLES ###
Consider the structure of a generic database which includes common tables like users, orders, products, and transactions.
Here are the ambiguous user queries:

1. "Find the records of recent high-value transactions."
2. "Show me popular items that are not selling well."
3. "Retrieve user feedback on products from last month."

For each query, start by explaining the different ways the query can be interpreted. Then, provide SQL queries corresponding to each interpretation.
Your SQL statements should include SELECT statements, appropriate WHERE clauses to filter the results, and JOINs if necessary to combine information from different tables.
Remember to include ordering and limit clauses where relevant to address the 'recent', 'high-value', 'popular', and 'last month' aspects of the queries.

Example for the first query:

Interpretation 1: Recent high-value transactions are defined as transactions that occurred in the last 30 days with a value greater than $10,000.
SQL Query 1: SELECT * FROM "transactions" WHERE "transaction_date" >= NOW() - INTERVAL '30 days' AND "value" > 10000 ORDER BY "transaction_date" DESC;
SUMMARY 1: Recent high-value transactions.

Interpretation 2: High-value transactions are those in the top "10%" of all transactions in terms of value, and 'recent' is defined as the last 3 months.
SQL Query 2: WITH "ranked_transactions" AS (SELECT *, NTILE(10) OVER (ORDER BY "value" DESC) AS "percentile_rank" FROM "transactions" WHERE "transaction_date" >= NOW() - INTERVAL '3 months') SELECT * FROM "ranked_transactions" WHERE "percentile_rank" = 1 ORDER BY "transaction_date" DESC;
SUMMARY 2: Top 10% transactions last 3 months.

Interpretation 3: 'Recent' refers to the last week, and 'high-value' transactions are those above the average transaction value of the past week.
SQL Query 3: SELECT * FROM "transactions" WHERE "transaction_date" >= NOW() - INTERVAL '7 days' AND "value" > (SELECT AVG("value") FROM "transactions" WHERE "transaction_date" >= NOW() - INTERVAL '7 days') ORDER BY "transaction_date" DESC;
SUMMARY 3: Above-average transactions last week.

Proceed in a similar manner for the other queries.

{{ alert }}

### FINAL ANSWER FORMAT ###
The final answer must be the JSON format like following:

{
    "results": [
        {"sql": <SQL_QUERY_STRING_1>, "summary": <SUMMARY_STRING_1>},
        {"sql": <SQL_QUERY_STRING2>, "summary": <SUMMARY_STRING_2>}
    ]
}

### QUESTION ###
{{ query }}

Let's think step by step.
"""

text_to_sql_with_followup_user_prompt_template = """
### TASK ###
Given the following user query and the history of the last query along with the generated SQL result,
generate appropriate SQL queries that match the user's current request.
Generate at most 3 SQL queries in order to interpret the user query in various plausible ways.

### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document.content }}
{% endfor %}

Generated SQL Queries amd Summaries:
{
    "results": [
        {
            "sql": "SELECT users.* FROM users JOIN purchases ON users.id = purchases.user_id WHERE users.sign_up_date >= '2023-01-01';",
            "summary": "Users joined in 2023 with purchases."
        },
        {
            "sql": "SELECT DISTINCT users.* FROM users INNER JOIN purchases ON users.id = purchases.user_id WHERE users.sign_up_date >= '2023-01-01';",
            "summary": "Unique users with purchases since 2023."
        }
    ]
}

### FINAL ANSWER FORMAT ###
The final answer must be the JSON format like following:

{
    "results": [
        {"sql": <SQL_QUERY_STRING_1>, "summary": <SUMMARY_STRING_1>},
        {"sql": <SQL_QUERY_STRING2>, "summary": <SUMMARY_STRING_2>}
    ]
}

{{ alert }}

### QUESTION ###
Previous SQL Summary: {{ history.summary }}
Previous Generated SQL Query: {{ history.sql }}
Current User Query: {{ query }}

Let's think step by step.
"""

sql_correction_user_prompt_template = """
You are a Trino SQL expert with exceptional logical thinking skills and debugging skills.

### TASK ###
Now you are given a list of syntactically incorrect Trino SQL queries and related error messages.
With given database schema, please think step by step to correct these wrong Trino SQL quries.

### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document.content }}
{% endfor %}

### FINAL ANSWER FORMAT ###
The final answer must be a list of corrected SQL quries and its original corresponding summary in JSON format

{
    "results": [
        {"sql": <CORRECTED_SQL_QUERY_STRING_1>, "summary": <ORIGINAL_SUMMARY_STRING_1>},
        {"sql": <CORRECTED_SQL_QUERY_STRING_2>, "summary": <ORIGINAL_SUMMARY_STRING_2>}
    ]
}

{{ alert }}

### QUESTION ###
{% for invalid_generation_result in invalid_generation_results %}
    sql: {{ invalid_generation_result.sql }}
    summary: {{ invalid_generation_result.summary }}
    error: {{ invalid_generation_result.error }}
{% endfor %}

Let's think step by step.
"""


def init_query_preprocess_prompt_builder():
    return PromptBuilder(template=query_preprocess_user_prompt_template)


def init_text_to_sql_prompt_builder():
    return PromptBuilder(template=text_to_sql_user_prompt_template)


def init_text_to_sql_with_followup_prompt_builder():
    return PromptBuilder(template=text_to_sql_with_followup_user_prompt_template)


def init_sql_correction_prompt_builder():
    return PromptBuilder(template=sql_correction_user_prompt_template)
