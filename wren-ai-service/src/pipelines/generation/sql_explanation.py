import asyncio
import logging
import sys
from typing import Any, Dict, List, Optional

import orjson
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack import component
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.web.v1.services.sql_explanation import StepWithAnalysisResult

logger = logging.getLogger("wren-ai-service")

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

sql_explanation_user_prompt_template = """
Question: {{ question }}
SQL query: {{ sql }}
SQL query summary: {{ sql_summary }}
SQL query analysis: {{ sql_analysis_result }}

Let's think step by step.
"""


def _compose_sql_expression_of_filter_type(
    filter_analysis: Dict, top: bool = True
) -> Dict:
    if filter_analysis["type"] == "EXPR":
        if top:
            return {
                "values": filter_analysis["node"],
                "id": filter_analysis.get("id", ""),
            }
        else:
            return filter_analysis["node"]

    elif filter_analysis["type"] in ("AND", "OR"):
        left_expr = _compose_sql_expression_of_filter_type(
            filter_analysis["left"], top=False
        )
        right_expr = _compose_sql_expression_of_filter_type(
            filter_analysis["right"], top=False
        )
        return {
            "values": f"{left_expr} {filter_analysis['type']} {right_expr}",
            "id": filter_analysis.get("id", ""),
        }

    return {"values": "", "id": ""}


def _compose_sql_expression_of_groupby_type(
    groupby_keys: List[List[dict]],
) -> List[str]:
    return [
        {
            "values": groupby_key["expression"],
            "id": groupby_key.get("id", ""),
        }
        for groupby_key_list in groupby_keys
        for groupby_key in groupby_key_list
    ]


def _compose_sql_expression_of_relation_type(relation: Dict) -> List[str]:
    def _is_subquery_or_has_subquery_child(relation):
        if relation["type"] == "SUBQUERY":
            return True
        if relation["type"].endswith("_JOIN"):
            if (
                relation["left"]["type"] == "SUBQUERY"
                or relation["right"]["type"] == "SUBQUERY"
            ):
                return True
        return False

    def _collect_relations(relation, result, top_level: bool = True):
        if _is_subquery_or_has_subquery_child(relation):
            return

        if relation["type"] == "TABLE" and top_level:
            result.append(
                {
                    "values": {
                        "type": relation["type"],
                        "tableName": relation["tableName"],
                    },
                    "id": relation.get("id", ""),
                }
            )
        elif relation["type"].endswith("_JOIN"):
            result.append(
                {
                    "values": {
                        "type": relation["type"],
                        "criteria": relation["criteria"],
                        "exprSources": [
                            {
                                "expression": expr_source["expression"],
                                "sourceDataset": expr_source["sourceDataset"],
                            }
                            for expr_source in relation["exprSources"]
                        ],
                    },
                    "id": relation.get("id", ""),
                }
            )
            _collect_relations(relation["left"], result, top_level=False)
            _collect_relations(relation["right"], result, top_level=False)

    results = []
    print(f"relation: {relation}")
    _collect_relations(relation, results)
    return results


def _compose_sql_expression_of_select_type(select_items: List[Dict]) -> Dict:
    result = {
        "withFunctionCallOrMathematicalOperation": [],
        "withoutFunctionCallOrMathematicalOperation": [],
    }

    for select_item in select_items:
        if (
            select_item["properties"]["includeFunctionCall"] == "true"
            or select_item["properties"]["includeMathematicalOperation"] == "true"
        ):
            result["withFunctionCallOrMathematicalOperation"].append(
                {
                    "values": {
                        "alias": select_item["alias"],
                        "expression": select_item["expression"],
                    },
                    "id": select_item.get("id", ""),
                }
            )
        else:
            result["withoutFunctionCallOrMathematicalOperation"].append(
                {
                    "values": {
                        "alias": select_item["alias"],
                        "expression": select_item["expression"],
                    },
                    "id": select_item.get("id", ""),
                }
            )

    return result


def _compose_sql_expression_of_sortings_type(sortings: List[Dict]) -> List[str]:
    return [
        {
            "values": f'{sorting["expression"]} {sorting["ordering"]}',
            "id": sorting.get("id", ""),
        }
        for sorting in sortings
    ]


def _extract_to_str(data):
    if isinstance(data, list) and data:
        return data[0]
    elif isinstance(data, str):
        return data

    return ""


