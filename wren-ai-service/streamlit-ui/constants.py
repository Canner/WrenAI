from pathlib import Path

# --- constant ---
CONFIG_VERSION = "0.20.2"   
CONFIG_URL = f"https://raw.githubusercontent.com/Canner/WrenAI/{CONFIG_VERSION}/docker/config.example.yaml"
CONFIG_IN_PATH = Path("config.yaml")
CONFIG_OUT_PATH = Path("generated_config.yaml")
REQUEST_TIMEOUT = 10  # seconds