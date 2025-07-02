import inspect
import logging
from typing import Any, Dict, get_type_hints

from fastapi import APIRouter, HTTPException

logger = logging.getLogger("wren-ai-service")
router = APIRouter()


def _extract_run_method_params(pipeline_instance) -> Dict[str, str]:
    """Extract parameter information from a pipeline's run method"""
    run_method = getattr(pipeline_instance, "run", None)
    if not run_method:
        return {}

    try:
        # Get the method signature
        sig = inspect.signature(run_method)

        # Get type hints
        type_hints = get_type_hints(run_method)

        params = {}
        for param_name, param in sig.parameters.items():
            if param_name == "self":
                continue

            # Get the type annotation as string
            param_type = type_hints.get(param_name)
            if param_type:
                # Handle complex types by getting their string representation
                type_str = str(param_type).replace("typing.", "")
            else:
                # Fallback to parameter annotation
                if param.annotation != inspect.Parameter.empty:
                    type_str = str(param.annotation).replace("typing.", "")
                else:
                    type_str = "Any"

            params[param_name] = type_str

        return params
    except Exception as e:
        logger.warning(f"Failed to extract parameters from pipeline run method: {e}")
        return {}


@router.get("/pipelines")
async def get_pipelines() -> dict:
    from src.__main__ import app

    service_container = app.state.service_container
    pipeline_params = {}

    # Extract pipelines from all services
    for _, service in service_container.__dict__.items():
        if hasattr(service, "_pipelines"):
            for pipeline_name, pipeline_instance in service._pipelines.items():
                pipeline_params[pipeline_name] = _extract_run_method_params(
                    pipeline_instance
                )

    return pipeline_params


@router.post("/pipelines/{pipeline_name}")
async def run_pipeline(pipeline_name: str, request_body: Dict[str, Any]) -> dict:
    from src.__main__ import app

    service_container = app.state.service_container
    pipe_components = {}

    for _, service in service_container.__dict__.items():
        if hasattr(service, "_pipelines"):
            for _pipeline_name, pipeline_instance in service._pipelines.items():
                pipe_components[_pipeline_name] = pipeline_instance

    if pipeline_name not in pipe_components:
        logger.error(f"Pipeline {pipeline_name} not found")
        raise HTTPException(
            status_code=404, detail=f"Pipeline '{pipeline_name}' not found"
        )

    try:
        pipeline = pipe_components[pipeline_name]
        result = await pipeline.run(**request_body)
        return result
    except Exception as e:
        logger.error(f"Error running pipeline {pipeline_name}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error running pipeline '{pipeline_name}': {e}"
        )
