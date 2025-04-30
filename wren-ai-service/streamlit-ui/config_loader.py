import requests
import yaml
from session_state import ConfigState
from pathlib import Path
import constants as cst
from typing import Any, Dict, List 

def load_config_yaml_blocks() -> List[Dict[str, Any]]:
    """
    嘗試從本地讀 config.yaml，若不存在則從 GitHub 讀取（不下載）。
    """
    if cst.CONFIG_IN_PATH.exists():
        try:
            return load_yaml_list(cst.CONFIG_IN_PATH)
        except Exception as e:
            print(f"❌ Failed to parse local config.yaml: {e}")
            return []
    else:
        return fetch_yaml_from_url(cst.CONFIG_URL)

def load_selected_example_yaml(example_name: str) -> List[Dict[str, Any]]:
    url = cst.CONFIG_EXAMPLES_SELECTED_URL + example_name
    return fetch_yaml_from_url(url)

def fetch_yaml_from_url(url: str) -> List[Dict[str, Any]]:
    try:
        response = requests.get(url, timeout=cst.REQUEST_TIMEOUT)
        response.raise_for_status()
        config_list = list(yaml.safe_load_all(response.text))

        if not config_list:
            raise ValueError(f"⚠️ GitHub 回傳的 YAML 是空的，URL: {url}")

        return config_list

    except (requests.RequestException, ValueError, yaml.YAMLError) as e:
        print(f"❌ Error loading config from {url}: {e}")
        return []

def extract_config_blocks(config_list: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    傳入 YAML List，回傳各 block 分類後的 dict
    """
    grouped = group_blocks(config_list)
    return {
        "llm": grouped.get("llm", {}),
        "embedder": grouped.get("embedder", {}),
        "document_store": grouped.get("document_store", {}),
        "pipeline": grouped.get("pipeline", {})
    }

def load__selected_config_yaml_blocks(selected_examples) -> List[Dict[str, Any]]:
        selected_url = cst.CONFIG_EXAMPLES_SELECTED_URL + selected_examples
        # return selected_url
        try:
            response = requests.get(selected_url, timeout=cst.REQUEST_TIMEOUT)
            response.raise_for_status()
            return list(yaml.safe_load_all(response.text))
        except requests.RequestException as e:
            print(f"❌ Error loading config from GitHub: {e}")
            return []
         
def load_yaml_list(path: Path) -> List[Dict[str, Any]]:
    with path.open("r", encoding="utf-8") as f:
        return list(yaml.safe_load_all(f))

def group_blocks(blocks: List[Dict[str, Any]]) -> Dict[str, Any]:
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
    """從 GitHub 的 config_examples 目錄中取得所有 .yaml 檔案名稱（不載入內容）"""
    try:
        response = requests.get(cst.CONFIG_EXAMPLES_URL, timeout=cst.REQUEST_TIMEOUT)
        response.raise_for_status()
        file_list = response.json()
        return [f["name"] for f in file_list if f["name"].endswith(".yaml")]
    except requests.RequestException as e:
        print(f"Error fetching config example filenames: {e}")
        return []

def apply_config_blocks(config_blocks: List[Dict[str, Any]]):
    grouped = extract_config_blocks(config_blocks)

    # 更新 ConfigState
    ConfigState.init(
        grouped["llm"],
        grouped["embedder"],
        grouped["document_store"],
        grouped["pipeline"],
        force=True
    )