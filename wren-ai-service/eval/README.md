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

## Terms

This section describes the terms used in the evaluation framework:

- **input**: The user query used as input to the Wren AI service (e.g., "What is the total number of COVID-19 cases in the US?").
- **actual_output**: The actual SQL query generated to retrieve the answer to the user query (e.g., "SELECT SUM(cases) FROM covid19 WHERE country='US'").
- **expected_output**: The expected SQL query that should retrieve the answer to the user query (e.g., "SELECT SUM(cases) FROM covid19 WHERE country='US'").
- **retrieval_context**: The relevant context that helps the LLM generate the SQL query (e.g., "covid19.country", "covid19.cases").
- **context**: The relevant context that aligns with human expectations to generate the SQL query (e.g., "covid19.country", "covid19.cases").