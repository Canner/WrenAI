import json
import os
import time
from pathlib import Path

from src.utils import load_env_vars

load_env_vars()
filename = f"locust_report_{time.strftime("%Y%m%d_%H%M%S")}"

if not Path("./outputs/locust").exists():
    Path("./outputs/locust").mkdir(parents=True, exist_ok=True)

os.system(
    f"""
    poetry run locust \
    --config tests/locust/locust.conf \
    --logfile outputs/locust/{filename}.log \
    --html outputs/locust/{filename}.html \
    --json > outputs/locust/{filename}.json
    """
)

with open(f"./outputs/locust/{filename}.json", "r") as f:
    test_results = json.load(f)

formatted = {
    "llm provider": os.getenv("LLM_PROVIDER"),
    "generation model": os.getenv("GENERATION_MODEL"),
    "embedding model": os.getenv("EMBEDDING_MODEL"),
    "locustfile": "tests/locust/locustfile.py",
    "test results": test_results,
}
with open(f"./outputs/locust/{filename}.json", "w") as f:
    json.dump(formatted, f, indent=2)

print(f"get the test results in {filename}.json and {filename}.html")
