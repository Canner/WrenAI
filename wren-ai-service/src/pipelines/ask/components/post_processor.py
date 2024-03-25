import json
from typing import Any, Dict, List, Optional

from haystack import component

from src.utils import clean_generation_result


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

        return {
            "results": (
                [cleaned_generation_result]
                if isinstance(cleaned_generation_result, dict)
                else cleaned_generation_result
            )
        }
