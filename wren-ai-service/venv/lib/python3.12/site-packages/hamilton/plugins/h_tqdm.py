from typing import Any, Collection, Dict, List, Optional

import tqdm

from hamilton import graph_types
from hamilton.lifecycle import GraphExecutionHook, NodeExecutionHook


class ProgressBar(
    GraphExecutionHook,
    NodeExecutionHook,
):
    """An adapter that uses tqdm to show progress bars for the graph execution.

    Note: you need to have tqdm installed for this to work.
    If you don't have it installed, you can install it with `pip install tqdm`
    (or `pip install sf-hamilton[tqdm]` -- use quotes if you're using zsh).

    .. code-block:: python

        from hamilton.plugins import h_tqdm

        dr = (
            driver.Builder()
            .with_config({})
            .with_modules(some_modules)
            .with_adapters(h_tqdm.ProgressBar(desc="DAG-NAME"))
            .build()
        )
        # and then when you call .execute() or .materialize() you'll get a progress bar!
    """

    def __init__(self, desc: str = "Graph execution", max_node_name_width: int = 50, **kwargs):
        """Create a new Progress Bar adapter.

        :param desc: The description to show in the progress bar. E.g. DAG Name is a good choice.
        :param kwargs: Additional kwargs to pass to TQDM. See TQDM docs for more info.
        :param node_name_target_width: the target width for the node name so that the progress bar is consistent. If this is None, it will take the longest, until it hits max_node_name_width.

        """
        self.desc = desc
        self.kwargs = kwargs
        self.node_name_target_width = (
            None  # what we target padding for -- starts at None as we adjust.
        )
        self.max_node_name_width = max_node_name_width  # what we cap the padding at.
        self.progress_bar = None

    def _get_node_name_display(self, node_name: str) -> str:
        """Gives the node name display given a max width and a node name. Max width could be DAG-dependent."""
        out = (
            node_name
            if len(node_name) <= self.node_name_target_width
            else node_name[: self.node_name_target_width - 3] + "..."
        )
        if len(out) < self.node_name_target_width:
            out += " " * (self.node_name_target_width - len(out))
        return out

    def run_before_graph_execution(
        self,
        *,
        graph: graph_types.HamiltonGraph,
        final_vars: List[str],
        inputs: Dict[str, Any],
        overrides: Dict[str, Any],
        execution_path: Collection[str],
        **future_kwargs: Any,
    ):
        total_node_to_execute = len(execution_path)
        max_node_name_length = min(
            max([len(node) for node in execution_path]), self.max_node_name_width
        )
        if self.node_name_target_width is None:
            self.node_name_target_width = max_node_name_length
        self.progress_bar = tqdm.tqdm(
            desc=self.desc, unit="funcs", total=total_node_to_execute, **self.kwargs
        )

    def run_before_node_execution(
        self,
        *,
        node_name: str,
        node_tags: Dict[str, Any],
        node_kwargs: Dict[str, Any],
        node_return_type: type,
        task_id: Optional[str],
        **future_kwargs: Any,
    ):
        name_display = self._get_node_name_display(node_name)
        self.progress_bar.set_description_str(f"{self.desc} -> {name_display}")

    def run_after_node_execution(self, **future_kwargs):
        self.progress_bar.update(1)

    def run_after_graph_execution(self, **future_kwargs):
        name_part = "Execution Complete!"
        if len(name_part) > self.node_name_target_width:
            padding = ""
        else:
            padding = " " * (self.node_name_target_width - len(name_part))
        self.progress_bar.set_description_str(f"{self.desc} -> {name_part + padding}")
        self.progress_bar.set_postfix({})
        self.progress_bar.close()
