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
) -> Dict:
    _token_count = len(encoding.encode(str(sql_data)))
    num_rows_used_in_llm = len(sql_data.get("data", []))

    if _token_count > 100_000:
        sql_data = {
            "columns": sql_data.get("columns", []),
            "data": sql_data.get("data", [])[:250],
            "dtypes": sql_data.get("dtypes", {}),
        }

        num_rows_used_in_llm = len(sql_data.get("data", []))

        return {
            "sql_data": sql_data,
            "num_rows_used_in_llm": num_rows_used_in_llm,
            "tokens": _token_count,
        }

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
