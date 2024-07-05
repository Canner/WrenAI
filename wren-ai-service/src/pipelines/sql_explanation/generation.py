import asyncio
import logging
import sys
from typing import Any, Dict, List, Optional

import orjson
import pydantic
from hamilton import base
from hamilton.experimental.h_async import AsyncDriver
from haystack import component
from haystack.components.builders.prompt_builder import PromptBuilder

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.sql_explanation.components.prompts import (
    sql_explanation_system_prompt,
)
from src.utils import async_timer, init_providers, timer

logger = logging.getLogger("wren-ai-service")


sql_explanation_user_prompt_template = """
Question: {{ question }}
SQL query: {{ sql }}
SQL query summary: {{ sql_summary }}
SQL query analysis: {{ sql_analysis_result }}

Let's think step by step.
"""


def _compose_sql_expression_of_filter_type(filter_analysis: Dict) -> str:
    if filter_analysis["type"] == "EXPR":
        return filter_analysis["node"]
    elif filter_analysis["type"] in ("AND", "OR"):
        left_expr = _compose_sql_expression_of_filter_type(filter_analysis["left"])
        right_expr = _compose_sql_expression_of_filter_type(filter_analysis["right"])
        return f"{left_expr} {filter_analysis['type']} {right_expr}"

    return ""


def _compose_sql_expression_of_groupby_type(groupby_keys: List[List[str]]) -> List[str]:
    return [f"{','.join(groupby_key)}" for groupby_key in groupby_keys]


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
            result.append(relation)
        elif relation["type"].endswith("_JOIN"):
            result.append(
                {
                    "type": relation["type"],
                    "criteria": relation["criteria"],
                    "exprSources": relation["exprSources"],
                }
            )
            _collect_relations(relation["left"], result, top_level=False)
            _collect_relations(relation["right"], result, top_level=False)

    results = []
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
                {"alias": select_item["alias"], "expression": select_item["expression"]}
            )
        else:
            result["withoutFunctionCallOrMathematicalOperation"].append(
                {
                    "alias": select_item["alias"],
                    "expression": select_item["expression"],
                }
            )

    return result


def _compose_sql_expression_of_sortings_type(sortings: List[Dict]) -> List[str]:
    return [f'{sorting["expression"]} {sorting["ordering"]}' for sorting in sortings]


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
                if "groupByKeys" in sql_analysis_result:
                    preprocessed_sql_analysis_result[
                        "groupByKeys"
                    ] = _compose_sql_expression_of_groupby_type(
                        sql_analysis_result["groupByKeys"]
                    )
                if "relation" in sql_analysis_result:
                    preprocessed_sql_analysis_result[
                        "relation"
                    ] = _compose_sql_expression_of_relation_type(
                        sql_analysis_result["relation"]
                    )
                if "selectItems" in sql_analysis_result:
                    preprocessed_sql_analysis_result[
                        "selectItems"
                    ] = _compose_sql_expression_of_select_type(
                        sql_analysis_result["selectItems"]
                    )
                if "sortings" in sql_analysis_result:
                    preprocessed_sql_analysis_result[
                        "sortings"
                    ] = _compose_sql_expression_of_sortings_type(
                        sql_analysis_result["sortings"]
                    )
                preprocessed_sql_analysis_results.append(
                    preprocessed_sql_analysis_result
                )

        return {"preprocessed_sql_analysis_results": preprocessed_sql_analysis_results}


@component
class GenerationPostProcessor:
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
                    # there might be multiple sql_explanation_results, so we need to correct them
                    # based on the real number according to preprocessed_sql_analysis_results
                    for key, sql_explanation_result in sql_explanation_results.items():
                        if key == "selectItems":
                            sql_explanation_results[key] = sql_explanation_result[
                                : len(
                                    preprocessed_sql_analysis_results[key][
                                        "withFunctionCallOrMathematicalOperation"
                                    ]
                                )
                                + len(
                                    preprocessed_sql_analysis_results[key][
                                        "withoutFunctionCallOrMathematicalOperation"
                                    ]
                                )
                            ]
                        else:
                            sql_explanation_results[key] = sql_explanation_result[
                                : len(preprocessed_sql_analysis_results[key])
                            ]

                    logger.debug(
                        f"sql_explanation_results: {orjson.dumps(sql_explanation_results, option=orjson.OPT_INDENT_2).decode()}"
                    )

                    if (
                        "filter" in preprocessed_sql_analysis_results
                        and "filter" in sql_explanation_results
                    ):
                        results.append(
                            {
                                "type": "filter",
                                "payload": {
                                    "expression": preprocessed_sql_analysis_results[
                                        "filter"
                                    ],
                                    "explanation": _extract_to_str(
                                        sql_explanation_results["filter"]
                                    ),
                                },
                            }
                        )
                    elif (
                        "groupByKeys" in preprocessed_sql_analysis_results
                        and "groupByKeys" in sql_explanation_results
                    ):
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
                                        "expression": groupby_key,
                                        "explanation": _extract_to_str(sql_explanation),
                                    },
                                }
                            )
                    elif (
                        "relation" in preprocessed_sql_analysis_results
                        and "relation" in sql_explanation_results
                    ):
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
                                        **relation,
                                        "explanation": _extract_to_str(sql_explanation),
                                    },
                                }
                            )
                    elif (
                        "selectItems" in preprocessed_sql_analysis_results
                        and "selectItems" in sql_explanation_results
                    ):
                        sql_analysis_result_for_select_items = [
                            {
                                **select_item,
                                "type": "withFunctionCallOrMathematicalOperation",
                            }
                            for select_item in preprocessed_sql_analysis_results[
                                "selectItems"
                            ]["withFunctionCallOrMathematicalOperation"]
                        ] + [
                            {
                                **select_item,
                                "type": "withoutFunctionCallOrMathematicalOperation",
                            }
                            for select_item in preprocessed_sql_analysis_results[
                                "selectItems"
                            ]["withoutFunctionCallOrMathematicalOperation"]
                        ]

                        for (
                            select_item,
                            sql_explanation,
                        ) in zip(
                            sql_analysis_result_for_select_items,
                            sql_explanation_results["selectItems"],
                        ):
                            results.append(
                                {
                                    "type": "selectItems",
                                    "payload": {
                                        **select_item,
                                        "explanation": _extract_to_str(sql_explanation),
                                    },
                                }
                            )
                    elif (
                        "sortings" in preprocessed_sql_analysis_results
                        and "sortings" in sql_explanation_results
                    ):
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
                                        "expression": sorting,
                                        "explanation": _extract_to_str(sql_explanation),
                                    },
                                }
                            )
        except Exception as e:
            logger.exception(f"Error in GenerationPostProcessor: {e}")

        print(
            f"PREPROCESSED_SQL_ANALYSIS_RESULTS: {orjson.dumps(preprocessed_sql_analysis_results, option=orjson.OPT_INDENT_2).decode()}"
        )
        print(f"RESULTS: {orjson.dumps(results, option=orjson.OPT_INDENT_2).decode()}")

        return {"results": results}


