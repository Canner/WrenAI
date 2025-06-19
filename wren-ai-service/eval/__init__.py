from pathlib import Path

from pydantic import Field, SecretStr

from src.config import Settings

SPIDER_DESTINATION_PATH = Path("./tools/dev/etc/spider1.0")
BIRD_DESTINATION_PATH = Path("./tools/dev/etc/bird")
WREN_ENGINE_API_URL = "http://localhost:8080"
EVAL_DATASET_DESTINATION_PATH = Path("./eval/dataset")


class EvalSettings(Settings):
    langfuse_project_id: str = ""
    batch_size: int = 4
    batch_interval: int = 1
    datasource: str = "bigquery"
    config_path: str = "eval/config.yaml"
    openai_api_key: SecretStr = Field(alias="OPENAI_API_KEY")
    allow_sql_samples: bool = True
    allow_instructions: bool = True
    allow_sql_functions: bool = True
    eval_data_db_path: str = ""

    # BigQuery
    bigquery_project_id: str = Field(default="")
    bigquery_dataset_id: str = Field(default="")
    bigquery_credentials: SecretStr = Field(default="")

    # Postgres
    postgres_host: str = Field(default="postgres")
    postgres_port: str = Field(default="5432")
    postgres_user: str = Field(default="postgres")
    postgres_password: SecretStr = Field(default="postgres")
    postgres_database: str = Field(default="test")

    @property
    def langfuse_url(self) -> str:
        if not self.langfuse_project_id:
            return ""
        return f"{self.langfuse_host.rstrip('/')}/project/{self.langfuse_project_id}"

    def get_openai_api_key(self) -> str:
        return self.openai_api_key.get_secret_value()

    @property
    def bigquery_info(self) -> dict:
        return {
            "project_id": self.bigquery_project_id,
            "dataset_id": self.bigquery_dataset_id,
            "credentials": self.bigquery_credentials.get_secret_value(),
        }

    @property
    def postgres_info(self) -> dict:
        return {
            "host": self.postgres_host,
            "port": self.postgres_port,
            "user": self.postgres_user,
            "password": self.postgres_password.get_secret_value(),
            "database": self.postgres_database,
        }
