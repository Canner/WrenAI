from config_loader import load_config_yaml_blocks, group_blocks
from session_state import ConfigState
from ui_components import (
    render_llm_config, 
    render_embedder_config, 
    render_document_store_config, 
    render_import_yaml, 
    render_pipeline_config,
    render_preview_and_generate,
    render_apikey,
    render_finished_setting
)
import streamlit as st

# Set Streamlit page layout
st.set_page_config(
    layout="wide",                # Use a wide layout for better horizontal space
    initial_sidebar_state="expanded"  # Expand sidebar by default
)

# Load and group configuration blocks from YAML
yaml_list = load_config_yaml_blocks()
blocks = group_blocks(yaml_list)

# Retrieve individual configuration sections
llm_block = blocks.get("llm", {})
embedder_block = blocks.get("embedder", {})
document_store_block = blocks.get("document_store", {})
engine_blocks = blocks.get("engine", [])
pipeline_block = blocks.get("pipeline", {})
settings_block = blocks.get("settings", {})

# Initialize session state with default or imported config values
ConfigState.init(llm_block, embedder_block, document_store_block, pipeline_block)

# ----------------------
# Streamlit UI rendering
# ----------------------
st.title("Custom LLM Config Generator")

# Layout: two columns – left for inputs, right for preview/export
col1, col2 = st.columns([1.5, 1])  

with col1:
    st.subheader("LLM Configuration")
    
    # Upload and parse YAML file into session state
    render_import_yaml()
    
    # API key input section
    render_apikey()
    
    # LLM model configuration UI
    render_llm_config()
    
    # Embedding model configuration UI
    render_embedder_config()
    
    # Document store configuration UI
    render_document_store_config()
    
    # Pipeline flow configuration UI
    render_pipeline_config()

with col2:
    # Final preview and export of the combined configuration as YAML
    render_preview_and_generate(engine_blocks, pipeline_block, settings_block)
    
    # Signal that configuration is complete and ready for CLI continuation
    render_finished_setting()
