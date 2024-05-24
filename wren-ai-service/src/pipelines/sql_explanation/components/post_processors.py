import json
import logging
from typing import Any, Dict, List, Optional

from haystack import component

from src.utils import (
    load_env_vars,
)

logger = logging.getLogger("wren-ai-service")
load_env_vars()


@component
class GenerationPostProcessor:
    @component.output_types(
        results=Optional[Dict[str, Any]],
    )
    def run(self, replies: List[str]) -> Dict[str, Any]:
        return {"results": json.loads(replies[0])}


def init_generation_post_processor():
    return GenerationPostProcessor()
