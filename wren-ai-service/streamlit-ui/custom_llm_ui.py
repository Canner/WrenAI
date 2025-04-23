import constants as cst
from config_loader import download_config, load_blocks

import streamlit as st
import yaml
import uuid



st.set_page_config(
    layout="wide",  # 使用寬屏模式
    initial_sidebar_state="expanded"  # 控制側邊欄的初始狀態
)


if not cst.CONFIG_IN_PATH.exists():
    download_config()
    
blocks = load_blocks(cst.CONFIG_IN_PATH)
llm_block = blocks.get("llm", {})
embedder_block = blocks.get("embedder", {})
document_store_block   = blocks.get("document_store", {})
engine_blocks = [b for t, b in blocks.items() if t == "engine"]
pipeline_block = blocks.get("pipeline", {})
settings_block = blocks.get("settings", {})


# --- Streamlit UI --
st.title(" Custom LLM Config Generator")
st.markdown("")
col1, col2 = st.columns([1.5, 1])  # 左右欄位


# =====================
# LLM Configuration
# =====================

def reinit_session_state_from_yaml(llm_block, embedder_block, document_store_block):
    # 1. 初始化 llm_forms
    st.session_state.llm_forms = []
    st.session_state.llm_models = []  # ← 必須清空重建
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
        st.session_state.llm_forms.append(form_entry)

        # 轉成儲存格式（kwargs 要是 dict）
        model_entry = {
            "id": form_entry["id"],
            "model": form_entry["model"],
            "alias": form_entry["alias"],
            "api_base": form_entry["api_base"],
            "timeout": form_entry["timeout"],
            "kwargs": {k["key"]: k["value"] for k in form_entry["kwargs"] if k["key"]},
        }
        st.session_state.llm_models.append(model_entry)


    # 2. 初始化 embedding_model
    embedder_models = embedder_block.get("models", [])
    if embedder_models:
        st.session_state.embedding_model = {
            "type": "embedder",
            "provider": embedder_block.get("provider"),
            "models": embedder_models
        }

    # 3. 初始化 document_store
    st.session_state.document_store = {
        "type": "document_store",
        "provider": document_store_block.get("provider"),
        "location": document_store_block.get("location"),
        "embedding_model_dim": document_store_block.get("embedding_model_dim", 3072),
        "timeout": document_store_block.get("timeout", 120),
        "recreate_index": document_store_block.get("recreate_index", False),
    }

# --- 初始化 session state ---
if "llm_forms" not in st.session_state or "embedding_model" not in st.session_state:
    reinit_session_state_from_yaml(llm_block, embedder_block, document_store_block)

