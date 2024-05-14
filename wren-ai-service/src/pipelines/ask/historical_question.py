import logging

from haystack import Pipeline

from src.core.document_store_provider import DocumentStoreProvider
from src.core.llm_provider import LLMProvider
from src.core.pipeline import BasicPipeline
from src.utils import init_providers, load_env_vars

load_env_vars()
logger = logging.getLogger("wren-ai-service")


class HistoricalQuestion(BasicPipeline):
    def __init__(
        self, llm_provider: LLMProvider, store_provider: DocumentStoreProvider
    ) -> None:
        pipe = Pipeline()
        pipe.add_component("embedder", llm_provider.get_text_embedder())
        pipe.add_component(
            "retriever",
            store_provider.get_retriever(
                document_store=store_provider.get_store(dataset_name="view_questions"),
                top_k=1,
            ),
        )

        pipe.connect("embedder.embedding", "retriever.query_embedding")

        self._pipeline = pipe
        super().__init__(self._pipeline)

    def run(self, query: str):
        return self._pipeline.run({"embedder": {"text": query}})


if __name__ == "__main__":
    pipeline = HistoricalQuestion(*init_providers())

    res = pipeline.run("What is the capital of France?")
    print(res.get("retriever"))
    document = res.get("retriever").get("documents")[0]
    print(document.content)

    # print("generating historical_question.jpg to outputs/pipelines/ask...")
    # pipeline.draw("./outputs/pipelines/historical_question.jpg")
