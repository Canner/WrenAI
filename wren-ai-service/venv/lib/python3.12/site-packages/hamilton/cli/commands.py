from pathlib import Path
from typing import List, Optional

from hamilton import ad_hoc_utils, driver
from hamilton.cli import logic


def build(modules: List[Path], context_path: Optional[Path] = None):
    """Build a Hamilton driver from the passed modules, and
    load the Driver config from the context file.

    Dynamic execution is enabled by default to support dataflow
    using Parallelizable/Collect. This only matters if we are to
    execute code.
    """
    context = logic.load_context(context_path) if context_path else {}
    module_objects = [ad_hoc_utils.module_from_source(p.read_text()) for p in modules]
    return (
        driver.Builder()
        .enable_dynamic_execution(allow_experimental_mode=True)
        .with_modules(*module_objects)
        .with_config(context.get("HAMILTON_CONFIG", {}))
        .build()
    )


def diff(
    current_dr: driver.Driver,
    modules: List[Path],
    git_reference: Optional[str] = "HEAD",
    view: bool = False,
    output_file_path: Path = Path("./diff.png"),
    context_path: Optional[Path] = None,
) -> dict:
    """Get the diff of"""
    context = logic.load_context(context_path) if context_path else {}

    current_version = logic.hash_hamilton_nodes(current_dr)
    current_node_to_func = logic.map_nodes_to_functions(current_dr)

    reference_modules = logic.load_modules_from_git(modules, git_reference)
    reference_dr = (
        driver.Builder()
        .enable_dynamic_execution(allow_experimental_mode=True)
        .with_modules(*reference_modules)
        .with_config(context.get("HAMILTON_CONFIG", {}))
        .build()
    )
    reference_version = logic.hash_hamilton_nodes(reference_dr)
    reference_node_to_func = logic.map_nodes_to_functions(reference_dr)

    nodes_diff = logic.diff_versions(
        reference_map=reference_version,
        current_map=current_version,
    )

    full_diff = dict()
    for status, node_names in nodes_diff.items():
        full_diff[status] = dict()
        for node_name in node_names:
            if current_node_to_func.get(node_name):
                func_name = current_node_to_func.get(node_name)
            else:
                func_name = reference_node_to_func.get(node_name)

            full_diff[status][node_name] = func_name

    if view:
        dot = logic.visualize_diff(current_dr=current_dr, reference_dr=reference_dr, **nodes_diff)

        # simplified logic from hamilton.graph.display()
        output_format = "png"
        if output_file_path:  # infer format from path
            if output_file_path.suffix != "":
                output_format = output_file_path.suffix.partition(".")[-1]

        dot.render(output_file_path.with_suffix(""), format=output_format)

    return full_diff


def validate(dr: driver.Driver, context_path: Path) -> dict:
    """Use driver.validate_execution() with values from the context file"""
    context = logic.load_context(context_path)

    try:
        dr.validate_execution(
            final_vars=context["HAMILTON_FINAL_VARS"],
            inputs=context["HAMILTON_INPUTS"],
            overrides=context["HAMILTON_OVERRIDES"],
        )
    except ValueError as e:
        raise e

    return context


def version(dr: driver.Driver) -> dict:
    """Get the node and dataflow versions from the instantiated Driver"""
    nodes_hash = logic.hash_hamilton_nodes(dr)
    dataflow_hash = logic.hash_dataflow(nodes_hash)
    return dict(
        nodes_hash=nodes_hash,
        dataflow_hash=dataflow_hash,
    )


def view(dr: driver.Driver, output_file_path: Path = Path("dag.png")) -> None:
    """Display all functions of the instantiated Driver"""
    dr.display_all_functions(output_file_path)
