from __future__ import annotations

import json
import typing as t
import uuid
from dataclasses import dataclass, field
from enum import Enum

from langchain_core.callbacks import (
    BaseCallbackHandler,
    CallbackManager,
    CallbackManagerForChainGroup,
    CallbackManagerForChainRun,
    Callbacks,
)
from pydantic import BaseModel, Field


def new_group(
    name: str,
    inputs: t.Dict,
    callbacks: Callbacks,
    tags: t.Optional[t.List[str]] = None,
    metadata: t.Optional[t.Dict[str, t.Any]] = None,
) -> t.Tuple[CallbackManagerForChainRun, CallbackManagerForChainGroup]:
    tags = tags or []
    metadata = metadata or {}

    # start evaluation chain
    if isinstance(callbacks, list):
        cm = CallbackManager.configure(inheritable_callbacks=callbacks)
    else:
        cm = t.cast(CallbackManager, callbacks)
    cm.tags = tags
    cm.metadata = metadata
    rm = cm.on_chain_start({"name": name}, inputs)
    child_cm = rm.get_child()
    group_cm = CallbackManagerForChainGroup(
        child_cm.handlers,
        child_cm.inheritable_handlers,
        child_cm.parent_run_id,
        parent_run_manager=rm,
        tags=child_cm.tags,
        inheritable_tags=child_cm.inheritable_tags,
        metadata=child_cm.metadata,
        inheritable_metadata=child_cm.inheritable_metadata,
    )

    return rm, group_cm


class ChainType(Enum):
    EVALUATION = "evaluation"
    METRIC = "metric"
    ROW = "row"
    RAGAS_PROMPT = "ragas_prompt"


class ChainRun(BaseModel):
    run_id: str
    parent_run_id: t.Optional[str]
    name: str
    inputs: t.Dict[str, t.Any]
    metadata: t.Dict[str, t.Any]
    outputs: t.Dict[str, t.Any] = Field(default_factory=dict)
    children: t.List[str] = Field(default_factory=list)


class ChainRunEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, uuid.UUID):
            return str(o)
        if isinstance(o, ChainType):
            return o.value
        # if isinstance(o, EvaluationResult):
        #     return ""
        return json.JSONEncoder.default(self, o)


@dataclass
class RagasTracer(BaseCallbackHandler):
    traces: t.Dict[str, ChainRun] = field(default_factory=dict)

    def on_chain_start(
        self,
        serialized: t.Dict[str, t.Any],
        inputs: t.Dict[str, t.Any],
        *,
        run_id: uuid.UUID,
        parent_run_id: t.Optional[uuid.UUID] = None,
        tags: t.Optional[t.List[str]] = None,
        metadata: t.Optional[t.Dict[str, t.Any]] = None,
        **kwargs: t.Any,
    ) -> t.Any:
        self.traces[str(run_id)] = ChainRun(
            run_id=str(run_id),
            parent_run_id=str(parent_run_id) if parent_run_id else None,
            name=serialized["name"],
            inputs=inputs,
            metadata=metadata or {},
            children=[],
        )

        if parent_run_id and str(parent_run_id) in self.traces:
            self.traces[str(parent_run_id)].children.append(str(run_id))

    def on_chain_end(
        self,
        outputs: t.Dict[str, t.Any],
        *,
        run_id: uuid.UUID,
        **kwargs: t.Any,
    ) -> t.Any:
        self.traces[str(run_id)].outputs = outputs

    def to_jsons(self) -> str:
        return json.dumps(
            [t.model_dump() for t in self.traces.values()],
            cls=ChainRunEncoder,
        )


@dataclass
class MetricTrace(dict):
    scores: t.Dict[str, float] = field(default_factory=dict)

    def __repr__(self):
        return self.scores.__repr__()

    def __str__(self):
        return self.__repr__()


def parse_run_traces(
    traces: t.Dict[str, ChainRun],
    parent_run_id: t.Optional[str] = None,
) -> t.List[t.Dict[str, t.Any]]:

    root_traces = [
        chain_trace
        for chain_trace in traces.values()
        if chain_trace.parent_run_id == parent_run_id
    ]

    if len(root_traces) > 1:
        raise ValueError(
            "Multiple root traces found! This is a bug on our end, please file an issue and we will fix it ASAP :)"
        )
    root_trace = root_traces[0]

    # get all the row traces
    parased_traces = []
    for row_uuid in root_trace.children:
        row_trace = traces[row_uuid]
        metric_traces = MetricTrace()
        for metric_uuid in row_trace.children:
            metric_trace = traces[metric_uuid]
            metric_traces.scores[metric_trace.name] = metric_trace.outputs.get(
                "output", {}
            )
            # get all the prompt IO from the metric trace
            prompt_traces = {}
            for i, prompt_uuid in enumerate(metric_trace.children):
                prompt_trace = traces[prompt_uuid]
                output = prompt_trace.outputs.get("output", {})
                output = output[0] if isinstance(output, list) else output
                prompt_traces[f"{prompt_trace.name}"] = {
                    "input": prompt_trace.inputs.get("data", {}),
                    "output": output,
                }
            metric_traces[f"{metric_trace.name}"] = prompt_traces
        parased_traces.append(metric_traces)

    return parased_traces
