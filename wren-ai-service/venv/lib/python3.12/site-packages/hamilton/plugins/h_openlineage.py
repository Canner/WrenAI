import json
import sys
import traceback
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import attr
from openlineage.client import OpenLineageClient, event_v2, facet_v2

from hamilton import graph as h_graph
from hamilton import graph_types, node
from hamilton.lifecycle import base


@attr.s
class HamiltonFacet(facet_v2.RunFacet):
    """Class for Hamilton Facet."""

    hamilton_run_id: str = attr.ib()
    graph_version: str = attr.ib()
    final_vars: List[str] = attr.ib()
    inputs: List[str] = attr.ib()
    overrides: List[str] = attr.ib()


def get_stack_trace(exception):
    # Python changed this API in 3.10
    if sys.version_info < (3, 10, 0):
        return traceback.format_exception(
            etype=type(exception), value=exception, tb=exception.__traceback__
        )

    return "".join(traceback.format_exception(exception))


def extract_schema_facet(metadata):
    """Extracts the schema facet from the metadata."""
    if "dataframe_metadata" in metadata:
        schema_datatypes = [
            facet_v2.schema_dataset.SchemaDatasetFacetFields(
                name=k,
                type=v,
            )
            for k, v in zip(
                metadata["dataframe_metadata"]["column_names"],
                metadata["dataframe_metadata"]["datatypes"],
            )
        ]
        schema_facet = facet_v2.schema_dataset.SchemaDatasetFacet(
            fields=schema_datatypes,
        )
        return schema_facet
    return None


def create_input_dataset(namespace: str, metadata: dict, node_) -> list[event_v2.InputDataset]:
    """Creates the open lineage input dataset."""
    datasource_facet = None
    storage_facet = None
    sql_facet = None
    if "file_metadata" in metadata:
        name = node_.name
        if ".loader" in name:
            name = name.split(".loader")[0]
        path = metadata["file_metadata"]["path"]
        format = path.split(".")[-1] if "." in name else "unknown"
        storage_facet = facet_v2.storage_dataset.StorageDatasetFacet(
            storageLayer="FileSystem",
            fileFormat=format,
        )
        datasource_facet = facet_v2.datasource_dataset.DatasourceDatasetFacet(
            name=name,
            uri=path,
        )
    elif "sql_metadata" in metadata:
        name = metadata["sql_metadata"]["table_name"]
        sql_facet = facet_v2.sql_job.SQLJobFacet(
            query=metadata["sql_metadata"]["query"],
        )
    else:
        name = "--UNKNOWN--"
    schema_facet = extract_schema_facet(metadata)
    inputFacets = {}
    if storage_facet:
        inputFacets["storage"] = storage_facet
    if datasource_facet:
        inputFacets["dataSource"] = datasource_facet
    if schema_facet:
        inputFacets["schema"] = schema_facet
    if len(inputFacets) == 0:
        inputFacets = None
    inputs = [event_v2.InputDataset(namespace, name, facets=inputFacets)]
    return inputs, sql_facet


def create_output_dataset(namespace: str, metadata: dict, node_) -> list[event_v2.OutputDataset]:
    """Creates the open lineage output dataset."""
    datasource_facet = None
    storage_facet = None
    if "file_metadata" in metadata:
        name = metadata["file_metadata"]["path"]
        format = name.split(".")[-1] if "." in name else "unknown"
        storage_facet = facet_v2.storage_dataset.StorageDatasetFacet(
            storageLayer="FileSystem",
            fileFormat=format,
        )
        datasource_facet = facet_v2.datasource_dataset.DatasourceDatasetFacet(
            name=node_.name,
            uri=name,
        )
    elif "sql_metadata" in metadata:
        name = metadata["sql_metadata"]["table_name"]
    else:
        name = "--UNKNOWN--"
    schema_facet = extract_schema_facet(metadata)
    outputFacets = {}
    if storage_facet:
        outputFacets["storage"] = storage_facet
    if datasource_facet:
        outputFacets["dataSource"] = datasource_facet
    if schema_facet:
        outputFacets["schema"] = schema_facet
    if len(outputFacets) == 0:
        outputFacets = None
    outputs = [event_v2.OutputDataset(namespace, name, facets=outputFacets)]
    return outputs


