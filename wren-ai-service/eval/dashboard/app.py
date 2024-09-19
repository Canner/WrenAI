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

    if st.button("Save"):
        st.toast("Initializing Langfuse Client...", icon="⏳")
        st.session_state.langfuse_client = init_langfuse_client(
            st.session_state.langfuse_public_key_input,
            st.session_state.langfuse_secret_key_input,
            st.session_state.langfuse_host_input,
        )


if st.session_state.langfuse_client:
    st.write(
        st.session_state.langfuse_client.fetch_trace(
            id="52098743-5bef-490e-8f0d-3d311cb4c464"
        )
    )
