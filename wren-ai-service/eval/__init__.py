from pathlib import Path
from urllib.parse import urlencode

from pydantic import Field, SecretStr

from src.config import Settings

SPIDER_DESTINATION_PATH = Path("./tools/dev/etc/spider1.0")
BIRD_DESTINATION_PATH = Path("./tools/dev/etc/bird")
SPIDER_EVAL_DATA_DB_PATH = "etc/spider1.0/database"
BIRD_EVAL_DATA_DB_PATH = "etc/bird/minidev/MINIDEV/dev_databases"
TOOLS_DEV_PATH = Path("./tools/dev")
WREN_ENGINE_API_URL = "http://localhost:8080"
EVAL_DATASET_DESTINATION_PATH = Path("./eval/dataset")


def default_eval_data_db_path(evaluation_dataset: str) -> str:
    normalized_dataset = evaluation_dataset.lower()
    if "spider_" in normalized_dataset:
        return SPIDER_EVAL_DATA_DB_PATH
    if "bird_" in normalized_dataset:
        return BIRD_EVAL_DATA_DB_PATH
    return ""


def resolve_host_eval_data_db_path(eval_data_db_path: str) -> str:
    if not eval_data_db_path:
        return ""

    path = Path(eval_data_db_path)
    if path.is_absolute():
        return str(path)

    parts = path.parts
    if len(parts) >= 2 and parts[:2] == ("tools", "dev"):
        return str(path)

    return str(TOOLS_DEV_PATH / path)


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
    spider_benchmark_db_target: str = ""
    spider_benchmark_use_postgres: bool = False
    spider_benchmark_postgres_schema: str = "public"

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

    @property
    def effective_spider_benchmark_db_target(self) -> str:
        return (
            self.spider_benchmark_db_target
            or (
                self.default_spider_postgres_benchmark_db_target
                if self.spider_benchmark_use_postgres
                else ""
            )
            or resolve_host_eval_data_db_path(self.eval_data_db_path)
            or str(SPIDER_DESTINATION_PATH / "database")
        )

    @property
    def default_spider_postgres_benchmark_db_target(self) -> str:
        query = urlencode({"schema": self.spider_benchmark_postgres_schema})
        return (
            f"postgresql://{self.postgres_user}:{self.postgres_password.get_secret_value()}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_database}?{query}"
        )
