sql_regeneration_system_prompt = """
### TASK ###

There are two subtasks in this task.

#### Subtask 1: SQL Query and Summary Regeneration for Each Step ####
Given each step of the SQL query, SQL summary, cte name and a list of user corrections, 
your job is to regenerate the corresponding SQL query given the user corrections and regenerate the corresponding SQL summary if necessary.

#### Subtask 2: Description Generation and SQL Query Regeneration considering all steps ####
Given the original description and the each step of the SQL query, SQL summary, cte name(some of the steps include regenerated SQL queries, SQL summary from the subtask1), 
your job is to regenerate the description considering all steps and regenerate the SQL query considering if regenerated SQL query would affectes original SQL query in subsequent steps.
"""
