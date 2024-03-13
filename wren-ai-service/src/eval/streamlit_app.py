import json
from pathlib import Path

import streamlit as st


def show_eval_results(eval_file_path):
    with open(eval_file_path, "r") as f:
        eval_results = json.load(f)

    st.markdown("**Performance Benchmark**")
    for k, v in eval_results["eval_results"].items():
        if k == "details":
            continue
        st.markdown(f"**{k}**")
        if isinstance(v, dict):
            st.json(v, expanded=True)
        else:
            st.markdown(v)


def get_question_right_or_wrong_mapping(eval_results):
    question_right_or_wrong_mapping = {}

    for correct_type, correct_details in eval_results["details"]["correct"].items():
        for details in correct_details:
            question_right_or_wrong_mapping[details["question"]] = {
                "correct": True,
                "type": correct_type,
                "ground_truth_answer": details["ground_truth_answer"],
                "prediction_answer": details["prediction_answer"],
                "ragas_eval_results": details["ragas_eval_results"],
            }

    for wrong_details in eval_results["details"]["wrong"]:
        question_right_or_wrong_mapping[wrong_details["question"]] = {
            "correct": False,
            "type": None,
            "ground_truth_answer": wrong_details["ground_truth_answer"],
            "prediction_answer": wrong_details["prediction_answer"],
            "ground_truth_query_results": wrong_details["ground_truth_query_results"],
            "prediction_query_results": wrong_details["prediction_query_results"],
            "prediction_error_details": wrong_details["prediction_error_details"],
            "ragas_eval_results": wrong_details["ragas_eval_results"],
        }

    return question_right_or_wrong_mapping


def show_prediction_results(eval_file_path, prediction_file_path):
    with open(eval_file_path, "r") as f:
        file_eval = json.load(f)

    with open(prediction_file_path, "r") as f:
        file_predictions = [json.loads(line) for line in f]

    file_question_right_or_wrong_mapping = get_question_right_or_wrong_mapping(
        file_eval["eval_results"]
    )

    st.markdown("**Details**")
    for prediction in file_predictions:
        expander_name = (
            f'(O) Question: {prediction["question"]}'
            if file_question_right_or_wrong_mapping[prediction["question"]]["correct"]
            else f'(X) Question: {prediction["question"]}'
        )

        with st.expander(expander_name):
            if file_question_right_or_wrong_mapping[prediction["question"]]["correct"]:
                st.markdown("Correct type")
                st.text(
                    file_question_right_or_wrong_mapping[prediction["question"]]["type"]
                )
            st.markdown("Documents")
            st.json(prediction["contexts"], expanded=False)
            st.markdown("Answer")
            st.code(prediction["answer"], language="sql")
            st.markdown("Groud truth answer")
            st.code(
                file_question_right_or_wrong_mapping[prediction["question"]][
                    "ground_truth_answer"
                ],
                language="sql",
            )
            if not file_question_right_or_wrong_mapping[prediction["question"]][
                "correct"
            ]:
                st.markdown("Ground truth query results")
                st.json(
                    file_question_right_or_wrong_mapping[prediction["question"]][
                        "ground_truth_query_results"
                    ],
                    expanded=False,
                )
                st.markdown("Prediction query results")
                st.json(
                    file_question_right_or_wrong_mapping[prediction["question"]][
                        "prediction_query_results"
                    ],
                    expanded=False,
                )
                st.markdown("Prediction error details")
                st.markdown(
                    file_question_right_or_wrong_mapping[prediction["question"]][
                        "prediction_error_details"
                    ]
                    or "None"
                )
            if file_question_right_or_wrong_mapping[prediction["question"]][
                "ragas_eval_results"
            ]:
                st.markdown("Ragas evaluation results")
                st.json(
                    file_question_right_or_wrong_mapping[prediction["question"]][
                        "ragas_eval_results"
                    ],
                    expanded=False,
                )
            st.markdown("Metadata")
            st.json(prediction["metadata"], expanded=False)


st.set_page_config(layout="wide")

st.title("Ask pipeline prediction evaluation results comparison")

output_dir = Path("outputs")
output_files = list(output_dir.glob("*.json"))

# get dataset names
dataset_names = sorted(
    set(
        [
            f.stem.split("_eval_results_")[0]
            if "_eval_results_" in f.stem
            else f.stem.split("_predictions_")[0]
            for f in output_files
        ]
    )
)
dataset_name = st.selectbox("Select dataset", dataset_names)

# get timestamp in filename for selected dataset
timestamps = sorted(
    set([f.stem.split("_")[-1] for f in output_files if dataset_name in f.stem])
)
selected_timestamps = st.multiselect(
    "Select 2 timestamps", timestamps, max_selections=2, disabled=len(timestamps) < 2
)

st.markdown("---")

if len(selected_timestamps) == 2:
    prediction_file1_path = (
        output_dir / f"{dataset_name}_predictions_{selected_timestamps[0]}.json"
    )
    prediction_file2_path = (
        output_dir / f"{dataset_name}_predictions_{selected_timestamps[1]}.json"
    )
    eval_file1_path = (
        output_dir / f"{dataset_name}_eval_results_{selected_timestamps[0]}.json"
    )
    eval_file2_path = (
        output_dir / f"{dataset_name}_eval_results_{selected_timestamps[1]}.json"
    )

    col1, col2 = st.columns(2)
    with col1:
        st.subheader(selected_timestamps[0])
        show_eval_results(eval_file1_path)
        show_prediction_results(
            eval_file1_path,
            prediction_file1_path,
        )
    with col2:
        st.subheader(selected_timestamps[1])
        show_eval_results(eval_file2_path)
        show_prediction_results(
            eval_file2_path,
            prediction_file2_path,
        )
