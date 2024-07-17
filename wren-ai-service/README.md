# AI Service of Wren AI

## Concepts

Please read the [documentation](https://docs.getwren.ai/concept/wren_ai_service) here to understand the concepts of Wren AI Service.

## Setup for Local Development

### Environment Setup

- Python 3.12.*, recommended to use [`pyenv`](https://github.com/pyenv/pyenv?tab=readme-ov-file#installation) to manage the Python versions
- install `poetry` with version 1.8.3: `curl -sSL https://install.python-poetry.org | python3 - --version 1.8.3`
- execute `poetry install` to install the dependencies
- copy `.env.dev.example` file to `.env.dev` and fill in the environment variables
- [for development] execute `poetry run pre-commit install` to install the pre-commit hooks and `poetry run pre-commit run --all-files` to run the pre-commit checks at the first time to check if everything is set up correctly
- [for development] to run the tests, execute `make test`

### Start the service for development

The following commands can quickly start the service for development:

- `make dev-up` to start needed containers
- `make start` to start the service 
    - go to `http://WREN_AI_SERVICE_HOST:WREN_AI_SERVICE_PORT`(default is http://localhost:5556) to see the API 
    documentation and try them.
    - go to `http://WREN_UI_HOST:WREN_UI_PORT`(default is http://localhost:3000) to interact interact from the UI
- `make dev-down` to stop the needed containers

## Others

### Pipeline Evaluation

- evaluation dataset curation
  - copy `.env.example` file to `.env` in the `eval/data_curation` folder and fill in the environment variables
  - execute the command under the `wren-ai-service` folder: `make data_curation_app`

### Speed Evaluation(Deprecated, will introduce new way to evaluate the speed in the future)

- to evaluate the speed of the pipeline, you can enable the timer
  - add environment variables `ENABLE_TIMER=1` in `.env.dev`
  - restart wren ai service
  - check the logs in the terminal
- to run the load test
  - setup `DATASET_NAME` in `.env.dev`
  - adjust test config if needed
    - adjust test config in pyproject.toml `tool.locust` section
    - adjust user count in `tests/locust/config_users.json`
  - in wren-ai-service folder, run `make dev-up` to start the docker containers
  - in wren-ai-service folder, run `make start` to start the ai service
  - run `make load-test`
  - check reports in /outputs/locust folder, there are 3 files with filename **locust_report_{test_timestamp}**:
    - .json: test report in json format, including info like llm provider, version
    - .html: test report in html format, showing tables and charts
    - .log: test log

### Demo

- go to the `demo` folder and run `poetry install` to install the dependencies
- in the `wren-ai-service` folder, open three terminals
  - in the first terminal, run `make dev-up` to start the docker container
  - in the second terminal, run `make start` to start the wren-ai service
  - in the third terminal, run `make demo` to start the demo service
- ports of the services:
  - wren-engine: ports should be 8080
  - wren-ai-service: port should be 5556
  - wren-ui: port should be 3000
  - qdrant: ports should be 6333, 6334

## Adding your preferred LLM, Embedder or Document Store

Please read the [documentation](https://docs.getwren.ai/installation/custom_llm) here to check out how you can add your preferred LLM, Embedder or Document Store.

## Related Issues or PRs

- [Issues](https://github.com/Canner/WrenAI/issues?q=is%3Aopen+is%3Aissue+label%3Amodule%2Fai-service)
- [PRs](https://github.com/Canner/WrenAI/pulls?q=is%3Aopen+is%3Apr+label%3Amodule%2Fai-service)
