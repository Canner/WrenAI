# Introduction to the codebase of wren-ai-service

## Table of Contents

- [Purpose](#purpose)
- [Environment Setup and Start wren-ai-service Locally](#environment-setup-and-start-wren-ai-service-locally)
- [Codebase Introduction](#codebase-introduction)
    - [Entrypoint](#entrypoint)
    - [Globals](#globals)
    - [API endpoints](#api-endpoints)
    - [Services](#services)
    - [Pipelines](#pipelines)
    - [Providers](#providers)
    - [Others](#others)

## Purpose

This document aims to dive deep to the implementation details of wren-ai-service. We have two goals in mind while writing the document:
1. You will be more knowledgeable about how wren-ai-service works under the hood.
2. You will be more confident on what part of codebase is needed for adjustment if you would like to be Wren AI's contributor.

## Environment Setup and Start wren-ai-service Locally

If you haven't setup the environment or don't know how to run wren-ai-service locally, please refer to the [document](../README.md#setup-for-local-development) here first.

## Codebase Introduction

wren-ai-service is basically an AI service which provides REST api endpoints for access. There are 4 main concepts to wren-ai-service: `API endpoints`, `Services`, `Pipelines` and `Providers`.
1. `API endpoints`: They are entry points for users to access several kinds of RAG(retrieval-augmented-generation) systems; you can also see API endpoints as encapsulation of Services. For example, when users need to ask a question in order to get SQL, they need to call `/ask` and there is AskService under the hood for background computation.
2. `Services`: They are abstraction of business-logic concepts, such as AskService for users asking questions to get SQL results back, AskDetailsService for users to get SQL breakdown as several sub-steps in order to understand the logic behind the original SQL. Every service is composed of a series of pipelines.
3. `Pipelines`: Basically RAG systems are actually implemented here. However, not all pipelines have complete indexing, retrieval and generation components; it depends on what's the purpose of the pipeline. Also, every pipeline contains some providers such as LLM provider, which represents an LLM.
4. `Providers`: Now there are 4 kinds of providers:
    - llm: representing large language models, and now we support OpenAI, Azure OpenAI, OpenAI api-compatible and Ollama models
    - embedder: representing embedding models, and now we support OpenAI, Azure OpenAI, OpenAI api-compatible and Ollama models
    - document store: representing vector database, and now we use Qdrant
    - engine: representing data engine, which is responsible for validating generated SQL's syntax.

### Entrypoint

- The entry point of wren-ai-service is located at [`wren-ai-service/src/__main__.py`](../src/__main__.py)
- The main point of the entry point is the `lifespan` method, which is FastAPI's feature for defining startup and shutdown logic.

```python
# https://fastapi.tiangolo.com/advanced/events/#lifespan
@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup events

    pipe_components = generate_components()
    app.state.service_container = create_service_container(
        pipe_components,
        column_indexing_batch_size=(
            int(os.getenv("COLUMN_INDEXING_BATCH_SIZE"))
            if os.getenv("COLUMN_INDEXING_BATCH_SIZE")
            else 50
        ),
        table_retrieval_size=(
            int(os.getenv("TABLE_RETRIEVAL_SIZE"))
            if os.getenv("TABLE_RETRIEVAL_SIZE")
            else 10
        ),
        table_column_retrieval_size=(
            int(os.getenv("TABLE_COLUMN_RETRIEVAL_SIZE"))
            if os.getenv("TABLE_COLUMN_RETRIEVAL_SIZE")
            else 1000
        ),
        query_cache={
            # the maxsize is a necessary parameter to init cache, but we don't want to expose it to the user
            # so we set it to 1_000_000, which is a large number
            "maxsize": 1_000_000,
            "ttl": int(os.getenv("QUERY_CACHE_TTL") or 120),
        },
    )
    app.state.service_metadata = create_service_metadata(pipe_components)
    init_langfuse()

    yield

    # shutdown events
    langfuse_context.flush()
```

- For startup logic, we initialize pipeline components, service containers(which include all services), service metadata(which is some metadata logged for traces inside [Langfuse, an open-source LLM engineering platform](https://langfuse.com/)) and Langfuse.
- For initializing pipeline components, we are in the progress of supporting multiple LLMs, namely users can choose which LLM is responsible for each pipeline.
    - You still need to have `.env.dev` locally, then you can prepare `config.yaml` and run `just start`.
- For shutdown logic, we make sure all Langfuse events are transmitted successfully

### Globals

- The file is located at [`wren-ai-service/src/globals.py`](../src/globals.py)
- You can understand the details of service containers and service metadata here
    - service containers(Other services are not supported in UI yet)
        - SemanticsPreparationService: this is responsible for indexing [MDL](https://docs.getwren.ai/oss/engine/concept/what_is_mdl) to Qdarnt
        - AskService: this is responsible for answering users' questions with SQLs, namely text-to-sql
        - AskDetailsService: this is responsible for SQL breakdown to several sub-steps
    - service metadata
        - We will record llm's and embedding model's metadata, wren-ai-service version, etc.

### API endpoints

- All business related API endpoints are located at [`wren-ai-service/src/web/v1/routers`](../src/web/v1/routers)
- Since computation for each kind of API endpoint(ex. ask, etc.) takes several seconds, so we use FastAPI's `background_tasks`. For example, after the `ask` api is invoked, the response is immediately returned, then users need to conduct polling in order to get the latest task status; and once the status is `finished`, the result is returned correspondingly
- Each kind of API endpoint corresponds to one kind of business related task, for example, AskService, AskDetailsService

### Services

- All services are located at [`wren-ai-service/src/web/v1/services`](../src/web/v1/services)

### Pipelines

- All pipelines are located at [`wren-ai-service/src/pipelines`](../src/pipelines)
- Since all pipelines are actually RAG systems, so we classify the role of each pipeline as indexing, retrieval or generation
- The abstract class is defined at [`wren-ai-service/src/core/pipeline.py`](../src/core/pipeline.py)

### Providers

- All providers are located at [`wren-ai-service/src/providers`](../src/providers)
- The abstract classes for providers(LLM, embedding model and document store) are defined at [`wren-ai-service/src/core/provider.py`](../src/core/provider.py)
- The abstract class for engine is defined at [`wren-ai-service/src/core/engine.py`](../src/core/engine.py)
