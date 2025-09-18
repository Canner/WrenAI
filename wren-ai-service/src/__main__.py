from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse, RedirectResponse
from langfuse.decorators import langfuse_context

from src.config import settings
from src.globals import (
    create_pipe_components,
    create_service_container,
    create_service_metadata,
)
from src.providers import generate_components
from src.providers.embedder.litellm import LitellmEmbedderProvider
from src.utils import (
    Configs,
    init_langfuse,
    setup_custom_logger,
)
from src.web.v1 import routers

setup_custom_logger(
    "wren-ai-service", level_str=settings.logging_level, is_dev=settings.development
)


# https://fastapi.tiangolo.com/advanced/events/#lifespan
@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup events
    pipe_components, instantiated_providers = generate_components(settings.components)
    app.state.service_container = create_service_container(pipe_components, settings)
    app.state.pipe_components = create_pipe_components(app.state.service_container)
    app.state.service_metadata = create_service_metadata(pipe_components)
    app.state.instantiated_providers = instantiated_providers
    init_langfuse(settings)

    yield

    # shutdown events
    langfuse_context.flush()


app = FastAPI(
    title="wren-ai-service API Docs",
    lifespan=lifespan,
    redoc_url=None,
    default_response_class=ORJSONResponse,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(routers.router, prefix="/v1", tags=["v1"])
if settings.development:
    from src.web import development

    app.include_router(development.router, prefix="/dev", tags=["dev"])


@app.exception_handler(Exception)
async def exception_handler(_, exc: Exception):
    return ORJSONResponse(
        status_code=500,
        content={"detail": str(exc)},
    )


@app.exception_handler(RequestValidationError)
async def request_exception_handler(_, exc: Exception):
    return ORJSONResponse(
        status_code=400,
        content={"detail": str(exc)},
    )


@app.get("/")
def root():
    return RedirectResponse(url="/docs")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/configs")
def get_configs():
    _configs = {
        "env_vars": {},
        "providers": {
            "llm": [],
            "embedder": [],
        },
        "pipelines": {},
    }

    _llm_model_alias_mapping = {}
    _embedder_model_alias_mapping = {}

    _llm_configs = []
    for _, model_config in app.state.instantiated_providers["llm"].items():
        _llm_configs.append(
            {
                "model": model_config._model,
                "alias": model_config._alias,
                "api_base": model_config._api_base,
                "api_version": model_config._api_version,
                "context_window_size": model_config._context_window_size,
                "timeout": model_config._timeout,
                "kwargs": model_config._model_kwargs,
            }
        )
        _llm_model_alias_mapping[model_config._model] = model_config._alias
    _configs["providers"]["llm"] = _llm_configs

    _embedder_configs = []
    # we only support one embedding model now
    for _, model_config in app.state.instantiated_providers["embedder"].items():
        _embedder_configs.append(
            {
                "model": model_config._model,
                "alias": model_config._alias,
                "dimension": app.state.instantiated_providers["document_store"][
                    "qdrant"
                ]._embedding_model_dim,
                "api_base": model_config._api_base,
                "api_version": model_config._api_version,
                "timeout": model_config._timeout,
                "kwargs": model_config._model_kwargs,
            }
        )
        _embedder_model_alias_mapping[model_config._model] = model_config._alias
        break
    _configs["providers"]["embedder"] = _embedder_configs

    for pipe_name, pipe_component in app.state.pipe_components.items():
        llm_model = pipe_component.get("llm", None)
        embedding_model = pipe_component.get("embedder", None)
        description = pipe_component.get("description", "")
        if llm_model or embedding_model:
            _configs["pipelines"][pipe_name] = {
                "has_db_data_in_llm_prompt": pipe_component.get(
                    "has_db_data_in_llm_prompt", False
                ),
                "description": description,
            }
            if llm_model:
                if llm_model_alias := _llm_model_alias_mapping.get(llm_model):
                    _configs["pipelines"][pipe_name]["llm"] = llm_model_alias
                else:
                    _configs["pipelines"][pipe_name]["llm"] = llm_model
            if embedding_model:
                if embedding_model_alias := _embedder_model_alias_mapping.get(
                    embedding_model
                ):
                    _configs["pipelines"][pipe_name]["embedder"] = embedding_model_alias
                else:
                    _configs["pipelines"][pipe_name]["embedder"] = embedding_model

    return _configs


@app.post("/configs")
def update_configs(configs_request: Configs):
    embedder_providers = {}
    for embedder_provider in configs_request.providers.embedder:
        identifier = f"litellm_embedder.{embedder_provider.alias if embedder_provider.alias else embedder_provider.model}"
        embedder_providers[identifier] = LitellmEmbedderProvider(
            **embedder_provider.__dict__
        )

    # try:
    #     for payload in pipe_components_request:
    #         for service in app.state.pipe_components[payload.pipeline_name].get(
    #             "services", []
    #         ):
    #             service._pipelines[payload.pipeline_name].update_llm_provider(
    #                 app.state.instantiated_providers["llm"][payload.llm_config]
    #             )
    # except Exception as e:
    #     raise HTTPException(
    #         status_code=500, detail=f"Error updating pipe components: {e}"
    #     )


if __name__ == "__main__":
    uvicorn.run(
        "src.__main__:app",
        host=settings.host,
        port=settings.port,
        reload=settings.development,
        reload_includes=["src/**/*.py", ".env.dev", "config.yaml"],
        reload_excludes=["tests/**/*.py", "eval/**/*.py"],
        workers=1,
        loop="uvloop",
        http="httptools",
    )
