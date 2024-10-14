import argparse

from eval.utils import gen_eval_preparation_data_from_json_to_csv, gen_new_mdl_from_csv

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--mdl-path", type=str, help="Path to the MDL JSON file", required=True
    )
    parser.add_argument("--csv-path", type=str, help="Path to the input CSV file")
    args = parser.parse_args()

    if args.mdl_path and not args.csv_path:
        gen_eval_preparation_data_from_json_to_csv(args.mdl_path)
    elif args.mdl_path and args.csv_path:
        gen_new_mdl_from_csv(args.mdl_path, args.csv_path)
