import json
import os
import time

from .utils import load_env_vars

load_env_vars()
filename = f"test_report_{time.strftime("%Y%m%d_%H%M%S")}"

os.system(
    f"poetry run locust -f tests/locustfile.py --config tests/locust.conf --html outputs/{filename}.html --json > outputs/{filename}.json"
)

with open(f"./outputs/{filename}.json", "r") as f:
    test_results = json.load(f)

formatted = {
    "llm provider": os.getenv("LLM_PROVIDER"),
    "generation model": os.getenv("OPENAI_GENERATION_MODEL"),
    "locustfile": "tests/locustfile.py",
    "test results": test_results,
}
with open(f"./outputs/{filename}.json", "w") as f:
    json.dump(formatted, f)

print(f"get the test results in {filename}.json and {filename}.html")
