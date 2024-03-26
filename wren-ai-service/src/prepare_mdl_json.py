import argparse
import os
import shutil
from pathlib import Path

from .utils import load_env_vars

load_env_vars()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Prepare the MDL JSON file for the Wren engine using the Spider dataset"
    )
    parser.add_argument(
        "--dataset_name",
        type=str,
        default=os.getenv("DATASET_NAME"),
        help="Database name of the Spider dataset",
    )
    args = parser.parse_args()

    dataset_name = args.dataset_name

    assert Path(
        f"src/eval/data/{dataset_name}_mdl.json"
    ).exists(), f"File not found in src/eval/data: {dataset_name}_mdl.json"

    # remove all files in src/eval/wren-engine/etc/mdl
    os.system("rm -rf src/eval/wren-engine/etc/mdl/*")
    os.makedirs("src/eval/wren-engine/etc/mdl", exist_ok=True)

    # move the file to src/eval/wren-engine/etc/mdl
    shutil.copyfile(
        f"src/eval/data/{dataset_name}_mdl.json",
        f"src/eval/wren-engine/etc/mdl/{dataset_name}_mdl.json",
    )
