import logging
import os
from pprint import pformat
from typing import Any, Dict, List, Optional

import orjson
from haystack import Pipeline, component
from haystack.components.builders.prompt_builder import PromptBuilder

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.ask_details.components.prompts import (
    ask_details_system_prompt,
)
from src.utils import (
    add_quotes,
    check_if_sql_executable,
    clean_generation_result,
    init_providers,
    load_env_vars,
)

load_env_vars()
logger = logging.getLogger("wren-ai-service")


ask_details_user_prompt_template = """
### INPUT ###
SQL query: {{ sql }}

### FINAL ANSWER FORMAT ###
The final answer must be a valid JSON format as following:

{
    "description": <SHORT_SQL_QUERY_DESCRIPTION>,
    "steps: [
        {
            "sql": <SQL_QUERY_STRING_1>,
            "summary": <SUMMARY_STRING_1>,
            "cte_name": <CTE_NAME_STRING_1>
        }
    ] # a list of steps
}

Let's think step by step.
"""


@component
class GenerationPostProcessor:
    @component.output_types(
        results=Optional[Dict[str, Any]],
    )
    def run(self, replies: List[str]) -> Dict[str, Any]:
        cleaned_generation_result = orjson.loads(clean_generation_result(replies[0]))

        steps = cleaned_generation_result.get("steps", [])
        if not steps:
            return {
                "results": {
                    "description": cleaned_generation_result["description"],
                    "steps": [],
                },
            }

        for step in steps:
            step["sql"] = add_quotes(step["sql"])

        sql = _build_cte_query(steps)
        logger.debug(f"GenerationPostProcessor: steps: {pformat(steps)}")
        logger.debug(f"GenerationPostProcessor: final sql: {sql}")

        if not check_if_sql_executable(os.getenv("WREN_ENGINE_ENDPOINT"), sql):
            return {
                "results": {
                    "description": cleaned_generation_result["description"],
                    "steps": [],
                },
            }

        # make sure the last step has an empty cte_name
        steps[-1]["cte_name"] = ""

        return {
            "results": {
                "description": cleaned_generation_result["description"],
                "steps": steps,
            },
        }


def _build_cte_query(steps) -> str:
    ctes = ",\n".join(
        f"{step['cte_name']} AS ({step['sql']})" for step in steps if step["cte_name"]
    )

    return f"WITH {ctes}\n" + steps[-1]["sql"] if ctes else steps[-1]["sql"]


class Generation(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
    ):
        self._pipeline = Pipeline()
        self._pipeline.add_component(
            "ask_details_prompt_builder",
            PromptBuilder(template=ask_details_user_prompt_template),
        )
        self._pipeline.add_component(
            "ask_details_generator",
            llm_provider.get_generator(system_prompt=ask_details_system_prompt),
        )
        self._pipeline.add_component("post_processor", GenerationPostProcessor())

        self._pipeline.connect(
            "ask_details_prompt_builder.prompt", "ask_details_generator.prompt"
        )
        self._pipeline.connect(
            "ask_details_generator.replies", "post_processor.replies"
        )

        super().__init__(self._pipeline)

    def run(self, sql: str, include_outputs_from: List[str] | None = None):
        logger.info("Ask Details Generation pipeline is running...")
        return self._pipeline.run(
            {
                "ask_details_prompt_builder": {
                    "sql": sql,
                },
            },
            include_outputs_from=(
                set(include_outputs_from) if include_outputs_from else None
            ),
        )


if __name__ == "__main__":
    llm_provider, _ = init_providers()
    generation_pipeline = Generation(
        llm_provider=llm_provider,
    )

    print("generating generation_pipeline.jpg to outputs/pipelines/ask_details...")
    generation_pipeline.draw("./outputs/pipelines/ask_details/generation_pipeline.jpg")
