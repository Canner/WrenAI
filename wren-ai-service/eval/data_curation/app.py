import asyncio

import streamlit as st
from utils import (
    get_contexts_from_sqls,
    get_llm_client,
    get_question_sql_pairs,
    is_sql_valid,
    is_valid_mdl_file,
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
    if "question_sql_pairs" not in st.session_state:
        st.session_state["question_sql_pairs"] = []
    if "candidate_dataset" not in st.session_state:
        st.session_state["candidate_dataset"] = []

    # widget callbacks
    def on_change_sql(i: int):
        sql = st.session_state[f"sql_{i}"]

        st.session_state["question_sql_pairs"][i]["sql"] = sql
        if asyncio.run(is_sql_valid(sql)):
            st.session_state["question_sql_pairs"][i]["is_valid"] = True
            new_context = asyncio.run(
                get_contexts_from_sqls(
                    llm_client,
                    [sql],
                )
            )
            st.session_state["question_sql_pairs"][i]["context"] = new_context
        else:
            st.session_state["question_sql_pairs"][i]["is_valid"] = False

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
                    not st.session_state["question_sql_pairs"]
                    or regenerate_question_sql_pairs
                ):
                    st.toast("Generating question-sql-pairs...")
                    st.session_state["question_sql_pairs"] = asyncio.run(
                        get_question_sql_pairs(llm_client, st.session_state["mdl_json"])
                    )

                with st.container(border=True):
                    for i, question_sql_pair in enumerate(
                        st.session_state["question_sql_pairs"]
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
                            question_sql_pair["sql"],
                            key=f"sql_{i}",
                            height=200,
                            on_change=on_change_sql,
                            args=(i,),
                        )
                        if st.session_state["question_sql_pairs"][i]["is_valid"]:
                            st.success("SQL is valid")
                        else:
                            st.error("SQL is invalid")

                        shoud_move_to_dataset = st.button(
                            "Move it to the dataset",
                            key=f"move_to_dataset_{i}",
                            disabled=not st.session_state["question_sql_pairs"][i][
                                "is_valid"
                            ],
                        )
                        if shoud_move_to_dataset:
                            st.session_state["candidate_dataset"].append(
                                {
                                    "question": question_sql_pair["question"],
                                    "sql": question_sql_pair["sql"],
                                }
                            )
                        st.markdown("---")

            with tab_generate_by_user:
                pass
        with col2:
            st.markdown("### Candidate Dataset")

            st.json(st.session_state["candidate_dataset"], expanded=True)

with tab_modify_dataset:
    pass
