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

## Eval Dataset Preparation(If using Spider 1.0 dataset, or Bird dataset)

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

## Benchmark SQLite exception

The product runtime and local development stack are PostgreSQL-first.
However, the evaluation pipeline still contains intentional SQLite references for upstream benchmark compatibility:

- Spider execution / exact-match helpers open the benchmark `.sqlite` databases directly.
- Bird preparation reads the upstream `mini_dev_sqlite.json` file name as provided by the dataset.
- DuckDB helper setup attaches benchmark `.sqlite` files before loading them into PostgreSQL for eval flows that require that conversion.

Treat these SQLite references as **benchmark artifact compatibility**, not as guidance for the main application database.

There is now an **experimental PostgreSQL adapter entry point** inside the Spider metrics helpers:

- exact-match / execution helpers can resolve a PostgreSQL DSN template instead of a `.sqlite` path
- PostgreSQL schema introspection is supported through `information_schema.columns`
- execution falls back to a single PostgreSQL target instead of a sibling `.sqlite` testsuite directory
- prediction / evaluation reload now resolves `{db_name}`, creates the target benchmark database when needed, and imports the upstream SQLite asset into that exact PostgreSQL target

This is only a first migration step. The default benchmark path remains SQLite-backed until execution-parity against the upstream testsuite is proven.

If you want to exercise that adapter explicitly, set an optional benchmark target in `config.yaml`:

```yaml
spider_benchmark_db_target: "postgresql://postgres:postgres@localhost:<published-postgres-port>/{db_name}?schema=public"
```

`{db_name}` is replaced with the current benchmark catalog name. If this field is omitted, Spider metrics continue using the existing `eval_data_db_path` / SQLite dataset layout.

Use the **host-side PostgreSQL port published by your local stack** in this DSN (for example `9432` in the current local Wren docker-compose stack). The loader will map that host-side target back to the matching Docker network/container alias for `pgloader`.

You can also opt into the default PostgreSQL benchmark target without hardcoding the full DSN template:

```yaml
spider_benchmark_use_postgres: true
spider_benchmark_postgres_schema: public
postgres_host: localhost
postgres_port: 9432
postgres_user: postgres
postgres_password: postgres
postgres_database: wrenai
```

This shorthand targets **one PostgreSQL database** built from the `postgres_*` settings above.
Use it when you want the current benchmark to be imported into a single reusable database (for example `wrenai`).

If you want **one isolated PostgreSQL database per benchmark catalog**, prefer the explicit DSN template form:

```yaml
spider_benchmark_db_target: "postgresql://postgres:postgres@localhost:9432/{db_name}?schema=public"
```

For host-run `just predict` / `just eval` flows, make sure `postgres_host` / `postgres_port` (or the explicit DSN template) point to the **host-side published PostgreSQL address** that your local stack exposes. In the current local Wren stack this is often `localhost:9432`, while other compose setups may still publish `localhost:5432`.

Prediction outputs now persist both `eval_data_db_path` and `spider_benchmark_db_target` in their metadata so `just eval ...` can reload the same benchmark source into PostgreSQL before running Spider metrics.

For the PostgreSQL-backed rehearsal path:

- benchmark SQLite databases are imported without `quote identifiers`
- PostgreSQL execution lowers double-quoted identifiers before execution so canonical Spider SQL remains compatible with the case-normalized import
- non-`public` benchmark schemas are supported by moving imported tables into the requested schema and setting the target database `search_path`

You can run a synthetic end-to-end loader smoke test locally:

```cli
just eval-postgres-loader-smoke "postgresql://postgres:postgres@localhost:9432/smoke_{db_name}?schema=analytics"
```

That command:

1. creates a tiny temporary SQLite benchmark DB under `tools/dev/etc/tmp-loader-smoke`
2. imports it through `load_eval_data_db_to_postgres()`
3. verifies both unqualified and schema-qualified PostgreSQL reads
4. drops the temporary PostgreSQL database and temp SQLite source unless `--keep-artifacts` is used directly via the Python script

## Evaluation Dataset Schema

- dataset_id(UUID)
- date
- mdl
- eval dataset

## Configure the datasource for prediction and evaluation

Before starting the prediction and evaluation process, you need to configure the datasource correctly. This ensures that the system can access the necessary data for making predictions and evaluations.

### For Spider or Bird Datasets

For the Spider or Bird datasets, a built-in datasource is used. This means that the data is stored locally and accessed through a specific path. You need to specify the `eval_data_db_path` in the `config.yaml` file. This path tells the system where to find the database files.

Here's an example of how to set this up in the `config.yaml` file:

```yaml
eval_data_db_path: "etc/bird/minidev/MINIDEV/dev_databases"
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
