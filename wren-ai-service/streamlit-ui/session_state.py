import streamlit as st
import uuid


# session_state.py

import streamlit as st
import uuid

class ConfigState:
    LLM_FORMS_KEY = "llm_forms"
    LLM_MODELS_KEY = "llm_models"
    EMBEDDER_KEY = "embedding_model"
    DOC_STORE_KEY = "document_store"

    @classmethod
    def init(cls, llm_block, embedder_block, document_store_block, force=False):
        """初始化所有 Session State"""
        cls.init_llm_forms(llm_block, force=force)
        cls.init_embedder(embedder_block, force=force)
        cls.init_document_store(document_store_block, force=force)

    @classmethod
    def init_llm_forms(cls, llm_block, force=False):
        # 當 force=False 且已有資料時跳過
        if not force and cls.LLM_FORMS_KEY in st.session_state and st.session_state[cls.LLM_FORMS_KEY]:
            return
        
        """初始化 LLM Forms"""
        # st.session_state.setdefault(cls.LLM_FORMS_KEY, [])
        # st.session_state.setdefault(cls.LLM_MODELS_KEY, [])
        st.session_state[cls.LLM_FORMS_KEY] = []
        st.session_state[cls.LLM_MODELS_KEY] = []
        

        # 如果 llm_forms 是空的，從 llm_block 讀取
        if not st.session_state[cls.LLM_FORMS_KEY]:
            for model_item in llm_block.get("models", []):
                form_entry = {
                    "id": str(uuid.uuid4()),
                    "model": model_item.get("model", ""),
                    "alias": model_item.get("alias", ""),
                    "api_base": "https://api.openai.com/v1",
                    "timeout": str(llm_block.get("timeout", 120)),
                    "kwargs": [
                        {"key": k, "value": v}
                        for k, v in model_item.get("kwargs", {}).items()
                    ]
                }
                st.session_state[cls.LLM_FORMS_KEY].append(form_entry)

                model_entry = {
                    "id": form_entry["id"],
                    "model": form_entry["model"],
                    "alias": form_entry["alias"],
                    "api_base": form_entry["api_base"],
                    "timeout": form_entry["timeout"],
                    "kwargs": {k["key"]: k["value"] for k in form_entry["kwargs"] if k["key"]},
                }
                st.session_state[cls.LLM_MODELS_KEY].append(model_entry)

    @classmethod
    def init_embedder(cls, embedder_block, force=False):
        if not force and cls.EMBEDDER_KEY in st.session_state and st.session_state[cls.EMBEDDER_KEY]:
            return
        
        # st.session_state.setdefault(cls.EMBEDDER_KEY, None)
        st.session_state[cls.EMBEDDER_KEY] = None
        if embedder_block.get("models"):
            st.session_state[cls.EMBEDDER_KEY] = {
                "type": "embedder",
                "provider": embedder_block.get("provider"),
                "models": embedder_block.get("models"),
            }

    @classmethod
    def init_document_store(cls, document_store_block, force=False):
        if not force and cls.DOC_STORE_KEY in st.session_state and st.session_state[cls.DOC_STORE_KEY]:
            return
        # st.session_state.setdefault(cls.DOC_STORE_KEY, None)
        st.session_state[cls.DOC_STORE_KEY] = {
            "type": "document_store",
            "provider": document_store_block.get("provider"),
            "location": document_store_block.get("location"),
            "embedding_model_dim": document_store_block.get("embedding_model_dim", 3072),
            "timeout": document_store_block.get("timeout", 120),
            "recreate_index": document_store_block.get("recreate_index", False),
        }

    # 可以額外做 CRUD：新增 LLM、刪除 LLM、更新 Embedder...