class OpenLineageAdapter(
    base.BasePreGraphExecute,
    base.BasePreNodeExecute,
    base.BasePostNodeExecute,
    base.BasePostGraphExecute,
):
    """
    This adapter emits OpenLineage events.

    .. code-block:: python

        # create the openlineage client
        from openlineage.client import OpenLineageClient

        # write to file
        from openlineage.client.transport.file import FileConfig, FileTransport
        file_config = FileConfig(
            log_file_path="/path/to/your/file",
            append=False,
        )
        client = OpenLineageClient(transport=FileTransport(file_config))

        # write to HTTP, e.g. marquez
        client = OpenLineageClient(url="http://localhost:5000")

        # create the adapter
        adapter = OpenLineageAdapter(client, "my_namespace", "my_job_name")

        # add to Hamilton
        # import your pipeline code
        dr = driver.Builder().with_modules(YOUR_MODULES).with_adapters(adapter).build()
        # execute as normal -- and openlineage events will be emitted
        dr.execute(...)

    Note for data lineage to be emitted, you must use the "materializer" abstraction to provide
    metadata. See https://hamilton.dagworks.io/en/latest/concepts/materialization/.
    This can be done via the `@datasaver()` and `@dataloader()` decorators, or
    using the `@load_from` or `@save_to` decorators, as well as passing in data savers
    and data loaders via `.with_materializers()` on the Driver Builder, or via `.materialize()`
    on the driver object.
    """

    def __init__(self, client: OpenLineageClient, namespace: str, job_name: str):
        """Constructor. You pass in the OLClient.

        :param self:
        :param client:
        :param namespace:
        :param job_name:
        :return:
        """
        # self.transport = transport
        self.client = client
        self.namespace = namespace
        self.job_name = job_name

    def pre_graph_execute(
        self,
        run_id: str,
        graph: h_graph.FunctionGraph,
        final_vars: List[str],
        inputs: Dict[str, Any],
        overrides: Dict[str, Any],
    ):
        """
        Emits a Run START event.
        Emits a Job Event with the sourceCode Facet for the entire DAG as the job.

        :param run_id:
        :param graph:
        :param final_vars:
        :param inputs:
        :param overrides:
        :return:
        """
        exportable_graph = graph_types.HamiltonGraph.from_graph(graph)
        graph_version = exportable_graph.version
        node_dict = [n.as_dict() for n in exportable_graph.nodes]
        job = event_v2.Job(
            namespace=self.namespace,
            name=self.job_name,
            facets={
                "sourceCode": facet_v2.source_code_job.SourceCodeJobFacet(
                    language="python",
                    sourceCode=json.dumps(node_dict),
                ),
                "jobType": facet_v2.job_type_job.JobTypeJobFacet(
                    processingType="BATCH",
                    integration="Hamilton",
                    jobType="DAG",
                ),
            },
        )
        run = event_v2.Run(
            runId=run_id,
            facets={
                "hamilton": HamiltonFacet(
                    hamilton_run_id=run_id,
                    graph_version=graph_version,
                    final_vars=final_vars,
                    inputs=list(inputs.keys()) if inputs else [],
                    overrides=list(overrides.keys()) if overrides else [],
                )
            },
        )
        run_event = event_v2.RunEvent(
            eventType=event_v2.RunState.START,
            eventTime=datetime.now(timezone.utc).isoformat(),
            run=run,
            job=job,
        )
        self.client.emit(run_event)

    def pre_node_execute(
        self, run_id: str, node_: node.Node, kwargs: Dict[str, Any], task_id: Optional[str] = None
    ):
        """No event emitted."""
        pass

    def post_node_execute(
        self,
        run_id: str,
        node_: node.Node,
        kwargs: Dict[str, Any],
        success: bool,
        error: Optional[Exception],
        result: Optional[Any],
        task_id: Optional[str] = None,
    ):
        """
        Run Event: will emit a RUNNING event with updates on input/outputs.

        A Job Event will be emitted for graph execution, and additional SQLJob facet if data was loaded
        from a SQL source.

        A Dataset Event will be emitted if a dataloader or datasaver was used:

           - input data set if loader
           - output data set if saver
           - appropriate facets will be added to the dataset where it makes sense.

        TODO: attach statistics facets

        :param run_id:
        :param node_:
        :param kwargs:
        :param success:
        :param error:
        :param result:
        :param task_id:
        :return:
        """
        if not success:
            # do not emit anything
            return
        metadata = {}
        saved_or_loaded = ""
        if node_.tags.get("hamilton.data_saver") is True and isinstance(result, dict):
            metadata = result
            saved_or_loaded = "saved"
        elif (
            node_.tags.get("hamilton.data_loader") is True
            and node_.tags.get("hamilton.data_loader.has_metadata") is True
            and isinstance(result, tuple)
            and len(result) == 2
            and isinstance(result[1], dict)
        ):
            metadata = result[1]
            saved_or_loaded = "loaded"
        if not metadata:
            # no metadata to emit
            return

        inputs = []
        outputs = []
        sql_facet = None
        if saved_or_loaded == "loaded":
            inputs, sql_facet = create_input_dataset(self.namespace, metadata, node_)
        else:
            outputs = create_output_dataset(self.namespace, metadata, node_)

        run = event_v2.Run(
            runId=run_id,
        )
        job_facets = {}
        if sql_facet:
            job_facets["sql"] = sql_facet
        job = event_v2.Job(namespace=self.namespace, name=self.job_name, facets=job_facets)
        run_event = event_v2.RunEvent(
            eventType=event_v2.RunState.RUNNING,
            eventTime=datetime.now(timezone.utc).isoformat(),
            run=run,
            job=job,
            inputs=inputs,
            outputs=outputs,
        )
        self.client.emit(run_event)

    def post_graph_execute(
        self,
        run_id: str,
        graph: h_graph.FunctionGraph,
        success: bool,
        error: Optional[Exception],
        results: Optional[Dict[str, Any]],
    ):
        """Emits a Run COMPLETE or FAIL event.

        :param run_id:
        :param graph:
        :param success:
        :param error:
        :param results:
        :return:
        """
        job = event_v2.Job(
            namespace=self.namespace,
            name=self.job_name,
        )
        facets = {}
        run_event_type = event_v2.RunState.COMPLETE
        if error:
            run_event_type = event_v2.RunState.FAIL
            error_message = str(error)
            facets = {
                "errorMessage": facet_v2.error_message_run.ErrorMessageRunFacet(
                    message=error_message,
                    stackTrace=get_stack_trace(error),
                    programmingLanguage="python",
                )
            }
        run = event_v2.Run(runId=run_id, facets=facets)

        run_event = event_v2.RunEvent(
            eventType=run_event_type,
            eventTime=datetime.now(timezone.utc).isoformat(),
            run=run,
            job=job,
        )
        self.client.emit(run_event)


# if __name__ == "__main__":
#     from openlineage.client import OpenLineageClient
#     from openlineage.client.transport.file import FileConfig, FileTransport
#
#     file_config = FileConfig(
#         log_file_path="/path/to/your/file",
#         append=False,
#     )
#
#     client = OpenLineageClient(transport=FileTransport(file_config))
#     namespace = "my_namespace"
#     db_datset = Dataset(namespace, name, facets)
