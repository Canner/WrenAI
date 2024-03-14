import json
from collections import defaultdict
from pathlib import Path
from typing import Dict, List

import streamlit as st


def show_eval_results(eval_file_path: Path):
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


def get_question_right_or_wrong_mapping(eval_results: Dict) -> Dict:
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


def show_single_prediction_result(
    question_right_or_wrong_mapping: Dict, prediction: Dict
):
    expander_name = (
        f'(O) Question: {prediction["question"]}'
        if question_right_or_wrong_mapping[prediction["question"]]["correct"]
        else f'(X) Question: {prediction["question"]}'
    )

    with st.expander(expander_name):
        if question_right_or_wrong_mapping[prediction["question"]]["correct"]:
            st.markdown("Correct type")
            st.text(question_right_or_wrong_mapping[prediction["question"]]["type"])
        st.markdown("Documents")
        st.json(prediction["contexts"], expanded=False)
        st.markdown("Answer")
        st.code(prediction["answer"], language="sql")
        st.markdown("Groud truth answer")
        st.code(
            question_right_or_wrong_mapping[prediction["question"]][
                "ground_truth_answer"
            ],
            language="sql",
        )
        if not question_right_or_wrong_mapping[prediction["question"]]["correct"]:
            st.markdown("Ground truth query results")
            st.markdown(
                question_right_or_wrong_mapping[prediction["question"]][
                    "ground_truth_query_results"
                ]
                or "None"
            )
            st.markdown("Prediction query results")
            st.markdown(
                question_right_or_wrong_mapping[prediction["question"]][
                    "prediction_query_results"
                ]
                or "None"
            )
            st.markdown("Prediction error details")
            st.markdown(
                question_right_or_wrong_mapping[prediction["question"]][
                    "prediction_error_details"
                ]
                or "None"
            )
        if question_right_or_wrong_mapping[prediction["question"]][
            "ragas_eval_results"
        ]:
            st.markdown("Ragas evaluation results")
            st.json(
                question_right_or_wrong_mapping[prediction["question"]][
                    "ragas_eval_results"
                ],
                expanded=False,
            )
        st.markdown("Metadata")
        st.json(prediction["metadata"], expanded=False)


def show_prediction_results(eval_file_paths: List, prediction_file_paths: List):
    assert len(eval_file_paths) == len(prediction_file_paths) == 2

    file_evals = []
    file_predictions = []

    for eval_file_path in eval_file_paths:
        with open(eval_file_path, "r") as f:
            file_evals.append(json.load(f))

    for prediction_file_path in prediction_file_paths:
        with open(prediction_file_path, "r") as f:
            file_predictions.append([json.loads(line) for line in f])

    file1_question_right_or_wrong_mapping = get_question_right_or_wrong_mapping(
        file_evals[0]["eval_results"]
    )
    file2_question_right_or_wrong_mapping = get_question_right_or_wrong_mapping(
        file_evals[1]["eval_results"]
    )

    predictions_correct_types_mapping = defaultdict(list)
    for i, (prediction1, prediction2) in enumerate(
        zip(file_predictions[0], file_predictions[1])
    ):
        prediction1_correct = file1_question_right_or_wrong_mapping[
            prediction1["question"]
        ]["correct"]
        prediction2_correct = file2_question_right_or_wrong_mapping[
            prediction2["question"]
        ]["correct"]

        if prediction1_correct and prediction2_correct:
            predictions_correct_types_mapping["both_correct"].append(i)
        elif not prediction1_correct and not prediction2_correct:
            predictions_correct_types_mapping["both_wrong"].append(i)
        elif prediction1_correct and not prediction2_correct:
            predictions_correct_types_mapping[
                "prediction1_correct_prediction2_wrong"
            ].append(i)
        elif not prediction1_correct and prediction2_correct:
            predictions_correct_types_mapping[
                "prediction1_wrong_prediction2_correct"
            ].append(i)

    st.markdown("### Details")

    st.markdown(
        f'#### Prediction 1 wrong, Prediction 2 correct ({len(predictions_correct_types_mapping['prediction1_wrong_prediction2_correct'])})'
    )
    col1, col2 = st.columns(2)
    for i in predictions_correct_types_mapping["prediction1_wrong_prediction2_correct"]:
        with col1:
            show_single_prediction_result(
                file1_question_right_or_wrong_mapping, file_predictions[0][i]
            )
        with col2:
            show_single_prediction_result(
                file2_question_right_or_wrong_mapping, file_predictions[1][i]
            )

    st.markdown(
        f'#### Prediction 1 correct, Prediction 2 wrong ({len(predictions_correct_types_mapping['prediction1_correct_prediction2_wrong'])})'
    )
    col1, col2 = st.columns(2)
    for i in predictions_correct_types_mapping["prediction1_correct_prediction2_wrong"]:
        with col1:
            show_single_prediction_result(
                file1_question_right_or_wrong_mapping, file_predictions[0][i]
            )
        with col2:
            show_single_prediction_result(
                file2_question_right_or_wrong_mapping, file_predictions[1][i]
            )

    st.markdown(
        f'#### Prediction 1 wrong, Prediction 2 wrong ({len(predictions_correct_types_mapping['both_wrong'])})'
    )
    col1, col2 = st.columns(2)
    for i in predictions_correct_types_mapping["both_wrong"]:
        with col1:
            show_single_prediction_result(
                file1_question_right_or_wrong_mapping, file_predictions[0][i]
            )
        with col2:
            show_single_prediction_result(
                file2_question_right_or_wrong_mapping, file_predictions[1][i]
            )

    st.markdown(
        f'#### Prediction 1 correct, Prediction 2 correct ({len(predictions_correct_types_mapping['both_correct'])})'
    )
    col1, col2 = st.columns(2)
    for i in predictions_correct_types_mapping["both_correct"]:
        with col1:
            show_single_prediction_result(
                file1_question_right_or_wrong_mapping, file_predictions[0][i]
            )
        with col2:
            show_single_prediction_result(
                file2_question_right_or_wrong_mapping, file_predictions[1][i]
            )


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
        st.markdown(f"## {selected_timestamps[0]}")
        show_eval_results(eval_file1_path)
    with col2:
        st.markdown(f"## {selected_timestamps[1]}")
        show_eval_results(eval_file2_path)

    show_prediction_results(
        eval_file_paths=[eval_file1_path, eval_file2_path],
        prediction_file_paths=[prediction_file1_path, prediction_file2_path],
    )
