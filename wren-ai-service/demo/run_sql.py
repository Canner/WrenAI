import argparse
import json

from utils import get_data_from_wren_engine, rerun_wren_engine


def main():
    parser = argparse.ArgumentParser(
        description="Execute SQL query against MDL manifest"
    )

    parser.add_argument(
        "--mdl-path",
        type=str,
        required=True,
        help="Path to MDL JSON file",
    )

    parser.add_argument(
        "--data-source",
        type=str,
        default="bigquery",
        choices=["bigquery", "duckdb"],
        help="Data source (default: bigquery)",
    )

    parser.add_argument(
        "--sample-dataset",
        type=str,
        default="ecommerce",
        choices=["ecommerce", "hr", ""],
        help="Sample dataset (default: ecommerce)",
    )

    args = parser.parse_args()

    mdl_path = args.mdl_path
    data_source = args.data_source
    sample_dataset = args.sample_dataset

    # Load MDL JSON file
    try:
        with open(mdl_path, "r") as f:
            mdl_json = json.load(f)
    except FileNotFoundError:
        print(f"Error: MDL file not found at {mdl_path}")
        return
    except json.JSONDecodeError:
        print(f"Error: Invalid JSON in MDL file {mdl_path}")
        return

    rerun_wren_engine(mdl_json, data_source, sample_dataset)

    # Execute query
    print("Enter SQL query (end with semicolon on a new line to execute, 'q' to quit):")
    lines = []
    while True:
        line = input()
        if line.strip() == "q":
            break
        if line.strip() == ";":
            command = "\n".join(lines)
            lines = []
            try:
                df = get_data_from_wren_engine(
                    sql=command,
                    dataset_type=data_source,
                    manifest=mdl_json,
                    limit=10,
                )
                print(f"\nExecution result:\n{df.to_string()}\n")
            except Exception as e:
                print(f"\nError executing query: {str(e)}")
        else:
            lines.append(line)


if __name__ == "__main__":
    main()
