import datetime
import hashlib
import inspect
import json
import logging
import os
import string
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Optional

from hamilton import graph_types, lifecycle
from hamilton.plugins.h_experiments.cache import JsonCache

logger = logging.getLogger(__name__)


def validate_string_input(user_input):
    """Validate the experiment name will make a valid directory name"""
    allowed = set(string.ascii_letters + string.digits + "_" + "-")
    for char in user_input:
        if char not in allowed:
            raise ValueError(f"`{char}` from `{user_input}` is an invalid character.")


def _get_default_input(node) -> Any:
    """Get default input node value from originating function signature"""
    param_name = node.name
    origin_function = node.originating_functions[0]
    param = inspect.signature(origin_function).parameters[param_name]
    return None if param.default is inspect._empty else param.default


def json_encoder(obj: Any):
    """convert non JSON-serializable objects to a serializable format

    set[T] -> list[T]
    else -> dict[type: str, byte_hash: str]
    """
    if isinstance(obj, set):
        serialized = list(obj)
    else:
        obj_hash = hashlib.sha256()
        obj_hash.update(obj)
        serialized = dict(
            dtype=type(obj).__name__,
            obj_hash=obj_hash.hexdigest(),
        )
    return serialized


@dataclass
class NodeImplementation:
    name: str
    source_code: str


@dataclass
class NodeInput:
    name: str
    value: Any
    default_value: Optional[Any]


@dataclass
class NodeOverride:
    name: str
    value: Any


@dataclass
class NodeMaterializer:
    source_nodes: list[str]
    path: str
    sink: str
    data_saver: str


@dataclass
class RunMetadata:
    """Metadata about an Hamilton to store in cache"""

    experiment: str
    run_id: str
    run_dir: str
    success: bool
    date_completed: datetime.datetime
    graph_hash: str
    modules: list[str]
    config: dict
    inputs: list[NodeInput]
    overrides: list[NodeOverride]
    materialized: list[NodeMaterializer]


class ExperimentTracker(
    lifecycle.NodeExecutionHook,
    lifecycle.GraphExecutionHook,
    lifecycle.GraphConstructionHook,
):
    def __init__(self, experiment_name: str, base_directory: str = "./experiments"):
        validate_string_input(experiment_name)

        self.experiment_name = experiment_name
        self.cache = JsonCache(cache_path=base_directory)
        self.run_id = str(uuid.uuid4())

        self.init_directory = Path.cwd()
        self.run_directory = (
            Path(base_directory).resolve().joinpath(self.experiment_name, self.run_id)
        )
        self.run_directory.mkdir(exist_ok=True, parents=True)

        self.graph_hash: str = ""
        self.modules: set[str] = set()
        self.config = dict()
        self.inputs: list[NodeInput] = list()
        self.overrides: list[NodeOverride] = list()
        self.materializers: list[NodeMaterializer] = list()

    def run_after_graph_construction(self, *, config: dict[str, Any], **kwargs):
        """Store the Driver config before creating the graph"""
        self.config = config

    def run_before_graph_execution(
        self,
        *,
        graph: graph_types.HamiltonGraph,
        inputs: Dict[str, Any],
        overrides: Dict[str, Any],
        **kwargs,
    ):
        """Store execution metadata: graph hash, inputs, overrides"""
        self.graph_hash = graph.version

        for node in graph.nodes:
            if node.tags.get("module"):
                self.modules.add(node.tags["module"])

            # filter out config nodes
            elif node.is_external_input and node.originating_functions:
                self.inputs.append(
                    NodeInput(
                        name=node.name,
                        value=inputs.get(node.name),
                        default_value=_get_default_input(node),
                    )
                )

        if overrides:
            self.overrides = [NodeOverride(name=k, value=v) for k, v in overrides.items()]

    def run_before_node_execution(self, *args, node_tags: dict, **kwargs):
        """Move to run directory before executing materializer"""
        if node_tags.get("hamilton.data_saver") is True:
            os.chdir(self.run_directory)  # before materialization

    def run_after_node_execution(
        self, *, node_name: str, node_tags: dict, node_kwargs: dict, result: Any, **kwargs
    ):
        """Move back to init directory after executing materializer.
        Then, save materialization metadata
        """
        if node_tags.get("hamilton.data_saver") is True:
            if "path" in result:
                path = result["path"]
            elif "file_metadata" in result:
                path = result["file_metadata"]["path"]
            else:
                logger.warning(
                    f"Materialization result from node={node_name} has no recordable path: {result}. Materializer must have either "
                    f"'path' or 'file_metadata' keys."
                )
            self.materializers.append(
                NodeMaterializer(
                    source_nodes=list(node_kwargs.keys()),
                    path=str(Path(path).resolve()),
                    sink=node_tags["hamilton.data_saver.sink"],
                    data_saver=node_tags["hamilton.data_saver.classname"],
                )
            )
            os.chdir(self.init_directory)  # after materialization

    def run_after_graph_execution(self, *, success: bool, **kwargs):
        """Encode run metadata as JSON and store in cache"""
        run_data = dict(
            experiment=self.experiment_name,
            run_id=self.run_id,
            run_dir=str(self.run_directory),
            date_completed=datetime.datetime.now().isoformat(),
            success=success,
            graph_hash=self.graph_hash,
            modules=list(self.modules),
            config=self.config,
            inputs=[] if len(self.inputs) == 0 else [asdict(i) for i in self.inputs],
            overrides=[] if len(self.overrides) == 0 else [asdict(o) for o in self.overrides],
            materialized=[asdict(m) for m in self.materializers],
        )

        run_json_string = json.dumps(run_data, default=str, sort_keys=True)
        self.cache.write(run_json_string, self.run_id)
