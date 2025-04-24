import streamlit as st
import uuid
from session_state import ConfigState


if "save_error" in st.session_state:
    st.error(st.session_state["save_error"])


def render_llm_config():
    # st.subheader("LLM Configuration")

    # ① 新增一個空白表單
    if st.button("➕  Add model", key="btn_add_model"):
        st.session_state[ConfigState.LLM_FORMS_KEY].append({
            "id": str(uuid.uuid4()),
            "model": "new-model",
            "alias": "",
            "api_base": "",
            "timeout": 120,
            "kwargs": []
        })

    # ② 逐一渲染 Expander
    for idx, form in enumerate(st.session_state[ConfigState.LLM_FORMS_KEY]):
        form_id = form["id"]
        title = form["model"] or f"LLM Model {idx+1}"

        with st.expander(title, expanded=False):
            # 基本欄位
            form["model"] = st.text_input("Model name", key=f"model_name_{form_id}", value=form["model"])
            form["alias"] = st.text_input("Alias", key=f"alias_{form_id}", value=form["alias"])
            form["api_base"] = st.text_input("API Base URL", key=f"api_base_{form_id}", value=form["api_base"])
            form["timeout"] = st.text_input("Timeout", key=f"timeout_{form_id}", value=form["timeout"])

            # 動態 KWArgs
            if st.button("➕ Add KWArg Field", key=f"add_kwarg_{idx}"):
                form["kwargs"].append({"key": "", "value": ""})

            for kw_idx, pair in enumerate(form["kwargs"]):
                kcol, vcol, rcol = st.columns([4, 4, 3])
                with kcol:
                    pair["key"] = st.text_input("Key", key=f"kw_key_{idx}_{kw_idx}", value=pair["key"])
                with vcol:
                    pair["value"] = st.text_input("Value", key=f"kw_val_{idx}_{kw_idx}", value=pair["value"])
                with rcol:
                    st.markdown("<br>", unsafe_allow_html=True)
                    if st.button("DEL", key=f"del_kw_{form_id}_{kw_idx}"):
                        form["kwargs"].pop(kw_idx)
                        st.rerun()

            # 儲存/刪除 按鈕
            c1, c2 = st.columns(2)
            with c1:
                if st.button("💾  Save this model", key=f"save_{form_id}"):
                    # 如果沒有錯誤，就清除錯誤訊息
                    st.session_state.pop("save_error", None)
                    save_llm_model(form, form_id)
            with c2:
                if st.button("🗑️  Remove this form", key=f"remove_form_{form_id}"):
                    remove_llm_model(form_id)


def render_embedder_config():
    # =====================
    # Embedder Configuration
    # =====================

    with st.expander(" Embedder Configuration", expanded=False):
        st.markdown(f"**type:** `embedder`")
        st.markdown(f"**provider:** `{st.session_state[ConfigState.EMBEDDER_KEY].get('provider')}`")

        embedding_model_name = st.text_input("Embedding Model Name", key="embedding_model_name", value="text-embedding-3-large")
        embedding_model_alias = st.text_input("Alias (optional, e.g. default)", key="embedding_model_alias", value="default")
        embedding_model_timeout = st.text_input("Timeout (optional, default: 120)", key="embedding_model_timeout", value="120")

        custom_embedding_setting = [{
            "model": embedding_model_name,
            "alias": embedding_model_alias,
            "timeout": embedding_model_timeout
        }]

        if st.button("save", key="save_embedding_model"):
            st.session_state.embedding_model = {
                "type": "embedder",
                "provider": st.session_state[ConfigState.EMBEDDER_KEY].get("provider"),
                "models": custom_embedding_setting
            }


def render_document_store_config():
    # =====================
    # Document Store Configuration
    # =====================

    with st.expander(" Document Store Configuration", expanded=False):
        st.markdown(f"**type:** `document_store`")
        st.markdown(f"**provider:** `{st.session_state[ConfigState.DOC_STORE_KEY].get('provider')}`")
        st.markdown(f"**location:** `{st.session_state[ConfigState.DOC_STORE_KEY].get('location')}`")
        document_store_timeout = st.text_input("Timeout (optional, default: 120)", key="document_store_timeout" , value="120")
        st.markdown(f"**timeout:** `120`")
        st.markdown(f"**recreate_index:** `{st.session_state[ConfigState.DOC_STORE_KEY].get('recreate_index')}`")
        document_store_dim = st.text_input("Embedding_model_dim", value="3072")

        if st.button("save", key="save_document_store"):
            st.session_state.document_store = {

                "type": "document_store",
                "provider": st.session_state[ConfigState.DOC_STORE_KEY].get("provider"),
                "location": st.session_state[ConfigState.DOC_STORE_KEY].get("location"),
                "embedding_model_dim": document_store_dim,
                "timeout": document_store_timeout,
                "recreate_index": st.session_state[ConfigState.DOC_STORE_KEY].get("recreate_index")

            }


def save_llm_model(form, form_id):
    # 轉成 kwargs dict
    kwargs_dict = {}
    for p in form["kwargs"]:
        if p["key"]:
            try:
                kwargs_dict[p["key"]] = eval(p["value"])
            except Exception:
                kwargs_dict[p["key"]] = p["value"]

    # 檢查 alias 是否重複
    if form["alias"]:
        existing_aliases = [
            m.get("alias") for m in st.session_state[ConfigState.LLM_MODELS_KEY] 
            if m.get("id") != form_id and "alias" in m
        ]
        if form["alias"] in existing_aliases:
            # 儲存錯誤訊息到 session state
            st.error(f"Duplicate alias name: {form['alias']}.")
            return False  # 不儲存
    
    saved_entry = {
        "model": form["model"],
        **({"alias": form["alias"]} if form["alias"] else {}),
        "api_base": form["api_base"],
        "timeout": safe_eval(form["timeout"], default=120),
        "kwargs": kwargs_dict,
    }

    existing_ids = [m.get("id") for m in st.session_state[ConfigState.LLM_MODELS_KEY]]
    if form_id in existing_ids:
        index = existing_ids.index(form_id)
        st.session_state[ConfigState.LLM_MODELS_KEY][index] = {**saved_entry, "id": form_id}
        st.success(f"Updated model: {form['model']}")
    else:
        st.session_state[ConfigState.LLM_MODELS_KEY].append({**saved_entry, "id": form_id})
        st.success(f"Added new model: {form['model']}")

def remove_llm_model(form_id):
    # 刪除 llm_forms
    st.session_state[ConfigState.LLM_FORMS_KEY] = [
        f for f in st.session_state[ConfigState.LLM_FORMS_KEY] if f["id"] != form_id
    ]
    # 刪除 llm_models
    st.session_state[ConfigState.LLM_MODELS_KEY] = [
        m for m in st.session_state[ConfigState.LLM_MODELS_KEY] if m.get("id") != form_id
    ]

def safe_eval(value, default=None):
    """安全地評估字符串值，失敗時返回原始值或默認值"""
    if not value:
        return default
    try:
        return eval(value)
    except Exception:
        return value
