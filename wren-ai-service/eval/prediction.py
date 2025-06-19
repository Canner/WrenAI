import argparse
import base64
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Tuple

import orjson
from git import Repo
from langfuse.decorators import langfuse_context
from tomlkit import document, dumps

sys.path.append(f"{Path().parent.resolve()}")
import eval.pipelines as pipelines
import src.providers as provider
import src.utils as utils
from eval import EvalSettings
from eval.utils import (
    load_eval_data_db_to_postgres,
    parse_db_name,
    parse_toml,
    replace_wren_engine_env_variables,
)


def generate_meta(
    path: str,
    dataset: dict,
    pipe: str,
    settings: EvalSettings,
    **kwargs,
) -> Dict[str, Any]:
    return {
        "langfuse_url": settings.langfuse_url,
        "user_id": "wren-evaluator",  # this property is using for langfuse
        "session_id": f"eval_{pipe}_{uuid.uuid4()}",
        "date": datetime.now(),
        "dataset_id": dataset["dataset_id"],
        "evaluation_dataset": path,
        "query_count": len(dataset["eval_dataset"]),
        "commit": obtain_commit_hash(),
        "column_indexing_batch_size": settings.column_indexing_batch_size,
        "table_retrieval_size": settings.table_retrieval_size,
        "table_column_retrieval_size": settings.table_column_retrieval_size,
        "pipeline": pipe,
        "batch_size": settings.batch_size,
        "batch_interval": settings.batch_interval,
        "catalog": dataset["mdl"]["catalog"],
        "datasource": settings.datasource,
    }


def write_prediction(
    meta: dict, predictions: list[dict], dir_path: str = "outputs/predictions"
) -> None:
    if Path(dir_path).exists() is False:
        Path(dir_path).mkdir(parents=True, exist_ok=True)

    output_file = f"prediction_{meta['session_id']}_{meta['date'].strftime('%Y_%m_%d_%H%M%S')}.toml"
    output_path = f"{dir_path}/{output_file}"

    doc = document()
    doc.add("meta", meta)
    doc.add("predictions", predictions)

    with open(output_path, "w") as file:
        file.write(dumps(doc))

    print(f"\n\nPrediction result is saved at {output_path}")
    print(
        f"You can then evaluate the prediction result by running `just eval {output_file}`"
    )


def obtain_commit_hash() -> str:
    repo = Repo(search_parent_directories=True)
    branch = repo.active_branch
    return f"{repo.head.commit}@{branch.name}"


def parse_args() -> Tuple[str, str]:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--file",
        "-F",
        type=str,
        help="Eval dataset file path",
    )
    parser.add_argument(
        "--pipeline",
        "-P",
        type=str,
        choices=["ask", "generation", "retrieval"],
        help="Specify the pipeline that you want to evaluate",
    )
    args = parser.parse_args()
    return args.file, args.pipeline


if __name__ == "__main__":
    path, pipe_name = parse_args()
    dataset = parse_toml(path)

    settings = EvalSettings()
    # todo: refactor this
    _mdl = base64.b64encode(orjson.dumps(dataset["mdl"])).decode("utf-8")
    if "spider_" in path or "bird_" in path:
        db_name = parse_db_name(path)
        if "spider_" in path:
            settings.eval_data_db_path = "etc/spider1.0/database"
        elif "bird_" in path:
            settings.eval_data_db_path = "etc/bird/minidev/MINIDEV/dev_databases"
            load_eval_data_db_to_postgres(db_name, settings.eval_data_db_path)

        settings.datasource = "postgres"
        _connection_info = base64.b64encode(
            orjson.dumps(settings.postgres_info)
        ).decode("utf-8")
        replace_wren_engine_env_variables(
            "wren_ibis",
            {
                "manifest": _mdl,
                "source": settings.datasource,
                "connection_info": _connection_info,
            },
            settings.config_path,
        )
    else:
        _connection_info = base64.b64encode(
            orjson.dumps(settings.bigquery_info)
        ).decode("utf-8")
        replace_wren_engine_env_variables(
            "wren_ibis",
            {
                "manifest": _mdl,
                "source": settings.datasource,
                "connection_info": _connection_info,
            },
            settings.config_path,
        )

    pipe_components = provider.generate_components(settings.components)
    utils.init_langfuse(settings)

    meta = generate_meta(path=path, dataset=dataset, pipe=pipe_name, settings=settings)

    pipe: pipelines.Eval = pipelines.init(
        pipe_name,
        meta,
        mdl=dataset["mdl"],
        components=pipe_components,
        settings=settings,
    )

    predictions = pipe.predict(dataset["eval_dataset"])
    meta["expected_batch_size"] = meta["query_count"] * pipe.candidate_size
    meta["actual_batch_size"] = len(predictions)

    write_prediction(meta, predictions)
    langfuse_context.flush()

    if meta["langfuse_url"]:
        print(
            f"You can also view the prediction result in Langfuse at {meta['langfuse_url']}/sessions/{meta['session_id']}"
        )
