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
from eval.utils import (
    engine_config,
    get_contexts_from_sql,
    parse_toml,
    trace_metadata,
)
from src.core.engine import EngineConfig
from src.core.provider import EmbedderProvider, LLMProvider
from src.pipelines.ask import generation, retrieval
from src.pipelines.indexing import indexing


def generate_meta(
    path: str,
    dataset: dict,
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


def predict(meta: dict, queries: list, pipes: dict, mdl: dict) -> List[Dict[str, Any]]:
    async def run(query: dict, meta: dict, mdl: dict) -> list:
        prediction = await wrapper(query, meta)
        valid_outputs = (
            prediction["actual_output"]
            .get("post_process", {})
            .get("valid_generation_results", [])
        )

        return [prediction] + [
            await flat(actual, prediction.copy(), meta, mdl) for actual in valid_outputs
        ]

    @observe(capture_input=False)
    async def flat(actual: str, prediction: dict, meta: dict, mdl: dict) -> dict:
        langfuse_context.update_current_trace(
            name=f"Prediction Process - Shallow Trace for {prediction['input']} ",
            session_id=meta["session_id"],
            user_id=meta["user_id"],
            metadata={
                **trace_metadata(meta),
                "source_trace_id": prediction["trace_id"],
                "source_trace_url": prediction["trace_url"],
            },
        )

        prediction["actual_output"] = actual
        prediction["actual_output_units"] = await get_contexts_from_sql(
            sql=actual["sql"], **engine_config(mdl)
        )
        prediction["source_trace_id"] = prediction["trace_id"]
        prediction["source_trace_url"] = prediction["trace_url"]
        prediction["trace_id"] = langfuse_context.get_current_trace_id()
        prediction["trace_url"] = langfuse_context.get_current_trace_url()
        prediction["type"] = "shallow"

        return prediction

    @observe(name="Prediction Process", capture_input=False)
    async def wrapper(query: dict, meta: dict) -> dict:
        prediction = {
            "trace_id": langfuse_context.get_current_trace_id(),
            "trace_url": langfuse_context.get_current_trace_url(),
            "input": query["question"],
            "actual_output": {},
            "expected_output": query["sql"],
            "retrieval_context": [],
            "context": query["context"],
            "type": "execution",
        }

        langfuse_context.update_current_trace(
            session_id=meta["session_id"],
            user_id=meta["user_id"],
            metadata=trace_metadata(meta),
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

        return prediction

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

    async def task(mdl: dict):
        tasks = [run(query, meta, mdl) for query in queries]
        results = await tqdm_asyncio.gather(*tasks, desc="Generating Predictions")
        return [prediction for predictions in results for prediction in predictions]

    return asyncio.run(task(mdl))


def deploy_model(mdl, pipe) -> None:
    async def wrapper():
        await pipe.run(orjson.dumps(mdl).decode())

    asyncio.run(wrapper())


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


def setup_pipes(
    llm_provider, embedder_provider, document_store_provider, engine
) -> Dict[str, Any]:
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

    dataset = parse_toml(path)
    providers = init_providers(dataset["mdl"])

    meta = generate_meta(path=path, dataset=dataset, **providers)

    pipes = setup_pipes(**providers)
    deploy_model(dataset["mdl"], pipes["indexing"])
    predictions = predict(meta, dataset["eval_dataset"], pipes, dataset["mdl"])

    write_prediction(meta, predictions)
    langfuse_context.flush()
