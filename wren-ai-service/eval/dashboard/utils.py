from langfuse.client import Langfuse


def init_langfuse_client(public_key: str, secret_key: str, host: str):
    return Langfuse(
        public_key=public_key,
        secret_key=secret_key,
        host=host,
    )
