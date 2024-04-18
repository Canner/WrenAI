import json
import uuid

import streamlit as st
from utils import (
    ask,
    ask_details,
    get_current_manifest,
    get_datasets,
    get_mdl_json,
    get_new_mdl_json,
    is_current_manifest_available,
    prepare_duckdb,
    prepare_semantics,
    rerun_wren_engine,
    save_mdl_json_file,
    show_asks_details_results,
    show_asks_results,
    show_er_diagram,
)

st.set_page_config(layout="wide")
st.title("Wren AI Service Demo")

if "deployment_id" not in st.session_state:
    st.session_state["deployment_id"] = str(uuid.uuid4())
if "chosen_dataset" not in st.session_state:
    st.session_state["chosen_dataset"] = "music"
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


def onchane_demo_dataset():
    st.session_state["chosen_dataset"] = st.session_state["choose_demo_dataset"]


def onchange_spider_dataset():
    st.session_state["chosen_dataset"] = st.session_state["choose_spider_dataset"]


if __name__ == "__main__":
    datasets = get_datasets()

    col1, col2 = st.columns([2, 4])

    with col1:
        with st.expander("Current Deployed Model"):
            manifest_name, models, relationships = get_current_manifest()
            st.markdown(f"Current Deployed Model: {manifest_name}")
            show_er_diagram(models, relationships)
        with st.expander("Deploy New Model"):
            uploaded_file = st.file_uploader(
                # "Upload an MDL json file, and the file name must be [xxx]_bigquery_mdl.json or [xxx]_duckdb_mdl.json",
                "Upload an MDL json file, and the file name must be [xxx]_duckdb_mdl.json",
                type="json",
            )
            st.markdown("or")
            chosen_demo_dataset = st.selectbox(
                "Select a demo dataset",
                key="choose_demo_dataset",
                options=["music", "nba", "ecommerce"],
                index=0,
                on_change=onchane_demo_dataset,
            )
            # st.markdown("or")
            # chosen_spider_dataset = st.selectbox(
            #     "Select a database from the Spider dataset",
            #     key='choose_spider_dataset',
            #     options=datasets,
            #     index=datasets.index("college_3"),  # default dataset
            #     on_change=onchange_spider_dataset,
            # )

            if uploaded_file is not None:
                # if "_bigquery_mdl.json" not in uploaded_file.name and "_duckdb_mdl.json" not in uploaded_file.name:
                #     st.error("File name must be [xxx]_bigquery_mdl.json or [xxx]_duckdb_mdl.json")
                #     st.stop()

                if "_duckdb_mdl.json" not in uploaded_file.name:
                    st.error("File name must be [xxx]_duckdb_mdl.json")
                    st.stop()

                if "_duckdb_mdl.json" in uploaded_file.name:
                    st.session_state["chosen_dataset"] = uploaded_file.name.split(
                        "_duckdb_mdl.json"
                    )[0]
                    st.session_state["dataset_type"] = "duckdb"
                    st.session_state["mdl_json"] = json.loads(
                        uploaded_file.getvalue().decode("utf-8")
                    )
                    save_mdl_json_file(uploaded_file.name, st.session_state["mdl_json"])
                # elif "_bigquery_mdl.json" in uploaded_file.name:
                #     st.session_state["chosen_dataset"] = uploaded_file.name.split("_bigquery_mdl.json")[
                #         0
                #     ]
                #     st.session_state["dataset_type"] = "bigquery"
                #     st.session_state["mdl_json"] = json.loads(
                #         uploaded_file.getvalue().decode("utf-8")
                #     )
                #     save_mdl_json_file(uploaded_file.name, st.session_state["mdl_json"])
            # elif chosen_spider_dataset and st.session_state["chosen_dataset"] == chosen_spider_dataset:
            #     st.session_state["chosen_dataset"] = chosen_spider_dataset
            #     st.session_state["dataset_type"] = "bigquery"
            #     st.session_state["mdl_json"] = get_mdl_json(chosen_spider_dataset, type='spider')
            elif (
                chosen_demo_dataset
                and st.session_state["chosen_dataset"] == chosen_demo_dataset
            ):
                st.session_state["chosen_dataset"] = chosen_demo_dataset
                st.session_state["dataset_type"] = "duckdb"
                st.session_state["mdl_json"] = get_mdl_json(
                    chosen_demo_dataset, type="demo"
                )

            st.markdown("---")

            chosen_models = st.multiselect(
                "Select data models for AI to generate MDL metadata",
                [model["name"] for model in st.session_state["mdl_json"]["models"]],
            )
            if chosen_models and st.session_state["chosen_models"] != chosen_models:
                st.session_state["chosen_models"] = chosen_models
                type = (
                    "demo" if st.session_state["dataset_type"] == "duckdb" else "spider"
                )
                st.session_state["mdl_json"] = get_mdl_json(
                    st.session_state["chosen_dataset"], type=type
                )

            ai_generate_metadata_ok = st.button(
                "AI Generate MDL Metadata",
                disabled=not chosen_models,
            )
            if ai_generate_metadata_ok:
                st.session_state["mdl_json"] = get_new_mdl_json(
                    chosen_models=chosen_models
                )

            # Display the model using the selected database
            st.markdown("MDL Model")
            st.json(
                body=st.session_state["mdl_json"],
                expanded=False,
            )

            show_er_diagram(
                st.session_state["mdl_json"]["models"],
                st.session_state["mdl_json"]["relationships"],
            )

            deploy_ok = st.button(
                "Deploy the MDL model using the selected database",
                type="primary",
            )
            # Semantics preparation
            if deploy_ok:
                if st.session_state["dataset_type"] == "duckdb":
                    prepare_duckdb(st.session_state["chosen_dataset"])

                rerun_wren_engine(st.session_state["mdl_json"])
                prepare_semantics(st.session_state["mdl_json"])

    query = st.chat_input(
        "Ask a question about the database",
        disabled=(not is_current_manifest_available())
        and st.session_state["semantics_preparation_status"] != "finished",
    )

    with col2:
        if query:
            if (
                st.session_state["asks_results"]
                and st.session_state["asks_details_result"]
            ):
                st.session_state["query_history"] = {
                    "sql": st.session_state["chosen_query_result"]["sql"],
                    "summary": st.session_state["chosen_query_result"]["summary"],
                    "steps": st.session_state["asks_details_result"]["steps"],
                }
            else:
                st.session_state["query_history"] = None

            # reset relevant session_states
            st.session_state["query"] = None
            st.session_state["asks_results"] = None
            st.session_state["chosen_query_result"] = None
            st.session_state["asks_details_result"] = None
            st.session_state["preview_data_button_index"] = None
            st.session_state["preview_sql"] = None

            ask(query, st.session_state["query_history"])
        if st.session_state["asks_results"]:
            show_asks_results()
        if (
            st.session_state["asks_details_result"]
            and st.session_state["chosen_query_result"]
        ):
            show_asks_details_results()
        elif st.session_state["chosen_query_result"]:
            ask_details()
            if st.session_state["asks_details_result"]:
                show_asks_details_results()
