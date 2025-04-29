import streamlit as st
import uuid
from session_state import ConfigState
from config_loader import group_blocks
from dry_run_test import llm_completion_test, llm_embedding_test
import yaml
import os

def render_apikey():
    with st.expander("API Key", expanded=False):
        
        add_api_key = st.session_state[ConfigState.API_KEY]
        add_api_key_form = st.session_state[ConfigState.API_KEY_FORM]
    
        if st.button("➕ API KEY", key=f"add_api_key_form"):
            add_api_key_form.append({"id": str(uuid.uuid4()), "key": "", "value": "", "is_saved": False})

        for apikey in add_api_key_form:
            kcol, vcol, rcol = st.columns([4, 6, 2])

            with kcol:
                if apikey.get("is_saved"):
                    st.text_input("apikey_service", key=f"api_key_{apikey['id']}", value=apikey["key"], disabled=True)
                else:
                    apikey["key"] = st.text_input("apikey_service", key=f"api_key_{apikey['id']}", value=apikey["key"])

            with vcol:
                if apikey.get("is_saved"):
                    st.text_input("apikey", key=f"api_val_{apikey['id']}", value=apikey["value"], disabled=True, type="password")
                else:
                    apikey["value"] = st.text_input("apikey", key=f"api_val_{apikey['id']}", value=apikey["value"], type="password")

            with rcol:
                st.markdown("<br>", unsafe_allow_html=True)
                if st.button("DEL", key=f"del_apikey_{apikey['id']}"):
                    os.environ.pop(apikey["key"], None)
                    add_api_key.pop(apikey["key"], None)
                    add_api_key_form[:] = [item for item in add_api_key_form if item["id"] != apikey["id"]]
                    st.rerun()

        if st.button("SAVE", key="save_apikey"):
            keys = []
            if len(add_api_key_form) == 0:
                st.error("No API key has been added.")
                return

            for fields in add_api_key_form:
                if not fields["key"] or not fields["value"]:
                    st.error("Each API key and value must be filled out.")
                    return
                keys.append(fields["key"])

            if len(keys) != len(set(keys)):
                st.error("API key names must be unique. Duplicate keys found.")
                return

            # 把 key-value form 轉成 dict
            processed_keys = {item["key"]: item["value"] for item in add_api_key_form}

            add_api_key.clear()
            add_api_key.update(processed_keys)

            # 標記所有 form 為已保存
            for item in add_api_key_form:
                item["is_saved"] = True
            st.rerun()

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

    # 用一個 dict 來暫存每個 form_id 對應的 title
    if "form_titles" not in st.session_state:
        st.session_state.form_titles = {}

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
    for form in st.session_state[ConfigState.LLM_FORMS_KEY]:
        form_id = form["id"]

        # 如果 model name 有值，更新 title，否則保留舊的 title
        if form["model"]:
            st.session_state.form_titles[form_id] = form["model"]
        title = st.session_state.form_titles.get(form_id, "new-model")

        with st.expander(title, expanded=False):
            # 基本欄位
            form["model"] = st.text_input("Model name", key=f"model_name_{form_id}", value=form["model"])
            form["alias"] = st.text_input("Alias (Optional)", key=f"alias_{form_id}", value=form["alias"])
            form["api_base"] = st.text_input("API Base URL", key=f"api_base_{form_id}", value=form["api_base"])
            form["timeout"] = st.text_input("Timeout", key=f"timeout_{form_id}", value=form["timeout"])

            # 動態 KWArgs
            if st.button("➕ Add KWArg Field", key=f"add_kwarg_{form_id}"):
                form["kwargs"].append({"key": "", "value": ""})

            for kw_idx, pair in enumerate(form["kwargs"]):
                kcol, vcol, rcol = st.columns([4, 4, 3])
                with kcol:
                    pair["key"] = st.text_input("Key", key=f"kw_key_{form_id}_{kw_idx}", value=pair["key"])
                with vcol:
                    pair["value"] = st.text_input("Value", key=f"kw_val_{form_id}_{kw_idx}", value=pair["value"])
                with rcol:
                    st.markdown("<br>", unsafe_allow_html=True)
                    if st.button("DEL", key=f"del_kw_{form_id}_{kw_idx}"):
                        form["kwargs"].pop(kw_idx)
                        st.rerun()

            if st.button("💾  Save this model", key=f"save_{form_id}"):
                return_state, msg = save_llm_model(form, form_id)
                if return_state:
                    st.success(msg)

            if st.button("🗑️  Remove this form", key=f"remove_form_{form_id}"):
                remove_llm_model(form_id)
                st.rerun()

            if st.button("test_llm_model", key=f"test_llm_{form_id}"):
                if not st.session_state[ConfigState.API_KEY]:
                    st.error("No API key has been saved.")
                    return
                
                llm_state, llm_msg = llm_completion_test(form)
                if llm_state:
                    st.success("Test Success")
                    st.success(llm_msg)
                else:
                    st.error(llm_msg)



