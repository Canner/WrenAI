import constants as cst
from config_loader import download_config, load_yaml_list, group_blocks
from session_state import ConfigState
from ui_components import (
    render_llm_config, 
    render_embedder_config, 
    render_document_store_config, 
    render_import_yaml, 
    render_pipeline_config,
    render_preview_and_generate
)
import streamlit as st


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

ConfigState.init(llm_block, embedder_block, document_store_block, pipeline_block)

with col1:
    # =====================
    # LLM Configuration UI
    # =====================
    render_import_yaml()
    render_llm_config()
    render_embedder_config()
    render_document_store_config()
    render_pipeline_config()

with col2:
    # =====================
    # preview and generate YAML UI 
    # =====================
    render_preview_and_generate(engine_blocks, pipeline_block, settings_block)
