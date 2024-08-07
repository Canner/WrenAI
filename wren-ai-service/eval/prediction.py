import argparse
import base64
import os
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Tuple

import dotenv
import orjson
from git import Repo
from langfuse.decorators import langfuse_context
from tomlkit import document, dumps

sys.path.append(f"{Path().parent.resolve()}")
import eval.pipelines as pipelines
import src.utils as utils
from eval.utils import (
    parse_toml,
)
from src.core.engine import EngineConfig
from src.core.provider import EmbedderProvider, LLMProvider


def generate_meta(
    path: str,
    dataset: dict,
    pipe: str,
    llm_provider: LLMProvider,
    embedder_provider: EmbedderProvider,
    **kwargs,
) -> Dict[str, Any]:
    return {
        "user_id": "wren-evaluator",  # this property is using for langfuse
        "session_id": f"eval_{uuid.uuid4()}",
        "date": datetime.now(),
        "dataset_id": dataset["dataset_id"],
        "evaluation_dataset": path,
        "query_count": len(dataset["eval_dataset"]),
        "commit": obtain_commit_hash(),
        "embedding_model": embedder_provider.get_model(),
        "generation_model": llm_provider.get_model(),
        "pipeline": pipe,
    }


def write_prediction(meta, predictions, dir_path="outputs/predictions") -> None:
    if Path(dir_path).exists() is False:
        Path(dir_path).mkdir(parents=True, exist_ok=True)

    output_path = f"{dir_path}/prediction_{meta['session_id']}_{meta['date'].strftime("%Y_%m_%d_%H%M%S")}.toml"

    doc = document()
    doc.add("meta", meta)
    doc.add("predictions", predictions)

    with open(output_path, "w") as file:
        file.write(dumps(doc))

    print(f"Prediction result is saved at {output_path}")


def obtain_commit_hash() -> str:
    repo = Repo(search_parent_directories=True)

    if repo.untracked_files:
        raise Exception("There are untracked files in the repository.")

    if repo.index.diff(None):
        raise Exception("There are uncommitted changes in the repository.")

    branch = repo.active_branch
    return f"{repo.head.commit}@{branch.name}"


def init_providers(mdl: dict) -> dict:
    engine_config = EngineConfig(
        provider="wren_ibis",
        config={
            "source": "bigquery",
            "manifest": base64.b64encode(orjson.dumps(mdl)).decode(),
            "connection_info": {
                "project_id": os.getenv("bigquery.project-id"),
                "dataset_id": os.getenv("bigquery.dataset-id"),
                "credentials": os.getenv("bigquery.credentials-key"),
            },
        },
    )

    providers = utils.init_providers(engine_config=engine_config)
    return {
        "llm_provider": providers[0],
        "embedder_provider": providers[1],
        "document_store_provider": providers[2],
        "engine": providers[3],
    }


def parse_args() -> Tuple[str]:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--file",
        "-F",
        type=str,
        help="Eval dataset file name in the eval/dataset folder",
    )
    parser.add_argument(
        "--pipeline",
        "-P",
        type=str,
        choices=["ask", "generation", "retrieval"],
        help="Specify the pipeline that you want to evaluate",
    )
    args = parser.parse_args()
    return f"eval/dataset/{args.file}", args.pipeline


if __name__ == "__main__":
    path, pipe = parse_args()

    dotenv.load_dotenv()
    utils.load_env_vars()
    utils.init_langfuse()

    dataset = parse_toml(path)
    providers = init_providers(dataset["mdl"])

    meta = generate_meta(path=path, dataset=dataset, pipe=pipe, **providers)

    pipe = pipelines.init(pipe, meta, mdl=dataset["mdl"], providers=providers)

    predictions = pipe.predict(dataset["eval_dataset"])
    meta["expected_batch_size"] = meta["query_count"] * pipe.candidate_size
    meta["actual_batch_size"] = len(predictions) - meta["query_count"]

    write_prediction(meta, predictions)
    langfuse_context.flush()
