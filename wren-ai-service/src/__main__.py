from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse, RedirectResponse
from langfuse.decorators import langfuse_context

from src.config import Settings
from src.globals import (
    create_service_container,
    create_service_metadata,
)
from src.providers import generate_components
from src.utils import (
    init_langfuse,
    setup_custom_logger,
)
from src.web.v1 import routers

settings = Settings()

setup_custom_logger("wren-ai-service", level_str=settings.logging_level)


# https://fastapi.tiangolo.com/advanced/events/#lifespan
@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup events

    pipe_components = generate_components()
    app.state.service_container = create_service_container(
        pipe_components,
        column_indexing_batch_size=settings.column_indexing_batch_size,
        table_retrieval_size=settings.table_retrieval_size,
        table_column_retrieval_size=settings.table_column_retrieval_size,
        query_cache={
            # the maxsize is a necessary parameter to init cache, but we don't want to expose it to the user
            # so we set it to 1_000_000, which is a large number
            "maxsize": 1_000_000,
            "ttl": settings.query_cache_ttl,
        },
    )
    app.state.service_metadata = create_service_metadata(pipe_components)
    init_langfuse()

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
    uvicorn.run(
        "src.__main__:app",
        host=settings.host,
        port=settings.port,
        reload=settings.development,
        reload_includes=["src/**/*.py", ".env.dev", "config.yaml"],
        workers=1,
        loop="uvloop",
        http="httptools",
    )
