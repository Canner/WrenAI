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
                    pipe["engine"] = "wren_ui"

    # Write back to the file
    with open("config.yaml", "w") as file:
        yaml.safe_dump_all(documents, file, default_flow_style=False)

    print("Successfully updated engine names to 'wren_ui' in all pipelines")


if __name__ == "__main__":
    update_config()
