# This file is only used for local development
# It will update the config.yaml file to use correct engine name for all pipelines
# Since the demo app uses the same config.yaml and the app will update the engine names while deploying mdl,
# so we need to force update the engine names to the correct ones when we would like to use Wren UI

import yaml


def update_config():
    # Read the config file
    with open("config.yaml", "r") as file:
        # Load all documents from YAML file (since it has multiple documents separated by ---)
        documents = list(yaml.safe_load_all(file))

    # Find the pipeline configuration document
    for doc in documents:
        if doc.get("type") == "pipeline":
            # Update engine name in all pipelines
            for pipe in doc.get("pipes", []):
                if "engine" in pipe:
                    if pipe["name"] == "sql_functions_retrieval":
                        pipe["engine"] = "wren_ibis"
                    else:
                        pipe["engine"] = "wren_ui"

    # Write back to the file
    with open("config.yaml", "w") as file:
        yaml.safe_dump_all(documents, file, default_flow_style=False)

    print("Successfully updated engine names to 'wren_ui' in all pipelines")


if __name__ == "__main__":
    update_config()
