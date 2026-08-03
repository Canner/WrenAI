import logging
import sys
from copy import deepcopy
from typing import Any, Dict

import tiktoken
from hamilton import base
from hamilton.driver import Driver
from langfuse.decorators import observe

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider

logger = logging.getLogger("wren-ai-service")


## Start of Pipeline
def _get_column_name(column: Any) -> str:
    if isinstance(column, dict):
        return str(column.get("name", ""))

    return str(column)


def _build_row_records(sql_data: Dict) -> list[dict]:
    column_names = [
        column_name
        for column_name in (
            _get_column_name(column) for column in sql_data.get("columns", [])
        )
        if column_name
    ]

    if not column_names:
        return []

    row_records = []
    for row in sql_data.get("data", []):
        if isinstance(row, dict):
            row_records.append(
                {column_name: row.get(column_name) for column_name in column_names}
            )
            continue

        if not isinstance(row, (list, tuple)):
            row = [row]

        row_records.append(
            {
                column_name: row[index] if index < len(row) else None
                for index, column_name in enumerate(column_names)
            }
        )

    return row_records


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

    sql_data = deepcopy(sql_data)
    sql_data["row_records"] = _build_row_records(sql_data)

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
        sql_data["row_records"] = _build_row_records(sql_data)
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
