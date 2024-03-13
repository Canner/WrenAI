# AI Service of WrenAI

## Environment Setup

- Python 3.12 or later 
- follow the instructions at https://pipx.pypa.io/stable/ install `pipx`
- execute `pipx install poetry` to install `poetry`
- execute `poetry install` to install the dependencies
- copy `.env.example` file to `.env`, and `.env.dev.example` file to `.env.dev` and fill in the environment variables
- [for development] execute `poetry run pre-commit install` to install the pre-commit hooks and `poetry run pre-commit run --all-files` to run the pre-commit checks at the first time to check if everything is set up correctly

## Start the service for development

- execute `make start` to start the service
  - go to `http://UVICORN_HOST:UVICORN_PORT/docs` to see the API documentation and try the API

## Production Environment Setup

- copy `.env.prod.example` file to `.env.prod` and fill in the environment variables
- `make build` to build the docker image
- `make up` to run the docker container
- `make down` to stop the docker container

## Pipeline Evaluation(for development)

- fill in environment variables: `.env.dev` in the src folder and `config.properties` in the src/eval/vulcansql-core-server folder
- start docker
- run qdrant and vulcansql-core-server docker containers: `make run-all`
- evaluation: `make eval` and check out the outputs folder
- `make streamlit` to compare between the evaluation results
- to run individual pipeline: `poetry run python -m src.pipelines.ask.[pipeline_name]` (e.g. `poetry run python -m src.pipelines.ask.retrieval_pipeline`)