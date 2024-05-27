import json
import os
from datetime import datetime

from src.eval.ask_details.utils import (
    Collector,
    Summary,
    _prepare_ask_details_eval_data,
)
from src.pipelines.ask_details.generation_pipeline import Generation
from src.utils import init_providers, load_env_vars

INPUT_PATH = "./src/eval/ask_details/data/baseball_1_data.json"
EVAL_CONTEXT_PATH = "./src/eval/ask_details/data/baseball_1_eval_context.json"
EVAL_REPORT_PATH = f"./outputs/ask_details/baseball_1_eval_report_{datetime.now().strftime("%Y%m%d%H%M%S")}.json"

load_env_vars()
_prepare_ask_details_eval_data(
    input_path=INPUT_PATH,
    output_path=EVAL_CONTEXT_PATH,
)

# read the evaluation data
eval_context = None
with open(EVAL_CONTEXT_PATH) as f:
    eval_context = json.load(f)

summary = Summary()
collectors = [Collector(element=element) for element in eval_context]

llm_provider, _ = init_providers()
pipeline = Generation(
    llm_provider=llm_provider,
)

for collector in collectors:
    collector.eval(pipeline)
    summary.append(collector)

os.makedirs(os.path.dirname(EVAL_REPORT_PATH), exist_ok=True)
with open(EVAL_REPORT_PATH, "w") as f:
    json.dump(summary.generate(), f, indent=4)
