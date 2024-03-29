import os
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, RedirectResponse

import src.globals as container
from src.utils import load_env_vars
from src.web.v1 import routers

env = load_env_vars()

server_host = os.getenv("UVICORN_HOST") or "127.0.0.1"
server_port = (
    int(os.getenv("UVICORN_PORT")) if os.getenv("UVICORN_PORT") is not None else 8000
)


# https://fastapi.tiangolo.com/advanced/events/#lifespan
@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup events
    container.init_globals()

    yield

    # shutdown events


app = FastAPI(lifespan=lifespan, redoc_url=None)

app.include_router(routers.router, prefix="/v1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        f"http://{server_host}:{server_port}",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def validation_exception_handler(request, exc: Exception):
    return PlainTextResponse(str(exc), status_code=500)


@app.get("/")
def root():
    return RedirectResponse(url="/docs")


if __name__ == "__main__":
    uvicorn.run(
        "src.__main__:app",
        host=server_host,
        port=server_port,
        reload=(env == "dev"),
        reload_dirs=["src"],
    )
