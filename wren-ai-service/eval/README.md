# Evaluation Framework

This document describes the evaluation framework for the Wren AI service. The evaluation framework is designed to assess the performance of the Wren AI service based on the following components:

## Requirements

- Install [Just](https://github.com/casey/just?tab=readme-ov-file#packages) to run the evaluation framework commands.
- Set up the [Langfuse](https://cloud.langfuse.com) account and get the API key and secret. Fill in the `.env.dev` file with the key and secret.
- Execute `just up` to start the necessary development services.

## Dataset Curation

The dataset curation process is used to prepare the evaluation dataset for the Wren AI service on evaluation purpose. You can follow the steps below to start the curation app:

- copy `.env.example` to `.env` and fill in the environment variables
- execute the command under the `wren-ai-service` folder: `just curate_eval_data`

## Eval Dataset Preparation(If using Spider 1.0 dataset)

```cli
just prep
```

This command will do two things:
1. download Spider 1.0 dataset in `wren-ai-service/tools/dev/spider1.0`; and there are two folders inside: database and spider_data
    - database: it contains test data. It's downloaded from [this repo](https://github.com/taoyds/test-suite-sql-eval).
    - spider_data: it contains table schema, ground truths(question sql pairs), etc. For more information, please refer to [this repo](https://github.com/taoyds/spider).
2. prepare evaluation dataset and put them in `wren-ai-service/eval/dataset`. File name of eval dataset for Spider would look like this: `spider_<db_name>_eval_dataset.toml`

## Evaluation Dataset Schema

- dataset_id(UUID)
- date
- mdl
- eval dataset

## Prediction Process

The prediction process is used to produce the results of the evaluation data using the Wren AI service. It will create traces and a session on Langfuse to make the results available to the user. You can use the following command to predict the evaluation dataset under the `eval/dataset` directory:

```cli
just predict <evaluation-dataset>
```

Also, sub-pipeline predictions are supported by specifying the pipeline name:

```cli
just predict <evaluation-dataset> <pipeline-name>
```

Currently, we support the following pipelines: 'ask', 'generation', and 'retrieval'. If no pipeline name is specified, the default is the 'ask' pipeline.

## Evaluation Process

The evaluation process is used to assess the prediction results of the Wren AI service. It compares the prediction results with the ground truth and calculates the evaluation metrics. This process will also add a trace in the same session on Langfuse to make the evaluation results available to the user. You can use the following command to evaluate the prediction results under the `outputs/predictions` directory:

```cli
just eval <prediction-result>
```

Note: If you would like to enable semantics comparison between SQLs by LLM in order to improve the accuracy metric, please fill in Open AI API key in `.env` file in `wren-ai-service/eval` and add `--semantics` to the end of the command like following:

```cli
just eval <prediction-result> --semantics
```

The evaluation results will be presented on Langfuse as follows:

![shallow_trace_example](../docs/imgs/shallow_trace_example.png)


## How to use DSPy in Wren AI
### Step 1: Generate optimized DSPy module

1. Prepare a predict result and training dataset
Generate a predict dataset without dspy. It's used to initialized evaluation pipeline (Metrics). Refer to https://github.com/Canner/WrenAI/blob/main/wren-ai-service/eval/README.md#eval-dataset-preparationif-using-spider-10-dataset

```
just predict <evaluation-dataset>
```
The output is a predict result. such as  `prediction_eval_ask_9df57d69-250c-4a10-b6a5-6595509fed6b_2024_10_23_132136.toml`

2. Train an DSPy module.
Using above predict result and training dataset to train a DSPy module.
```
wren-ai-service/eval/dspy_modules/prompt_optimizer.py --training-dataset spider_car_1_eval_dataset.toml --file prediction_eval_ask_9df57d69-250c-4a10-b6a5-6595509fed6b_2024_10_23_132136.toml
```

output: `eval/optimized/AskGenerationV1_optimized_2024_10_21_181426.json` This is the trained DSPy module 

### Step 2: Use the optimized module in pipeline

1. set an environment variable `DSPY_OPTIMAZED_MODEL` which is the trained dspy module above step

```
export DSPY_OPTIMAZED_MODEL=eval/optimized/AskGenerationV1_optimized_2024_10_21_181426.json
```

2. start predict pipeline and get the predicted result

```
just predict eval/dataset/spider_car_1_eval_dataset.toml
```

The output is genereated by DSPy

```
outputs/predictions/prediction_eval_ask_f5103405-09b2-448c-829d-cedd3c3b12d0_2024_10_22_184950.toml

```

### Step 3: (Optional)

1. Evaluate the DSPy prodiction result

```
just eval prediction_eval_ask_f5103405-09b2-448c-829d-cedd3c3b12d0_2024_10_22_184950.toml

```

2. Compare the two results with DSPy and without DSPy

![image](https://github.com/user-attachments/assets/34ee0c25-dcdc-45b7-8cc0-cb2fe55211af)


Notes:
wren-ai-service/eval/dspy_modules/prompt_optimizer.py can be improved by incorporating additional training examples or use other modules in dspy


## Terms

This section describes the terms used in the evaluation framework:

- **input**: The user query used as input to the Wren AI service (e.g., "What is the total number of COVID-19 cases in the US?").
- **actual_output**: The actual SQL query generated to retrieve the answer to the user query (e.g., "SELECT SUM(cases) FROM covid19 WHERE country='US'").
- **expected_output**: The expected SQL query that should retrieve the answer to the user query (e.g., "SELECT SUM(cases) FROM covid19 WHERE country='US'").
- **retrieval_context**: The relevant context that helps the LLM generate the SQL query (e.g., "covid19.country", "covid19.cases").
- **context**: The relevant context that aligns with human expectations to generate the SQL query (e.g., "covid19.country", "covid19.cases").

## Metrics

This section describes the evaluation metrics used in the evaluation framework:

- **Accuracy**: This metrics is defined as the proportion of the correct SQL output generated by the model compared to the expected SQL output. It checks if the generated SQL query produces the correct results.
- **Answer Relevancy**: This metric helps determine how well your LLM generates relevant information based on the input it receives. It ensures the efficiency and accuracy of the model's output.
- **Faithfulness**: This metric helps determine how well your LLM generates information that is factually correct and aligned with the retrieval context, minimizing hallucinations and contradictions.
- **Contextual Relevancy**: This metric helps determine how well your retriever minimizes irrelevant information while maximizing the retrieval of relevant information. It ensures the efficiency and accuracy of the retrieval process.
- **Contextual Recall**: This metric helps determine how well the embedding model identifies and retrieves relevant information based on the given context.
- **Contextual Precision**: This metric helps determine how well the reranker places relevant nodes higher in the ranking, ensuring that users get the most pertinent results quickly.
