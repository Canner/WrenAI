import asyncio
import os
import re
import sys
import uuid
from datetime import datetime
from pathlib import Path

import orjson
import pandas as pd
import streamlit as st
import tomlkit
from openai import AsyncClient
from streamlit_tags import st_tags

sys.path.append(f"{Path().parent.resolve()}")
from eval import EvalSettings
from eval.utils import (
    get_documents_given_contexts,
    get_eval_dataset_in_toml_string,
    get_openai_client,
    prepare_duckdb_init_sql,
    prepare_duckdb_session_sql,
)
from utils import (
    DATA_SOURCES,
    WREN_ENGINE_ENDPOINT,
    WREN_IBIS_ENDPOINT,
    get_contexts_from_sqls,
    get_data_from_wren_engine_with_sqls,
    get_question_sql_pairs,
    is_sql_valid,
    prettify_sql,
)

st.set_page_config(layout="wide")
st.title("WrenAI Data Curation App")


LLM_OPTIONS = ["gpt-4o-mini", "gpt-4o"]

settings = EvalSettings()
llm_client = get_openai_client(api_key=settings.get_openai_api_key())

# session states
if "llm_model" not in st.session_state:
    st.session_state["llm_model"] = LLM_OPTIONS[0]
if "deployment_id" not in st.session_state:
    st.session_state["deployment_id"] = str(uuid.uuid4())
if "mdl_json" not in st.session_state:
    st.session_state["mdl_json"] = None
if "custom_instructions_for_llm" not in st.session_state:
    st.session_state["custom_instructions_for_llm"] = ""
if "llm_question_sql_pairs" not in st.session_state:
    st.session_state["llm_question_sql_pairs"] = []
if "user_question_sql_pair" not in st.session_state:
    st.session_state["user_question_sql_pair"] = {}
if "candidate_dataset" not in st.session_state:
    st.session_state["candidate_dataset"] = []
if "data_source" not in st.session_state:
    st.session_state["data_source"] = None
if "connection_info" not in st.session_state:
    st.session_state["connection_info"] = None


# widget callbacks
def on_change_upload_eval_dataset():
    doc = tomlkit.parse(st.session_state.uploaded_eval_file.getvalue().decode("utf-8"))

    assert doc["mdl"] == st.session_state["mdl_json"], (
        "The model in the uploaded dataset is different from the deployed model"
    )
    st.session_state["candidate_dataset"] = doc["eval_dataset"]


def on_change_custom_instructions_for_llm():
    st.session_state["custom_instructions_for_llm"] = st.session_state[
        "custom_instructions_text_area"
    ]


def on_click_generate_question_sql_pairs(llm_client: AsyncClient):
    st.toast("Generating question-sql-pairs...")
    st.session_state["llm_question_sql_pairs"] = asyncio.run(
        get_question_sql_pairs(
            llm_client,
            st.session_state["llm_model"],
            st.session_state["mdl_json"],
            st.session_state["custom_instructions_for_llm"],
            st.session_state["data_source"],
            st.session_state["connection_info"],
        )
    )


def on_click_setup_uploaded_file():
    uploaded_file = st.session_state.get("uploaded_mdl_file")
    if uploaded_file:
        match = re.match(
            r".+_(" + "|".join(DATA_SOURCES) + r")(_.+)?_mdl\.json$",
            uploaded_file.name,
        )
        if not match:
            st.error(
                f"the file name must be [xxx]_[datasource]_mdl.json, now we support these datasources: {DATA_SOURCES}"
            )
            st.stop()

        data_source = match.group(1)
        st.session_state["data_source"] = data_source
        st.session_state["mdl_json"] = orjson.loads(
            uploaded_file.getvalue().decode("utf-8")
        )

        if data_source == "bigquery":
            st.session_state["connection_info"] = {
                "project_id": os.getenv("bigquery.project-id"),
                "dataset_id": os.getenv("bigquery.dataset-id"),
                "credentials": os.getenv("bigquery.credentials-key"),
            }
        elif data_source == "duckdb":
            prepare_duckdb_session_sql(WREN_ENGINE_ENDPOINT)
            prepare_duckdb_init_sql(
                WREN_ENGINE_ENDPOINT, st.session_state["mdl_json"]["catalog"]
            )
    else:
        st.session_state["data_source"] = None
        st.session_state["mdl_json"] = None
        st.session_state["connection_info"] = None


