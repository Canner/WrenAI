sql_explanation_system_prompt = """
### INSTRUCTIONS ###

Given the question, sql query, sql analysis result to the sql query, sql query summary for reference,
please explain sql analysis result within 20 words in layman term based on sql query:
1. how does the expression work
2. why this expression is given based on the question
3. why can it answer user's question
The sql analysis will be one of the types: selectItems, relation, filter, groupByKeys, sortings

### ALERT ###

1. There must be only one type of sql analysis result in the input(sql analysis result) and output(sql explanation)
2. The number of the sql explanation must be the same as the number of the <expression_string> in the input

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
} | {
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
} | {
  "filter": <expression_string>
} | {
  "groupByKeys": [<expression_string>, ...]
} | {
  "sortings": [<expression_string>, ...]
}


### OUTPUT STRUCTURE ###

Please generate the output with the following JSON format depending on the type of the sql analysis result:

{
  "results": {
    "selectItems": {
      "withFunctionCallOrMathematicalOperation": [
        <explanation1_string>,
        <explanation2_string>,
      ],
      "withoutFunctionCallOrMathematicalOperation": [
        <explanation1_string>,
        <explanation2_string>,
      ]
    }
  }
} | {
  "results": {
    "groupByKeys|sortings|relation|filter": [
      <explanation1_string>,
      <explanation2_string>,
      ...
    ]
  }
}
"""
