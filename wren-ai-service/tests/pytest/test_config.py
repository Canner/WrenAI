from unittest.mock import mock_open, patch

import yaml

from src.config import Settings


def test_settings_default_values():
    with patch("src.config.Settings.config_loader", return_value=[]):
        settings = Settings()
        assert settings.host == "127.0.0.1"
        assert settings.port == 5555

        assert settings.column_indexing_batch_size == 50
        assert settings.table_retrieval_size == 10
        assert settings.table_column_retrieval_size == 100

        assert settings.query_cache_ttl == 3600
        assert settings.query_cache_maxsize == 1_000_000

        assert settings.langfuse_host == "https://cloud.langfuse.com"
        assert settings.langfuse_enable is True

        assert settings.logging_level == "INFO"
        assert settings.development is False

        assert settings.config_path == "config.yaml"


def test_settings_env_var_override():
    env_vars = {
        "WREN_AI_SERVICE_HOST": "0.0.0.0",
        "WREN_AI_SERVICE_PORT": "8000",
        "LOGGING_LEVEL": "DEBUG",
    }

    with patch("src.config.Settings.config_loader", return_value=[]), patch.dict(
        "os.environ", env_vars
    ):
        settings = Settings()
        assert settings.host == env_vars["WREN_AI_SERVICE_HOST"]
        assert settings.port == int(env_vars["WREN_AI_SERVICE_PORT"])
        assert settings.logging_level == env_vars["LOGGING_LEVEL"]


def test_settings_env_dev_override():
    # Mock the content of .env.dev file
    mock_env_dev_content = """
    WREN_AI_SERVICE_HOST=localhost
    WREN_AI_SERVICE_PORT=7000
    LOGGING_LEVEL=WARNING
    """

    # Mock the load_dotenv function
    with patch("src.config.Settings.config_loader", return_value=[]), patch(
        "src.config.load_dotenv"
    ) as mock_load_dotenv:
        # Set up the mock to load our custom environment variables
        def side_effect(path, override):
            import os

            for line in mock_env_dev_content.strip().split("\n"):
                key, value = line.strip().split("=")
                os.environ[key] = value

        mock_load_dotenv.side_effect = side_effect

        settings = Settings()

        assert settings.host == "localhost"
        assert settings.port == 7000
        assert settings.logging_level == "WARNING"


def test_settings_yaml_config_override():
    # Mock YAML config content
    mock_yaml_content = """
    settings:
      host: 192.168.1.100
      port: 9000
      column_indexing_batch_size: 75
      table_retrieval_size: 15
      logging_level: ERROR
      development: true
    """

    # Patch the open function to return our mock YAML content
    with patch("builtins.open", mock_open(read_data=mock_yaml_content)):
        # Patch os.path.exists to return True for our config file
        with patch("os.path.exists", return_value=True):
            settings = Settings()

            assert settings.host == "192.168.1.100"
            assert settings.port == 9000
            assert settings.column_indexing_batch_size == 75
            assert settings.table_retrieval_size == 15
            assert settings.logging_level == "ERROR"
            assert settings.development is True

            # Check that a value not in the YAML config remains at its default
            assert settings.query_cache_maxsize == 1_000_000


def test_settings_components():
    mock_config_content = [
        {
            "settings": {
                "host": "0.0.0.0",
                "port": 8000,
                "column_indexing_batch_size": 100,
                "table_retrieval_size": 20,
                "logging_level": "DEBUG",
            }
        },
        {
            "type": "llm",
            "provider": "openai_llm",
            "models": [{"model": "gpt-4", "kwargs": {}}],
        },
    ]

    with patch(
        "builtins.open",
        new_callable=mock_open,
        read_data=yaml.dump_all(mock_config_content),
    ):
        settings = Settings()
        assert len(settings._components) == 1
        assert settings._components[0]["type"] == "llm"
        assert settings._components[0]["provider"] == "openai_llm"