def on_change_llm_model():
    st.toast(f"Switching LLM model to {st.session_state['select_llm_model']}")
    st.session_state["llm_model"] = st.session_state["select_llm_model"]


def on_change_sql(i: int, key: str):
    sql = st.session_state[key]

    valid, error = asyncio.run(
        is_sql_valid(
            sql,
            st.session_state["data_source"],
            st.session_state["mdl_json"],
            st.session_state["connection_info"],
            WREN_ENGINE_ENDPOINT
            if st.session_state["data_source"] == "duckdb"
            else WREN_IBIS_ENDPOINT,
        )
    )
    if valid:
        new_context = asyncio.run(
            get_contexts_from_sqls([sql], st.session_state["mdl_json"])
        )[0]
        document = get_documents_given_contexts(
            [new_context], st.session_state["mdl_json"]
        )
    if i != -1:
        st.session_state["llm_question_sql_pairs"][i]["sql"] = sql
        st.session_state["llm_question_sql_pairs"][i]["is_valid"] = valid
        st.session_state["llm_question_sql_pairs"][i]["error"] = error
        if valid:
            st.session_state["llm_question_sql_pairs"][i]["context"] = new_context
            st.session_state["llm_question_sql_pairs"][i]["document"] = document
    else:
        st.session_state["user_question_sql_pair"]["sql"] = sql
        st.session_state["user_question_sql_pair"]["is_valid"] = valid
        st.session_state["user_question_sql_pair"]["error"] = error
        if valid:
            st.session_state["user_question_sql_pair"]["context"] = new_context
            st.session_state["user_question_sql_pair"]["document"] = document


def on_click_add_candidate_dataset(i: int, categories: list):
    if i != -1:
        dataset_to_add = {
            "categories": categories,
            "question": st.session_state["llm_question_sql_pairs"][i]["question"],
            "context": st.session_state["llm_question_sql_pairs"][i]["context"],
            "sql": st.session_state["llm_question_sql_pairs"][i]["sql"],
            "document": st.session_state["llm_question_sql_pairs"][i]["document"],
        }
    else:
        dataset_to_add = {
            "categories": categories,
            "question": st.session_state["user_question_sql_pair"]["question"],
            "context": st.session_state["user_question_sql_pair"]["context"],
            "sql": st.session_state["user_question_sql_pair"]["sql"],
            "document": st.session_state["user_question_sql_pair"]["document"],
        }

        # reset input for user question sql pair
        st.session_state["user_question_sql_pair"] = {}
        st.session_state["user_question"] = ""
        st.session_state["user_sql"] = ""

    should_add = True
    for dataset in st.session_state["candidate_dataset"]:
        if dataset == dataset_to_add:
            should_add = False
            break

    if should_add:
        st.session_state["candidate_dataset"].append(dataset_to_add)


def on_change_user_question():
    if not st.session_state["user_question_sql_pair"]:
        st.session_state["user_question_sql_pair"] = {
            "question": st.session_state["user_question"],
            "context": [],
            "document": [],
            "sql": "",
            "is_valid": False,
            "error": "",
        }
    else:
        st.session_state["user_question_sql_pair"] = {
            **st.session_state["user_question_sql_pair"],
            "question": st.session_state["user_question"],
        }


def on_click_remove_candidate_dataset_button(i: int):
    st.session_state["candidate_dataset"].pop(i)


st.file_uploader(
    f"Upload an MDL json file, and the file name must be [xxx]_[datasource]_mdl.json, now we support these datasources: {DATA_SOURCES}",
    type="json",
    key="uploaded_mdl_file",
    on_change=on_click_setup_uploaded_file,
)

