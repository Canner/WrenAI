import streamlit as st
import uuid
from session_state import ConfigState
from config_loader import load_selected_example_yaml, apply_config_blocks
from dry_run_test import llm_completion_test, llm_embedding_test
import yaml
import os

def render_import_yaml():
    """
    Render the configuration YAML import section.
    Supports loading example YAMLs from GitHub or uploading a custom YAML.
    """
    with st.expander("Import Configuration YAML", expanded=False):
        # Load example YAML filenames from GitHub
        example_names = ["None"] + st.session_state.get("example_yaml_names", [])
        selected_examples_yaml = st.selectbox("Select example config YAML", options=example_names)

        # Load selected example YAML
        if selected_examples_yaml != "None" and st.button("Import.yaml", key="import__examples_yaml"):
            blocks = load_selected_example_yaml(selected_examples_yaml)
            apply_config_blocks(blocks)
            st.success("YAML import succeeded. Settings updated.")

        # Upload custom YAML
        uploaded_file = st.file_uploader("Upload your own YAML file", type=["yaml", "yml"])
        if uploaded_file is not None and st.button("Import.yaml", key="import_own_yaml"):
            try:
                blocks = list(yaml.safe_load_all(uploaded_file))
                apply_config_blocks(blocks)
            except Exception as e:
                st.error(f"Failed to import YAML file: {e}")


def render_apikey():
    """
    Render the API Key configuration section.
    Supports adding, editing, saving, and deleting multiple API keys.
    """
    with st.expander("API Key", expanded=False):
        from constants import get_env_path
        CONFIG_ENV_PATH = get_env_path()
        add_api_key = st.session_state[ConfigState.API_KEY]
        add_api_key_form = st.session_state[ConfigState.API_KEY_FORM]

        if st.button("➕ API KEY", key="add_api_key_form"):
            add_api_key_form.append({"id": str(uuid.uuid4()), "key": "", "value": "", "is_saved": False})

        for apikey in add_api_key_form:
            kcol, vcol, rcol = st.columns([4, 6, 2])

            with kcol:
                apikey["key"] = st.text_input("apikey_service (LLMAI_API_KEY)", key=f"api_key_{apikey['id']}", value=apikey["key"], disabled=apikey.get("is_saved", False))

            with vcol:
                apikey["value"] = st.text_input("apikey", key=f"api_val_{apikey['id']}", value=apikey["value"], type="password", disabled=apikey.get("is_saved", False))

            with rcol:
                st.markdown("<br>", unsafe_allow_html=True)
                if st.button("DEL", key=f"del_apikey_{apikey['id']}"):
                    # Attempt to remove the API key from the .env file if it exists  
                    key_to_delete = apikey["key"]

                    if CONFIG_ENV_PATH.exists():
                        with open(CONFIG_ENV_PATH, "r", encoding="utf-8") as f:
                            lines = f.readlines()

                        # Remove the line that starts with the specified key
                        new_lines = [line for line in lines if not line.strip().startswith(f"{key_to_delete}=")]

                        with open(CONFIG_ENV_PATH, "w", encoding="utf-8") as f:
                            f.writelines(new_lines)

                    # Remove the key from both the environment and session state
                    os.environ.pop(apikey["key"], None)
                    add_api_key.pop(apikey["key"], None)
                    add_api_key_form[:] = [item for item in add_api_key_form if item["id"] != apikey["id"]]

                    st.rerun()

        if st.button("SAVE", key="save_apikey"):
            keys = []
            if len(add_api_key_form) == 0:
                st.error("No API key has been added.")
                return

            for fields in add_api_key_form:
                if not fields["key"] or not fields["value"]:
                    st.error("Each API key and value must be filled out.")
                    return
                keys.append(fields["key"])

            if len(keys) != len(set(keys)):
                st.error("API key names must be unique. Duplicate keys found.")
                return

            # Convert key-value form into a dictionary
            processed_keys = {item["key"]: item["value"] for item in add_api_key_form}

            add_api_key.clear()
            add_api_key.update(processed_keys)

            for item in add_api_key_form:
                item["is_saved"] = True

            # ✅ Overwrite or append keys to /app/data/.env
            existing_lines = []

            # Read existing lines if the .env file exists
            if CONFIG_ENV_PATH.exists():
                with open(CONFIG_ENV_PATH, "r", encoding="utf-8") as f:
                    existing_lines = f.readlines()

            new_lines = []
            seen_keys = set()

            # First, update values of keys that already exist in the .env file
            for line in existing_lines:
                if "=" in line:
                    k, _, v = line.partition("=")
                    k = k.strip()
                    if k in processed_keys:
                        new_lines.append(f"{k}={processed_keys[k]}\n")
                        seen_keys.add(k)
                    else:
                        new_lines.append(line)
                else:
                    new_lines.append(line)

            # Then, append any new keys that were not seen in the existing file
            for k, v in processed_keys.items():
                if k not in seen_keys:
                    new_lines.append(f"{k}={v}\n")

            # Write updated lines back to the .env file
            with open(CONFIG_ENV_PATH, "w", encoding="utf-8") as f:
                f.writelines(new_lines)

            st.success("API keys saved to .env.")

            st.rerun()

