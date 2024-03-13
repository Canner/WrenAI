import json
from typing import Any, AnyStr, Dict, Optional

from haystack import Pipeline
from haystack.components.builders import PromptBuilder
from haystack.components.embedders import (
    OpenAIDocumentEmbedder,
    OpenAITextEmbedder,
)
from haystack.components.generators import OpenAIGenerator
from haystack.utils import Secret
from haystack_integrations.components.retrievers.qdrant import QdrantEmbeddingRetriever
from haystack_integrations.document_stores.qdrant import QdrantDocumentStore

from src.core.pipeline import BasicPipeline
from src.utils import load_env_vars

_TEMPLATE = """
There are numerous experts dedicated to generating semantic descriptions and names for various types of 
data. They are working together to provide a comprehensive and accurate description of the data.

### EXTRA INFORMATION ###
Given the following information to improve the description generation.

Context: 
{% for document in documents %}
    {{ document.content }}
{% endfor %}

### INSTRUCTIONS ###
- Provide a brief summary of the specified identifier as the description.
- Name the display_name based on the description, using natural language.

### TASK ###
Given the input model, provide a description of the specified identifier.

### MODEL STRUCTURE ###
Model Structure: {{ mdl }}

### MODEL NAME ###
Model Name: {{ model }}

### IDENTIFIER ###
the types for the identifier include: model, column@column_name
Identifier: {{ identifier }}

### OUTPUT FORMAT ###
The output format must be in JSON format:
{
 "identifier": "<IDENTIFIER>",
 "display_name": "<DISPLAY_NAME>",
 "description": "<DESCRIPTION>"
}

The output format doesn't need a markdown JSON code block.
"""


class Generation(BasicPipeline):
    def __init__(self):
        self._document_store = create_qdrant_document_store()
        self._text_embedder = create_openai_text_embedder()
        self._retriever = create_qdrant_embedding_retriever(
            document_store=self._document_store
        )
        self._prompt_builder = PromptBuilder(template=_TEMPLATE)
        self._llm = OpenAIGenerator()

        self._pipe = Pipeline()
        self._pipe.add_component("text_embedder", self._text_embedder)
        self._pipe.add_component("retriever", self._retriever)
        self._pipe.add_component("prompt_builder", self._prompt_builder)
        self._pipe.add_component("llm", self._llm)

        self._pipe.connect("text_embedder.embedding", "retriever.query_embedding")
        self._pipe.connect("retriever", "prompt_builder.documents")
        self._pipe.connect("prompt_builder", "llm")

        super().__init__(self._pipe)

    def run(
        self, *, mdl: Dict[AnyStr, Any], model: str, identifier: Optional[str] = None
    ):
        return self._pipe.run(
            {
                "prompt_builder": {
                    "mdl": mdl,
                    "model": model,
                    "identifier": identifier,
                },
                "text_embedder": {
                    "text": f"model: {model}, identifier: {identifier}",
                },
            }
        )


_EMBEDDING_MODEL_DIMENSION = 3072
_EMBEDDING_MODEL_NAME = "text-embedding-3-large"
_DATASET_NAME = "example"

"""
This is a simple example of how to use the QdrantDocumentStore and OpenAITextEmbedder to index and query documents.

```
document_store = create_qdrant_document_store()
documents = [Document(content="There are over 7,000 languages spoken around the world today."),
             Document(
                 content="Elephants have been observed to behave in a way that indicates a high level of self-awareness, such as recognizing themselves in mirrors."),
             Document(
                 content="In certain parts of the world, like the Maldives, Puerto Rico, and San Diego, you can witness the phenomenon of bioluminescent waves.")]

document_embedder = create_openai_document_embedder()
documents_with_embeddings = document_embedder.run(documents)
document_store.write_documents(documents_with_embeddings.get("documents"), policy=DuplicatePolicy.OVERWRITE)
```
"""


