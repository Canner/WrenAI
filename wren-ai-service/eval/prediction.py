import argparse
import asyncio
import base64
import os
import re
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Tuple

import dotenv
import orjson
from git import Repo
from langfuse.decorators import langfuse_context, observe
from tomlkit import document, dumps
from tqdm.asyncio import tqdm_asyncio

sys.path.append(f"{Path().parent.resolve()}")
import src.utils as utils
from eval.utils import parse_toml
from src.pipelines.ask import generation, retrieval
from src.pipelines.indexing import indexing


def generate_meta(dataset_path: str) -> Dict[str, Any]:
    return {
        "user_id": "wren-evaluator",  # this property is using for langfuse
        "session_id": f"eval_{uuid.uuid4()}",
        "date": datetime.now(),
        "evaluation_dataset": dataset_path,
        "commit": obtain_commit_hash(),
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


def obtain_commit_hash() -> str:
    repo = Repo(search_parent_directories=True)

    if repo.untracked_files:
        raise Exception("There are untracked files in the repository.")

    if repo.index.diff(None):
        raise Exception("There are uncommitted changes in the repository.")

    branch = repo.active_branch
    return f"{repo.head.commit}@{branch.name}"


def predict(meta: dict, queries: list, pipes: dict) -> List[Dict[str, Any]]:
    predictions = []

    @observe(name="Prediction Process")
    async def wrapper(query: dict) -> None:
        prediction = {
            "trace_id": langfuse_context.get_current_trace_id(),
            "trace_url": langfuse_context.get_current_trace_url(),
            "input": query["question"],
            "actual_output": [],
            "expected_output": query["sql"],
            "retrieval_context": [],
            "context": query["context"],
        }

        langfuse_context.update_current_trace(
            session_id=meta["session_id"],
            user_id=meta["user_id"],
            metadata={
                "commit": meta["commit"],
            },
        )

        result = await pipes["retrieval"].run(query=prediction["input"])
        documents = result.get("retrieval", {}).get("documents", [])
        actual_output = await pipes["generation"].run(
            query=prediction["input"],
            contexts=documents,
            exclude=[],
        )

        prediction["actual_output"] = actual_output
        prediction["retrieval_context"] = extract_units(
            [doc.to_dict() for doc in documents]
        )

        predictions.append(prediction)

    def extract_units(docs: list) -> list:
        columns = []
        for doc in docs:
            columns.extend(parse_ddl(doc["content"]))
        return columns

    def parse_ddl(ddl: str) -> list:
        # Regex to extract table name
        table_name_match = re.search(r"CREATE TABLE (\w+)", ddl, re.IGNORECASE)
        table_name = table_name_match.group(1) if table_name_match else None

        # Regex to extract column names
        columns = re.findall(r"-- \{[^}]*\}\n\s*(\w+)", ddl)

        # Format columns with table name as prefix
        if table_name:
            columns = [f"{table_name}.{col}" for col in columns]

        return columns

    async def task():
        tasks = [wrapper(query) for query in queries]
        await tqdm_asyncio.gather(*tasks, desc="Generating Predictions")

    asyncio.run(task())

    return predictions


def deploy_model(mdl, pipe) -> None:
    async def wrapper():
        await pipe.run(orjson.dumps(mdl).decode())

    asyncio.run(wrapper())


def setup_pipes(mdl: str) -> Dict[str, Any]:
    (
        llm_provider,
        embedder_provider,
        document_store_provider,
        engine,
    ) = utils.init_providers(
        engine_config=utils.EngineConfig(
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
    )

    document_store_provider.get_store(recreate_index=True)
    return {
        "indexing": indexing.Indexing(
            embedder_provider=embedder_provider,
            document_store_provider=document_store_provider,
        ),
        "retrieval": retrieval.Retrieval(
            embedder_provider=embedder_provider,
            document_store_provider=document_store_provider,
        ),
        "generation": generation.Generation(
            llm_provider=llm_provider,
            engine=engine,
        ),
    }


def parse_args() -> Tuple[str]:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--file",
        "-F",
        type=str,
        help="Eval dataset file name in the eval/dataset folder",
    )
    args = parser.parse_args()
    return f"eval/dataset/{args.file}"


if __name__ == "__main__":
    path = parse_args()

    dotenv.load_dotenv()
    utils.load_env_vars()
    utils.init_langfuse()

    meta = generate_meta(dataset_path=path)

    dataset = parse_toml(path)
    pipes = setup_pipes(dataset["mdl"])
    deploy_model(dataset["mdl"], pipes["indexing"])
    predictions = predict(meta, dataset["eval_dataset"], pipes)

    write_prediction(meta, predictions)
    langfuse_context.flush()
