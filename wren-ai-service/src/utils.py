import os
import re

from dotenv import load_dotenv


def clean_generation_result(result: str) -> str:
    def _normalize_whitespace(s: str) -> str:
        return re.sub(r"\s+", " ", s).strip()

    return _normalize_whitespace(result).replace("\n", "")


def load_env_vars() -> str:
    load_dotenv(override=True)

    if is_dev_env := os.getenv("ENV") and os.getenv("ENV").lower() == "dev":
        load_dotenv(".env.dev", override=True)
    else:
        load_dotenv(".env.prod", override=True)

    return "dev" if is_dev_env else "prod"
