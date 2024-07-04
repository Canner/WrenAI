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
question: {{ question }}
SQL query: {{ sql }}
SQL query summary: {{ sql_summary }}
SQL query analysis: {{ sql_analysis_results }}
full SQL query: {{ full_sql }}

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
    def run(self, replies: List[str]) -> Dict[str, Any]:
        results = []
        try:
            sql_explanation_results = orjson.loads(replies[0])

            if "selectItems" in sql_explanation_results:
                results += [
                    {
                        "type": "selectItems",
                        "payload": {
                            **select_item,
                            **{"includeFunctionCallOrMathematicalOperation": True},
                        },
                    }
                    for select_item in (
                        sql_explanation_results["selectItems"].get(
                            "withFunctionCallOrMathematicalOperation", []
                        )
                    )
                ] + [
                    {
                        "type": "selectItems",
                        "payload": {
                            **select_item,
                            **{"includeFunctionCallOrMathematicalOperation": False},
                        },
                    }
                    for select_item in (
                        sql_explanation_results["selectItems"].get(
                            "withoutFunctionCallOrMathematicalOperation", []
                        )
                    )
                ]
            if "relation" in sql_explanation_results:
                results += [
                    {"type": "relation", "payload": relation}
                    for relation in sql_explanation_results["relation"]
                ]
            if (
                "filter" in sql_explanation_results
                and sql_explanation_results["filter"]["expression"]
            ):
                results += [
                    {"type": "filter", "payload": sql_explanation_results["filter"]}
                ]
            if "groupByKeys" in sql_explanation_results:
                results += [
                    {"type": "groupByKeys", "payload": groupby_key}
                    for groupby_key in sql_explanation_results["groupByKeys"]
                ]
            if "sortings" in sql_explanation_results:
                results += [
                    {"type": "sortings", "payload": sorting}
                    for sorting in sql_explanation_results["sortings"]
                ]
        except Exception as e:
            logger.exception(f"Error in GenerationPostProcessor: {e}")

        return {"results": results}


## Start of Pipeline
@timer
def preprocess(
    sql_analysis_results: List[dict], pre_processor: SQLAnalysisPreprocessor
) -> List[dict]:
    logger.debug(
        f"sql_analysis_results: {orjson.dumps(sql_analysis_results, option=orjson.OPT_INDENT_2).decode()}"
    )
    return pre_processor.run(sql_analysis_results)


@timer
def prompt(
    question: str,
    sql: str,
    preprocess: List[dict],
    sql_summary: str,
    full_sql: str,
    prompt_builder: PromptBuilder,
) -> dict:
    logger.debug(f"question: {question}")
    logger.debug(f"sql: {sql}")
    logger.debug(
        f"preprocess: {orjson.dumps(preprocess, option=orjson.OPT_INDENT_2).decode()}"
    )
    logger.debug(f"sql_summary: {sql_summary}")
    logger.debug(f"full_sql: {full_sql}")
    return prompt_builder.run(
        question=question,
        sql=sql,
        sql_analysis_results=preprocess["preprocessed_sql_analysis_results"],
        sql_summary=sql_summary,
        full_sql=full_sql,
    )


@async_timer
async def generate(prompt: dict, generator: Any) -> dict:
    logger.debug(f"prompt: {orjson.dumps(prompt, option=orjson.OPT_INDENT_2).decode()}")
    return await generator.run(prompt=prompt.get("prompt"))


@timer
def post_process(generate: dict, post_processor: GenerationPostProcessor) -> dict:
    logger.debug(
        f"generate: {orjson.dumps(generate, option=orjson.OPT_INDENT_2).decode()}"
    )
    return post_processor.run(generate.get("replies"))


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
        full_sql: str,
    ):
        logger.info("SQL Explanation Generation pipeline is running...")

        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "question": question,
                "sql": step_with_analysis_results.sql,
                "sql_analysis_results": step_with_analysis_results.sql_analysis_results,
                "sql_summary": step_with_analysis_results.summary,
                "full_sql": full_sql,
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
