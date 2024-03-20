# AI Service of WrenAI

## Environment Setup

- Python 3.12 or later 
- follow the instructions at https://pipx.pypa.io/stable/ install `pipx`
- execute `pipx install poetry` to install `poetry`
- execute `poetry install` to install the dependencies
- copy `.env.example` file to `.env`, and `.env.dev.example` file to `.env.dev` and fill in the environment variables
- [for development] execute `poetry run pre-commit install` to install the pre-commit hooks and `poetry run pre-commit run --all-files` to run the pre-commit checks at the first time to check if everything is set up correctly

## Start the service for development

- execute `make start` to start the service and go to `http://UVICORN_HOST:UVICORN_PORT/docs` to see the API documentation and try the API

## Production Environment Setup

- copy `.env.prod.example` file to `.env.prod` and fill in the environment variables
- `make build` to build the docker image
- `make up` to run the docker container
- `make down` to stop the docker container

## Pipeline Evaluation(for development)

- fill in environment variables: `.env.dev` in the src folder and `config.properties` in the src/eval/wren-engine folder
- start docker
- run qdrant and wren-engine docker containers: `make run-all`
- evaluation: `make eval` and check out the outputs folder
- `make streamlit` to compare between the evaluation results
- to run individual pipeline: `poetry run python -m src.pipelines.ask.[pipeline_name]` (e.g. `poetry run python -m src.pipelines.ask.retrieval_pipeline`)

## Demo

- you should stop all services first before running the demo
- go to the `demo` folder and run `poetry install` to install the dependencies
- in the `demo` folder, run `make prepare` in one terminal, and `make run` in another terminal to start the demo and go to `http://localhost:8501` to see the demo
    - `make prepare` will run three other services: qdrant, wren-engine, and wren-ai-service
    - qdrant: ports should be 6333, 6334
    - wren-engine: ports should be8080, 7342
    - wren-ai-service: port should be 5000
