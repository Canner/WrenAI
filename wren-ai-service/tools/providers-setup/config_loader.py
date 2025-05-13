import requests
import yaml
from session_state import ConfigState
from pathlib import Path
import constants as cst
from typing import Any, Dict, List
import streamlit as st

def load_config_yaml_blocks() -> List[Dict[str, Any]]:
    """
    Load the config.yaml from local disk if available; 
    otherwise, fetch it from the GitHub URL without downloading it.
    """
    CONFIG_IN_PATH = cst.get_config_path()
    if CONFIG_IN_PATH.exists():
        try:
            return load_yaml_list(CONFIG_IN_PATH)
        except Exception as e:
            st.error(f"❌ Failed to parse local config.yaml: {e}")
            return []
    else:
        return fetch_yaml_from_url(cst.CONFIG_URL)

def load_selected_example_yaml(selected_example: str) -> List[Dict[str, Any]]:
    """
    Fetch a selected YAML example file from GitHub and return it as a list of blocks.
    """
    selected_url = cst.CONFIG_EXAMPLES_SELECTED_URL + selected_example
    try:
        response = requests.get(selected_url, timeout=cst.REQUEST_TIMEOUT)
        response.raise_for_status()
        return list(yaml.safe_load_all(response.text))
    except requests.RequestException as e:
        st.error(f"❌ Error loading config from GitHub: {e}")
        return []

def fetch_yaml_from_url(url: str) -> List[Dict[str, Any]]:
    """
    Fetch and parse a YAML list from a remote URL.
    Returns an empty list if fetch or parsing fails.
    """
    try:
        response = requests.get(url, timeout=cst.REQUEST_TIMEOUT)
        response.raise_for_status()
        config_list = list(yaml.safe_load_all(response.text))

        if not config_list:
            raise ValueError(f"⚠️ Received empty YAML content from: {url}")

        return config_list

    except (requests.RequestException, ValueError, yaml.YAMLError) as e:
        st.error(f"❌ Error loading config from {url}: {e}")
        return []

def extract_config_blocks(config_list: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Convert a flat list of config blocks into grouped dictionary format 
    with keys like 'llm', 'embedder', 'document_store', and 'pipeline'.
    """
    grouped = group_blocks(config_list)
    return {
        "llm": grouped.get("llm", {}),
        "embedder": grouped.get("embedder", {}),
        "document_store": grouped.get("document_store", {}),
        "pipeline": grouped.get("pipeline", {})
    }

def load_yaml_list(path: Path) -> List[Dict[str, Any]]:
    """
    Load and parse all YAML documents from a file path.
    """
    with path.open("r", encoding="utf-8") as f:
        return list(yaml.safe_load_all(f))

def group_blocks(blocks: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Group YAML blocks by their 'type' field.
    If multiple blocks share the same type, they are stored as a list.
    """
    save_blocks = {}
    for block in blocks:
        key = block.get("type") or ("settings" if "settings" in block else None)
        if not key:
            continue
        if key in save_blocks:
            if isinstance(save_blocks[key], list):
                save_blocks[key].append(block)
            else:
                save_blocks[key] = [save_blocks[key], block]
        else:
            save_blocks[key] = block
    return save_blocks

def fetch_example_yaml_filenames() -> List[str]:
    """
    Fetch the filenames of all .yaml example configs from the GitHub directory 
    (does not download the content).
    """
    try:
        response = requests.get(cst.CONFIG_EXAMPLES_URL, timeout=cst.REQUEST_TIMEOUT)
        response.raise_for_status()
        file_list = response.json()
        return [f["name"] for f in file_list if f["name"].endswith(".yaml")]
    except requests.RequestException as e:
        st.error(f"Error fetching config example filenames: {e}")
        return []

def apply_config_blocks(config_blocks: List[Dict[str, Any]]):
    """
    Group and apply config blocks by updating the Streamlit session state via ConfigState.
    """
    grouped = extract_config_blocks(config_blocks)

    ConfigState.init(
        grouped["llm"],
        grouped["embedder"],
        grouped["document_store"],
        grouped["pipeline"],
        force=True
    )