with col1:
    

    if "llm_models" not in st.session_state:      # 真的「存檔」後的結果
        st.session_state.llm_models = []

    st.subheader("LLM Configuration")

    # IMPORT YAML
    uploaded_file = st.file_uploader("Choose a YAML file", type=["yaml", "yml"])

    if uploaded_file is not None:
        if st.button("Import .yaml", key="import_yaml"):
            try:
                # 解析使用者上傳的 yaml 檔案
                user_config = list(yaml.safe_load_all(uploaded_file))

                # 用於更新的暫存區
                user_llm_block = next((item for item in user_config if item.get("type") == "llm"), None)
                user_embedder_block = next((item for item in user_config if item.get("type") == "embedder"), None)
                # user_engine_blocks = [item for item in user_config if item.get("type") == "engine"]
                user_document_store_block = next((item for item in user_config if item.get("type") == "document_store"), None)
                user_pipeline_block = next((item for item in user_config if item.get("type") == "pipeline"), None)
                # user_settings_block = next((item.get("settings") for item in user_config if "settings" in item), None)

                # 僅在有新資料時才更新對應的 block
                if user_llm_block: llm_block = user_llm_block
                if user_embedder_block: embedder_block = user_embedder_block
                # if user_engine_blocks: engine_blocks = user_engine_blocks
                if user_document_store_block: document_store_block = user_document_store_block
                if user_pipeline_block: pipeline_block = user_pipeline_block
                # if user_settings_block: settings_block = user_settings_block
                
                reinit_session_state_from_yaml(llm_block, embedder_block, document_store_block)
                st.success("YAML 匯入成功，設定已更新。")
                # st.write(llm_block)
            except Exception as e:
                st.error(f"匯入 YAML 檔案時發生錯誤: {e}")
            st.rerun()  # 重新載入頁面以顯示更新的內容


    # ① 新增一個空白表單（Expander）──會觸發 rerun，下一輪就看得到
    if st.button("➕  Add model", key="btn_add_model"):
        st.session_state.llm_forms.append({
            "id": str(uuid.uuid4()),  # 加上唯一識別碼
            "model": "new-model",
            "alias": "",
            "api_base": "",
            "timeout": "120",
            "kwargs": []
        })

    # ② 逐一渲染 Expander
    for idx, form in enumerate(st.session_state.llm_forms):
        form_id = form["id"]

        # ── 讓 Expander 標題隨「model」欄位變動 ──
        title = form["model"] or f"LLM Model {idx+1}"
        with st.expander(title, expanded=False):

            # ----- 基本欄位 -----
            form["model"] = st.text_input(
                "Model name (e.g. gpt-4o-2024-08-06)",
                key=f"model_name_{idx}",
                value=form["model"]
            )
            form["alias"] = st.text_input(
                "Alias (optional, e.g. default)",
                key=f"alias_{idx}",
                value=form["alias"]
            )
            form["api_base"] = st.text_input(
                "API Base URL",
                key=f"api_base_{idx}",
                value=form["api_base"]
            )
            form["timeout"] = st.text_input(
                "Timeout (default: 120)",
                key=f"timeout_{idx}",
                value=form["timeout"]
            )

            # ----- 動態 KWArgs -----
            if st.button("➕ Add KWArg Field", key=f"add_kwarg_{idx}"):
                form["kwargs"].append({"key": "", "value": ""})

            # 逐列顯示 kwargs
            for kw_idx, pair in enumerate(form["kwargs"]):
                kcol, vcol, rcol = st.columns([4, 4, 3])
                with kcol:
                    pair["key"] = st.text_input(
                        "Key",
                        key=f"kw_key_{idx}_{kw_idx}",
                        value=pair["key"]
                    )
                with vcol:
                    pair["value"] = st.text_input(
                        "Value",
                        key=f"kw_val_{idx}_{kw_idx}",
                        value=pair["value"]
                    )
                with rcol:
                    # st.markdown(" ")
                    st.markdown("<br>", unsafe_allow_html=True)  # 對齊用的空行
                    if st.button("DEl", key=f"del_kw_{idx}_{kw_idx}"):
                        form["kwargs"].pop(kw_idx)
                        st.rerun()

            # ----- 儲存／刪除 這筆表單 -----
            c1, c2 = st.columns(2)
            with c1:
                if st.button("💾  Save this model", key=f"save_{idx}"):
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

                    existing_ids = [m.get("id") for m in st.session_state.llm_models]
                    if form_id in existing_ids:
                        index = existing_ids.index(form_id)
                        st.session_state.llm_models[index] = {**saved_entry, "id": form_id}
                        st.success(f"Updated model: {form['model']}")
                    else:
                        st.session_state.llm_models.append({**saved_entry, "id": form_id})
                        st.success(f"Added new model: {form['model']}")
                    st.rerun()
            with c2:
                if st.button("🗑️  Remove this form", key=f"remove_form_{idx}"):
                    existing_ids = [m.get("id") for m in st.session_state.llm_models]
        
                    if form_id in existing_ids:
                        # 刪除 llm_forms 中這個 id 的表單
                        st.session_state.llm_forms = [
                            f for f in st.session_state.llm_forms if f["id"] != form_id
                        ]

                        # 刪除 llm_models 中這個 id 的模型（如果存在）
                        st.session_state.llm_models = [
                            m for m in st.session_state.llm_models if m.get("id") != form_id
                        ]
                        st.rerun()
                    else:
                        st.warning("還沒有這筆表單，或資料已損壞")
                    

    # =====================
    # Embedder Configuration
    # =====================

    with st.expander(" Embedder Configuration", expanded=False):
        st.markdown(f"**type:** `embedder`")
        st.markdown(f"**provider:** `{embedder_block.get('provider')}`")

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
                "provider": embedder_block.get("provider"),
                "models": custom_embedding_setting
            }



    # =====================
    # Document Store Configuration
    # =====================

    with st.expander(" Document Store Configuration", expanded=False):
        st.markdown(f"**type:** `document_store`")
        st.markdown(f"**provider:** `{document_store_block.get('provider')}`")
        st.markdown(f"**location:** `{document_store_block.get('location')}`")
        document_store_timeout = st.text_input("Timeout (optional, default: 120)", key="document_store_timeout" , value="120")
        st.markdown(f"**timeout:** `120`")
        st.markdown(f"**recreate_index:** `{document_store_block.get('recreate_index')}`")
        document_store_dim = st.text_input("Embedding_model_dim", value="3072")

        if st.button("save", key="save_document_store"):
            st.session_state.document_store = {

                "type": "document_store",
                "provider": document_store_block.get("provider"),
                "location": document_store_block.get("location"),
                "embedding_model_dim": document_store_dim,
                "timeout": document_store_timeout,
                "recreate_index": document_store_block.get("recreate_index")

            }


with col2:

    st.subheader("Current LLM Configuration (Preview)")
    # --- 顯示目前已新增的模型清單 ---
    if st.session_state.llm_models:
    
        llm_preview = {
            "type": "llm",
            "provider": llm_block.get("provider"),
            "models": [
                {k: v for k, v in model.items() if k != "id"}
                for model in st.session_state.llm_models
            ]
        }
        embedder_model_preview = st.session_state.embedding_model
        document_store_block_preview = st.session_state.document_store

        preview_blocks = [llm_preview, embedder_model_preview, document_store_block_preview]
        st.json(preview_blocks)  # 一次顯示整體 config preview


    if st.button("Generate config.yaml"):
        engine_blocks_list = [  # 可直接用之前解析到的 engine_blocks 變數
            {
                "type": "engine",
                "provider": engine.get("provider"),
                "endpoint": engine.get("endpoint")
            }
            for engine in engine_blocks
        ]
        pipeline_block = {  
            "type": "pipeline",
            "pipes": pipeline_block.get("pipes", []) 
        }
        settings_block = {
            "settings": settings_block
        }
        final_blocks = [
            llm_preview, 
            embedder_model_preview, 
            *engine_blocks_list, 
            document_store_block_preview, 
            pipeline_block, 
            settings_block
        ]
        
        with open(cst.CONFIG_OUT_PATH, "w") as f:
            yaml.dump_all(final_blocks, f, sort_keys=False)
        st.success(f" Config saved to {cst.CONFIG_OUT_PATH.resolve()}")