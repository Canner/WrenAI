# ui_components.py

import streamlit as st
import uuid
from session_state import ConfigState

def render_llm_config():
    # st.subheader("LLM Configuration")

    # ① 新增一個空白表單
    if st.button("➕  Add model", key="btn_add_model"):
        st.session_state[ConfigState.LLM_FORMS_KEY].append({
            "id": str(uuid.uuid4()),
            "model": "new-model",
            "alias": "",
            "api_base": "",
            "timeout": "120",
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
                    save_llm_model(form, form_id)
                    st.rerun()
            with c2:
                if st.button("🗑️  Remove this form", key=f"remove_form_{form_id}"):
                    remove_llm_model(form_id)
                    st.rerun()

def save_llm_model(form, form_id):
    # 轉成 kwargs dict
    kwargs_dict = {}
    for p in form["kwargs"]:
        if p["key"]:
            try:
                kwargs_dict[p["key"]] = eval(p["value"])
            except Exception:
                kwargs_dict[p["key"]] = p["value"]

    saved_entry = {
        "model": form["model"],
        "alias": form["alias"],
        "api_base": form["api_base"],
        "timeout": form["timeout"],
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

