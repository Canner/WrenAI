from litellm import completion, embedding
from session_state import ConfigState
import streamlit as st
import os


# os.environ["OPENAI_API_KEY"] = "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"


def llm_completion_test():
    os.environ["OPENAI_API_KEY"] = st.session_state[ConfigState.API_KEY]
    try:
    # 發送測試訊息
        response_completion = completion(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": "hi"}]
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
    os.environ["OPENAI_API_KEY"] = st.session_state[ConfigState.API_KEY]
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



