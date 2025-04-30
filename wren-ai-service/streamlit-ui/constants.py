from pathlib import Path
import requests

# --- 自動取得最新版本 tag ---
def get_latest_config_version():
    url = "https://api.github.com/repos/Canner/WrenAI/releases/latest"
    try:
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            return data["tag_name"]  # ← 這裡就是 "0.20.2" 這種版本號
        else:
            print(f"Failed to get latest release: {response.status_code}")
    except Exception as e:
        print(f"Error fetching latest config version: {e}")
    return "main"  # fallback 版本，如果失敗就用 main branch

# --- constant ---
CONFIG_VERSION = get_latest_config_version()
CONFIG_URL = f"https://raw.githubusercontent.com/Canner/WrenAI/{CONFIG_VERSION}/docker/config.example.yaml"
CONFIG_EXAMPLES_URL = f"https://api.github.com/repos/Canner/WrenAI/contents/wren-ai-service/docs/config_examples?ref={CONFIG_VERSION}"
CONFIG_EXAMPLES_SELECTED_URL = f"https://raw.githubusercontent.com/Canner/WrenAI/{CONFIG_VERSION}/wren-ai-service/docs/config_examples/"
CONFIG_IN_PATH = Path("config.yaml")
CONFIG_OUT_PATH = Path("generated_config.yaml")
REQUEST_TIMEOUT = 10  # seconds