import uuid

import streamlit as st
from utils import (
    ask,
    ask_details,
    get_datasets,
    get_mdl_json,
    get_new_mdl_json,
    prepare_semantics,
    rerun_wren_engine,
    show_asks_details_results,
    show_asks_results,
)

st.set_page_config(layout="wide")
st.title("Wren AI Service Demo")

if "deployment_id" not in st.session_state:
    st.session_state["deployment_id"] = str(uuid.uuid4())
if "chosen_dataset" not in st.session_state:
    st.session_state["chosen_dataset"] = None
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


if __name__ == "__main__":
    datasets = get_datasets()

    col1, col2 = st.columns([2, 4])

    with col1:
        chosen_dataset = st.selectbox(
            "Select a database from the Spider dataset", datasets
        )
        if st.session_state["chosen_dataset"] != chosen_dataset:
            st.session_state["chosen_dataset"] = chosen_dataset
            st.session_state["mdl_json"] = get_mdl_json(chosen_dataset)

        chosen_models = st.multiselect(
            "Select data models for AI to generate MDL metadata",
            [model["name"] for model in st.session_state["mdl_json"]["models"]],
        )
        if chosen_models and st.session_state["chosen_models"] != chosen_models:
            st.session_state["chosen_models"] = chosen_models
            st.session_state["mdl_json"] = get_mdl_json(chosen_dataset)

        ai_generate_metadata_ok = st.button(
            "AI Generate MDL Metadata",
            disabled=not chosen_models,
        )
        if ai_generate_metadata_ok:
            st.session_state["mdl_json"] = get_new_mdl_json(chosen_models=chosen_models)

        # Display the model using the selected dataset
        st.markdown("MDL Model")
        st.json(
            body=st.session_state["mdl_json"],
            expanded=False,
        )

        # TODO: Display the ERD diagram using the selected dataset
        # st.markdown('ERD Diagram')
        # show_erd_diagram()

        deploy_ok = st.button("Deploy the model using the selected dataset")

        # Semantics preparation
        if deploy_ok:
            rerun_wren_engine(chosen_dataset)
            prepare_semantics(st.session_state["mdl_json"])

    query = st.chat_input(
        "Ask a question about the dataset",
        disabled=st.session_state["semantics_preparation_status"] != "finished",
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
