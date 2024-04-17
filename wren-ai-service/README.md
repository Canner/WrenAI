# AI Service of WrenAI

## Environment Setup

- Python 3.12
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
- run qdrant and wren-engine docker containers: `make run-all`
- evaluation: `make eval-ask` and check out the outputs folder
- `make streamlit` to compare between the evaluation results
- to run individual pipeline: `poetry run python -m src.pipelines.ask.[pipeline_name]` (e.g. `poetry run python -m src.pipelines.ask.retrieval_pipeline`)

## Demo

- prerequisites
  - install and run the docker service, and you should stop all WrenAI services first before running the demo
  - go to the `../docker` folder and prepare the `.env.local` file
  - make sure the node version is v16.19.0
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
