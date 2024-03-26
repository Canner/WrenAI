import os
import shutil
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(".env.dev", override=True)


if __name__ == "__main__":
    dataset_name = os.getenv("DATASET_NAME")

    assert Path(
        f"src/eval/data/{dataset_name}_mdl.json"
    ).exists(), f"File not found in src/eval/data: {dataset_name}_mdl.json"

    # remove all files in src/eval/wren-engine/etc/mdl
    os.system("rm -rf src/eval/wren-engine/etc/mdl/*")

    # move the file to src/eval/wren-engine/etc/mdl
    shutil.copyfile(
        f"src/eval/data/{dataset_name}_mdl.json",
        f"src/eval/wren-engine/etc/mdl/{dataset_name}_mdl.json",
    )
