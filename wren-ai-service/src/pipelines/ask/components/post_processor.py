import json
import os
from typing import Any, Dict, List, Optional

from haystack import component

from src.utils import (
    clean_generation_result,
    get_mdl_catalog_and_schema,
    load_env_vars,
    remove_invalid_generation_results,
)

load_env_vars()


@component
class PostProcessor:
    @component.output_types(processed_replies=List[Optional[Dict[str, Any]]])
    def run(self, replies: List[str]):
        cleaned_generation_result = json.loads(clean_generation_result(replies[0]))

        if (
            isinstance(cleaned_generation_result, dict)
            and cleaned_generation_result["sql"] == ""
        ):
            return {"results": []}

        mdl_catalog, mdl_schema = get_mdl_catalog_and_schema(
            os.getenv("WREN_ENGINE_API_ENDPOINT")
        )
        valid_generation_results = remove_invalid_generation_results(
            f'{os.getenv("WREN_ENGINE_SQL_ENDPOINT")}/{mdl_catalog}?options=--search_path%3D{mdl_schema}',
            [cleaned_generation_result]
            if isinstance(cleaned_generation_result, dict)
            else cleaned_generation_result,
        )

        return {"results": valid_generation_results}