@component
class SQLAnalysisPreprocessor:
    @component.output_types(
        preprocessed_sql_analysis_results=List[Dict],
    )
    def run(
        self,
        sql_analysis_results: List[Dict],
    ) -> Dict[str, List[Dict]]:
        preprocessed_sql_analysis_results = []
        for sql_analysis_result in sql_analysis_results:
            if not sql_analysis_result.get("isSubqueryOrCte", False):
                preprocessed_sql_analysis_result = {}
                if "filter" in sql_analysis_result:
                    preprocessed_sql_analysis_result[
                        "filter"
                    ] = _compose_sql_expression_of_filter_type(
                        sql_analysis_result["filter"]
                    )
                else:
                    preprocessed_sql_analysis_result["filter"] = {}
                if "groupByKeys" in sql_analysis_result:
                    preprocessed_sql_analysis_result[
                        "groupByKeys"
                    ] = _compose_sql_expression_of_groupby_type(
                        sql_analysis_result["groupByKeys"]
                    )
                else:
                    preprocessed_sql_analysis_result["groupByKeys"] = []
                if "relation" in sql_analysis_result:
                    preprocessed_sql_analysis_result[
                        "relation"
                    ] = _compose_sql_expression_of_relation_type(
                        sql_analysis_result["relation"]
                    )
                else:
                    preprocessed_sql_analysis_result["relation"] = []
                if "selectItems" in sql_analysis_result:
                    preprocessed_sql_analysis_result[
                        "selectItems"
                    ] = _compose_sql_expression_of_select_type(
                        sql_analysis_result["selectItems"]
                    )
                else:
                    preprocessed_sql_analysis_result["selectItems"] = {
                        "withFunctionCallOrMathematicalOperation": [],
                        "withoutFunctionCallOrMathematicalOperation": [],
                    }
                if "sortings" in sql_analysis_result:
                    preprocessed_sql_analysis_result[
                        "sortings"
                    ] = _compose_sql_expression_of_sortings_type(
                        sql_analysis_result["sortings"]
                    )
                else:
                    preprocessed_sql_analysis_result["sortings"] = []
                preprocessed_sql_analysis_results.append(
                    preprocessed_sql_analysis_result
                )

        return {"preprocessed_sql_analysis_results": preprocessed_sql_analysis_results}


@component
class SQLExplanationGenerationPostProcessor:
    @component.output_types(
        results=Optional[List[Dict[str, Any]]],
    )
    def run(
        self, generates: List[List[str]], preprocessed_sql_analysis_results: List[dict]
    ) -> Dict[str, Any]:
        results = []
        try:
            if preprocessed_sql_analysis_results:
                preprocessed_sql_analysis_results = preprocessed_sql_analysis_results[0]
                for generate in generates:
                    sql_explanation_results = orjson.loads(generate["replies"][0])[
                        "results"
                    ]

                    if preprocessed_sql_analysis_results.get(
                        "filter", {}
                    ) and sql_explanation_results.get("filter", {}):
                        results.append(
                            {
                                "type": "filter",
                                "payload": {
                                    "id": preprocessed_sql_analysis_results["filter"][
                                        "id"
                                    ],
                                    "expression": preprocessed_sql_analysis_results[
                                        "filter"
                                    ]["values"],
                                    "explanation": _extract_to_str(
                                        sql_explanation_results["filter"]
                                    ),
                                },
                            }
                        )
                    elif preprocessed_sql_analysis_results.get(
                        "groupByKeys", []
                    ) and sql_explanation_results.get("groupByKeys", []):
                        for (
                            groupby_key,
                            sql_explanation,
                        ) in zip(
                            preprocessed_sql_analysis_results["groupByKeys"],
                            sql_explanation_results["groupByKeys"],
                        ):
                            results.append(
                                {
                                    "type": "groupByKeys",
                                    "payload": {
                                        "id": groupby_key["id"],
                                        "expression": groupby_key["values"],
                                        "explanation": _extract_to_str(sql_explanation),
                                    },
                                }
                            )
                    elif preprocessed_sql_analysis_results.get(
                        "relation", []
                    ) and sql_explanation_results.get("relation", []):
                        for (
                            relation,
                            sql_explanation,
                        ) in zip(
                            preprocessed_sql_analysis_results["relation"],
                            sql_explanation_results["relation"],
                        ):
                            results.append(
                                {
                                    "type": "relation",
                                    "payload": {
                                        "id": relation["id"],
                                        **relation["values"],
                                        "explanation": _extract_to_str(sql_explanation),
                                    },
                                }
                            )
                    elif preprocessed_sql_analysis_results.get(
                        "selectItems", {}
                    ) and sql_explanation_results.get("selectItems", {}):
                        sql_analysis_result_for_select_items = [
                            {
                                "type": "selectItems",
                                "payload": {
                                    "id": select_item["id"],
                                    **select_item["values"],
                                    "isFunctionCallOrMathematicalOperation": True,
                                    "explanation": _extract_to_str(sql_explanation),
                                },
                            }
                            for select_item, sql_explanation in zip(
                                preprocessed_sql_analysis_results["selectItems"][
                                    "withFunctionCallOrMathematicalOperation"
                                ],
                                sql_explanation_results["selectItems"][
                                    "withFunctionCallOrMathematicalOperation"
                                ],
                            )
                        ] + [
                            {
                                "type": "selectItems",
                                "payload": {
                                    "id": select_item["id"],
                                    **select_item["values"],
                                    "isFunctionCallOrMathematicalOperation": False,
                                    "explanation": _extract_to_str(sql_explanation),
                                },
                            }
                            for select_item, sql_explanation in zip(
                                preprocessed_sql_analysis_results["selectItems"][
                                    "withoutFunctionCallOrMathematicalOperation"
                                ],
                                sql_explanation_results["selectItems"][
                                    "withoutFunctionCallOrMathematicalOperation"
                                ],
                            )
                        ]

                        results += sql_analysis_result_for_select_items
                    elif preprocessed_sql_analysis_results.get(
                        "sortings", []
                    ) and sql_explanation_results.get("sortings", []):
                        for (
                            sorting,
                            sql_explanation,
                        ) in zip(
                            preprocessed_sql_analysis_results["sortings"],
                            sql_explanation_results["sortings"],
                        ):
                            results.append(
                                {
                                    "type": "sortings",
                                    "payload": {
                                        "id": sorting["id"],
                                        "expression": sorting["values"],
                                        "explanation": _extract_to_str(sql_explanation),
                                    },
                                }
                            )
        except Exception as e:
            logger.exception(f"Error in SQLExplanationGenerationPostProcessor: {e}")

        return {"results": results}


