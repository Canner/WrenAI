from haystack.components.embedders import OpenAITextEmbedder
from haystack.utils.auth import Secret

from src.utils import load_env_vars

load_env_vars()

EMBEDDING_MODEL_NAME = "text-embedding-3-large"
EMBEDDING_MODEL_DIMENSION = 3072


def init_embedder(embedding_model_name: str = EMBEDDING_MODEL_NAME):
    return OpenAITextEmbedder(
        api_key=Secret.from_env_var("OPENAI_API_KEY"),
        model=embedding_model_name,
    )
