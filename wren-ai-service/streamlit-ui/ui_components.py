import streamlit as st
import uuid
from session_state import ConfigState
from config_loader import group_blocks
from dry_run_test import llm_completion_test, llm_embedding_test
import yaml

def render_apikey():
    with st.expander("API Key", expanded=False):

        api_key = st.text_input(
            "Enter your API key:",
            type="password",
            key="api_key_input"
        )

        if st.button("save", key="save_apikey"):
            if not api_key:
                st.error("請輸入 API Key")
            else:
                st.session_state[ConfigState.API_KEY] = api_key



        

def render_import_yaml():
    st.subheader("LLM Configuration")
    # IMPORT YAML
    uploaded_file = st.file_uploader("Choose a YAML file", type=["yaml", "yml"])
    
    if uploaded_file is not None:
        if st.button("Import.yaml", key="import_yaml"):
            try:
                # 解析使用者上傳的 yaml 檔案
                user_config_list = list(yaml.safe_load_all(uploaded_file))
                user_config_block = group_blocks(user_config_list)  # 將 YAML 轉換為字典格式

                # 用於更新的暫存區
                user_llm_block = user_config_block.get("llm", {})
                user_embedder_block = user_config_block.get("embedder", {})
                user_document_store_block = user_config_block.get("document_store", {})
                user_pipeline_block = user_config_block.get("pipeline", {})

                # 僅在有新資料時才更新對應的 block
                if user_llm_block: llm_block = user_llm_block
                if user_embedder_block: embedder_block = user_embedder_block
                if user_document_store_block: document_store_block = user_document_store_block
                if user_pipeline_block: pipeline_block = user_pipeline_block
                
                ConfigState.init(llm_block, embedder_block, document_store_block, pipeline_block,force=True)  # 強制重新初始化 Session State
                st.success("YAML 匯入成功，設定已更新。")
            except Exception as e:
                st.error(f"匯入 YAML 檔案時發生錯誤: {e}")

def render_llm_config():

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
            st.success(f"Updated embedder models")
        


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
            st.success(f"Updated document store models")

def render_pipeline_config():
    # =====================
    # Pipeline Configuration
    # =====================
    pipeline__llm_options = []
    pipeline_name_options = [n for n in st.session_state[ConfigState.PIPELINE_KEY].get("pipes")]

    for model in st.session_state[ConfigState.LLM_MODELS_KEY]:
        if model.get("alias"):
            pipeline__llm_options.append("litellm_llm." + model["alias"])
        elif model.get("model"):
            pipeline__llm_options.append("litellm_llm." + model["model"])
    
    with st.expander("Pipeline Configuration", expanded=False):
        selected_pipeline_name  = st.selectbox("pipeline_name", options=[n.get("name") for n in pipeline_name_options if n.get("llm")])
            # 根據選擇的 pipeline 顯示相應的 Expander
        for idx, form in enumerate(pipeline_name_options):
            if form.get("name") == selected_pipeline_name:
                for key, value in form.items():
                    if key == "llm":
                        pipeline_llm = st.selectbox(
                            "llm",
                            options=[m for m in pipeline__llm_options],
                            index=pipeline__llm_options.index(value) if value in pipeline__llm_options else 0,
                            key=f"llm_{idx}"
                        )
                    else:
                        st.markdown(f"**{key}:** `{value}`")
                if st.button("💾  Save this llm", key=f"save_{form["name"]}"):
                    st.session_state[ConfigState.PIPELINE_KEY]["pipes"][idx]["llm"] = pipeline_llm
                    st.success(f"Updated pipeline llm: {pipeline_llm}")
        
def render_preview_and_generate(engine_blocks, pipeline_block, settings_block):
    st.subheader("Current Configuration (Preview)")

    # ---- 取得目前的 LLM 配置 ----
    llm_preview = {
        "type": "llm",
        "provider": "litellm_llm",
        "models": [
            {k: v for k, v in model.items() if k != "id"}
            for model in st.session_state.get(ConfigState.LLM_MODELS_KEY, [])
        ]
    }

    # ---- 取得 Embedder 配置 ----
    embedder_preview = st.session_state.get(ConfigState.EMBEDDER_KEY)

    # ---- 取得 Document Store 配置 ----
    document_store_preview = st.session_state.get(ConfigState.DOC_STORE_KEY)

    # --- 取得 Pipeline llm 配置 ----
    pipeline_preview = {
        "type": "pipeline",
        "pipes": [form for form in st.session_state.get(ConfigState.PIPELINE_KEY, {}).get("pipes", []) if form.get("llm")]
    }

    # ---- 合併所有配置 ----
    preview_blocks = [llm_preview, embedder_preview, document_store_preview, pipeline_preview]

    generate_pipeline_block = {
        "type": "pipeline",
        "pipes": st.session_state.get(ConfigState.PIPELINE_KEY, {}).get("pipes", [])
    }
    generate_yaml_blocks = [
        llm_preview,
        embedder_preview,
        *[
            {"type": "engine", "provider": engine.get("provider"), "endpoint": engine.get("endpoint")}
            for engine in engine_blocks
        ],
        document_store_preview,
        generate_pipeline_block,
        {"settings": settings_block}
    ]

    # ---- 顯示 JSON 預覽 ----
    st.json(preview_blocks)

    # ---- 生成 YAML 按鈕 ----
    if st.button("Generate config.yaml"):
        from constants import CONFIG_OUT_PATH
        with open(CONFIG_OUT_PATH, "w", encoding="utf-8") as f:
            yaml.dump_all(generate_yaml_blocks, f, sort_keys=False, allow_unicode=True)
        st.success(f"Config saved to {CONFIG_OUT_PATH.resolve()}")



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
