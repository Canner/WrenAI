import os
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Dict, List, Literal, Optional, Union

import pydantic
from langfuse import Langfuse
from langfuse.model import MapValue, ModelUsage, PromptClient

from src.utils import load_env_vars

load_env_vars()

if with_trace := os.getenv("ENABLE_TRACE", default=False):
    langfuse = Langfuse(
        public_key=os.getenv("LANGFUSE_PUBLIC_KEY"),
        secret_key=os.getenv("LANGFUSE_SECRET_KEY"),
        host="https://cloud.langfuse.com",
        threads=os.cpu_count() // 2,
    )
    langfuse.auth_check()


@dataclass
class TraceInput:
    id: Optional[str] = None
    name: Optional[str] = None
    user_id: Optional[str] = None
    version: Optional[str] = None
    input: Optional[Any] = None
    output: Optional[Any] = None
    metadata: Optional[Any] = None
    tags: Optional[List[str]] = None
    timestamp: Optional[datetime] = None


@dataclass
class TraceSpanInput:
    id: Optional[str] = None
    trace_id: Optional[str] = None
    name: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    metadata: Optional[Any] = None
    input: Optional[Any] = None
    output: Optional[Any] = None
    level: Optional[Literal["DEBUG", "DEFAULT", "WARNING", "ERROR"]] = None
    status_message: Optional[str] = None
    parent_observation_id: Optional[str] = None
    version: Optional[str] = None


@dataclass
class TraceGenerationInput:
    id: Optional[str] = None
    trace_id: Optional[str] = None
    name: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    metadata: Optional[Any] = None
    level: Optional[Literal["DEBUG", "DEFAULT", "WARNING", "ERROR"]] = None
    status_message: Optional[str] = None
    parent_observation_id: Optional[str] = None
    version: Optional[str] = None
    completion_start_time: Optional[datetime] = None
    completion_end_time: Optional[datetime] = None
    model: Optional[str] = None
    model_parameters: Optional[Dict[str, MapValue]] = None
    input: Optional[Any] = None
    output: Optional[Any] = None
    usage: Optional[Union[pydantic.BaseModel, ModelUsage]] = None
    prompt: Optional[PromptClient] = None


def trace_span(func: Callable):
    def wrapper(*args, **kwargs):
        span = langfuse.span(**kwargs["trace_span_input"].__dict__)
        del kwargs["trace_span_input"]
        results = func(*args, **kwargs)
        span.end(output=results)
        return results

    return wrapper


def trace_generation(func: Callable):
    def wrapper(*args, **kwargs):
        generation = langfuse.generation(**kwargs["trace_generation_input"].__dict__)
        del kwargs["trace_generation_input"]
        results = func(*args, **kwargs)
        generation.end(
            output=results,
        )
        return results

    return wrapper