def render_llm_config():
    """
    Render the LLM configuration section.
    Allows creating, editing, validating, testing, and saving LLM model entries.
    """
    if "form_titles" not in st.session_state:
        st.session_state.form_titles = {}

    if st.button("➕  Add model", key="btn_add_model"):
        st.session_state[ConfigState.LLM_FORMS_KEY].append({
            "id": str(uuid.uuid4()),
            "model": "new-model",
            "alias": "",
            "api_base": "",
            "timeout": 120,
            "kwargs": []
        })

    for form in st.session_state[ConfigState.LLM_FORMS_KEY]:
        form_id = form["id"]
        if form["model"]:
            st.session_state.form_titles[form_id] = form["model"]
        title = st.session_state.form_titles.get(form_id, "new-model")

        with st.expander(title, expanded=False):
            form["model"] = st.text_input("Model name", key=f"model_name_{form_id}", value=form["model"])
            form["alias"] = st.text_input("Alias (Optional)", key=f"alias_{form_id}", value=form["alias"])
            form["api_base"] = st.text_input("API Base URL", key=f"api_base_{form_id}", value=form["api_base"])
            form["timeout"] = st.text_input("Timeout", key=f"timeout_{form_id}", value=form["timeout"])

            if st.button("➕ Add KWArg Field", key=f"add_kwarg_{form_id}"):
                form["kwargs"].append({"key": "", "value": ""})

            for kw_idx, pair in enumerate(form["kwargs"]):
                kcol, vcol, rcol = st.columns([4, 4, 3])
                with kcol:
                    pair["key"] = st.text_input("Key", key=f"kw_key_{form_id}_{kw_idx}", value=pair["key"])
                with vcol:
                    pair["value"] = st.text_input("Value", key=f"kw_val_{form_id}_{kw_idx}", value=pair["value"])
                with rcol:
                    st.markdown("<br>", unsafe_allow_html=True)
                    if st.button("DEL", key=f"del_kw_{form_id}_{kw_idx}"):
                        form["kwargs"].pop(kw_idx)
                        st.rerun()

            if st.button("💾  Save this model", key=f"save_{form_id}"):
                return_state, msg = save_llm_model(form, form_id)
                if return_state:
                    st.success(msg)

            if st.button("🗑️  Remove this form", key=f"remove_form_{form_id}"):
                remove_llm_model(form_id)
                st.rerun()

            if st.button("test_llm_model", key=f"test_llm_{form_id}"):
                if not st.session_state[ConfigState.API_KEY]:
                    st.error("No API key has been saved.")
                    return

                llm_state, llm_msg = llm_completion_test(form)
                if llm_state:
                    st.success("Test Success")
                else:
                    st.error(llm_msg)



