import logging
import sys
from typing import Dict

import tiktoken
from hamilton import base
from hamilton.driver import Driver
from langfuse.decorators import observe

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider

logger = logging.getLogger("wren-ai-service")


## Start of Pipeline
@observe(capture_input=False, capture_output=False)
def preprocess(
    sql_data: Dict,
    encoding: tiktoken.Encoding,
    context_window_size: int,
) -> Dict:
    def reduce_data_size(data: list, reduction_step: int = 50) -> list:
        """Reduce the size of data by removing elements from the end.

        Args:
            data: The input list to reduce
            reduction_step: Number of elements to remove (must be positive)

        Returns:
            list: A list with reduced size

        Raises:
            ValueError: If reduction_step is not positive
        """
        if reduction_step <= 0:
            raise ValueError("reduction_step must be positive")

        elements_to_keep = max(0, len(data) - reduction_step)
        returned_data = data[:elements_to_keep]

        logger.info(
            f"Reducing data size by {reduction_step} rows. "
            f"Original size: {len(data)}, New size: {len(returned_data)}"
        )

        return returned_data

    _token_count = len(encoding.encode(str(sql_data)))
    num_rows_used_in_llm = len(sql_data.get("data", []))
    iteration = 0

    while _token_count > context_window_size:
        if iteration > 1000:
            """
            Avoid infinite loop
            If the token count is still too high after 1000 iterations, break
            """
            break

        iteration += 1

        data = sql_data.get("data", [])
        sql_data["data"] = reduce_data_size(data)
        num_rows_used_in_llm = len(sql_data.get("data", []))
        _token_count = len(encoding.encode(str(sql_data)))
        logger.info(f"Token count: {_token_count}")

    return {
        "sql_data": sql_data,
        "num_rows_used_in_llm": num_rows_used_in_llm,
        "tokens": _token_count,
    }


## End of Pipeline


class PreprocessSqlData(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **kwargs,
    ):
        _model = llm_provider.get_model()
        if _model == "gpt-4o-mini" or _model == "gpt-4o":
            _encoding = tiktoken.get_encoding("o200k_base")
        else:
            _encoding = tiktoken.get_encoding("cl100k_base")

        self._configs = {
            "encoding": _encoding,
            "context_window_size": llm_provider.get_context_window_size(),
        }

        super().__init__(Driver({}, sys.modules[__name__], adapter=base.DictResult()))

    @observe(name="Preprocess SQL Data")
    def run(
        self,
        sql_data: Dict,
    ):
        logger.info("Preprocess SQL Data pipeline is running...")
        return self._pipe.execute(
            ["preprocess"],
            inputs={
                "sql_data": sql_data,
                **self._configs,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(PreprocessSqlData, "preprocess_sql_data", sql_data={})