## Start of Pipeline
@timer
def preprocess(
    sql_analysis_results: List[dict], pre_processor: SQLAnalysisPreprocessor
) -> dict:
    logger.debug(
        f"sql_analysis_results: {orjson.dumps(sql_analysis_results, option=orjson.OPT_INDENT_2).decode()}"
    )
    return pre_processor.run(sql_analysis_results)


@timer
def prompts(
    question: str,
    sql: str,
    preprocess: dict,
    sql_summary: str,
    prompt_builder: PromptBuilder,
) -> List[dict]:
    logger.debug(f"question: {question}")
    logger.debug(f"sql: {sql}")
    logger.debug(
        f"preprocess: {orjson.dumps(preprocess, option=orjson.OPT_INDENT_2).decode()}"
    )
    logger.debug(f"sql_summary: {sql_summary}")

    preprocessed_sql_analysis_results_with_values = []
    for preprocessed_sql_analysis_result in preprocess[
        "preprocessed_sql_analysis_results"
    ]:
        for key, value in preprocessed_sql_analysis_result.items():
            if value:
                preprocessed_sql_analysis_results_with_values.append({key: value})

    logger.debug(
        f"preprocessed_sql_analysis_results_with_values: {orjson.dumps(preprocessed_sql_analysis_results_with_values, option=orjson.OPT_INDENT_2).decode()}"
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


@async_timer
async def generates(prompts: List[dict], generator: Any) -> List[dict]:
    logger.debug(
        f"prompts: {orjson.dumps(prompts, option=orjson.OPT_INDENT_2).decode()}"
    )

    async def _task(prompt: str, generator: Any):
        return await generator.run(prompt=prompt.get("prompt"))

    tasks = [_task(prompt, generator) for prompt in prompts]
    return await asyncio.gather(*tasks)


@timer
def post_process(
    generates: List[dict],
    preprocess: dict,
    post_processor: GenerationPostProcessor,
) -> dict:
    logger.debug(
        f"generates: {orjson.dumps(generates, option=orjson.OPT_INDENT_2).decode()}"
    )
    logger.debug(
        f"preprocess: {orjson.dumps(preprocess, option=orjson.OPT_INDENT_2).decode()}"
    )

    return post_processor.run(
        generates,
        preprocess["preprocessed_sql_analysis_results"],
    )


## End of Pipeline


class Generation(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
    ):
        self.pre_processor = SQLAnalysisPreprocessor()
        self.prompt_builder = PromptBuilder(
            template=sql_explanation_user_prompt_template
        )
        self.generator = llm_provider.get_generator(
            system_prompt=sql_explanation_system_prompt
        )
        self.post_processor = GenerationPostProcessor()

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @async_timer
    async def run(
        self,
        question: str,
        step_with_analysis_results: pydantic.BaseModel,
    ):
        logger.info("SQL Explanation Generation pipeline is running...")

        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "question": question,
                "sql": step_with_analysis_results.sql,
                "sql_analysis_results": step_with_analysis_results.sql_analysis_results,
                "sql_summary": step_with_analysis_results.summary,
                "pre_processor": self.pre_processor,
                "prompt_builder": self.prompt_builder,
                "generator": self.generator,
                "post_processor": self.post_processor,
            },
        )


if __name__ == "__main__":
    from src.core.pipeline import async_validate
    from src.utils import load_env_vars

    load_env_vars()

    llm_provider, _ = init_providers()
    pipeline = Generation(
        llm_provider=llm_provider,
    )

    async_validate(
        lambda: pipeline.run(
            "this is a test question",
            "this is a test sql",
            [],
            "this is a test sql summary",
            "this is a test full sql",
        )
    )
