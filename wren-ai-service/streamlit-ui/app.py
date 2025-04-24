import constants as cst
from config_loader import download_config, load_yaml_list, group_blocks
from session_state import ConfigState
from ui_components import render_llm_config

import streamlit as st
import yaml
import uuid



st.set_page_config(
    layout="wide",  # 使用寬屏模式
    initial_sidebar_state="expanded"  # 控制側邊欄的初始狀態
)


if not cst.CONFIG_IN_PATH.exists():
    download_config()
    
yaml_list = load_yaml_list(cst.CONFIG_IN_PATH)
blocks = group_blocks(yaml_list)

llm_block = blocks.get("llm", {})
embedder_block = blocks.get("embedder", {})
document_store_block   = blocks.get("document_store", {})
engine_blocks = blocks.get("engine", [])
pipeline_block = blocks.get("pipeline", {})
settings_block = blocks.get("settings", {})


# --- Streamlit UI --
st.title(" Custom LLM Config Generator")
st.markdown("")
col1, col2 = st.columns([1.5, 1])  # 左右欄位

# =====================
# LLM Configuration
# =====================

ConfigState.init(llm_block, embedder_block, document_store_block)

with col1:
    

    if "llm_models" not in st.session_state:      # 真的「存檔」後的結果
        st.session_state.llm_models = []

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
                
                ConfigState.init(llm_block, embedder_block, document_store_block, force=True)  # 強制重新初始化 Session State
                st.success("YAML 匯入成功，設定已更新。")
            except Exception as e:
                st.error(f"匯入 YAML 檔案時發生錯誤: {e}")

    render_llm_config()

with col2:

    st.subheader("Current LLM Configuration (Preview)")
    # --- 顯示目前已新增的模型清單 ---
    if st.session_state.llm_models:
    
        llm_preview = {
            "type": "llm",
            "provider": "litellm_embedder",
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
            "settings": settings_block.get("settings", {})
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