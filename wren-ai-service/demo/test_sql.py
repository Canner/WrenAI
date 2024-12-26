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
        "--dataset-type",
        type=str,
        default="bigquery",
        choices=["bigquery", "duckdb"],
        help="Dataset type (default: bigquery)",
    )

    parser.add_argument(
        "--dataset",
        type=str,
        default="ecommerce",
        choices=["ecommerce", "hr", ""],
        help="Dataset (default: ecommerce)",
    )

    args = parser.parse_args()

    # Load MDL JSON file
    try:
        with open(args.mdl_path, "r") as f:
            mdl_json = json.load(f)
    except FileNotFoundError:
        print(f"Error: MDL file not found at {args.mdl_path}")
        return
    except json.JSONDecodeError:
        print(f"Error: Invalid JSON in MDL file {args.mdl_path}")
        return

    rerun_wren_engine(mdl_json, args.dataset_type, args.dataset)

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
                    dataset_type=args.dataset_type,
                    manifest=mdl_json,
                    limit=10,
                )
                print(f"\nExecution result:\n{df.to_string()}\n")
            except Exception as e:
                print(f"Error executing query: {str(e)}")
        else:
            lines.append(line)


if __name__ == "__main__":
    main()
