from typing import Any, Dict, List

from haystack import component
from haystack.components.embedders import OpenAITextEmbedder
from haystack.utils.auth import Secret

from src.utils import load_env_vars

from ...trace import TraceSpanInput, trace_span

load_env_vars()

EMBEDDING_MODEL_NAME = "text-embedding-3-large"
EMBEDDING_MODEL_DIMENSION = 3072


@component
class TracedOpenAITextEmbedder(OpenAITextEmbedder):
    def _run(self, *args, **kwargs):
        return super(TracedOpenAITextEmbedder, self).run(*args, **kwargs)

    @component.output_types(embedding=List[float], meta=Dict[str, Any])
    def run(self, text: str, trace_span_input: TraceSpanInput):
        return trace_span(self._run)(trace_span_input=trace_span_input, text=text)


def init_embedder(
    with_trace: bool = False, embedding_model_name: str = EMBEDDING_MODEL_NAME
):
    if with_trace:
        return TracedOpenAITextEmbedder(
            api_key=Secret.from_env_var("OPENAI_API_KEY"),
            model=embedding_model_name,
        )

    return OpenAITextEmbedder(
        api_key=Secret.from_env_var("OPENAI_API_KEY"),
        model=embedding_model_name,
    )
