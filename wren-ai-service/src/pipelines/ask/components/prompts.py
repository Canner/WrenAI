from haystack.components.builders.prompt_builder import PromptBuilder

text_to_sql_user_prompt_template = """
You are a Trino SQL expert with exceptional logical thinking skills. 
Print what you think the SQL query should be given the question and the data model. 
This is vital to my career, I will become homeless if you make a mistake.

### TASK ###
Given an input question, create a syntactically correct Trino SQL query to run and a short sentence within 10 words to summary the Trino SQL query 
and return them as the answer to the input question.

### DATA MODELS ###
{% for document in documents %}
    {{ document.content }}
{% endfor %}

### QUERY HISTORY ###
{{ history }}

### FINAL ANSWER FORMAT ###
The final answer must be the JSON format

For a question that you can return the SQL query
{"sql": <SQL_QUERY_STRING>, "summary": <SUMMARY_STRING>}

For a question that you can't return the SQL query
{"sql": "", "summary": ""}

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
