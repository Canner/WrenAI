import streamlit as st
from utils import init_langfuse_client

st.set_page_config(page_title="Langfuse Dashboard", layout="wide")


if "langfuse_client" not in st.session_state:
    st.session_state.langfuse_client = None


st.title("Langfuse Dashboard")

with st.sidebar:
    st.markdown("## Langfuse Setup")

    st.text_input("Public Key", key="langfuse_public_key_input")
    st.text_input("Secret Key", type="password", key="langfuse_secret_key_input")
    st.text_input("Host", value="https://cloud.langfuse.com", key="langfuse_host_input")

    if st.button(
        "Save",
        disabled=(
            not st.session_state.langfuse_public_key_input
            or not st.session_state.langfuse_secret_key_input
            or not st.session_state.langfuse_host_input
        ),
    ):
        st.toast("Initializing Langfuse Client...", icon="⏳")
        st.session_state.langfuse_client = init_langfuse_client(
            st.session_state.langfuse_public_key_input,
            st.session_state.langfuse_secret_key_input,
            st.session_state.langfuse_host_input,
        )


if st.session_state.langfuse_client:
    st.markdown("Please enter a session ID or trace ID to fetch.")
    col1, col2 = st.columns(2)
    with col1:
        st.text_input("Session ID", key="session_id_input")
    with col2:
        st.text_input("Trace ID", key="trace_id_input")

    if st.session_state.session_id_input:
        sessions = st.session_state.langfuse_client.fetch_traces(
            session_id=st.session_state.session_id_input
        )
        st.json(sessions.data)

    if st.session_state.trace_id_input:
        trace = st.session_state.langfuse_client.fetch_trace(
            id=st.session_state.trace_id_input
        )
        st.json(trace.data.json())
