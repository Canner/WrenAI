# AI Service of WrenAI

This AI service provides the Web APIs to interative with LLM for the WrenAI system. The following sections will guide 
you through the environment setup, development, and production deployment of the AI service.

## Requirements
- Python == 3.12
- Docker
- Poetry == 1.7.1 (`curl -sSL https://install.python-poetry.org | python3 - --version 1.7.1`)

Ensure you have installed the required tools before proceeding to the next steps.

## Setup the Development Environment
- Begin by building the environment using the following commands:
  ```shell
  make setup
  ```
- Fill in the environment variables in the `.env` file and `.env.dev` file.

## Start and Stop the Service for Development
- To run the service and the dependent services, execute the following command in the terminal and go to 
  `http://localhost:5556` to see the API documentation and try them.
  ```shell
  make start
  ```
  - If you change the host and port in env file, you could follow the format to access the API documentation and 
  try the Web APIs. (`http://WREN_AI_SERVICE_HOST:WREN_AI_SERVICE_PORT`)
- To stop the services, execute the following command:
  ```shell
  make stop
  ```

## Run all test cases
- All the test cases are located in the `tests` folder and the following command will run all the test cases:
  ```shell
  make test
  ```

## Pipeline Evaluation

- Copy the `config.properties.example` to `config.properties` in the `src/eval/wren-engine/etc` folder 
  and fill in the environment variables
- Execute the following commands to run the evaluation and specify the pipeline name as the argument:
  ```shell
  make eval pipeline=[pipeline-name]
  ```
  - pipeline-name: `ask`, `ask_detail`
  - the evaluation results will be saved in the output folder
- Visualize the evaluation results by executing the following command:
  ```shell
  make streamlit pipeline=[pipeline-name]
  ```
  - pipeline-name: `ask`, `ask_detail`
- To run other ask-related evaluation: 
  ```shell
  poetry run python -m src.pipelines.ask.[pipeline_name]
  ``` 
  - e.g. `poetry run python -m src.pipelines.ask.retrieval_pipeline`

## Production Environment Setup(might be deprecated in the future)

- Copy `.env.prod.example` file to `.env.prod` and fill in the environment variables
- `make build` to build the docker image
- `make up` to run the docker container
- `make down` to stop the docker container

## Interative the system with Demo application or UI

- Go to the `../docker` folder and prepare the `.env.local` file
- Execute the following command to start the containers and choose App or UI to interact with the system
  ```shell
  make start-demo
  ```
- To stop the containers, execute the following command:
  ```shell
  make stop-demo
  ```
- There are the ports of the services:
  - wren-engine: 8080
  - wren-ai-service: 5556
  - wren-ui: 3000
  - qdrant: 6333, 6334

### Run the Demo Application
  - Go to the `demo` folder and run `poetry install` to install the dependencies
  - Execute the following commands to run the demo application:
    ```shell
    make start-app
    ```

### Run the UI Service
  - Make sure the node version is v16.19.0
  - If you are using Python 3.12+, please also install `setuptools` in order to successfully install the dependencies 
  of the wren-ui service
  - Execute the following commands to run the UI service:
    ```shell
    make start-ui
    ```

## Helper Commands
- To run the helper commands, execute the following command and you will see all the available commands:
  ```shell
  make help
  ```