## Start of Pipeline
@observe(capture_input=False)
def preprocess(
    sql_analysis_results: List[dict], pre_processor: SQLAnalysisPreprocessor
) -> dict:
    return pre_processor.run(sql_analysis_results)


@observe(capture_input=False)
def prompts(
    question: str,
    sql: str,
    preprocess: dict,
    sql_summary: str,
    prompt_builder: PromptBuilder,
) -> List[dict]:
    preprocessed_sql_analysis_results_with_values = []
    for preprocessed_sql_analysis_result in preprocess[
        "preprocessed_sql_analysis_results"
    ]:
        for key, value in preprocessed_sql_analysis_result.items():
            if value:
                if key != "selectItems":
                    if isinstance(value, list):
                        preprocessed_sql_analysis_results_with_values.append(
                            {key: [v["values"] for v in value]}
                        )
                    else:
                        preprocessed_sql_analysis_results_with_values.append(
                            {key: value["values"]}
                        )
                else:
                    preprocessed_sql_analysis_results_with_values.append(
                        {
                            key: {
                                "withFunctionCallOrMathematicalOperation": [
                                    v["values"]
                                    for v in value[
                                        "withFunctionCallOrMathematicalOperation"
                                    ]
                                ],
                                "withoutFunctionCallOrMathematicalOperation": [
                                    v["values"]
                                    for v in value[
                                        "withoutFunctionCallOrMathematicalOperation"
                                    ]
                                ],
                            }
                        }
                    )

    return [
        prompt_builder.run(
            question=question,
            sql=sql,
            sql_analysis_result=sql_analysis_result,
            sql_summary=sql_summary,
        )
        for sql_analysis_result in preprocessed_sql_analysis_results_with_values
    ]


@observe(as_type="generation", capture_input=False)
async def generate_sql_explanation(prompts: List[dict], generator: Any) -> List[dict]:
    async def _task(prompt: str, generator: Any):
        return await generator(prompt=prompt.get("prompt"))

    tasks = [_task(prompt, generator) for prompt in prompts]
    return await asyncio.gather(*tasks)


@observe(capture_input=False)
def post_process(
    generate_sql_explanation: List[dict],
    preprocess: dict,
    post_processor: SQLExplanationGenerationPostProcessor,
) -> dict:
    return post_processor.run(
        generate_sql_explanation,
        preprocess["preprocessed_sql_analysis_results"],
    )


## End of Pipeline


class AggregatedItemsResult(BaseModel):
    groupByKeys: Optional[list[str]]
    sortings: Optional[list[str]]
    relation: Optional[list[str]]
    filter: Optional[list[str]]


class SelectedItem(BaseModel):
    withFunctionCallOrMathematicalOperation: list[str]
    withoutFunctionCallOrMathematicalOperation: list[str]


class SelectedItemsResult(BaseModel):
    selectItems: SelectedItem


class ExplanationResults(BaseModel):
    results: Optional[SelectedItemsResult]
    results: Optional[AggregatedItemsResult]


SQL_EXPLANATION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "explanation_results",
            "schema": ExplanationResults.model_json_schema(),
        },
    }
}


class SQLExplanation(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **kwargs,
    ):
        self._components = {
            "pre_processor": SQLAnalysisPreprocessor(),
            "prompt_builder": PromptBuilder(
                template=sql_explanation_user_prompt_template
            ),
            "generator": llm_provider.get_generator(
                system_prompt=sql_explanation_system_prompt,
                generation_kwargs=SQL_EXPLANATION_MODEL_KWARGS,
            ),
            "post_processor": SQLExplanationGenerationPostProcessor(),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="SQL Explanation Generation")
    async def run(
        self,
        question: str,
        step_with_analysis_results: StepWithAnalysisResult,
    ):
        logger.info("SQL Explanation Generation pipeline is running...")

        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "question": question,
                "sql": step_with_analysis_results.sql,
                "sql_analysis_results": step_with_analysis_results.sql_analysis_results,
                "sql_summary": step_with_analysis_results.summary,
                **self._components,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        SQLExplanation,
        "sql_explanation",
        question="this is a test question",
        step_with_analysis_results=StepWithAnalysisResult(
            sql="xxx", summary="xxx", sql_analysis_results=[]
        ),
    )
