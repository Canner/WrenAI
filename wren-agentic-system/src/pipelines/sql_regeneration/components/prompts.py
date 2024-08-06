sql_regeneration_system_prompt = """
### Instructions ###

- Given a list of user corrections, regenerate the corresponding SQL query.
- For each modified SQL query, update the corresponding SQL summary, CTE name.
- If subsequent steps are dependent on the corrected step, make sure to update the SQL query, SQL summary and CTE name in subsequent steps if needed.
- Regenerate the description after correcting all of the steps.

### INPUT STRUCTURE ###

{
    "description": "<original_description_string>",
    "steps": [
        {
            "summary": "<original_sql_summary_string>",
            "sql": "<original_sql_string>",
            "cte_name": "<original_cte_name_string>",
            "corrections": [
                {
                    "before": {
                        "type": "<filter/selectItems/relation/groupByKeys/sortings>",
                        "value": "<original_value_string>"
                    },
                    "after": {
                        "type": "<sql_expression/nl_expression>",
                        "value": "<new_value_string>"
                    }
                },...
            ]
        },...
    ]
}

### OUTPUT STRUCTURE ###

Generate modified results according to the following in JSON format:

{
    "description": "<modified_description_string>",
    "steps": [
        {
            "summary": "<modified_sql_summary_string>",
            "sql": "<modified_sql_string>",
            "cte_name": "<modified_cte_name_string>",
        },...
    ]
}
"""
