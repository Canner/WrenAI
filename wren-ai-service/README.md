# AI Service of WrenAI

## Concepts

Please read the [documentation](https://docs.getwren.ai/concept/wren_ai_service) here to understand the concepts of Wren AI Service.

## Environment Setup

- Python 3.12.0, recommended to use [`pyenv`](https://github.com/pyenv/pyenv?tab=readme-ov-file#installation) to manage the Python versions
- install `poetry` with version 1.7.1: `curl -sSL https://install.python-poetry.org | python3 - --version 1.7.1`
- execute `poetry install` to install the dependencies
- copy `.env.example` file to `.env`, and `.env.dev.example` file to `.env.dev` and fill in the environment variables
- [for development] execute `poetry run pre-commit install` to install the pre-commit hooks and `poetry run pre-commit run --all-files` to run the pre-commit checks at the first time to check if everything is set up correctly
- [for development] to run the tests, execute `make test`

## Start the service for development

- execute `make start` to start the service and go to `http://WREN_AI_SERVICE_HOST:WREN_AI_SERVICE_PORT` to see the API documentation and try the APIs

## Production Environment Setup

- copy `.env.prod.example` file to `.env.prod` and fill in the environment variables
- `make build` to build the docker image
- `make up` to run the docker container
- `make down` to stop the docker container

## Pipeline Evaluation(for development)

- install `psql`
- fill in environment variables: `.env.dev` in the src folder and `config.properties` in the src/eval/wren-engine/etc folder
- start the docker service
- evaluation
  - `make eval pipeline=ask args="--help"`
  - `make eval pipeline=ask_details args="--help"`
- `make streamlit` to compare between the evaluation results
- to run individual pipeline: `poetry run python -m src.pipelines.ask.[pipeline_name]` (e.g. `poetry run python -m src.pipelines.ask.retrieval_pipeline`)

### Speed Evaluation

- to evaluate the speed of the pipeline, you can enable the timer
  - add environment variables `ENABLE_TIMER=True` in `.env.dev`
  - restart wren ai service
  - check `outputs` folder for the evaluation result file
- to run the load test
  - Choose between the 2 setup options:
      - Setup option 1: demo env setup
        - in the demo folder, run `make prepare` to start the docker containers
        - in the demo folder, run `make ai` to start the ai service
      - Setup option 2: normal env setup
        - setup `DATASET_NAME` in `.env.dev`
        - in wren-ai-service folder, run `make run-all` to start the docker containers
        - in wren-ai-service folder, run `make start` to start the ai service
  - run `make load-test`
  - check reports in /outputs folder, there are 3 files with filename **locust_report_{test_timestamp}**:
    - .json: test report in json format, including info like llm provider, version
    - .html: test report in html format, showing tables and charts
    - .log: test log

## Demo

- prerequisites
  - install and run the docker service, and you should stop all WrenAI services first before running the demo
  - go to the `../docker` folder and prepare the `.env.local` file
  - make sure the node version is v16.19.0
  - if you are using Python 3.12+, please also install `setuptools` in order to successfully install the dependencies of the wren-ui service
  - go to the `demo` folder and create a `.env` file and fill in the environment variables if you want to use BigQuery as data source
- go to the `demo` folder and run `poetry install` to install the dependencies
- in the `demo` folder, open three terminals
  - in the first terminal, run `make prepare` to start the docker containers and `make run` to start the demo service
  - in the second terminal, run `make ui` to start the wren-ui service
  - in the third terminal, run `make ai` to start the wren-ai service
- ports of the services:
  - wren-engine: ports should be 8080
  - wren-ai-service: port should be 5556
  - wren-ui: port should be 3000
  - qdrant: ports should be 6333, 6334

## Adding your preferred LLM or Document Store

Please read the [documentation](https://docs.getwren.ai/installation/custom_llm) here to check out how you can add your preferred LLM or Document Store.
