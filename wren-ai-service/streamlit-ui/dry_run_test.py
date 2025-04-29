from litellm import completion, embedding
from session_state import ConfigState
import streamlit as st
import os


def llm_completion_test(llm_from):
    save_api_key()
    try:
    # 發送測試訊息
        response_completion = completion(
            model=llm_from["model"],
            messages=[{"role": "user", "content": "hi, who are you"}]
        )

        # 判斷回傳值是否有包含 choices 和 message 內容
        choices = response_completion.get("choices")
        if choices and choices[0].get("message", {}).get("content"):
            return True, response_completion["choices"][0]["message"]["content"]
        else:
            return False, "No valid response content"

    except Exception as e:
        # 捕捉到錯誤就回傳 False 和錯誤訊息
        return False, str(e)


def llm_embedding_test():
    save_api_key()
    try:
        embedder_block = st.session_state[ConfigState.EMBEDDER_KEY]
        embedding_model_name = embedder_block.get("models", [])[0].get("model")
        response_embedding = embedding(
            model=embedding_model_name,
            input=["Hello world"],
        )

        # 檢查回傳格式
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
    for service, api_key in st.session_state[ConfigState.API_KEY].items():
        os.environ[service] = api_key