def render_embedder_config():
    # =====================
    # Embedder Configuration
    # =====================

    with st.expander(" Embedder Configuration", expanded=False):
        st.markdown(f"**type:** `embedder`")
        st.markdown(f"**provider:** `{st.session_state[ConfigState.EMBEDDER_KEY].get('provider')}`")

        embedding_models = st.session_state[ConfigState.EMBEDDER_KEY].get("models", [])
        embedding_api_base = embedding_models[0].get("api_base", "https://api.openai.com/v1") if embedding_models else ""

        embedding_model_name = st.text_input("Embedding Model Name", key="embedding_model_name", value="text-embedding-3-large")
        embedding_model_alias = st.text_input("Alias (optional, e.g. default)", key="embedding_model_alias", value="default")
        embedding_model_api_base = st.text_input("API Base URL", key="embedding_model_api_base", value=f"{embedding_api_base}")
        embedding_model_timeout = st.text_input("Timeout (default: 120)", key="embedding_model_timeout", value="120")

        custom_embedding_setting = [{
            "model": embedding_model_name,
            "alias": embedding_model_alias,
            "timeout": embedding_model_timeout,
            "api_base": embedding_model_api_base
        }]

        if st.button("💾  save", key="save_embedding_model"):
            errors = []
            if not embedding_model_name:
                errors.append("Embedding Model Name is required.")
            if not embedding_model_timeout:
                errors.append("Timeout is required.")
            else:
                try:
                    int(embedding_model_timeout)
                except ValueError:
                    errors.append("Timeout must be an integer.")

            if errors:
                for error in errors:
                    st.error(error)
            else:
                st.session_state.embedding_model = {
                    "type": "embedder",
                    "provider": st.session_state[ConfigState.EMBEDDER_KEY].get("provider"),
                    "models": custom_embedding_setting
                }
                st.success(f"Updated embedder models")
        
        if st.button("test_embedding_model", key="test_embedding_model"):
            if not st.session_state[ConfigState.API_KEY]:
                st.error("No API key has been saved.")
                return

            embedding_state, embedding_msg = llm_embedding_test()
            if embedding_state:
                st.success(embedding_msg)
            else:
                st.error(embedding_msg)



def render_document_store_config():
    # =====================
    # Document Store Configuration
    # =====================

    with st.expander(" Document Store Configuration", expanded=False):
        st.markdown(f"**type:** `document_store`")
        st.markdown(f"**provider:** `{st.session_state[ConfigState.DOC_STORE_KEY].get('provider')}`")
        st.markdown(f"**location:** `{st.session_state[ConfigState.DOC_STORE_KEY].get('location')}`")
        document_store_timeout = st.text_input("Timeout (default: 120)", key="document_store_timeout" , value="120")
        st.markdown(f"**timeout:** `120`")
        st.markdown(f"**recreate_index:** `{st.session_state[ConfigState.DOC_STORE_KEY].get('recreate_index')}`")
        document_store_dim = st.text_input("Embedding_model_dim", value="3072")

        if st.button("💾  save", key="save_document_store"):
            errors = []
            if not document_store_dim:
                errors.append("Embedding model dim is required.")
            else:
                try:
                    int(document_store_dim)
                except ValueError:
                    errors.append("Embedding model dim must be an integer.")

            if not document_store_timeout:
                errors.append("Timeout is required.")
            else:
                try:
                    int(document_store_timeout)
                except ValueError:
                    errors.append("Timeout must be an integer.")

            if errors:
                for error in errors:
                    st.error(error)
            else:
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

    # --- 檢查必填欄位 ---
    errors = validate_llm_form(form)
    if errors:
        for error in errors:
            st.error(error)
        return False, None  # 中止存檔
    
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
            return False, None  # 不儲存
    
    saved_entry = {
        "model": form["model"],
        **({"alias": form["alias"]} if form["alias"] else {}),
        "api_base": form["api_base"],
        "timeout": form["timeout"],
        "kwargs": kwargs_dict,
    }

    existing_ids = [m.get("id") for m in st.session_state[ConfigState.LLM_MODELS_KEY]]
    if form_id in existing_ids:
        index = existing_ids.index(form_id)
        st.session_state[ConfigState.LLM_MODELS_KEY][index] = {**saved_entry, "id": form_id}
        return True, f"Updated model: {form['model']}"
    else:
        st.session_state[ConfigState.LLM_MODELS_KEY].append({**saved_entry, "id": form_id})
        return True, f"Added new model: {form['model']}"

def remove_llm_model(form_id):
    # 刪除 llm_forms
    st.session_state[ConfigState.LLM_FORMS_KEY] = [
        f for f in st.session_state[ConfigState.LLM_FORMS_KEY] if f["id"] != form_id
    ]
    # 刪除 llm_models
    st.session_state[ConfigState.LLM_MODELS_KEY] = [
        m for m in st.session_state[ConfigState.LLM_MODELS_KEY] if m.get("id") != form_id
    ]


def validate_llm_form(form):
    errors = []

    if not form.get("model"):
        errors.append("Model name is required.")
    if not form.get("api_base"):
        errors.append("API Base URL is required.")
    if not form.get("timeout"):
        errors.append("Timeout is required.")
    else:
        # 檢查 timeout 是否為整數
        try:
            int(form["timeout"])
        except ValueError:
            errors.append("Timeout must be an integer.")

    # 檢查 kwargs 是否有 key 但沒有 value 或相反
    for idx, pair in enumerate(form.get("kwargs", [])):
        if pair.get("key") and not pair.get("value"):
            errors.append(f"KWArg field {idx+1}: Value is required when key is provided.")
        if pair.get("value") and not pair.get("key"):
            errors.append(f"KWArg field {idx+1}: Key is required when value is provided.")
    
    return errors
