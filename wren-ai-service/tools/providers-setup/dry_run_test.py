from litellm import completion, embedding
from session_state import ConfigState
import streamlit as st
import os

def llm_completion_test(llm_from):
    """
    Test LLM completion using the selected model configuration.
    Sends a static prompt and verifies the returned message content.

    Args:
        llm_from (dict): Dictionary with model parameters (model name, etc.)

    Returns:
        (bool, str): Tuple of success flag and either response content or error message
    """
    save_api_key()
    try:
        response_completion = completion(
            model=llm_from["model"],
            messages=[{"role": "user", "content": "hi, who are you"}]
        )

        choices = response_completion.get("choices")
        if choices and choices[0].get("message", {}).get("content"):
            return True, response_completion["choices"][0]["message"]["content"]
        else:
            return False, "No valid response content"

    except Exception as e:
        return False, str(e)


def llm_embedding_test():
    """
    Test embedding model using a static input.
    Verifies that an embedding vector is returned and is valid.

    Returns:
        (bool, str): Tuple of success flag and message or error string
    """
    save_api_key()
    try:
        embedder_block = st.session_state[ConfigState.EMBEDDER_KEY]
        embedding_model_name = embedder_block.get("models", [])[0].get("model")

        response_embedding = embedding(
            model=embedding_model_name,
            input=["Hello world"],
        )

        data = response_embedding.get("data")
        if data and data[0].get("embedding"):
            embedding_vector = data[0]["embedding"]
            if isinstance(embedding_vector, list) and len(embedding_vector) > 0:
                return True, f"Embedding length: {len(embedding_vector)}"
            else:
                return False, "Embedding vector is empty or invalid"
        else:
            return False, "No embedding data returned"

    except Exception as e:
        return False, str(e)


def save_api_key():
    """
    Set all saved API keys from session state into environment variables.
    Enables external libraries like LiteLLM to access required credentials.
    """
    for service, api_key in st.session_state[ConfigState.API_KEY].items():
        os.environ[service] = api_key