def render_embedder_config():
    """
    Render the embedding model configuration section.
    Displays current provider settings and allows users to override the model name,
    alias, timeout, and base URL. Supports testing and saving.
    """
    embedding_models = st.session_state[ConfigState.EMBEDDER_KEY].get("models", [])
    default_name = embedding_models[0].get("model") or "text-embedding-3-large"
    
    with st.expander(f"{default_name}", expanded=False):
        st.markdown(f"**type:** `embedder`")
        st.markdown(f"**provider:** `{st.session_state[ConfigState.EMBEDDER_KEY].get('provider')}`")

        embedding_api_base = embedding_models[0].get("api_base", "https://api.openai.com/v1") if embedding_models else ""

        embedding_model_name = st.text_input("Embedding Model Name", key="embedding_model_name", value=default_name)
        embedding_model_alias = st.text_input("Alias (optional, e.g. default)", key="embedding_model_alias", value="default")
        embedding_model_api_base = st.text_input("API Base URL", key="embedding_model_api_base", value=embedding_api_base)
        embedding_model_timeout = st.text_input("Timeout (default: 120)", key="embedding_model_timeout", value="120")

        # Dimension of the embedding model output vector, used by document store for index creation
        document_store_dim = st.text_input("Embedding_model_dim (placed in doucument_store)", key="embedding_model_dim", value="3072")

        custom_embedding_setting = [{
            "model": embedding_model_name,
            "alias": embedding_model_alias,
            "timeout": embedding_model_timeout,
            "api_base": embedding_model_api_base
        }]

        if st.button("💾  save", key="save_embedding_model"):
            errors = []
            if not embedding_model_name:
                errors.append("Embedding Model Name is required.")
            if not embedding_model_timeout:
                errors.append("Timeout is required.")
            else:
                try:
                    int(embedding_model_timeout)
                except ValueError:
                    errors.append("Timeout must be an integer.")

            if not document_store_dim:
                errors.append("Embedding model dim is required.")
            else:
                try:
                    int(document_store_dim)
                except ValueError:
                    errors.append("Embedding model dim must be an integer.")

            if errors:
                for error in errors:
                    st.error(error)
            else:
                st.session_state.embedding_model = {
                    "type": "embedder",
                    "provider": st.session_state[ConfigState.EMBEDDER_KEY].get("provider"),
                    "models": custom_embedding_setting
                }

                st.session_state.document_store = {
                    "type": "document_store",
                    "provider": st.session_state[ConfigState.DOC_STORE_KEY].get("provider"),
                    "location": st.session_state[ConfigState.DOC_STORE_KEY].get("location"),
                    "embedding_model_dim": document_store_dim,
                    "timeout": st.session_state[ConfigState.DOC_STORE_KEY].get("timeout"),
                    "recreate_index": st.session_state[ConfigState.DOC_STORE_KEY].get("recreate_index")
                }
                
                st.success("Updated embedder model configuration")
                st.rerun()

        if st.button("test_embedding_model", key="test_embedding_model"):
            if not st.session_state[ConfigState.API_KEY]:
                st.error("No API key has been saved.")
                return

            embedding_state, embedding_msg = llm_embedding_test()
            if embedding_state:
                st.success("Success")
            else:
                st.error(embedding_msg)


# DELETE 
# def render_document_store_config():
#     """
#     Render the document store configuration section.
#     Displays current settings and allows updating index location, dimensions, timeout, etc.
#     """
#     with st.expander("Document Store Configuration", expanded=False):
#         st.markdown(f"**type:** `document_store`")
#         st.markdown(f"**provider:** `{st.session_state[ConfigState.DOC_STORE_KEY].get('provider')}`")
#         st.markdown(f"**location:** `{st.session_state[ConfigState.DOC_STORE_KEY].get('location')}`")

#         document_store_timeout = st.text_input("Timeout (default: 120)", key="document_store_timeout", value="120")
#         st.markdown(f"**timeout:** `120`")
#         st.markdown(f"**recreate_index:** `{st.session_state[ConfigState.DOC_STORE_KEY].get('recreate_index')}`")

#         document_store_dim = st.text_input("Embedding_model_dim", value="3072")

#         if st.button("💾  save", key="save_document_store"):
#             errors = []
#             if not document_store_dim:
#                 errors.append("Embedding model dim is required.")
#             else:
#                 try:
#                     int(document_store_dim)
#                 except ValueError:
#                     errors.append("Embedding model dim must be an integer.")

