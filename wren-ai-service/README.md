# AI Service of Wren AI

## Concepts

Please read the [documentation](https://docs.getwren.ai/oss/concept/wren_ai_service) here to understand the concepts of Wren AI Service.

## Setup for Local Development

### Prerequisites

1. **Python**: Install Python 3.12.\*

   - Recommended: Use [`pyenv`](https://github.com/pyenv/pyenv?tab=readme-ov-file#installation) to manage Python versions

2. **Poetry**: Install Poetry 1.8.3

   ```bash
   curl -sSL https://install.python-poetry.org | python3 - --version 1.8.3
   ```

3. **Just**: Install [Just](https://github.com/casey/just?tab=readme-ov-file#packages) command runner (version 1.36 or higher)

### Step-by-Step Setup

1. **Install Dependencies**:

   ```bash
   poetry install
   ```

2. **Generate Configuration Files**:

   ```bash
   just init
   ```

   This creates both `.env.dev` and `config.yaml`. Use `just init --non-dev` to generate only `config.yaml`.

    > For Windows, add the line `set shell:= ["bash", "-cu"]` at the start of the Justfile.

4. **Configure Environment**:

   - Edit `.env.dev` to set environment variables
   - Modify `config.yaml` to configure components, pipelines, and other settings
   - Refer to [AI Service Configuration](./docs/configuration.md) for detailed setup instructions

5. **Set Up Development Environment** (optional):

   - Install pre-commit hooks:

     ```bash
     poetry run pre-commit install
     ```

   - Run initial pre-commit checks:

     ```bash
     poetry run pre-commit run --all-files
     ```

6. **Run Tests** (optional):

   ```bash
   just test
   ```

### Starting the Service

1. **Start Required Containers**:

   ```bash
   just up
   ```

2. **Launch the AI Service**:

   ```bash
   just start
   ```

3. **Access the Service**:

   - API Documentation: `http://WREN_AI_SERVICE_HOST:WREN_AI_SERVICE_PORT` (default: <http://localhost:5556>)
   - User Interface: `http://WREN_UI_HOST:WREN_UI_PORT` (default: <http://localhost:3000>)

4. **Stop the Service**:
   When finished, stop the containers:

   ```bash
   just down
   ```

This setup ensures a consistent development environment and helps maintain code quality through pre-commit hooks and tests. Follow these steps to get started with local development of the Wren AI Service.

## Others

### Pipeline Evaluation

For a comprehensive understanding of how to evaluate the pipelines, please refer to the [evaluation framework](./eval/README.md). This document provides detailed guidelines on the evaluation process, including how to set up and run evaluations, interpret results, and utilize the evaluation metrics effectively. It is a valuable resource for ensuring that the evaluation is conducted accurately and that the results are meaningful.

### Estimate the Speed of the Pipeline(may be outdated)

- to run the load test
  - setup `DATASET_NAME` in `.env.dev`
  - adjust test config if needed
    - adjust user count in `tests/locust/config_users.json`
  - in wren-ai-service folder, run `just up` to start the docker containers
  - in wren-ai-service folder, run `just start` to start the ai service
  - run `just load-test`
  - check reports in /outputs/locust folder, there are 3 files with filename **locust*report*{test_timestamp}**:
    - .json: test report in json format, including info like llm provider, version
    - .html: test report in html format, showing tables and charts
    - .log: test log

## Contributing

Thank you for investing your time in contributing to our project! Please [read this for more information](CONTRIBUTING.md)!
