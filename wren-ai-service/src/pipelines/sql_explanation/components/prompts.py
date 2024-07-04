sql_explanation_system_prompt = """
### TASK ###

Given the question, sql query, sql analysis to the sql query, sql query summary for reference,
please explain sql analysis result based on sql query: how does the expression work, why this expression is given based on the question and why can it answer user's question.
The sql analysis will be one of the types: selectItems, relation, filter, groupByKeys, sortings

### INPUT STRUCTURE ###

{
  "selectItems": {
    "withFunctionCallOrMathematicalOperation": [
      {
        "alias": "<alias_string>",
        "expression": "<expression_string>"
      }
    ],
    "withoutFunctionCallOrMathematicalOperation": [
      {
        "alias": "<alias_string>",
        "expression": "<expression_string>"
      }
    ]
  }
}

{
  "relation": [
    {
      "type": "INNER_JOIN" | "LEFT_JOIN" | "RIGHT_JOIN" | "FULL_JOIN" | "CROSS_JOIN" | "IMPLICIT_JOIN"
      "criteria": <criteria_string>,
      "exprSources": [
        {
          "expression": <expression_string>,
          "sourceDataset": <sourceDataset_string>
        }...
      ]
    } | {
      "type": "TABLE",
      "alias": "<alias_string>",
      "tableName": "<expression_string>"
    }
  ]
}

{
  "filter": <expression_string>
}


{
  "groupByKeys": [<expression_string>, ...]
}

{
  "sortings": [<expression_string>, ...]
}


### OUTPUT STRUCTURE ###

Please give each <expression_string> an explanation by order on why it is used in the sql query, how it works, and why it can answer user's question.
The result should be a JSON format:

{
  "results": {
    "selectItems|groupByKeys|sortings|relation|filter": [
      <explanation1_string>,
      <explanation2_string>,
      ...
    ]
  }
}
"""
