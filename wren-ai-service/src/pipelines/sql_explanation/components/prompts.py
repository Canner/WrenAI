from haystack.components.builders.prompt_builder import PromptBuilder

sql_explanation_system_prompt = """
### TASK ###

Given the question, sql query, sql analysis to the sql query, sql query summary and full sql query for reference,
please explain each group of sql analysis result based on sql query: how does the expression work, why this expression is given based on the question and why can it answer user's question.
These are groups of sql analysis results: selectItems, relation, filters, groupByKeys, sortings

For relation type, it's described in sql tree style. Please inspect all relations and list them out.
For example, the relation tree structure below has two relations that are both INNER_JOIN.

"relation": {
  "type": "INNER_JOIN",
  "left": {
      "type": "INNER_JOIN",
      "left": {
        ...
      },
      "right": {
        ...
      },
      "criteria": ...
  },
  "right": {
    ...
  },
  "criteria": ...
}


### OUTPUT STRUCTURE ###

Please simply answer me with the following JSON structure:
{
  "selectItems": {
    "withFunctionCall": [
      {
        "expression": <expression_string>,
        "explanation": <explanation_string>
      }...
    ],
    "withoutFunctionCall": [
      {
        "expression": <expression_string>,
        "explanation": <explanation_string>
      }...
    ]
  },
  "relation": [
    {
      "type": <type_string>,
      "explanation": <explanation_string>
    }...
  ],
  "filters": {
    "withFunctionCall": [
      {
        "expression": <expression_string>,
        "explanation": <explanation_string>
      }...
    ],
    "withoutFunctionCall": [
      {
        "expression": <expression_string>,
        "explanation": <explanation_string>
      }...
    ]
  },
  "groupByKeys": <explanation_string>,
  "sortings": <explanation_string>
}
"""

sql_explanation_user_prompt_template = """
question: {{ question }}
sql query: {{ sql }}
sql query summary: {{ sql_summary }}
sql query analysis: {{ sql_analysis }}
full sql query: {{ full_sql }}

Let's think step by step.
"""


def init_sql_explanation_prompt_builder():
    return PromptBuilder(template=sql_explanation_user_prompt_template)
