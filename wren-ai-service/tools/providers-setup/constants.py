from pathlib import Path
import os
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
            return data["tag_name"]
        else:
            print(f"Failed to get latest release: {response.status_code}")
    except Exception as e:
        print(f"Error fetching latest config version: {e}")

    return "main"  # Fallback to 'main' branch if the request fails


# -------------------------------
# Constants for Config Loading
# -------------------------------

CONFIG_VERSION = get_latest_config_version()

# URL for the default config YAML (used if no local config is found)
CONFIG_URL = f"https://raw.githubusercontent.com/Canner/WrenAI/{CONFIG_VERSION}/docker/config.example.yaml"

# GitHub API URL to list config examples (only metadata)
CONFIG_EXAMPLES_URL = (
    f"https://api.github.com/repos/Canner/WrenAI/contents/wren-ai-service/docs/config_examples?ref={CONFIG_VERSION}"
)

# Base URL to fetch individual example YAML files by filename
CONFIG_EXAMPLES_SELECTED_URL = (
    f"https://raw.githubusercontent.com/Canner/WrenAI/{CONFIG_VERSION}/wren-ai-service/docs/config_examples/"
)

# -------------------------------
# Local Config Paths
# -------------------------------

volume_app_data = Path("/app/data")

# Global HTTP request timeout in seconds
REQUEST_TIMEOUT = 10

def get_config_done_path():
    # Docker environment: mounted config.done
    docker_path = volume_app_data / "config.done"
    local_path = Path.home() / ".wrenai" / "config.done"

    if docker_path.exists():
        return docker_path
    else:
        return local_path

def get_config_path():
    # Docker environment: mounted config.yaml
    docker_path = volume_app_data / "config.yaml"
    local_path = Path.home() / ".wrenai" / "config.yaml"

    if docker_path.exists():
        return docker_path
    else:
        return local_path

# Path to the .env file
def get_env_path():
    docker_path = volume_app_data / ".env"
    local_path = Path.home() / ".wrenAI" / ".env"

    if docker_path.exists():
        return docker_path
    else:
        return local_path