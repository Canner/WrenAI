from config_loader import load_config_yaml_blocks, group_blocks
from session_state import ConfigState
from ui_components import (
    render_llm_config, 
    render_embedder_config,  
    render_import_yaml, 
    render_pipeline_config,
    render_preview,
    render_apikey,
    render_generate_button
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
st.title("Custom Provider Config Generator")

# Layout: two columns – left for inputs, right for preview/export
col1, col2 = st.columns([1.5, 1])  

with col1:
    
    # API key input section
    st.subheader("API_KEY Configuration")
    render_apikey()

    # Upload and parse YAML file into session state
    st.subheader("LLM Configuration") 
    render_import_yaml()
    
    # LLM model configuration UI
    render_llm_config()
    
    # Embedding model configuration UI
    st.subheader("Embedder Configuration")
    render_embedder_config()
    
    # Pipeline flow configuration UI
    st.subheader("Pipeline Configuration")
    render_pipeline_config()

    # Generate config.yaml and save configuration button
    render_generate_button(engine_blocks, settings_block)

with col2:
    # Final preview and export of the combined configuration as YAML
    render_preview(engine_blocks, settings_block)

