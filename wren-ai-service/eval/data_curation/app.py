import asyncio
from datetime import datetime

import streamlit as st
import tomlkit
from openai import AsyncClient
from streamlit_tags import st_tags
from utils import (
    get_contexts_from_sqls,
    get_current_manifest,
    get_eval_dataset_in_toml_string,
    get_llm_client,
    get_question_sql_pairs,
    is_sql_valid,
    prettify_sql,
    show_er_diagram,
)

st.set_page_config(layout="wide")
st.title("WrenAI Data Curation App")


llm_client = get_llm_client()


# session states
if "mdl_json" not in st.session_state:
    st.session_state["mdl_json"] = None
if "llm_question_sql_pairs" not in st.session_state:
    st.session_state["llm_question_sql_pairs"] = []
if "user_question_sql_pair" not in st.session_state:
    st.session_state["user_question_sql_pair"] = {}
if "candidate_dataset" not in st.session_state:
    st.session_state["candidate_dataset"] = []


# widget callbacks
def on_change_upload_eval_dataset():
    doc = tomlkit.parse(st.session_state.uploaded_file.getvalue().decode("utf-8"))
    assert (
        doc["mdl"] == st.session_state["mdl_json"]
    ), "The model in the uploaded dataset is different from the deployed model"
    st.session_state["candidate_dataset"] = doc["eval_dataset"]


def on_click_generate_question_sql_pairs(llm_client: AsyncClient):
    st.toast("Generating question-sql-pairs...")
    st.session_state["llm_question_sql_pairs"] = asyncio.run(
        get_question_sql_pairs(llm_client, st.session_state["mdl_json"])
    )


def on_change_sql(i: int, key: str):
    sql = st.session_state[key]

    valid, error = asyncio.run(is_sql_valid(sql))
    if valid:
        new_context = asyncio.run(
            get_contexts_from_sqls(
                llm_client,
                [sql],
            )
        )
    if i != -1:
        st.session_state["llm_question_sql_pairs"][i]["sql"] = sql
        st.session_state["llm_question_sql_pairs"][i]["is_valid"] = valid
        st.session_state["llm_question_sql_pairs"][i]["error"] = error
        if valid:
            st.session_state["llm_question_sql_pairs"][i]["context"] = new_context
    else:
        st.session_state["user_question_sql_pair"]["sql"] = sql
        st.session_state["user_question_sql_pair"]["is_valid"] = valid
        st.session_state["user_question_sql_pair"]["error"] = error
        if valid:
            st.session_state["user_question_sql_pair"]["context"] = new_context


def on_click_add_candidate_dataset(i: int, categories: list):
    if i != -1:
        dataset_to_add = {
            "categories": categories,
            "question": st.session_state["llm_question_sql_pairs"][i]["question"],
            "context": st.session_state["llm_question_sql_pairs"][i]["context"],
            "sql": st.session_state["llm_question_sql_pairs"][i]["sql"],
        }
    else:
        dataset_to_add = {
            "categories": categories,
            "question": st.session_state["user_question_sql_pair"]["question"],
            "context": st.session_state["user_question_sql_pair"]["context"],
            "sql": st.session_state["user_question_sql_pair"]["sql"],
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


def on_change_sql_context(i: int):
    if i == -1:
        st.session_state.get("user_question_sql_pair", {}).get("context", []).append(
            st.session_state["user_context_input"]
        )
        st.session_state["user_context_input"] = ""
    else:
        st.session_state["llm_question_sql_pairs"][i]["context"].append(
            st.session_state[f"context_input_{i}"]
        )
        st.session_state[f"context_input_{i}"] = ""


def on_change_user_question():
    if not st.session_state["user_question_sql_pair"]:
        st.session_state["user_question_sql_pair"] = {
            "question": st.session_state["user_question"],
            "context": [],
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


tab_create_dataset, tab_modify_dataset = st.tabs(
    ["Create New Evaluation Dataset", "Modify Saved Evaluation Dataset"]
)
with tab_create_dataset:
    st.markdown(
        """
        ### Usage Guide
        1. Use WrenUI to deploy the MDL model first and make sure it's deployed successfully
        2. Get question-sql-pairs given by LLM or you manually enter question and corresponding sql
        3. Do validation on each group of question, context and SQL, and move it to the candidate dataset if you think it's valid
        3. Save the candidate dataset by clicking the "Save as Evaluation Dataset" button.
        """
    )

with tab_modify_dataset:
    st.markdown(
        """
        ### Usage Guide
        1. Use WrenUI to deploy the MDL model first and make sure it's deployed successfully
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
        key="uploaded_file",
        on_change=on_change_upload_eval_dataset,
    )


if manifest := get_current_manifest():
    st.session_state["mdl_json"] = manifest
    st.markdown("### Deployed Model Information")
    st.json(st.session_state["mdl_json"], expanded=False)
    show_er_diagram(
        st.session_state["mdl_json"]["models"],
        st.session_state["mdl_json"]["relationships"],
    )
    st.markdown("---")

if st.session_state["mdl_json"] is not None:
    col1, col2 = st.columns(2)
    with col1:
        st.markdown("### Question SQL Pairs")
        tab_generated_by_llm, tab_generated_by_user = st.tabs(
            ["Generated by LLM", "Generated by User"]
        )

        with tab_generated_by_llm:
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
                    st.text_input(
                        f"Context {i}",
                        placeholder="Enter the context of SQL manually with format <table_name>.<column_name>",
                        key=f"context_input_{i}",
                        on_change=on_change_sql_context,
                        args=(i,),
                    )
                    st.multiselect(
                        label=f"Context {i}",
                        options=question_sql_pair["context"],
                        default=question_sql_pair["context"],
                        key=f"context_{i}",
                        help="Contexts are automatically generated based on the SQL once you save the changes of the it(ctrl+enter or command+enter)",
                        label_visibility="hidden",
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
                    else:
                        st.error(
                            f"SQL is invalid: {st.session_state["llm_question_sql_pairs"][i]["error"]}"
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
                st.text_input(
                    "Context",
                    placeholder="Enter the context of SQL manually with format <table_name>.<column_name>",
                    key="user_context_input",
                    on_change=on_change_sql_context,
                    args=(-1,),
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
                    label_visibility="hidden",
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
                else:
                    st.error(
                        f"SQL is invalid: {st.session_state.get("user_question_sql_pair", {}).get('error', '')}"
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
                f'eval_dataset_{datetime.today().strftime("%Y_%m_%d")}.toml',
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
