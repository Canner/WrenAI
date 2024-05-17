import json
from pathlib import Path

import streamlit as st


def load_eval_results(eval_file_path: str):
    with open(eval_file_path, "r") as f:
        eval_results = json.load(f)
    return eval_results


def show_eval_results(eval_results: dict):
    st.markdown("### Metrics")
    for k, v in eval_results.items():
        if k == "collection":
            continue
        st.markdown(f"**{k}**")
        if isinstance(v, dict):
            st.json(v, expanded=True)
        else:
            st.markdown(v)


def show_collection(eval_results: dict):
    st.markdown("### Collection")
    collection = eval_results.get("collection", [])
    for record in collection:
        for k, v in record.items():
            st.markdown(f"**{k}**")
            if isinstance(v, dict):
                st.json(v, expanded=True)
            else:
                st.markdown(v)


st.set_page_config(layout="wide")

st.title("Ask Details pipeline evaluation reports comparison")

output_dir = Path("outputs/ask_details/")
output_files = list(output_dir.glob("*.json"))

# get dataset names
dataset_names = set([f.stem.split("_eval_report_")[0] for f in output_files])

dataset_name = st.selectbox("Select dataset", sorted(dataset_names))

# get timestamp in filename for selected dataset
timestamps = sorted(
    set([f.stem.split("_")[-1] for f in output_files if dataset_name in f.stem])
)
selected_timestamps = st.multiselect("Select timestamps", timestamps, max_selections=2)

st.markdown("---")

if len(selected_timestamps) == 1:
    eval_report_1_path = (
        f"{output_dir}/{dataset_name}_eval_report_{selected_timestamps[0]}.json"
    )
    st.markdown(f"## {selected_timestamps[0]}")
    eval_results_1 = load_eval_results(eval_report_1_path)
    show_eval_results(eval_results_1)
    show_collection(eval_results_1)
elif len(selected_timestamps) == 2:
    eval_report_1_path = (
        f"{output_dir}/{dataset_name}_eval_report_{selected_timestamps[0]}.json"
    )
    eval_report_2_path = (
        f"{output_dir}/{dataset_name}_eval_report_{selected_timestamps[1]}.json"
    )

    col1, col2 = st.columns(2)
    with col1:
        eval_results_1 = load_eval_results(eval_report_1_path)
        st.markdown(f"## {selected_timestamps[0]}")
        show_eval_results(eval_results_1)
        show_collection(eval_results_1)
    with col2:
        eval_results_2 = load_eval_results(eval_report_2_path)
        st.markdown(f"## {selected_timestamps[1]}")
        show_eval_results(eval_results_2)
        show_collection(eval_results_2)
