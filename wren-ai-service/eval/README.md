# Evaluation Framework

This document describes the evaluation framework for the Wren AI service. The evaluation framework is designed to assess the performance of the Wren AI service based on the following components:

## Requirements

- Install [Just](https://github.com/casey/just?tab=readme-ov-file#packages) to run the evaluation framework commands.
- Set up the [Langfuse](https://cloud.langfuse.com) account and get the API key and secret. Fill in the `.env.dev` file with the key and secret.

## Prediction Process

The prediction process is used to produce the results of the Wren AI service. It will create traces and a session on Langfuse to make the results available to the user. You can use the following command to predict the evaluation dataset under the `eval/dataset` directory:

```cli
just predict <evaluation-dataset>
```

## Evaluation Process

The evaluation process is used to assess the prediction results of the Wren AI service. It compares the prediction results with the ground truth and calculates the evaluation metrics. This process will also add a trace in the same session on Langfuse to make the evaluation results available to the user. You can use the following command to evaluate the prediction results under the `outputs/predictions` directory:

```cli
just eval <prediction-result>
```
