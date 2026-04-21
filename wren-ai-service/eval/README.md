# Evaluation Framework

This document describes the evaluation framework for the Wren AI service. The evaluation framework is designed to assess the performance of the Wren AI service based on the following components:

## Requirements

1. **Install Just**: Download and install [Just](https://github.com/casey/just?tab=readme-ov-file#packages) to run the evaluation framework commands.
2. **Set up Langfuse**: Create an account on [Langfuse](https://cloud.langfuse.com) and obtain the API key and secret. Populate the `.env.dev` file with these credentials.
3. **Start Development Services**: Run `just up` to initiate the necessary development services.
4. **Configuration File**: Ensure you have a copy of `config.yaml` located in the `wren-ai-service/eval/` directory.

## Dataset Curation

The dataset curation process is used to prepare the evaluation dataset for the Wren AI service on evaluation purpose. You can follow the steps below to start the curation app:

- copy `.env.example` to `.env` and fill in the environment variables
- execute the command under the `wren-ai-service` folder: `just curate_eval_data`

## Eval Dataset Preparation (Spider 1.0 / BIRD)

```cli
just prep <dataset-name>
```

Currently, we support two datasets for evaluation:

- `spider1.0`: The Spider dataset (default if no dataset specified)
- `bird`: The Bird dataset

The command performs two main steps:

1. Downloads the specified dataset to:

   ```txt
   wren-ai-service/tools/dev/etc/<dataset-name>
   ```

2. Prepares and saves evaluation datasets to:

   ```txt
   wren-ai-service/eval/dataset
   ```

   The output files follow these naming conventions:

   - Spider dataset: `spider_<db_name>_eval_dataset.toml`
   - Bird dataset: `bird_<db_name>_eval_dataset.toml`

Each evaluation dataset contains questions, SQL queries, and relevant context needed for testing the system's text-to-SQL capabilities.

During BIRD preparation, the downloaded ground-truth file is normalized to `mini_dev_ground_truth.json` so the eval code stays backend-neutral.

## Benchmark execution model

Spider/BIRD benchmark execution is now **PostgreSQL-only**.

- `ExactMatchAccuracy` / `ExecutionAccuracy` resolve a PostgreSQL benchmark target.
- Schema introspection uses PostgreSQL `information_schema.columns`.
- Prediction and evaluation no longer import local benchmark files into PostgreSQL at runtime.
- Benchmark databases must already exist in PostgreSQL before you run `just predict` or `just eval`.

Configure either an explicit benchmark DSN template:

```yaml
settings:
  spider_benchmark_db_target: postgresql://postgres:postgres@localhost:9432/{db_name}?schema=public
```

or rely on the default target built from `postgres_*` + `spider_benchmark_postgres_schema`:

```yaml
settings:
  spider_benchmark_postgres_schema: public
  postgres_host: localhost
  postgres_port: 9432
  postgres_user: postgres
  postgres_password: postgres
  postgres_database: wrenai
```

Notes:

- `{db_name}` is replaced with the current benchmark catalog name.
- For host-run eval commands, use the **host-side published PostgreSQL address** from your local stack.
- `eval_data_db_path` still points to the downloaded benchmark asset root used by dataset preparation and metadata, but it is no longer the execution backend.
- If you omit `spider_benchmark_db_target`, eval builds a default PostgreSQL target from `postgres_*` + `spider_benchmark_postgres_schema`.

## Evaluation Dataset Schema

- dataset_id(UUID)
- date
- mdl
- eval dataset

## Configure the datasource for prediction and evaluation

Before starting the prediction and evaluation process, you need to configure the datasource correctly. This ensures that the system can access the necessary data for making predictions and evaluations.

### For Spider or Bird Datasets

For the Spider or Bird datasets:

- downloaded benchmark assets still live under `tools/dev/etc/...`
- benchmark execution runs against PostgreSQL
- `eval_data_db_path` points to the downloaded benchmark asset root
- `spider_benchmark_db_target` (or the default `postgres_*`-derived DSN) points to the PostgreSQL benchmark database

Example `config.yaml`:

```yaml
settings:
  eval_data_db_path: etc/bird/minidev/MINIDEV/dev_databases
  spider_benchmark_db_target: postgresql://postgres:postgres@localhost:9432/{db_name}?schema=public
```

### Configuring BigQuery as a Datasource for Other custom MDLs

When working with custom MDLs that utilize BigQuery as their datasource, it's crucial to properly configure your system to access the necessary datasets. This involves setting specific parameters in the `config.yaml` file or the `.env.dev` file. Both methods are effective, but using the `.env.dev` file is particularly beneficial for keeping sensitive credentials secure.

#### Encoding the credentials

You can use the following command to encode the credentials:

```cli
cat <path/to/credentials.json> | base64
```

#### Configuration in `config.yaml`

To enable access to your BigQuery dataset, add the following parameters to your `config.yaml` file. This configuration will guide the system in locating and authenticating with your BigQuery resources:

```yaml
bigquery_project_id: "your_project_id"
bigquery_dataset_id: "your_dataset_id"
bigquery_credentials: "your_credentials" # this is a base64 encoded string of the credentials
```

#### Configuration in `.env.dev`

For the `.env.dev` file, you can use the following parameters:

```env
BIGQUERY_PROJECT_ID="your_project_id"
BIGQUERY_DATASET_ID="your_dataset_id"
BIGQUERY_CREDENTIALS="your_credentials" # this is a base64 encoded string of the credentials
```

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
- **QuestionToReasoningJudge**: This metric helps determine how well the LLM generates reasoning that is aligned with the question.
- **ReasoningToSqlJudge**: This metric helps determine how well the LLM generates SQL that is aligned with the reasoning.
- **SqlSemanticsJudge**: This metric helps determine how well the LLM generates SQL that is semantically equivalent to the expected SQL.
