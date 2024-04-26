import json
import logging
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
from src.utils import generate_ddls_from_semantics, load_env_vars

load_env_vars()
logger = logging.getLogger("wren-ai-service")

DATASET_NAME = os.getenv("DATASET_NAME")


class Indexing(BasicPipeline):
    def __init__(
        self,
        document_store: DocumentStore,
        embedding_model_name: str = EMBEDDING_MODEL_NAME,
        embedding_model_dim: int = EMBEDDING_MODEL_DIMENSION,
    ) -> None:
        self._pipeline = Pipeline()
        # TODO: add a component to remove existing documents to fully delete old documents
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

        logger.debug(f"original mdl_json: {json.dumps(mdl_json, indent=2)}")

        for i, _ in enumerate(mdl_json["relationships"]):
            mdl_json["relationships"][i]["type"] = "relationship"

        semantics = {
            "models": [],
            "relationships": mdl_json["relationships"],
            "views": mdl_json["views"],
        }

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

        ddl_commands = generate_ddls_from_semantics(
            semantics["models"],
            semantics["relationships"],
        )

        ddl_commands.extend(self._convert_views(semantics["views"]))

        embeddings = self._openai_client.embeddings.create(
            input=ddl_commands,
            model=self.embedding_model_name,
            dimensions=self.embedding_model_dim,
        )

        return [
            Document(
                id=str(i),
                meta={"id": str(i)},
                content=ddl_command,
                embedding=embeddings.data[i].embedding,
            )
            for i, ddl_command in enumerate(tqdm(ddl_commands))
        ]

    def _convert_views(self, views: List[Dict[str, Any]]) -> List[str]:
        def _format(view: Dict[str, Any]) -> str:
            properties = view["properties"] if view["properties"] else ""
            return f"/* {properties} */\nCREATE VIEW {view['name']}\nAS ({view['statement']})"

        return [_format(view) for view in views]


if __name__ == "__main__":
    indexing_pipeline = Indexing(
        document_store=init_document_store(),
    )

    print("generating indexing_pipeline.jpg to outputs/pipelines/ask...")
    indexing_pipeline.draw("./outputs/pipelines/ask/indexing_pipeline.jpg")
