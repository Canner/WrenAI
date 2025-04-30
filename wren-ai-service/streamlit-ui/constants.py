from pathlib import Path
import requests

# -------------------------------
# Fetch Latest Release Version
# -------------------------------

def get_latest_config_version():
    """
    Retrieve the latest release tag from the WrenAI GitHub repository.
    
    Returns:
        str: The latest version tag (e.g., "0.20.2") if successful,
             or "main" as a fallback if the request fails.
    """
    url = "https://api.github.com/repos/Canner/WrenAI/releases/latest"
    try:
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            return data["tag_name"]  # e.g., "0.20.2"
        else:
            print(f"Failed to get latest release: {response.status_code}")
    except Exception as e:
        print(f"Error fetching latest config version: {e}")

    return "main"  # Fallback to 'main' branch if fetch fails


# -------------------------------
# Constants for Config Loading
# -------------------------------

CONFIG_VERSION = get_latest_config_version()

# URL of the default config YAML file (used when no local file is available)
CONFIG_URL = f"https://raw.githubusercontent.com/Canner/WrenAI/{CONFIG_VERSION}/docker/config.example.yaml"

# GitHub API URL to list example config files (metadata only, no content)
CONFIG_EXAMPLES_URL = (
    f"https://api.github.com/repos/Canner/WrenAI/contents/wren-ai-service/docs/config_examples?ref={CONFIG_VERSION}"
)

# Base URL to fetch actual example YAML content by filename
CONFIG_EXAMPLES_SELECTED_URL = (
    f"https://raw.githubusercontent.com/Canner/WrenAI/{CONFIG_VERSION}/wren-ai-service/docs/config_examples/"
)

# Path to local input config file (used if exists)
CONFIG_IN_PATH = Path("config.yaml")

# Path to write the generated config YAML file
CONFIG_OUT_PATH = Path("generated_config.yaml")

# Timeout duration for HTTP requests (in seconds)
REQUEST_TIMEOUT = 10
