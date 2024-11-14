import re
import uuid

import orjson
import streamlit as st
from utils import (
    DATA_SOURCES,
    ask,
    ask_details,
    get_mdl_json,
    prepare_semantics,
    rerun_wren_engine,
    save_mdl_json_file,
    show_asks_details_results,
    show_asks_results,
)

st.set_page_config(layout="wide")
st.title("Wren AI LLM Service Demo")

if "deployment_id" not in st.session_state:
    st.session_state["deployment_id"] = str(uuid.uuid4())
if "chosen_dataset" not in st.session_state:
    st.session_state["chosen_dataset"] = "ecommerce"
if "dataset_type" not in st.session_state:
    st.session_state["dataset_type"] = "duckdb"
if "chosen_models" not in st.session_state:
    st.session_state["chosen_models"] = None
if "mdl_json" not in st.session_state:
    st.session_state["mdl_json"] = None
if "semantics_preparation_status" not in st.session_state:
    st.session_state["semantics_preparation_status"] = None
if "query" not in st.session_state:
    st.session_state["query"] = None
if "asks_results" not in st.session_state:
    st.session_state["asks_results"] = None
if "chosen_query_result" not in st.session_state:
    st.session_state["chosen_query_result"] = None
if "asks_details_result" not in st.session_state:
    st.session_state["asks_details_result"] = None
if "preview_data_button_index" not in st.session_state:
    st.session_state["preview_data_button_index"] = None
if "preview_sql" not in st.session_state:
    st.session_state["preview_sql"] = None
if "query_history" not in st.session_state:
    st.session_state["query_history"] = None
if "sql_explanation_question" not in st.session_state:
    st.session_state["sql_explanation_question"] = None
if "sql_explanation_steps_with_analysis" not in st.session_state:
    st.session_state["sql_explanation_steps_with_analysis"] = None
if "sql_analysis_results" not in st.session_state:
    st.session_state["sql_analysis_results"] = None
if "sql_explanation_results" not in st.session_state:
    st.session_state["sql_explanation_results"] = None
if "sql_user_corrections_by_step" not in st.session_state:
    st.session_state["sql_user_corrections_by_step"] = []
if "sql_regeneration_results" not in st.session_state:
    st.session_state["sql_regeneration_results"] = None
if "language" not in st.session_state:
    st.session_state["language"] = "English"


def onchange_demo_dataset():
    st.session_state["chosen_dataset"] = st.session_state["choose_demo_dataset"]


def onchange_language():
    st.session_state["language"] = st.session_state["language_selectbox"]


with st.sidebar:
    st.markdown("## Deploy MDL Model")
    uploaded_file = st.file_uploader(
        f"Upload an MDL json file, and the file name must be [xxx]_[datasource]_mdl.json, now we support these datasources: {DATA_SOURCES}",
        type="json",
    )
    st.markdown("or")
    chosen_demo_dataset = st.selectbox(
        "Select a demo dataset",
        key="choose_demo_dataset",
        options=[
            "ecommerce",
            "hr",
        ],
        index=0,
        on_change=onchange_demo_dataset,
    )

    st.selectbox(
        "Language",
        key="language_selectbox",
        options=[
            "English",
            "Spanish",
            "French",
            "TraditionalChinese",
            "SimplifiedChinese",
            "German",
            "Portuguese",
            "Russian",
            "Japanese",
            "Korean",
        ],
        index=0,
        on_change=onchange_language,
    )

    if uploaded_file is not None:
        match = re.match(
            r".+_(" + "|".join(DATA_SOURCES) + r")_mdl\.json$",
            uploaded_file.name,
        )
        if not match:
            st.error(
                f"the file name must be [xxx]_[datasource]_mdl.json, now we support these datasources: {DATA_SOURCES}"
            )
            st.stop()

        data_source = match.group(1)
        st.session_state["chosen_dataset"] = uploaded_file.name.split(
            f"_{data_source}_mdl.json"
        )[0]
        st.session_state["dataset_type"] = data_source
        st.session_state["mdl_json"] = orjson.loads(
            uploaded_file.getvalue().decode("utf-8")
        )
        save_mdl_json_file(uploaded_file.name, st.session_state["mdl_json"])
    elif (
        chosen_demo_dataset
        and st.session_state["chosen_dataset"] == chosen_demo_dataset
    ):
        st.session_state["chosen_dataset"] = chosen_demo_dataset
        st.session_state["dataset_type"] = "duckdb"
        st.session_state["mdl_json"] = get_mdl_json(chosen_demo_dataset)

    st.markdown("---")

    if st.session_state["mdl_json"]:
        # Display the model using the selected database
        st.markdown("MDL Model")
        st.json(
            body=st.session_state["mdl_json"],
            expanded=False,
        )

        deploy_ok = st.button(
            "Deploy",
            use_container_width=True,
            type="primary",
        )
        # Semantics preparation
        if deploy_ok:
            rerun_wren_engine(
                st.session_state["mdl_json"],
                st.session_state["dataset_type"],
                st.session_state["chosen_dataset"],
            )
            prepare_semantics(st.session_state["mdl_json"])

query = st.chat_input(
    "Ask a question about the database",
    disabled=st.session_state["semantics_preparation_status"] != "finished",
)

if query:
    if st.session_state["asks_results"] and st.session_state["asks_details_result"]:
        st.session_state["query_history"] = {
            "sql": st.session_state["chosen_query_result"]["sql"],
            "steps": st.session_state["asks_details_result"]["steps"],
        }
    else:
        st.session_state["query_history"] = None

    # reset relevant session_states
    # st.session_state["query"] = None
    st.session_state["asks_results"] = None
    st.session_state["chosen_query_result"] = None
    st.session_state["asks_details_result"] = None
    st.session_state["preview_data_button_index"] = None
    st.session_state["preview_sql"] = None

    ask(query, st.session_state["query_history"])
if st.session_state["asks_results"]:
    show_asks_results()
if st.session_state["asks_details_result"] and st.session_state["chosen_query_result"]:
    show_asks_details_results(st.session_state["query"])
elif st.session_state["chosen_query_result"]:
    ask_details()
    if st.session_state["asks_details_result"]:
        show_asks_details_results(st.session_state["query"])
