from pydantic import Field, SecretStr

from src.config import Settings


class EvalSettings(Settings):
    langfuse_project_id: str = ""
    batch_size: int = 4
    batch_interval: int = 1
    datasource: str = "bigquery"
    config_path: str = "eval/config.yaml"
    openai_api_key: SecretStr = Field(alias="LLM_OPENAI_API_KEY")

    @property
    def langfuse_url(self) -> str:
        if not self.langfuse_project_id:
            return ""
        return f"{self.langfuse_host.rstrip('/')}/project/{self.langfuse_project_id}"

    def get_openai_api_key(self) -> str:
        return self.openai_api_key.get_secret_value()
