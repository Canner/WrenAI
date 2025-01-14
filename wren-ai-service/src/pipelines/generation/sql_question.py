import asyncio
import logging
import sys
from typing import Any

import orjson
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.web.v1.services import Configuration

logger = logging.getLogger("wren-ai-service")


sql_question_system_prompt = """
### TASK ###

You are a data analyst great at translating any SQL query into a question that can be answered by the given SQL query.

### INSTRUCTIONS ###

- The question should be in the language of the user provided
- The question should be a single sentence, concise, and easy to understand

### OUTPUT FORMAT ###

Please return the result in the following JSON format:

{
    "question": <QUESTION_STRING_IN_USER_LANGUAGE>
}
"""

sql_question_user_prompt_template = """
SQL: {{sql}}
Language: {{language}}

Let's think step by step.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompts(
    sqls: list[str],
    language: str,
    prompt_builder: PromptBuilder,
) -> list[dict]:
    """
    Generate prompts for SQL queries in a specified language using a prompt builder.
    
    Parameters:
        sqls (list[str]): A list of SQL queries to generate prompts for.
        language (str): The target language for the generated prompts.
        prompt_builder (PromptBuilder): A prompt builder instance used to create prompts.
    
    Returns:
        list[dict]: A list of generated prompts, one for each input SQL query.
    
    Example:
        prompt_builder = PromptBuilder()
        sql_queries = ["SELECT * FROM users", "SELECT name FROM employees"]
        prompts = prompts(sql_queries, "English", prompt_builder)
    """
    return [
        prompt_builder.run(
            sql=sql,
            language=language,
        )
        for sql in sqls
    ]


@observe(as_type="generation", capture_input=False)
async def generate_sql_questions(prompts: list[dict], generator: Any) -> list[dict]:
    # use asyncio.gather to run all prompts in parallel
    """
    Asynchronously generate SQL questions by concurrently processing multiple prompts using a generator.
    
    Parameters:
        prompts (list[dict]): A list of dictionaries containing prompts for SQL question generation.
        generator (Any): An asynchronous function or callable capable of generating responses from prompts.
    
    Returns:
        list[dict]: A list of generated SQL question results, processed in parallel.
    
    Notes:
        - Utilizes asyncio.gather for concurrent execution of generator calls
        - Each prompt is processed independently and simultaneously
        - Preserves the order of input prompts in the output results
    """
    return await asyncio.gather(
        *[generator(prompt=prompt.get("prompt")) for prompt in prompts]
    )


@observe(capture_input=False)
async def post_process(
    generate_sql_questions: list[dict],
) -> list[dict]:
    """
    Extracts and returns the generated SQL questions from the pipeline results.
    
    Parameters:
        generate_sql_questions (list[dict]): A list of dictionaries containing generation results from SQL question generation.
    
    Returns:
        list[dict]: A list of generated SQL questions extracted from the first reply of each result.
    
    Notes:
        - Uses orjson for efficient JSON parsing
        - Assumes each result contains a 'replies' key with at least one JSON-encoded reply
        - Extracts the 'question' field from the first reply
    """
    return [
        orjson.loads(result.get("replies")[0])["question"]
        for result in generate_sql_questions
    ]


## End of Pipeline


class SQLQuestionResult(BaseModel):
    question: str


SQL_QUESTION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "sql_question_result",
            "schema": SQLQuestionResult.model_json_schema(),
        },
    }
}


class SQLQuestion(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **kwargs,
    ):
        """
        Initialize the SQLQuestion pipeline with a language model provider and optional components.
        
        Parameters:
            llm_provider (LLMProvider): Provider for generating language model responses.
            **kwargs: Additional optional keyword arguments for pipeline configuration.
        
        Attributes:
            _components (dict): Dictionary containing pipeline components:
                - 'generator': Language model generator configured with SQL question system prompt
                - 'prompt_builder': Prompt builder using SQL question user prompt template
        
        Notes:
            - Initializes an asynchronous driver for pipeline execution
            - Uses default SQL question model configuration and system prompts
        """
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=sql_question_system_prompt,
                generation_kwargs=SQL_QUESTION_MODEL_KWARGS,
            ),
            "prompt_builder": PromptBuilder(template=sql_question_user_prompt_template),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Sql Question Generation")
    async def run(
        self,
        sqls: list[str],
        configuration: Configuration = Configuration(),
    ):
        """
        Asynchronously run the SQL question generation pipeline.
        
        Generates natural language questions from a list of SQL queries using the configured pipeline components.
        
        Parameters:
            sqls (list[str]): A list of SQL queries to generate questions for.
            configuration (Configuration, optional): Configuration settings for the pipeline. 
                Defaults to a new Configuration instance with default settings.
        
        Returns:
            list[str]: A list of generated natural language questions corresponding to the input SQL queries.
        
        Notes:
            - Uses the pipeline's execute method with 'post_process' as the final stage
            - Defaults to English language if no language is specified in the configuration
            - Logs the start of the SQL question generation process
        """
        logger.info("Sql Question Generation pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "sqls": sqls,
                "language": configuration.language or "English",
                **self._components,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        SQLQuestion,
        "sql_question",
        sqls=["SELECT * FROM table", "SELECT * FROM table2"],
        configuration=Configuration(),
    )