st.selectbox(
    label="Select which LLM model you want to use",
    options=LLM_OPTIONS,
    index=0,
    key="select_llm_model",
    on_change=on_change_llm_model,
)

tab_create_dataset, tab_modify_dataset = st.tabs(
    ["Create New Evaluation Dataset", "Modify Saved Evaluation Dataset"]
)
with tab_create_dataset:
    st.markdown(
        """
        ### Usage Guide
        1. Upload an MDL json file first
        2. Get question-sql-pairs given by LLM or you manually enter question and corresponding sql
        3. Do validation on each group of question, context and SQL, and move it to the candidate dataset if you think it's valid
        3. Save the candidate dataset by clicking the "Save as Evaluation Dataset" button.
        """
    )

with tab_modify_dataset:
    st.markdown(
        """
        ### Usage Guide
        1. Upload an MDL json file first
        2. Upload the evaluation dataset(`.toml` file) you want to modify, and please make sure the model in the dataset is the same as the deployed model
        3. Modify the evaluation dataset the same as you create a new one
        4. Save the candidate dataset by clicking the "Save as Evaluation Dataset" button.
        """
    )

    st.warning(
        "WARNING: Uploading the evaluation dataset will overwrite the current candidate dataset"
    )
    st.file_uploader(
        "Upload Evaluation Dataset",
        type="toml",
        key="uploaded_eval_file",
        on_change=on_change_upload_eval_dataset,
        disabled=st.session_state["mdl_json"] is None,
    )