def create_qdrant_document_store(
    url: str = "localhost" if load_env_vars() == "dev" else "qdrant",
    embedding_dim: int = _EMBEDDING_MODEL_DIMENSION,
    index: str = _DATASET_NAME,
) -> QdrantDocumentStore:
    return QdrantDocumentStore(
        url=url,
        embedding_dim=embedding_dim,
        index=index,
    )


# this method is not being used in the pipeline, but it will be kept for testing and evaluation purposes
def create_openai_document_embedder(
    api_key: Secret = Secret.from_env_var("OPENAI_API_KEY"),
    model: str = _EMBEDDING_MODEL_NAME,
) -> OpenAIDocumentEmbedder:
    return OpenAIDocumentEmbedder(
        api_key=api_key,
        model=model,
    )


"""
This is a simple example of how to use the QdrantEmbeddingRetriever to query documents from the document store.

```
document_store = create_qdrant_document_store()
text_embedder = create_openai_text_embedder()
retriever = create_qdrant_embedding_retriever(document_store)

query_pipeline = Pipeline()
query_pipeline.add_component("text_embedder", text_embedder)
query_pipeline.add_component("retriever", retriever)

query_pipeline.connect("text_embedder.embedding", "retriever.query_embedding")

query = "How many languages are there?"

result = query_pipeline.run({"text_embedder": {"text": query}})

print(result['retriever']['documents'])
```
"""


def create_openai_text_embedder(
    api_key: Secret = Secret.from_env_var("OPENAI_API_KEY"),
    model: str = _EMBEDDING_MODEL_NAME,
) -> OpenAITextEmbedder:
    return OpenAITextEmbedder(
        api_key=api_key,
        model=model,
    )


def create_qdrant_embedding_retriever(
    document_store: QdrantDocumentStore, top_k: int = 3
) -> QdrantEmbeddingRetriever:
    return QdrantEmbeddingRetriever(
        document_store=document_store,
        top_k=top_k,
    )


if __name__ == "__main__":
    env = load_env_vars()
    pipe = Generation()

    res = pipe.run(
        **{
            "mdl": {
                "name": "all_star",
                "properties": {},
                "refsql": 'select * from "canner-cml".spider."baseball_1-all_star"',
                "columns": [
                    {
                        "name": "player_id",
                        "type": "varchar",
                        "notnull": False,
                        "iscalculated": False,
                        "expression": "player_id",
                        "properties": {},
                    },
                    {
                        "name": "year",
                        "type": "integer",
                        "notnull": False,
                        "iscalculated": False,
                        "expression": "year",
                        "properties": {},
                    },
                    {
                        "name": "game_num",
                        "type": "integer",
                        "notnull": False,
                        "iscalculated": False,
                        "expression": "game_num",
                        "properties": {},
                    },
                    {
                        "name": "game_id",
                        "type": "varchar",
                        "notnull": False,
                        "iscalculated": False,
                        "expression": "game_id",
                        "properties": {},
                    },
                    {
                        "name": "team_id",
                        "type": "varchar",
                        "notnull": False,
                        "iscalculated": False,
                        "expression": "team_id",
                        "properties": {},
                    },
                    {
                        "name": "league_id",
                        "type": "varchar",
                        "notnull": False,
                        "iscalculated": False,
                        "expression": "league_id",
                        "properties": {},
                    },
                    {
                        "name": "gp",
                        "type": "real",
                        "notnull": False,
                        "iscalculated": False,
                        "expression": "gp",
                        "properties": {},
                    },
                    {
                        "name": "starting_pos",
                        "type": "real",
                        "notnull": False,
                        "iscalculated": False,
                        "expression": "starting_pos",
                        "properties": {},
                    },
                ],
                "primarykey": "",
            },
            "model": "all_star",
            "identifier": "model",
        }
    )
    print(res)
    print(res["llm"]["replies"][0])
    content = json.loads(res["llm"]["replies"][0])
    print(content)

    pipe.draw("./outputs/pipelines/semantics/description.jpg")
    pass
