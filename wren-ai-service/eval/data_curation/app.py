import asyncio

import streamlit as st
from utils import (
    get_contexts_from_sqls,
    get_llm_client,
    get_question_sql_pairs,
    is_sql_valid,
    is_valid_mdl_file,
    prettify_sql,
    show_er_diagram,
)

st.set_page_config(layout="wide")
st.title("WrenAI Data Curation App")

tab_create_dataset, tab_modify_dataset = st.tabs(["Create Dataset", "Modify Dataset"])

llm_client = get_llm_client()

with tab_create_dataset:
    if "mdl_file" not in st.session_state:
        st.session_state["mdl_file"] = None
    if "mdl_json" not in st.session_state:
        st.session_state["mdl_json"] = None
    if "llm_question_sql_pairs" not in st.session_state:
        st.session_state["llm_question_sql_pairs"] = []
    if "user_question_sql_pair" not in st.session_state:
        st.session_state["user_question_sql_pair"] = {}
    if "candidate_dataset" not in st.session_state:
        st.session_state["candidate_dataset"] = []

    # widget callbacks
    def on_change_sql(i: int, key: str):
        sql = st.session_state[key]

        if i != -1:
            st.session_state["llm_question_sql_pairs"][i]["sql"] = sql
            if asyncio.run(is_sql_valid(sql)):
                st.session_state["llm_question_sql_pairs"][i]["is_valid"] = True
                new_context = asyncio.run(
                    get_contexts_from_sqls(
                        llm_client,
                        [sql],
                    )
                )
                st.session_state["llm_question_sql_pairs"][i]["context"] = new_context
            else:
                st.session_state["llm_question_sql_pairs"][i]["is_valid"] = False
        else:
            st.session_state["user_question_sql_pair"]["sql"] = sql
            if asyncio.run(is_sql_valid(sql)):
                st.session_state["user_question_sql_pair"]["is_valid"] = True
                new_context = asyncio.run(
                    get_contexts_from_sqls(
                        llm_client,
                        [sql],
                    )
                )
                st.session_state["user_question_sql_pair"]["context"] = new_context
            else:
                st.session_state["user_question_sql_pair"]["is_valid"] = False

    def on_click_add_candidate_dataset(i: int):
        if i != -1:
            dataset_to_add = {
                "question": st.session_state["llm_question_sql_pairs"][i]["question"],
                "context": st.session_state["llm_question_sql_pairs"][i]["context"],
                "sql": st.session_state["llm_question_sql_pairs"][i]["sql"],
            }
        else:
            dataset_to_add = {
                "question": st.session_state["user_question_sql_pair"]["question"],
                "context": st.session_state["user_question_sql_pair"]["context"],
                "sql": st.session_state["user_question_sql_pair"]["sql"],
            }

        print(f"dataset_to_add: {dataset_to_add}")

        should_add = True
        for dataset in st.session_state["candidate_dataset"]:
            if dataset == dataset_to_add:
                should_add = False
                break

        if should_add:
            st.session_state["candidate_dataset"].append(dataset_to_add)

    def on_change_user_question():
        st.session_state["user_question_sql_pair"] = {
            "question": st.session_state["user_question"],
            "context": [],
            "sql": "",
            "is_valid": False,
        }

    def on_click_remove_candidate_dataset_button(i: int):
        st.session_state["candidate_dataset"].pop(i)

    st.markdown(
        """
        ### Usage Guide
        1. Upload an MDL file
        2. Get question-sql-pairs given by LLM or you manually enter question and corresponding sql
        3. Do validation on them and move them to the candidate dataset
        3. Save the candidate dataset as the final version of the dataset by downloading the TOML file
        """
    )

    mdl_file = st.file_uploader("Upload an MDL file", type=["json"])
    if mdl_file is not None and mdl_file != st.session_state["mdl_file"]:
        is_valid, mdl_json = is_valid_mdl_file(mdl_file)
        if not is_valid:
            st.error("MDL file is not valid")
            st.stop()
        else:
            st.toast("MDL file is valid!")
            st.session_state["mdl_file"] = mdl_file
            st.session_state["mdl_json"] = mdl_json

    if st.session_state["mdl_json"] is not None:
        st.markdown("### MDL File Content")
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
            tab_generate_by_llm, tab_generate_by_user = st.tabs(
                ["Generate by LLM", "Generate by User"]
            )

            with tab_generate_by_llm:
                regenerate_question_sql_pairs = st.button(
                    "Regenerate question-sql-pairs"
                )
                if (
                    not st.session_state["llm_question_sql_pairs"]
                    or regenerate_question_sql_pairs
                ):
                    st.toast("Generating question-sql-pairs...")
                    st.session_state["llm_question_sql_pairs"] = asyncio.run(
                        get_question_sql_pairs(llm_client, st.session_state["mdl_json"])
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
                        st.multiselect(
                            f"Context {i}",
                            options=question_sql_pair["context"],
                            default=question_sql_pair["context"],
                            disabled=True,
                            key=f"context_{i}",
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
                            st.error("SQL is invalid")

                        st.button(
                            "Move it to the dataset",
                            key=f"move_to_dataset_{i}",
                            disabled=not st.session_state["llm_question_sql_pairs"][i][
                                "is_valid"
                            ],
                            on_click=on_click_add_candidate_dataset,
                            args=(i,),
                        )

                        st.markdown("---")

            with tab_generate_by_user:
                with st.container(border=True, height=550):
                    st.text_input(
                        "Question",
                        disabled=False,
                        key="user_question",
                        on_change=on_change_user_question,
                    )
                    st.multiselect(
                        f"Context {i}",
                        options=st.session_state.get("user_question_sql_pair", {}).get(
                            "context", []
                        ),
                        default=st.session_state.get("user_question_sql_pair", {}).get(
                            "context", []
                        ),
                        disabled=True,
                        key="user_context",
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
                        st.error("SQL is invalid")

                    st.button(
                        "Move it to the dataset",
                        key="move_to_dataset",
                        disabled=not st.session_state.get(
                            "user_question_sql_pair", {}
                        ).get("is_valid", False),
                        on_click=on_click_add_candidate_dataset,
                        args=(-1,),
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
                        f"Context {i}",
                        options=dataset["context"],
                        default=dataset["context"],
                        disabled=True,
                        key=f"candidate_dataset_context_{i}",
                    )
                    st.markdown(f"SQL {i}")
                    st.code(
                        prettify_sql(dataset["sql"]), language="sql", line_numbers=True
                    )
                    st.button(
                        "Remove",
                        key=f"remove_{i}",
                        on_click=on_click_remove_candidate_dataset_button,
                        args=(i,),
                    )
                    st.markdown("---")

            st.button(
                "Save as Evaluation Dataset",
                key="save_as_evaluation_dataset",
                disabled=not st.session_state["candidate_dataset"],
            )

with tab_modify_dataset:
    pass
