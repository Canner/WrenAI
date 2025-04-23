# config_loader.py
import requests
import yaml
from pathlib import Path
import constants as cst
from typing import Any, Dict, List 

def download_config():
    try:
        response = requests.get(cst.CONFIG_URL, timeout=cst.REQUEST_TIMEOUT)
        response.raise_for_status()
        cst.CONFIG_IN_PATH.write_text(response.text, encoding='utf-8')
        return True
    except requests.RequestException as e:
        return False, str(e)

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