if st.session_state["mdl_json"] is not None:
    col1, col2 = st.columns(2)
    with col1:
        st.markdown("### Question SQL Pairs")
        tab_generated_by_llm, tab_generated_by_user = st.tabs(
            ["Generated by LLM", "Generated by User"]
        )

        with tab_generated_by_llm:
            st.text_area(
                "Custom Instructions for generating question-sql-pairs (Optional)",
                key="custom_instructions_text_area",
                value=st.session_state["custom_instructions_for_llm"],
                placeholder="You can specify the custom instructions on how LLM should generate question-sql-pairs here, for example: what type of questions you want to generate.",
                on_change=on_change_custom_instructions_for_llm,
            )

            st.button(
                "Generate 10 question-sql-pairs",
                key="generate_question_sql_pairs",
                on_click=on_click_generate_question_sql_pairs,
                args=(llm_client,),
            )

            with st.container(border=True, height=550):
                for i, question_sql_pair in enumerate(
                    st.session_state["llm_question_sql_pairs"]
                ):
                    st.text_input(
                        f"Question {i}",
                        question_sql_pair["question"],
                        disabled=True,
                        key=f"question_{i}",
                    )
                    categories = st_tags(
                        label=f"Categories {i}",
                        text="Press enter to add more",
                        value=[],
                        key=f"categories_{i}",
                    )
                    st.multiselect(
                        label=f"Context {i}",
                        options=question_sql_pair["context"],
                        default=question_sql_pair["context"],
                        key=f"context_{i}",
                        help="Contexts are automatically generated based on the SQL once you save the changes of the it(ctrl+enter or command+enter)",
                        disabled=True,
                    )
                    st.text_area(
                        f"SQL {i}",
                        prettify_sql(question_sql_pair["sql"]),
                        key=f"sql_{i}",
                        height=250,
                        on_change=on_change_sql,
                        args=(i, f"sql_{i}"),
                    )
                    if st.session_state["llm_question_sql_pairs"][i]["is_valid"]:
                        st.success("SQL is valid")
                        st.dataframe(
                            pd.DataFrame(
                                question_sql_pair["data"]["data"],
                                columns=question_sql_pair["data"]["columns"],
                            )
                        )
                    else:
                        st.error(
                            f"SQL is invalid: {st.session_state['llm_question_sql_pairs'][i]['error']}"
                        )

                    st.button(
                        "Move it to the candidate dataset",
                        key=f"move_to_dataset_{i}",
                        disabled=(
                            not st.session_state["llm_question_sql_pairs"][i][
                                "is_valid"
                            ]
                            or not st.session_state[f"context_{i}"]
                            or not categories
                        ),
                        on_click=on_click_add_candidate_dataset,
                        args=(
                            i,
                            categories,
                        ),
                    )

                    st.markdown("---")

        with tab_generated_by_user:
            with st.container(border=True, height=550):
                st.text_input(
                    "Question",
                    disabled=False,
                    key="user_question",
                    on_change=on_change_user_question,
                )
                categories = st_tags(
                    label="Categories",
                    text="Press enter to add more",
                    value=[],
                    key="user_categories",
                )
                st.multiselect(
                    label="Context",
                    options=st.session_state.get("user_question_sql_pair", {}).get(
                        "context", []
                    ),
                    default=st.session_state.get("user_question_sql_pair", {}).get(
                        "context", []
                    ),
                    key="user_context",
                    help="Contexts are automatically generated based on the SQL once you save the changes of the it(ctrl+enter or command+enter)",
                    disabled=True,
                )
                st.text_area(
                    "SQL",
                    key="user_sql",
                    height=250,
                    on_change=on_change_sql,
                    args=(-1, "user_sql"),
                )

                if st.session_state.get("user_question_sql_pair", {}).get(
                    "is_valid", False
                ):
                    st.success("SQL is valid")
                    data = asyncio.run(
                        get_data_from_wren_engine_with_sqls(
                            [st.session_state["user_question_sql_pair"]["sql"]],
                            st.session_state["data_source"],
                            st.session_state["mdl_json"],
                            st.session_state["connection_info"],
                            WREN_ENGINE_ENDPOINT
                            if st.session_state["data_source"] == "duckdb"
                            else WREN_IBIS_ENDPOINT,
                        )
                    )[0]
                    st.dataframe(
                        pd.DataFrame(
                            data["data"],
                            columns=data["columns"],
                        )
                    )
                else:
                    st.error(
                        f"SQL is invalid: {st.session_state.get('user_question_sql_pair', {}).get('error', '')}"
                    )

                st.button(
                    "Move it to the candidate dataset",
                    key="move_to_dataset",
                    disabled=(
                        not st.session_state.get("user_question_sql_pair", {}).get(
                            "is_valid", False
                        )
                        or not st.session_state["user_context"]
                        or not st.session_state["user_question"]
                        or not categories
                    ),
                    on_click=on_click_add_candidate_dataset,
                    args=(
                        -1,
                        categories,
                    ),
                )
    with col2:
        st.markdown("### Candidate Dataset")

        with st.container(border=True, height=600):
            for i, dataset in enumerate(st.session_state["candidate_dataset"]):
                st.text_input(
                    f"Question {i}",
                    dataset["question"],
                    disabled=True,
                    key=f"candidate_dataset_question_{i}",
                )
                st.multiselect(
                    f"Categories {i}",
                    options=dataset["categories"],
                    default=dataset["categories"],
                    disabled=True,
                    key=f"candidate_dataset_categories_{i}",
                )
                st.multiselect(
                    f"Context {i}",
                    options=dataset["context"],
                    default=dataset["context"],
                    disabled=True,
                    key=f"candidate_dataset_context_{i}",
                )
                st.markdown(f"SQL {i}")
                st.code(prettify_sql(dataset["sql"]), language="sql", line_numbers=True)
                st.button(
                    "Remove",
                    key=f"remove_{i}",
                    on_click=on_click_remove_candidate_dataset_button,
                    args=(i,),
                )
                st.markdown("---")

        with st.popover("Save as Evaluation Dataset", use_container_width=True):
            file_name = st.text_input(
                "File Name",
                f"eval_dataset_{datetime.today().strftime('%Y_%m_%d')}.toml",
                key="eval_dataset_file_name",
            )
            download_btn = st.download_button(
                "Download",
                get_eval_dataset_in_toml_string(
                    st.session_state["mdl_json"],
                    st.session_state["candidate_dataset"],
                ),
                file_name=file_name,
                key="download_eval_dataset_confirmed",
                disabled=not st.session_state["candidate_dataset"],
            )
            if download_btn:
                st.toast("Downloading the evaluation dataset...")
