from contextlib import asynccontextmanager
from importlib.util import find_spec
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import ORJSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from langfuse.decorators import langfuse_context

from src.config import settings
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

setup_custom_logger(
    "wren-ai-service", level_str=settings.logging_level, is_dev=settings.development
)


def get_local_swagger_static_dir() -> Path | None:
    litellm_spec = find_spec("litellm")
    if not litellm_spec or not litellm_spec.submodule_search_locations:
        return None

    swagger_dir = (
        Path(next(iter(litellm_spec.submodule_search_locations))) / "proxy" / "swagger"
    )
    required_assets = ("swagger-ui-bundle.js", "swagger-ui.css", "favicon.ico")

    if all((swagger_dir / asset).is_file() for asset in required_assets):
        return swagger_dir

    return None


# https://fastapi.tiangolo.com/advanced/events/#lifespan
@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup events
    pipe_components = generate_components(settings.components)
    app.state.service_container = create_service_container(pipe_components, settings)
    app.state.service_metadata = create_service_metadata(pipe_components)
    init_langfuse(settings)

    yield

    # shutdown events
    langfuse_context.flush()


app = FastAPI(
    title="wren-ai-service API Docs",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    default_response_class=ORJSONResponse,
)

swagger_static_dir = get_local_swagger_static_dir()
if swagger_static_dir:
    app.mount(
        "/_docs/static",
        StaticFiles(directory=swagger_static_dir),
        name="swagger-static",
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


@app.get("/docs", include_in_schema=False)
def swagger_ui_html():
    kwargs = {
        "openapi_url": app.openapi_url,
        "title": f"{app.title} - Swagger UI",
    }

    if swagger_static_dir:
        kwargs.update(
            {
                "swagger_js_url": "/_docs/static/swagger-ui-bundle.js",
                "swagger_css_url": "/_docs/static/swagger-ui.css",
                "swagger_favicon_url": "/_docs/static/favicon.ico",
            }
        )

    return get_swagger_ui_html(**kwargs)


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
        reload_excludes=["tests/**/*.py", "eval/**/*.py"],
        workers=1,
        loop="auto",
        http="auto",
    )
