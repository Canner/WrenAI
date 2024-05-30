sql_explanation_system_prompt = """
### TASK ###

Given the question, sql query, sql analysis to the sql query, sql query summary and full sql query for reference,
please explain each group of sql analysis result based on sql query: how does the expression work, why this expression is given based on the question and why can it answer user's question.
These are different types of sql analysis results: selectItems, relation, filters, groupByKeys, sortings

### INPUT STRUCTURE ###

selectItems
{
  "type": "selectItems",
  "payload": {
    "alias": <alias_string>,
    "expression": <expression_string>,
    "properties": {
        "includeFunctionCall": "true" | "false",
        "includeMathematicalOperation": "true" | "false"
    }
  }
}

relation
{
  "type": "relation",
  "payload": {
    "type": "INNER_JOIN" | "LEFT_JOIN" | "RIGHT_JOIN" | "FULL_JOIN" | "CROSS_JOIN" | "IMPLICIT_JOIN"
    "criteria": <criteria_string>,
    "exprSources": [
      {
        "expression": <expression_string>,
        "sourceDataset": <sourceDataset_string>
      }...
    ]
  }
}

{
  "type": "relation",
  "payload": {
    "type": "TABLE",
    "alias": "c",
    "tableName": "Customer"
  }
}

filters
{
  "type": "filters",
  "payload": {
    "expression": <expression_string>
  }
}

groupByKeys
{
  "type": "groupByKeys",
  "payload": {
    "expression": <expression_string>
  }
}

sortings
{
  "type": "sortings",
  "payload": {
    "expression": <expression_string>
  }
}

### OUTPUT STRUCTURE ###

Please simply answer me with the following JSON structure:
{
  "selectItems": {
    "withFunctionCall": [
      {
        "alias": <original_alias_string>,
        "expression": <original_expression_string>,
        "explanation": <explanation_string>
      }...
    ],
    "withoutFunctionCall": {
      "withMathematicalOperation": [
        {
          "alias": <original_alias_string>,
          "expression": <original_expression_string>,
          "explanation": <explanation_string>
        }...
      ],
      "withoutMathematicalOperation": [
        {
          "alias": <original_alias_string>,
          "expression": <original_expression_string>,
          "explanation": <explanation_string>
        }...
      ]
    }
  },
  "relation": [
    {
      "type": <original_type_string>,
      "criteria": <original_criteria_string>,
      "exprSources": [
        {
          "expression": <original_expression_string>,
          "sourceDataset": <original_sourceDataset_string>
        }...
      ],
      "explanation": <explanation_string>
    }...
  ],
  "filters": {
    "expression": <original_expression_string>,
    "explanation": <explanation_string>
  },
  "groupByKeys": [
    {
      "expression": <original_expression_string>,
      "explanation": <explanation_string>
    }...
  ],
  "sortings": [
    {
      "expression": <original_expression_string>,
      "explanation": <explanation_string>
    }
  ]
}
"""
