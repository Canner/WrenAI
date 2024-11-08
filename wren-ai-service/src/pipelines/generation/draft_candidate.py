import logging
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import orjson
from hamilton import base
from hamilton.experimental.h_async import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline, async_validate
from src.core.provider import LLMProvider

logger = logging.getLogger("wren-ai-service")


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    sql: str,
    question: str,
    language: str,
    current_date: str,
    prompt_builder: PromptBuilder,
) -> dict:
    return prompt_builder.run(
        sql=sql,
        question=question,
        language=language,
        current_date=current_date,
    )


@observe(capture_input=False, as_type="generation")
async def generate(prompt: dict, generator: Any) -> dict:
    return await generator.run(prompt=prompt.get("prompt"))


@observe(capture_input=False)
def normalized(generate: dict) -> dict:
    def wrapper(text: str) -> dict:
        text = text.replace("\n", " ")
        text = " ".join(text.split())
        try:
            text_dict = orjson.loads(text.strip())
            return text_dict
        except orjson.JSONDecodeError as e:
            logger.error(f"Error decoding JSON: {e}")
            return {"candidates": []}  # Return empty candidates if JSON decoding fails

    reply = generate.get("replies")[0]  # Expecting only one reply
    normalized = wrapper(reply)

    return normalized


## End of Pipeline
class Candidate(BaseModel):
    sql: str
    summary: str


class CandidateResult(BaseModel):
    candidates: list[Candidate]


DRAFT_CANDIDATE_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "draft_candidate",
            "schema": CandidateResult.model_json_schema(),
        },
    }
}

system_prompt = """
"""

user_prompt_template = """
SQL Query:
{{sql}}

Question:
{{question}}

Current Date: {{current_date}}
Language: {{language}}
"""


class DraftCandidate(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **_,
    ):
        self._components = {
            "prompt_builder": PromptBuilder(template=user_prompt_template),
            "generator": llm_provider.get_generator(
                system_prompt=system_prompt,
                generation_kwargs=DRAFT_CANDIDATE_MODEL_KWARGS,
            ),
        }

        self._final = "normalized"

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def visualize(
        self,
        sql: str,
        question: str,
        language: str = "English",
        current_date: str = datetime.now(),
    ) -> None:
        destination = "outputs/pipelines/generation"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            [self._final],
            output_file_path=f"{destination}/draft_candidate.dot",
            inputs={
                "sql": sql,
                "question": question,
                "language": language,
                "current_date": current_date,
            },
            show_legend=True,
            orient="LR",
        )

    @observe(name="Draft Candidate")
    async def run(
        self,
        sql: str,
        question: str,
        language: str = "English",
        current_date: str = datetime.now(),
    ) -> dict:
        logger.info("Draft Candidate pipeline is running...")
        return await self._pipe.execute(
            [self._final],
            inputs={
                "sql": sql,
                "question": question,
                "language": language,
                "current_date": current_date,
                **self._components,
            },
        )


if __name__ == "__main__":
    from langfuse.decorators import langfuse_context

    from src.core.engine import EngineConfig
    from src.core.pipeline import async_validate
    from src.providers import init_providers
    from src.utils import init_langfuse, load_env_vars

    load_env_vars()
    init_langfuse()

    llm_provider, _, _, _ = init_providers(EngineConfig())
    pipeline = DraftCandidate(llm_provider=llm_provider)

    input = {
        "sql": "SELECT * FROM users",
        "question": "How many users are there?",
        "language": "English",
    }

    # pipeline.visualize(**input)
    async_validate(lambda: pipeline.run(**input))

    langfuse_context.flush()
