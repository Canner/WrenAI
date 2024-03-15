from typing import Any, Dict, List, Optional

from haystack import Document, component
from haystack_integrations.components.retrievers.qdrant import QdrantEmbeddingRetriever

from ...trace import TraceSpanInput, trace_span


@component
class TracedQdrantEmbeddingRetriever(QdrantEmbeddingRetriever):
    def _run(self, *args, **kwargs):
        return super(TracedQdrantEmbeddingRetriever, self).run(*args, **kwargs)

    @component.output_types(documents=List[Document])
    def run(
        self,
        trace_span_input: TraceSpanInput,
        query_embedding: List[float],
        filters: Optional[Dict[str, Any]] = None,
        top_k: Optional[int] = None,
        scale_score: Optional[bool] = None,
        return_embedding: Optional[bool] = None,
    ):
        return trace_span(self._run)(
            trace_span_input=trace_span_input,
            query_embedding=query_embedding,
            filters=filters,
            top_k=top_k,
            scale_score=scale_score,
            return_embedding=return_embedding,
        )


def init_retriever(document_store: Any, with_trace: bool = False, top_k: int = 3):
    if with_trace:
        return TracedQdrantEmbeddingRetriever(
            document_store=document_store,
            top_k=top_k,
        )

    return QdrantEmbeddingRetriever(document_store=document_store, top_k=top_k)