#             if not document_store_timeout:
#                 errors.append("Timeout is required.")
#             else:
#                 try:
#                     int(document_store_timeout)
#                 except ValueError:
#                     errors.append("Timeout must be an integer.")

#             if errors:
#                 for error in errors:
#                     st.error(error)
#             else:
#                 st.session_state.document_store = {
#                     "type": "document_store",
#                     "provider": st.session_state[ConfigState.DOC_STORE_KEY].get("provider"),
#                     "location": st.session_state[ConfigState.DOC_STORE_KEY].get("location"),
#                     "embedding_model_dim": document_store_dim,
#                     "timeout": document_store_timeout,
#                     "recreate_index": st.session_state[ConfigState.DOC_STORE_KEY].get("recreate_index")
#                 }
#                 st.success("Updated document store configuration")

def render_pipeline_config():
    """
    Render the pipeline configuration section.
    Allows selecting LLM models for each defined pipeline step.
    """
    pipeline_llm_options = []
    all_pipelines = st.session_state[ConfigState.PIPELINE_KEY].get("pipes", [])

    # set all LLM models options
    for model in st.session_state[ConfigState.LLM_MODELS_KEY]:
        if model.get("alias"):
            pipeline_llm_options.append("litellm_llm." + model["alias"])
        elif model.get("model"):
            pipeline_llm_options.append("litellm_llm." + model["model"])

    # enumerate all pipelines, record original index
    for original_idx, pipe in enumerate(all_pipelines):
        if not pipe.get("llm"):
            continue

        pipe_name = pipe.get("name", f"Unnamed Pipeline {original_idx}")
        with st.expander(f"🔧 Pipeline: {pipe_name}", expanded=False):
            for key, value in pipe.items():
                if key == "llm":
                    selected_llm = st.selectbox(
                        "LLM Model",
                        options=pipeline_llm_options,
                        index=pipeline_llm_options.index(value) if value in pipeline_llm_options else 0,
                        key=f"llm_{original_idx}"
                    )
                else:
                    st.markdown(f"**{key}:** `{value}`")

            if st.button("💾  Save this llm", key=f"save_{pipe_name}"):
                # ✅ use original index to update llm
                st.session_state[ConfigState.PIPELINE_KEY]["pipes"][original_idx]["llm"] = selected_llm
                st.success(f"✅ Updated pipeline `{pipe_name}` LLM to `{selected_llm}`")



def render_preview(engine_blocks, settings_block):
    """
    Render the preview section and display all configured components 
    """
    st.subheader("Current Configuration (Preview)")

    preview_blocks, _ = get_config_blocks(engine_blocks, settings_block)
    st.json(preview_blocks)

def render_generate_button(engine_blocks, settings_block):
    """
    Render the generate button section and handle saving configuration to files.
    Writes the final configuration to config.yaml and creates config.done marker file.
    """
    if st.button("Save configuration", key="generate_config_yaml"):
        from constants import get_config_path, get_config_done_path
        CONFIG_OUT_PATH = get_config_path()
        CONFIG_DONE_PATH = get_config_done_path()
        _, generate_blocks = get_config_blocks(engine_blocks, settings_block)

        try:
            with open(CONFIG_OUT_PATH, "w", encoding="utf-8") as f:
                yaml.dump_all(generate_blocks, f, sort_keys=False, allow_unicode=True)
            st.success(f"Config saved to {CONFIG_OUT_PATH.resolve()}")

            with open(CONFIG_DONE_PATH, "w", encoding="utf-8") as f:
                f.write("true\n")
            st.success("✅ Configuration completed. Please return to the CLI.")
        except Exception as e:
            st.error(f"❌ Failed to generate config: {e}")



