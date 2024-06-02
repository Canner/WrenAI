import asyncio

import streamlit as st
from utils import get_llm_client, get_question_sql_pairs, is_valid_mdl_file

st.set_page_config(layout="wide")
st.title("WrenAI Data Curation App")

st.markdown(
    """
### Usage Guide
1. Upload an MDL file
2. Get question-sql-pairs given by LLM and do validation on them
3. Save them as the dataset
"""
)

if "mdl_json" not in st.session_state:
    st.session_state["mdl_json"] = None

mdl_file = st.file_uploader("Upload an MDL file", type=["json"])
if mdl_file is not None:
    is_valid, mdl_json = is_valid_mdl_file(mdl_file)
    if not is_valid:
        st.error("MDL file is not valid")
        st.stop()
    else:
        st.toast("MDL file is valid!")
        st.session_state["mdl_json"] = mdl_json

if st.session_state["mdl_json"] is not None:
    st.markdown("### MDL File Content")
    st.json(st.session_state["mdl_json"], expanded=False)
    st.markdown("---")

if st.session_state["mdl_json"] is not None:
    st.toast("Generating question-sql-pairs...")
    llm_client = get_llm_client()
    question_sql_pairs = asyncio.run(
        get_question_sql_pairs(llm_client, st.session_state["mdl_json"])
    )

    with st.form("wren_ai_data_curation_form"):
        for i, question_sql_pair in enumerate(question_sql_pairs):
            st.text_input(f"Question {i}", question_sql_pair["question"])
            st.text_input(f"SQL query {i}", question_sql_pair["sql_query"])
            st.markdown("---")

        st.form_submit_button("Save as the dataset")
