import streamlit as st
import uuid

class ConfigState:
    # Session state keys
    LLM_FORMS_KEY = "llm_forms"
    LLM_MODELS_KEY = "llm_models"
    EMBEDDER_KEY = "embedding_model"
    DOC_STORE_KEY = "document_store"
    PIPELINE_KEY = "pipeline"
    API_KEY = "api_key"
    API_KEY_FORM = "api_key_form"
    EXAMPLE_CONFIG_NAMES_KEY = "example_yaml_names"

    @classmethod
    def init(cls, llm_block, embedder_block, document_store_block, pipeline_block, force=False):
        """
        Initialize all configuration-related session states. 
        Set force=True to overwrite existing values.
        """
        cls.init_llm_forms(llm_block, force=force)
        cls.init_embedder(embedder_block, force=force)
        cls.init_document_store(document_store_block, force=force)
        cls.init_pipeline(pipeline_block, force=force)
        cls.init_apikey()
        cls.init_example_configs()

    @classmethod
    def init_llm_forms(cls, llm_block, force=False):
        """
        Initialize LLM form and model configuration in session state.
        This sets up editable forms for each model and compiles a cleaned model list.
        """
        if not force and cls.LLM_FORMS_KEY in st.session_state and st.session_state[cls.LLM_FORMS_KEY]:
            return

        st.session_state[cls.LLM_FORMS_KEY] = []
        st.session_state[cls.LLM_MODELS_KEY] = []

        for model_item in llm_block.get("models", []):
            form_entry = {
                "id": str(uuid.uuid4()),
                "model": model_item.get("model", ""),
                "alias": model_item.get("alias", ""),
                "api_base": model_item.get("api_base", "https://api.openai.com/v1"),
                "timeout": int(llm_block.get("timeout", 120)),
                "kwargs": [
                    {"key": k, "value": v}
                    for k, v in model_item.get("kwargs", {}).items()
                ]
            }

            st.session_state[cls.LLM_FORMS_KEY].append(form_entry)

            # Flatten kwargs and prepare cleaned model block
            model_entry = {
                "id": form_entry["id"],
                "model": form_entry["model"],
                **({'alias': form_entry["alias"]} if form_entry["alias"] else {}),
                "api_base": form_entry["api_base"],
                "timeout": form_entry["timeout"],
                "kwargs": {k["key"]: k["value"] for k in form_entry["kwargs"] if k["key"]},
            }

            st.session_state[cls.LLM_MODELS_KEY].append(model_entry)

    @classmethod
    def init_embedder(cls, embedder_block, force=False):
        """
        Initialize embedding model configuration.
        Ensures all models have an 'api_base' field set.
        """
        if not force and cls.EMBEDDER_KEY in st.session_state and st.session_state[cls.EMBEDDER_KEY]:
            return

        st.session_state[cls.EMBEDDER_KEY] = None

        if embedder_block.get("models"):
            for model in embedder_block["models"]:
                if "api_base" not in model:
                    model["api_base"] = "https://api.openai.com/v1"

            st.session_state[cls.EMBEDDER_KEY] = {
                "type": "embedder",
                "provider": embedder_block.get("provider"),
                "models": embedder_block["models"],
            }

    @classmethod
    def init_document_store(cls, document_store_block, force=False):
        """
        Initialize document store configuration.
        Provides default values for missing fields like timeout and dimension.
        """
        if not force and cls.DOC_STORE_KEY in st.session_state and st.session_state[cls.DOC_STORE_KEY]:
            return

        st.session_state[cls.DOC_STORE_KEY] = {
            "type": "document_store",
            "provider": document_store_block.get("provider"),
            "location": document_store_block.get("location"),
            "embedding_model_dim": document_store_block.get("embedding_model_dim", 3072),
            "timeout": document_store_block.get("timeout", 120),
            "recreate_index": document_store_block.get("recreate_index", False),
        }

    @classmethod
    def init_pipeline(cls, pipeline_block, force=False):
        """
        Initialize pipeline configuration block.
        """
        if not force and cls.PIPELINE_KEY in st.session_state and st.session_state[cls.PIPELINE_KEY]:
            return

        st.session_state[cls.PIPELINE_KEY] = {
            "type": "pipeline",
            "pipes": pipeline_block.get("pipes", []),
        }

    @classmethod
    def init_apikey(cls, force=False):
        """
        Initialize the API key input state.
        Stores both the key-value pair and a user-editable form.
        """
        if cls.API_KEY not in st.session_state:
            st.session_state[cls.API_KEY] = {}
        if cls.API_KEY_FORM not in st.session_state:
            st.session_state[cls.API_KEY_FORM] = []

    @classmethod
    def init_example_configs(cls, force=False):
        """
        Fetch and store the list of available example YAML filenames from GitHub.
        Delayed import is used to avoid circular dependency.
        """
        from config_loader import fetch_example_yaml_filenames
        st.session_state[cls.EXAMPLE_CONFIG_NAMES_KEY] = fetch_example_yaml_filenames()

    # Additional CRUD methods for LLM, Embedder, etc. can be added below.
