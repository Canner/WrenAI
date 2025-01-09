import argparse

import orjson


def to_str(mdl: dict) -> str:
    """Convert MDL dictionary to string format with proper escaping.

    Args:
        mdl (dict): The MDL dictionary containing schema information

    Returns:
        str: Properly escaped string representation of the MDL

    Example:
        mdl = {
            "schema": "public",
            "models": [
                {"name": "table1"}
            ]
        }
        result = to_str(mdl)
        # Returns escaped string representation
    """

    mdl_str = orjson.dumps(mdl).decode("utf-8")

    mdl_str = mdl_str.replace("\\", "\\\\")  # Escape backslashes
    mdl_str = mdl_str.replace('"', '\\"')  # Escape double quotes

    return mdl_str


def _args():
    parser = argparse.ArgumentParser(
        description="Convert MDL JSON file to escaped string format"
    )
    parser.add_argument("-p", "--path", help="Path to input MDL JSON file")
    return parser.parse_args()


if __name__ == "__main__":
    args = _args()
    mdl = orjson.loads(open(args.path).read())
    print(to_str(mdl))
