import logging
from typing import List

import orjson
from hamilton import driver
from haystack import component
from haystack.components.builders.prompt_builder import PromptBuilder

from src.utils import init_providers, load_env_vars, timer

# logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("wren-ai-service")


_prompt = """
### TASK ###
Based on the user's input below, classify whether the query is not random words.
Provide your classification as 'Yes' or 'No'. Yes if you think the query is not random words, and No if you think the query is random words.

### FINAL ANSWER FORMAT ###
The final answer must be the JSON format like following:

{
    "result": "yes" or "no"
}

### INPUT ###
{{ query }}

Let's think step by step.
"""
prompt_builder = PromptBuilder(template=_prompt)


def prompt(query: str) -> dict:
    return prompt_builder.run(query=query)


llm_provider, _ = init_providers()
generator = llm_provider.get_generator()


@timer
def generate(prompt: dict) -> dict:
    logger.info("prompt: %s", prompt)
    return generator.run(prompt=prompt.get("prompt"))


@component
class QueryUnderstandingPostProcessor:
    @component.output_types(
        is_valid_query=bool,
    )
    def run(self, replies: List[str]):
        try:
            result = orjson.loads(replies[0])["result"]

            if result == "yes":
                return {
                    "is_valid_query": True,
                }

            return {
                "is_valid_query": False,
            }
        except Exception as e:
            logger.error(f"Error in QueryUnderstandingPostProcessor: {e}")

            return {
                "is_valid_query": True,
            }


post_processor = QueryUnderstandingPostProcessor()


def post_process(generate: dict) -> dict:
    logger.info("generate: %s", generate)
    return post_processor.run(generate.get("replies"))


if __name__ == "__main__":
    import __main__

    load_env_vars()

    # dr = AsyncDriver({}, __main__)
    dr = driver.Builder().with_modules(__main__).build()
    result = dr.execute(
        [post_process], inputs={"query": "What is the capital of France?"}
    )

    print(result)
