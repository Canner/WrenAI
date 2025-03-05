import datetime
from typing import Any, Optional

from pydantic import BaseModel, create_model, model_validator


def model_from_values(name: str, specs: dict[str, Any]) -> dict[str, tuple[type, ...]]:
    return create_model(name, **{str(k): (type(v), ...) for k, v in specs.items()})


class NodeMaterializer(BaseModel):
    source_nodes: list[str]
    path: str
    sink: str
    data_saver: str


def denormalize_node_list(nodes: list) -> dict:
    denorm = dict()
    for node in nodes:
        name = node["name"]
        del node["name"]
        denorm[name] = node
    return denorm


class RunMetadata(BaseModel):
    experiment: str
    run_id: str
    run_dir: str
    success: bool
    date_completed: datetime.datetime
    graph_hash: str
    modules: list[str]
    config: dict
    inputs: dict
    overrides: dict
    materialized: list[NodeMaterializer]
    graph_version: Optional[int] = None

    @model_validator(mode="before")
    def pre_root(cls, v: dict[str, Any]):
        dt = datetime.datetime.fromisoformat(v["date_completed"])
        res = datetime.timedelta(seconds=1)
        nsecs = dt.hour * 3600 + dt.minute * 60 + dt.second + dt.microsecond * 1e-6
        delta = nsecs % res.seconds
        v["date_completed"] = dt - datetime.timedelta(seconds=delta)

        for field in ["inputs", "overrides"]:
            v[field] = denormalize_node_list(v[field])
        return v
