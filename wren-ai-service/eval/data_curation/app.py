import asyncio

import streamlit as st
from utils import get_llm_client, get_question_sql_pairs, is_valid_mdl_file

st.set_page_config(layout="wide")
st.title("WrenAI Data Curation App")

if "mdl_json" not in st.session_state:
    st.session_state["mdl_json"] = None

st.markdown("## Step 1: Upload the MDL file")
mdl_file = st.file_uploader("Upload a MDL file", type=["json"])
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

st.markdown("## Step 2: Get question-sql-pairs given by LLM")
if st.session_state["mdl_json"] is not None:
    llm_client = get_llm_client()
    question_sql_pairs = asyncio.run(
        get_question_sql_pairs(llm_client, st.session_state["mdl_json"])
    )
    st.json(question_sql_pairs, expanded=True)

st.markdown("## Step 3: Human validation for the question-sql-pairs")

st.markdown("## Step 4: Save the validated dataset")
