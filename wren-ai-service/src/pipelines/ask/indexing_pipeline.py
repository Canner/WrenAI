import json
import os
from typing import Any, Dict, List

import openai
from haystack import Document, Pipeline
from haystack.components.writers import DocumentWriter
from haystack.document_stores.types import DocumentStore, DuplicatePolicy
from tqdm import tqdm

from src.core.pipeline import BasicPipeline
from src.pipelines.ask.components.document_store import init_document_store
from src.pipelines.ask.components.embedder import (
    EMBEDDING_MODEL_DIMENSION,
    EMBEDDING_MODEL_NAME,
)
from src.utils import load_env_vars

load_env_vars()

DATASET_NAME = os.getenv("DATASET_NAME")


class Indexing(BasicPipeline):
    def __init__(
        self,
        document_store: DocumentStore,
        embedding_model_name: str = EMBEDDING_MODEL_NAME,
        embedding_model_dim: int = EMBEDDING_MODEL_DIMENSION,
    ) -> None:
        self._pipeline = Pipeline()
        self._pipeline.add_component(
            "writer",
            DocumentWriter(
                document_store=document_store,
                policy=DuplicatePolicy.OVERWRITE,
            ),
        )
        self._openai_client = openai.Client(api_key=os.getenv("OPENAI_API_KEY"))

        self.embedding_model_name = embedding_model_name
        self.embedding_model_dim = embedding_model_dim

        super().__init__(self._pipeline)

    def run(self, mdl_str: str) -> Dict[str, Any]:
        return self._pipeline.run(
            {"writer": {"documents": self._get_documents(mdl_str)}}
        )

    def _get_documents(self, mdl_str: str) -> List[Document]:
        mdl_json = json.loads(mdl_str)

        semantics = {"models": [], "relationships": mdl_json["relationships"]}

        for model in mdl_json["models"]:
            columns = []
            for column in model["columns"]:
                if "relationship" in column:
                    columns.append(
                        {
                            "name": column["name"],
                            "properties": column["properties"],
                            "type": column["type"],
                            "relationship": column["relationship"],
                        }
                    )
                else:
                    columns.append(
                        {
                            "name": column["name"],
                            "properties": column["properties"],
                            "type": column["type"],
                        }
                    )

            semantics["models"].append(
                {
                    "type": "model",
                    "name": model["name"],
                    "properties": model["properties"],
                    "columns": columns,
                    "primaryKey": model["primaryKey"],
                }
            )

        embeddings = self._openai_client.embeddings.create(
            input=[
                json.dumps(data)
                for data in semantics["models"] + semantics["relationships"]
            ],
            model=self.embedding_model_name,
            dimensions=self.embedding_model_dim,
        )

        return [
            Document(
                id=str(i),
                meta={"id": str(i)},
                content=json.dumps(data),
                embedding=embeddings.data[i].embedding,
            )
            for i, data in enumerate(
                tqdm(semantics["models"] + semantics["relationships"])
            )
        ]


# this is for quick testing only, please ignore this
if __name__ == "__main__":
    document_store = init_document_store()

    indexing_pipeline = Indexing(
        document_store=document_store,
    )

    with open("src/eval/data/book_2_mdl.json", "r") as f:
        mdl_str = json.dumps(json.load(f))

    indexing_pipeline.run(mdl_str)
    indexing_pipeline.draw("./outputs/pipelines/ask/indexing_pipeline.jpg")

    print(
        f"finished indexing documents, document count: {document_store.count_documents()}"
    )