def save_llm_model(form, form_id):
    """
    Validate and save a single LLM model form to session state.
    Checks for required fields, converts kwargs, and handles alias uniqueness.
    """
    errors = validate_llm_form(form)
    if errors:
        for error in errors:
            st.error(error)
        return False, None

    # Convert list of kwargs to dictionary
    kwargs_dict = {}
    for p in form["kwargs"]:
        if p["key"]:
            try:
                kwargs_dict[p["key"]] = eval(p["value"])
            except Exception:
                kwargs_dict[p["key"]] = p["value"]

    # Prevent duplicate aliases
    if form["alias"]:
        existing_aliases = [
            m.get("alias") for m in st.session_state[ConfigState.LLM_MODELS_KEY]
            if m.get("id") != form_id and "alias" in m
        ]
        if form["alias"] in existing_aliases:
            st.error(f"Duplicate alias name: {form['alias']}.")
            return False, None

    saved_entry = {
        "model": form["model"],
        **({"alias": form["alias"]} if form["alias"] else {}),
        "api_base": form["api_base"],
        "timeout": form["timeout"],
        "kwargs": kwargs_dict,
    }

    existing_ids = [m.get("id") for m in st.session_state[ConfigState.LLM_MODELS_KEY]]
    if form_id in existing_ids:
        index = existing_ids.index(form_id)
        st.session_state[ConfigState.LLM_MODELS_KEY][index] = {**saved_entry, "id": form_id}
        return True, f"Updated model: {form['model']}"
    else:
        st.session_state[ConfigState.LLM_MODELS_KEY].append({**saved_entry, "id": form_id})
        return True, f"Added new model: {form['model']}"


def remove_llm_model(form_id):
    """
    Remove a model and its form from session state by ID.
    """
    st.session_state[ConfigState.LLM_FORMS_KEY] = [
        f for f in st.session_state[ConfigState.LLM_FORMS_KEY] if f["id"] != form_id
    ]
    st.session_state[ConfigState.LLM_MODELS_KEY] = [
        m for m in st.session_state[ConfigState.LLM_MODELS_KEY] if m.get("id") != form_id
    ]


def validate_llm_form(form):
    """
    Validate a single LLM form for completeness and formatting.
    Returns a list of error messages if validation fails.
    """
    errors = []

    if not form.get("model"):
        errors.append("Model name is required.")
    if not form.get("api_base"):
        errors.append("API Base URL is required.")
    if not form.get("timeout"):
        errors.append("Timeout is required.")
    else:
        try:
            int(form["timeout"])
        except ValueError:
            errors.append("Timeout must be an integer.")

    for idx, pair in enumerate(form.get("kwargs", [])):
        if pair.get("key") and not pair.get("value"):
            errors.append(f"KWArg field {idx+1}: Value is required when key is provided.")
        if pair.get("value") and not pair.get("key"):
            errors.append(f"KWArg field {idx+1}: Key is required when value is provided.")

    return errors


def get_config_blocks(engine_blocks, settings_block): 
    """
    Returns preview blocks for display and generate blocks for saving.
    """
    llm_preview = {
        "type": "llm",
        "provider": "litellm_llm",
        "models": [
            {k: v for k, v in model.items() if k != "id"}
            for model in st.session_state.get(ConfigState.LLM_MODELS_KEY, [])
        ]
    }

    embedder_preview = st.session_state.get(ConfigState.EMBEDDER_KEY)
    document_store_preview = st.session_state.get(ConfigState.DOC_STORE_KEY)

    pipeline_preview = {
        "type": "pipeline",
        "pipes": [form for form in st.session_state.get(ConfigState.PIPELINE_KEY, {}).get("pipes", []) if form.get("llm")]
    }

    generate_pipeline_block = {
        "type": "pipeline",
        "pipes": st.session_state.get(ConfigState.PIPELINE_KEY, {}).get("pipes", [])
    }

    preview_blocks = [llm_preview, embedder_preview, document_store_preview, pipeline_preview]
    generate_blocks = [
        llm_preview,
        embedder_preview,
        *[
            {"type": "engine", "provider": engine.get("provider"), "endpoint": engine.get("endpoint")}
            for engine in engine_blocks
        ],
        document_store_preview,
        generate_pipeline_block,
        {"settings": settings_block}
    ]

    return preview_blocks, generate_blocks
