import inspect
from typing import Any, Dict, List, Optional, Tuple, Type

from kedro.pipeline.node import Node as KNode
from kedro.pipeline.pipeline import Pipeline as KPipeline

from hamilton import driver, graph
from hamilton.function_modifiers.expanders import extract_fields
from hamilton.lifecycle import base as lifecycle_base
from hamilton.node import Node as HNode


def expand_k_node(base_node: HNode, outputs: List[str]) -> List[HNode]:
    """Manually apply `@extract_fields()` on a Hamilton node.Node for a Kedro
    node that specifies >1 `outputs`.

    The number of nodes == len(outputs) + 1 because it includes the `base_node`
    """

    def _convert_output_from_tuple_to_dict(node_result: Any, node_kwargs: Dict[str, Any]):
        return {out: v for out, v in zip(outputs, node_result)}

    # NOTE isinstance(Any, type) is False for Python < 3.11
    extractor = extract_fields(fields={out: Any for out in outputs})
    func = base_node.originating_functions[0]
    if issubclass(func.__annotations__["return"], Tuple):
        base_node = base_node.transform_output(_convert_output_from_tuple_to_dict, Dict)
        func.__annotations__["return"] = Dict

    extractor.validate(func)
    return list(extractor.transform_node(base_node, {}, func))


def k_node_to_h_nodes(node: KNode) -> List[HNode]:
    """Convert a Kedro node to a list of Hamilton nodes.
    If the Kedro node specifies 1 output, generate 1 Hamilton node.
    If it generate >1 output, generate len(outputs) + 1 to include the base node + extracted fields.
    """
    # determine if more than one output
    node_names = []
    if isinstance(node.outputs, list):
        node_names.extend(node.outputs)
    elif isinstance(node.outputs, dict):
        node_names.extend(node.outputs.values())

    # determine the base node name
    if len(node_names) == 1:
        base_node_name = node_names[0]
    elif isinstance(node.outputs, str):
        base_node_name = node.outputs
    else:
        base_node_name = node.func.__name__

    func_sig = inspect.signature(node.func)
    params = func_sig.parameters.values()
    output_type = func_sig.return_annotation
    if output_type is None:
        # manually creating `hamilton.node.Node` doesn't accept `typ=None`
        output_type = Type[None]  # NoneType is introduced in Python 3.10

    base_node = HNode(
        name=base_node_name,
        typ=output_type,
        doc_string=getattr(node.func, "__doc__", ""),
        callabl=node.func,
        originating_functions=(node.func,),
    )

    # if Kedro node defines multiple outputs, use `@extract_fields()`
    if len(node_names) > 1:
        h_nodes = expand_k_node(base_node, node_names)
    else:
        h_nodes = [base_node]

    # remap the function parameters to the node `inputs` and clean Kedro `parameters` name
    new_params = {}
    for param, k_input in zip(params, node.inputs):
        if k_input.startswith("params:"):
            k_input = k_input.partition("params:")[-1]

        new_params[param.name] = k_input

    h_nodes = [n.reassign_inputs(input_names=new_params) for n in h_nodes]

    return h_nodes


def kedro_pipeline_to_driver(
    *pipelines: KPipeline,
    builder: Optional[driver.Builder] = None,
) -> driver.Driver:
    """Convert one or mode Kedro `Pipeline` to a Hamilton `Driver`.
    Pass a Hamilton `Builder` to include lifecycle adapters in your `Driver`.

    :param pipelines: one or more Kedro `Pipeline` objects
    :param builder: a Hamilton `Builder` to use when building the `Driver`
    :return: the Hamilton `Driver` built from Kedro `Pipeline` objects.

    .. code-block: python

        from hamilton import driver
        from hamilton.plugins import h_kedro

        builder = driver.Builder().with_adapters(tracker)

        dr = h_kedro.kedro_pipeline_to_driver(
            data_science.create_pipeline(),  # Kedro Pipeline
            data_processing.create_pipeline(),  # Kedro Pipeline
            builder=builder
        )
    """
    # generate nodes
    h_nodes = []
    for pipe in pipelines:
        for node in pipe.nodes:
            h_nodes.extend(k_node_to_h_nodes(node))

    # resolve dependencies
    h_nodes = graph.update_dependencies(
        {n.name: n for n in h_nodes},
        lifecycle_base.LifecycleAdapterSet(),
    )

    builder = builder if builder else driver.Builder()
    dr = builder.build()
    # inject function graph in Driver
    dr.graph = graph.FunctionGraph(
        h_nodes, config={}, adapter=lifecycle_base.LifecycleAdapterSet(*builder.adapters)
    )
    # reapply lifecycle hooks
    if dr.adapter.does_hook("post_graph_construct", is_async=False):
        dr.adapter.call_all_lifecycle_hooks_sync(
            "post_graph_construct", graph=dr.graph, modules=dr.graph_modules, config={}
        )
    return dr
