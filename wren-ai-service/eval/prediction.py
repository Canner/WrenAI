import argparse
import asyncio
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Tuple

import orjson
from langfuse.decorators import langfuse_context, observe
from tomlkit import document, dumps, parse
from tqdm import tqdm

sys.path.append(f"{Path().parent.resolve()}")
import src.utils as utils
from src.pipelines.ask import generation, retrieval
from src.pipelines.indexing import indexing


def generate_meta() -> Dict[str, Any]:
    return {
        "user_id": "wren-evaluator",  # this property is using for langfuse
        "session_id": f"eval_{uuid.uuid4()}",
        "date": datetime.now(),
    }


def write_prediction(meta, predictions, dir_path="outputs/predictions") -> None:
    if Path(dir_path).exists() is False:
        Path(dir_path).mkdir(parents=True, exist_ok=True)

    output_path = f"{dir_path}/prediction_{meta['session_id']}.toml"

    doc = document()
    doc.add("meta", meta)
    doc.add("predictions", predictions)

    with open(output_path, "w") as file:
        file.write(dumps(doc))


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

        # todo: do we need version, release, and other metadata?
        langfuse_context.update_current_trace(
            session_id=meta["session_id"],
            user_id=meta["user_id"],
        )

        result = await pipes["retrieval"].run(query=prediction["input"])
        documents = result.get("retrieval", {}).get("documents", [])
        actual_output = await pipes["generation"].run(
            query=prediction["input"],
            contexts=documents,
            exclude=[],
        )

        prediction["actual_output"] = actual_output
        prediction["retrieval_context"] = [
            {key: doc[key] for key in ("id", "content", "score")}
            for doc in (doc.to_dict() for doc in documents)
        ]

        predictions.append(prediction)

    for query in tqdm(queries, desc="Generating Predictions"):
        asyncio.run(wrapper(query))

    return predictions


def deploy_model(mdl, pipe) -> None:
    async def wrapper():
        await pipe.run(orjson.dumps(mdl).decode())

    asyncio.run(wrapper())


def setup_pipes() -> Dict[str, Any]:
    (
        llm_provider,
        embedder_provider,
        document_store_provider,
        engine,
    ) = utils.init_providers()

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

    utils.load_env_vars()
    utils.init_langfuse()
    pipes = setup_pipes()

    meta = generate_meta()

    dataset = parse(open(path).read())
    deploy_model(dataset["mdl"], pipes["indexing"])
    predictions = predict(meta, dataset["eval_dataset"], pipes)

    write_prediction(meta, predictions)
    langfuse_context.flush()
