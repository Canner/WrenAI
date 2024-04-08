from haystack.components.builders.prompt_builder import PromptBuilder

text_to_sql_user_prompt_template = """
### TASK ###
Given a user query that is ambiguous in nature, your task is to interpret the query in various plausible ways and 
generate three SQL statements that could potentially answer each interpreted version of the queries and within-10-words summary. 
Provide three different interpretations and corresponding SQL queries that reflect these interpretations. 
Ensure that your SQL queries are diverse, covering a range of possible meanings behind the ambiguous query.

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
SQL Query 1: SELECT * FROM transactions WHERE transaction_date >= NOW() - INTERVAL '30 days' AND value > 10000 ORDER BY transaction_date DESC;
SUMMARY 1: Recent high-value transactions.

Interpretation 2: High-value transactions are those in the top "10%" of all transactions in terms of value, and 'recent' is defined as the last 3 months.
SQL Query 2: WITH ranked_transactions AS (SELECT *, NTILE(10) OVER (ORDER BY value DESC) AS percentile_rank FROM transactions WHERE transaction_date >= NOW() - INTERVAL '3 months') SELECT * FROM ranked_transactions WHERE percentile_rank = 1 ORDER BY transaction_date DESC;
SUMMARY 2: Top 10% transactions last 3 months.

Interpretation 3: 'Recent' refers to the last week, and 'high-value' transactions are those above the average transaction value of the past week.
SQL Query 3: SELECT * FROM transactions WHERE transaction_date >= NOW() - INTERVAL '7 days' AND value > (SELECT AVG(value) FROM transactions WHERE transaction_date >= NOW() - INTERVAL '7 days') ORDER BY transaction_date DESC;
SUMMARY 3: Above-average transactions last week.

Proceed in a similar manner for the other queries.

### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document.content }}
{% endfor %}

### FINAL ANSWER FORMAT ###
The final answer must be the JSON format like following:

{
    "results": [
        {"sql": <SQL_QUERY_STRING_1>, "summary": <SUMMARY_STRING_1>},
        {"sql": <SQL_QUERY_STRING2>, "summary": <SUMMARY_STRING_2>}
    ]
}

### NOTICE ###
- Only use the tables and columns mentioned in the database schema.
- If you think you can't generate a valid SQL query for a specific interpretation, you can skip that interpretation and provide the other ones.
- Make sure to map operators and operands correctly based on their data types.

### QUESTION ###
{{ query }}
"""

text_to_sql_with_followup_user_prompt_template = """
### TASK ###
Given the following user query and the history of the last query along with the generated SQL result, 
generate appropriate SQL queries that match the user's current request. 
Generate at most 3 SQL queries in order to interpret the user query in various plausible ways.

### EXAMPLES ###
Previous SQL Summary: "Users signed up this year."
Previous Generated SQL Query: "SELECT * FROM users WHERE sign_up_date >= '2023-01-01';"
Current User Query: "Who has made a purchase?"

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

### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document.content }}
{% endfor %}

### FINAL ANSWER FORMAT ###
The final answer must be the JSON format like following:

{
    "results": [
        {"sql": <SQL_QUERY_STRING_1>, "summary": <SUMMARY_STRING_1>},
        {"sql": <SQL_QUERY_STRING2>, "summary": <SUMMARY_STRING_2>}
    ]
}

### NOTICE ###
- Only use the tables and columns mentioned in the database schema.
- If you think you can't generate a valid SQL query for a specific interpretation, you can skip that interpretation and provide the other ones.
- Make sure to map operators and operands correctly based on their data types.

### QUESTION ###
Previous SQL Summary: {{ history.summary }}
Previous Generated SQL Query: {{ history.sql }}
Current User Query: {{ query }}

Generated SQL Queries amd Summaries:
"""

text_to_sql_with_followup_user_prompt_template = """
### TASK ###
Given a set of user queries that are ambiguous in nature, your task is to interpret these queries in various plausible ways and 
generate multiple SQL statements that could potentially answer each interpreted version of the queries and within-10-words summary. 
For each ambiguous user query, provide at least three different interpretations and corresponding SQL queries that reflect these interpretations. 
Ensure that your SQL queries are diverse, covering a range of possible meanings behind the ambiguous query. 
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
SQL Query 1: SELECT * FROM transactions WHERE transaction_date >= NOW() - INTERVAL '30 days' AND value > 10000 ORDER BY transaction_date DESC;
SUMMARY 1: Recent high-value transactions.

Interpretation 2: High-value transactions are those in the top "10%" of all transactions in terms of value, and 'recent' is defined as the last 3 months.
SQL Query 2: WITH ranked_transactions AS (SELECT *, NTILE(10) OVER (ORDER BY value DESC) AS percentile_rank FROM transactions WHERE transaction_date >= NOW() - INTERVAL '3 months') SELECT * FROM ranked_transactions WHERE percentile_rank = 1 ORDER BY transaction_date DESC;
SUMMARY 2: Top 10% transactions last 3 months.

Interpretation 3: 'Recent' refers to the last week, and 'high-value' transactions are those above the average transaction value of the past week.
SQL Query 3: SELECT * FROM transactions WHERE transaction_date >= NOW() - INTERVAL '7 days' AND value > (SELECT AVG(value) FROM transactions WHERE transaction_date >= NOW() - INTERVAL '7 days') ORDER BY transaction_date DESC;
SUMMARY 3: Above-average transactions last week.

Proceed in a similar manner for the other queries.

### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document.content }}
{% endfor %}

### QUERY HISTORY ###
{{ history }}

### FINAL ANSWER FORMAT ###
The final answer must be the JSON format like following:

[
    {"sql": <SQL_QUERY_STRING_1>, "summary": <SUMMARY_STRING_1>},
    {"sql": <SQL_QUERY_STRING2>, "summary": <SUMMARY_STRING_2>}
]

### QUESTION ###
{{ query }}
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

### NOTICE ###
- Only use the tables and columns mentioned in the database schema.
- Make sure to map operators and operands correctly based on their data types.

### QUESTION ###
{{ invalid_generation_results }}
"""


def init_text_to_sql_prompt_builder():
    return PromptBuilder(template=text_to_sql_user_prompt_template)


def init_text_to_sql_with_followup_prompt_builder():
    return PromptBuilder(template=text_to_sql_with_followup_user_prompt_template)


def init_sql_correction_prompt_builder():
    return PromptBuilder(template=sql_correction_user_prompt_template)
