import logging
import os
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse, RedirectResponse
from langfuse.decorators import langfuse_context

import src.globals as container
from src.core.engine import EngineConfig
from src.utils import (
    init_langfuse,
    init_providers,
    load_env_vars,
    service_metadata,
    setup_custom_logger,
)
from src.web.v1 import routers

env = load_env_vars()
setup_custom_logger(
    "wren-ai-service",
    level=(
        logging.DEBUG if os.getenv("LOGGING_LEVEL", "INFO") == "DEBUG" else logging.INFO
    ),
)


# https://fastapi.tiangolo.com/advanced/events/#lifespan
@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup events
    providers = init_providers(
        engine_config=EngineConfig(provider=os.getenv("ENGINE", "wren_ui"))
    )
    container.init_globals(*providers)
    service_metadata(*providers)
    init_langfuse()

    yield

    # shutdown events
    langfuse_context.flush()


app = FastAPI(lifespan=lifespan, redoc_url=None, default_response_class=ORJSONResponse)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(routers.router, prefix="/v1")
if env == "dev":
    from src.web import development

    app.include_router(development.router, prefix="/dev")


@app.exception_handler(Exception)
async def exception_handler(request, exc: Exception):
    return ORJSONResponse(
        status_code=500,
        content={"detail": str(exc)},
    )


@app.exception_handler(RequestValidationError)
async def request_exception_handler(request, exc: Exception):
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


if __name__ == "__main__":
    server_host = os.getenv("WREN_AI_SERVICE_HOST") or "127.0.0.1"
    server_port = (
        int(os.getenv("WREN_AI_SERVICE_PORT"))
        if os.getenv("WREN_AI_SERVICE_PORT") is not None
        else 8000
    )

    should_reload = env == "dev"

    uvicorn.run(
        "src.__main__:app",
        host=server_host,
        port=server_port,
        reload=should_reload,
        reload_includes=["src/**/*.py", ".env.dev"],
        reload_excludes=[
            "./demo/*.py",
        ],  # TODO: add eval folder when evaluation system is ready
        workers=1,
        loop="uvloop",
        http="httptools",
    )
