import argparse

import tomlkit

from eval.utils import (
    get_next_few_items_circular,
)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--toml", type=str, help="The toml file name", required=True)
    args = parser.parse_args()

    if args.toml:
        # read toml
        with open(f"eval/dataset/{args.toml}", "r") as f:
            doc = tomlkit.parse(f.read())

        # get the list of question-sql pairs for generating sample values
        ground_truth_list = [
            {"question": element["question"], "sql": element["sql"]}
            for element in doc["eval_dataset"]
        ]

        # utilize utils.get_next_few_items_circular, put n samples in the eval dataset
        new_dataset = []
        for i, element in enumerate(doc["eval_dataset"]):
            samples = get_next_few_items_circular(ground_truth_list, i)
            element["samples"] = samples
            new_dataset.append(element)

        # write toml
        doc["eval_dataset"] = new_dataset

        with open(f"eval/dataset/added_samples_{args.toml}", "w") as f:
            f.write(tomlkit.dumps(doc, sort_keys=True))
