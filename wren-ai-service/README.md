# AI Service of Wren AI

## Concepts

Please read the [documentation](https://docs.getwren.ai/oss/concept/wren_ai_service) here to understand the concepts of Wren AI Service.

## Setup for Local Development

### Environment Setup

- Python 3.12.\*, recommended to use [`pyenv`](https://github.com/pyenv/pyenv?tab=readme-ov-file#installation) to manage the Python versions
- install `poetry` with version 1.8.3: `curl -sSL https://install.python-poetry.org | python3 - --version 1.8.3`
- execute `poetry install` to install the dependencies
- copy `.env.dev.example` file to `.env.dev` and fill in the environment variables
- [for development] execute `poetry run pre-commit install` to install the pre-commit hooks and `poetry run pre-commit run --all-files` to run the pre-commit checks at the first time to check if everything is set up correctly
- [for development] install [Just](https://github.com/casey/just?tab=readme-ov-file#packages)
- [for development] to run the tests, execute `just test`

### Start the service for development

The following commands can quickly start the service for development:

- `just up` to start needed containers
- `just start` to start the service 
    - go to `http://WREN_AI_SERVICE_HOST:WREN_AI_SERVICE_PORT`(default is http://localhost:5556) to see the API 
    documentation and try them.
    - go to `http://WREN_UI_HOST:WREN_UI_PORT`(default is http://localhost:3000) to interact interact from the UI
- `just down` to stop the needed containers

## Others

### Pipeline Evaluation

For a comprehensive understanding of how to evaluate the pipelines, please refer to the [evaluation framework](./eval/README.md). This document provides detailed guidelines on the evaluation process, including how to set up and run evaluations, interpret results, and utilize the evaluation metrics effectively. It is a valuable resource for ensuring that the evaluation is conducted accurately and that the results are meaningful.

### Estimate the Speed of the Pipeline

- to evaluate the speed of the pipeline, you can enable the timer
  - add environment variables `ENABLE_TIMER=1` in `.env.dev`
  - restart wren ai service
  - check the logs in the terminal
- to run the load test
  - setup `DATASET_NAME` in `.env.dev`
  - adjust test config if needed
    - adjust user count in `tests/locust/config_users.json`
  - in wren-ai-service folder, run `just up` to start the docker containers
  - in wren-ai-service folder, run `just start` to start the ai service
  - run `just load-test`
  - check reports in /outputs/locust folder, there are 3 files with filename **locust_report_{test_timestamp}**:
    - .json: test report in json format, including info like llm provider, version
    - .html: test report in html format, showing tables and charts
    - .log: test log

### Demo

- go to the `demo` folder and run `poetry install` to install the dependencies
- in the `wren-ai-service` folder, open three terminals
  - in the first terminal, run `just up` to start the docker container
  - in the second terminal, run `just start` to start the wren-ai service
  - in the third terminal, run `just demo` to start the demo service
- ports of the services:
  - wren-engine: ports should be 8080
  - wren-ai-service: port should be 5556
  - wren-ui: port should be 3000
  - qdrant: ports should be 6333, 6334

## Contributing

Thank you for investing your time in contributing to our project! Please [read this for more information](CONTRIBUTING.md)!
