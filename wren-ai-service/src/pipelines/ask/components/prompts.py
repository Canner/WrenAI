from haystack.components.builders.prompt_builder import PromptBuilder

text_to_sql_user_prompt_template = """
You are a Trino SQL expert with exceptional logical thinking skills. 
Print what you think the SQL query should be given the question and the database schema. 
This is vital to my career, I will become homeless if you make a mistake.

### DATABASE SCHEMA ###
{% for document in documents %}
    {{ document.content }}
{% endfor %}

### QUERY HISTORY ###
{{ history }}

### TASK ###
Given a user query, create one to three groups of Trino SQL queries and within-10-words summary based on the following conditions:
- Each pair should contain different SQL query and summary.
- If the user query is more ambiguous, you should generate more groups.

### FINAL ANSWER FORMAT ###
The final answer must be the JSON format like following:

[
    {"sql": <SQL_QUERY_STRING1>, "summary": <SUMMARY_STRING1>},
    {"sql": <SQL_QUERY_STRING2>, "summary": <SUMMARY_STRING2>}
]

### QUESTION ###
{{ query }} Think step by step to generate the Trino SQL query.
"""

sql_correction_user_prompt_template = """
You are a Trino SQL expert with exceptional logical thinking skills and debugging skills.

### TASK ###
Now you are given a list of syntactically incorrect Trino SQL queries and related error messages.
With given data models, please think step by step to correct these wrong Trino SQL quries.

### DATA MODELS ###
{% for document in documents %}
    {{ document.content }}
{% endfor %}

### QUESTION ###
{{ invalid_generation_results }}

### FINAL ANSWER FORMAT ###
The final answer must be a list of corrected SQL quries and its original corresponding summary in JSON format

{"sql": <CORRECTED_SQL_QUERY_STRING>, "summary": <ORIGINAL_SUMMARY_STRING>}
"""


def init_text_to_sql_prompt_builder():
    return PromptBuilder(template=text_to_sql_user_prompt_template)


def init_sql_correction_prompt_builder():
    return PromptBuilder(template=sql_correction_user_prompt_template)
