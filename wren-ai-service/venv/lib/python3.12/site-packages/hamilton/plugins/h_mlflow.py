import logging
import pickle
import warnings
from typing import Any, Dict, List, Optional, Type, Union

import mlflow
import mlflow.data

from hamilton import graph_types
from hamilton.lifecycle import GraphConstructionHook, GraphExecutionHook, NodeExecutionHook

# silence odd ongoing MLFlow issue that spams warnings
# GitHub Issue https://github.com/mlflow/mlflow/issues/8605
warnings.filterwarnings("ignore", category=UserWarning)


FIGURE_TYPES = []
try:
    import matplotlib.figure

    FIGURE_TYPES.append(matplotlib.figure.Figure)
except ImportError:
    pass

try:
    import plotly.graph_objects

    FIGURE_TYPES.append(plotly.graph_objects.Figure)
except ImportError:
    pass


logger = logging.getLogger(__name__)


def get_path_from_metadata(metadata: dict) -> Union[str, None]:
    """Retrieve the `path` attribute from DataSaver output metadata"""
    path = None
    if "path" in metadata:
        path = metadata["path"]
    elif "file_metadata" in metadata:
        path = metadata["file_metadata"]["path"]

    return path


# NOTE `mlflow.client.MLFlowClient` is preferred to top-level `mlflow.` methods in MLFlowTracker
# because the latter relies on hard-to-debug global variables. Yet, we set an `active_run` by using
# `mlflow.start_run()` in pre_graph_execution to ensure the user-specified MLFlow code
# and MLFlow materializers log metrics and models to the same run as the MLFlowTracker
class MLFlowTracker(
    NodeExecutionHook,
    GraphExecutionHook,
    GraphConstructionHook,
):
    """Driver adapter logging Hamilton execution results to an MLFlow server."""

    def __init__(
        self,
        tracking_uri: Optional[str] = None,
        registry_uri: Optional[str] = None,
        artifact_location: Optional[str] = None,
        experiment_name: str = "Hamilton",
        experiment_tags: Optional[dict] = None,
        experiment_description: Optional[str] = None,
        run_id: Optional[str] = None,
        run_name: Optional[str] = None,
        run_tags: Optional[dict] = None,
        run_description: Optional[str] = None,
        log_system_metrics: bool = False,
    ):
        """Configure the MLFlow client and experiment for the lifetime of the tracker

        :param tracking_uri: Destination of the logged artifacts and metadata. It can be a filesystem, database, or server. [reference](https://mlflow.org/docs/latest/getting-started/tracking-server-overview/index.html)
        :param registry_uri: Destination of the registered models. By default it's the same as the tracking destination, but they can be different. [reference](https://mlflow.org/docs/latest/getting-started/registering-first-model/index.html)
        :param artifact_location: Root path on tracking server where experiment is stored
        :param experiment_name: MLFlow experiment name used to group runs.
        :param experiment_tags: Tags to query experiments programmatically (not displayed).
        :param experiment_description: Description of the experiment displayed
        :param run_id: Run id to log to an existing run (every execution logs to the same run)
        :param run_name: Run name displayed and used to query runs. You can have multiple runs with the same name but different run ids.
        :param run_tags: Tags to query runs and appears as columns in the UI for filtering and grouping. It automatically includes serializable inputs and Driver config.
        :param run_description: Description of the run displayed
        :param log_system_metrics: Log system metrics to display (requires additonal dependencies)
        """
        self.client = mlflow.client.MlflowClient(tracking_uri, registry_uri)

        # experiment setup
        experiment_tags = experiment_tags if experiment_tags else {}
        if experiment_description:
            # mlflow.note.content is the description field
            experiment_tags["mlflow.note.content"] = experiment_description

        # TODO link HamiltonTracker project and MLFlowTracker experiment
        experiment = self.client.get_experiment_by_name(experiment_name)
        if experiment:
            experiment_id = experiment.experiment_id
            # update tags and description of an existing experiment
            if experiment_tags:
                for k, v in experiment_tags.items():
                    self.client.set_experiment_tag(experiment_id, key=k, value=v)
        # create an experiment
        else:
            experiment_id = self.client.create_experiment(
                name=experiment_name,
                artifact_location=artifact_location,
                tags=experiment_tags,
            )
        self.experiment_id = experiment_id

        # run setup
        # TODO link HamiltonTracker and MLFlowTracker run ids
        self.mlflow_run_id = run_id
        self.run_name = run_name
        self.run_tags = run_tags if run_tags else {}
        if run_description:
            # mlflow.note.content is the description field
            self.run_tags["mlflow.note.content"] = run_description

        self.log_system_metrics = log_system_metrics

    def run_after_graph_construction(self, *, config: dict[str, Any], **kwargs):
        """Store the Driver config before creating the graph"""
        self.config = config

    def run_before_graph_execution(
        self,
        *,
        run_id: str,
        final_vars: List[str],
        inputs: Dict[str, Any],
        graph: graph_types.HamiltonGraph,
        **kwargs,
    ):
        """Create and start MLFlow run. Log graph version, run_id, inputs, overrides"""
        # add Hamilton metadata to run tags
        run_tags = self.run_tags
        run_tags["hamilton_run_id"] = run_id  # the Hamilton run_id
        run_tags["code_version"] = graph.version

        # create Hamilton run
        self.run = self.client.create_run(
            experiment_id=self.experiment_id,
            tags=run_tags,
            run_name=self.run_name,
        )
        self.run_id = self.run.info.run_id
        # start run to set `active_run` and allow user-defined callbacks and materializers
        # to log to the same run as the HamiltonTracker
        mlflow.start_run(
            run_id=self.run_id,
            experiment_id=self.experiment_id,
            tags=run_tags,
            log_system_metrics=self.log_system_metrics,
        )

        # log config to artifacts
        self.client.log_dict(self.run_id, self.config, "config.json")

        # log HamiltonGraph to reproduce the run
        self.graph = graph
        graph_as_json = {n.name: n.as_dict() for n in graph.nodes}
        self.client.log_dict(self.run_id, graph_as_json, "hamilton_graph.json")

        # log config and inputs as `param` which creates columns in the UI to filter runs
        # `log_param()` accepts `value: Any` and will stringify complex objects
        for value_sets in [self.config, inputs]:
            for node_name, value in value_sets.items():
                self.client.log_param(self.run_id, key=node_name, value=value)

        self.final_vars = final_vars

    # TODO log DataLoaders as MLFlow datasets
    def run_after_node_execution(
        self,
        *,
        node_name: str,
        node_return_type: Type,
        node_tags: dict,
        node_kwargs: dict,
        result: Any,
        **kwargs,
    ):
        """Log materializers and final vars as artifacts"""
        # log DataSavers as artifacts
        # TODO refactor if/else as `handle_materializers()`
        if node_tags.get("hamilton.data_saver") is True:
            # don't log mlflow materializers as artifact since they already create models
            # instead, use the Materializer metadata to add metadata to registered models
            if node_tags["hamilton.data_saver.sink"] == "mlflow":
                # skip if not registered model
                if "registered_model" not in result.keys():
                    return

                # get the registered model name (param of MLFlowModelSaver)
                model_name = result["registered_model"]["name"]
                version = result["registered_model"]["version"]
                materializer_node = self.graph[node_name]
                # get the "materialized node" defining the model
                materialized_node = self.graph[materializer_node.required_dependencies.pop()]
                # add the materialized node docstring as description
                # registered models have multiple versions
                self.client.update_registered_model(model_name, materialized_node.documentation)
                self.client.update_model_version(
                    model_name, version, materialized_node.documentation
                )

                # add node name as tag
                self.client.set_registered_model_tag(
                    model_name, key="node_name", value=materialized_node.name
                )
                self.client.set_model_version_tag(
                    model_name, version, key="node_name", value=materialized_node.name
                )

                # add origin function name as tag
                self.client.set_registered_model_tag(
                    model_name,
                    key="function_name",
                    value=materialized_node.originating_functions[0].__name__,
                )
                self.client.set_model_version_tag(
                    model_name,
                    version,
                    key="function_name",
                    value=materialized_node.originating_functions[0].__name__,
                )

                # add the materialized node @tag values as tags
                for k, v in materialized_node.tags.items():
                    # skip internal Hamilton tags
                    if "hamilton." in k:
                        continue
                    self.client.set_registered_model_tag(model_name, key=k, value=v)
                    self.client.set_model_version_tag(model_name, version, key=k, value=v)
                # TODO automatically collect model input signature; maybe simpler from user code

            # special case for matplotlib and plotly
            # log materialized figure. Allows great degree of control over rendering format
            # and also save interactive plotly visualization as HTML
            elif node_tags["hamilton.data_saver.sink"] in ["plt", "plotly"]:
                materializer_node = self.graph[node_name]
                materialized_node = self.graph[materializer_node.required_dependencies.pop()]
                figure = node_kwargs[materialized_node.name]

                path = get_path_from_metadata(result)
                if path:
                    self.client.log_figure(self.run_id, figure, path)
                else:
                    logger.warning(
                        f"Materialization result from node={node_name} has no recordable path: {result}. Materializer must have either "
                        f"'path' or 'file_metadata' keys."
                    )

            else:
                # log the materializer path as an artifact
                path = get_path_from_metadata(result)
                if path:
                    self.client.log_artifact(self.run_id, path, node_name)
                else:
                    logger.warning(
                        f"Materialization result from node={node_name} has no recordable path: {result}. Materializer must have either "
                        f"'path' or 'file_metadata' keys."
                    )
            return

        # log final_vars as artifacts
        if node_name not in self.final_vars:
            return

        # TODO refactor if/else as `handle_final_vars()`
        # log float and int as metrics
        if node_return_type in [float, int]:
            self.client.log_metric(self.run_id, key=node_name, value=float(result))

        # log str as text in .txt format
        elif isinstance(node_return_type, str):
            file_path = f"{node_name}.txt"
            with open(file_path, "w") as f:
                f.write(result)
            self.client.log_text(self.run_id, result, file_path)

        # log_dict (JSON) dictionary types; pickle if not json-serializable
        elif isinstance(node_return_type, dict):
            try:
                file_path = f"{node_name}.json"
                self.client.log_dict(self.run_id, result, file_path)
            # not json-serializable
            except TypeError:
                file_path = f"{node_name}.pickle"
                with open(file_path, "wb") as f:
                    pickle.dump(result, file=f)
                self.client.log_dict(self.run_id, result, file_path)

        # this puts less burden on users by not having to define materializers
        # for viz, but less control over rendering format
        elif node_return_type in FIGURE_TYPES:
            file_path = f"{node_name}.png"
            self.client.log_figure(self.run_id, result, file_path)

        # default to log_artifact in .pickle format
        else:
            file_path = f"{node_name}.pickle"
            with open(file_path, "wb") as f:
                pickle.dump(result, f)
            self.client.log_dict(self.run_id, result, file_path)

    def run_after_graph_execution(self, success: bool, *args, **kwargs):
        """End the MLFlow run"""
        # `status` is an enum value of mlflow.entities.RunStatus
        if success:
            self.client.set_terminated(self.run_id, status="FINISHED")
        else:
            self.client.set_terminated(self.run_id, status="FAILED")
        mlflow.end_run()

    def run_before_node_execution(self, *args, **kwargs):
        """Placeholder required to subclass NodeExecutionHook"""
