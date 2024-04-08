from typing import Any

from haystack import Pipeline

from src.core.pipeline import BasicPipeline
from src.pipelines.ask.components.document_store import init_document_store
from src.pipelines.ask.components.embedder import init_embedder
from src.pipelines.ask.components.post_processors import init_retrieval_post_processor
from src.pipelines.ask.components.retriever import init_retriever
from src.utils import load_env_vars

load_env_vars()


class Retrieval(BasicPipeline):
    def __init__(
        self,
        embedder: Any,
        retriever: Any,
    ):
        self._pipeline = Pipeline()
        self._pipeline.add_component("embedder", embedder)
        self._pipeline.add_component("retriever", retriever)
        self._pipeline.add_component("post_processor", init_retrieval_post_processor())

        self._pipeline.connect("embedder.embedding", "retriever.query_embedding")
        self._pipeline.connect("retriever.documents", "post_processor.documents")

        super().__init__(self._pipeline)

    def run(self, query: str):
        return self._pipeline.run(
            {
                "embedder": {
                    "text": query,
                },
            }
        )


if __name__ == "__main__":
    retrieval_pipeline = Retrieval(
        embedder=init_embedder(),
        retriever=init_retriever(
            document_store=init_document_store(),
        ),
    )

    print("generating retrieval_pipeline.jpg to outputs/pipelines/ask...")
    retrieval_pipeline.draw("./outputs/pipelines/ask/retrieval_pipeline.jpg")
