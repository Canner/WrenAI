from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any, Callable, Dict, List, Type

from hamilton import lifecycle, node
from hamilton.lifecycle import base


def _new_fn(fn: Callable, **fn_kwargs) -> Any:
    """Function that runs in the thread.

    It can recursively check for Futures because we don't have to worry about
    process serialization.
    :param fn: Function to run
    :param fn_kwargs: Keyword arguments to pass to the function
    """
    for k, v in fn_kwargs.items():
        if isinstance(v, Future):
            while isinstance(v, Future):
                v = v.result()  # this blocks until the future is resolved
            fn_kwargs[k] = v
    # execute the function once all the futures are resolved
    return fn(**fn_kwargs)


class FutureAdapter(base.BaseDoRemoteExecute, lifecycle.ResultBuilder):
    """Adapter that lazily submits each function for execution to a ThreadpoolExecutor.

    This adapter has similar behavior to the async Hamilton driver which allows for parallel execution of functions.

    This adapter works because we don't have to worry about object serialization.

    Caveats:
    - DAGs with lots of CPU intense functions will limit usefulness of this adapter, unless they release the GIL.
    - DAGs with lots of I/O bound work will benefit from this adapter, e.g. making API calls.
    - The max parallelism is limited by the number of threads in the ThreadPoolExecutor.

    Unsupported behavior:
    - The FutureAdapter does not support DAGs with Parallelizable & Collect functions. This is due to laziness
    rather than anything inherently technical. If you'd like this feature, please open an issue on the Hamilton
    repository.

    """

    def __init__(
        self,
        max_workers: int = None,
        thread_name_prefix: str = "",
        result_builder: lifecycle.ResultBuilder = None,
    ):
        """Constructor.
        :param max_workers: The maximum number of threads that can be used to execute the given calls.
        :param thread_name_prefix: An optional name prefix to give our threads.
        :param result_builder: Optional. Result builder to use for building the result.
        """
        self.executor = ThreadPoolExecutor(
            max_workers=max_workers, thread_name_prefix=thread_name_prefix
        )
        self.result_builder = result_builder

    def input_types(self) -> List[Type[Type]]:
        """Gives the applicable types to this result builder.
        This is optional for backwards compatibility, but is recommended.

        :return: A list of types that this can apply to.
        """
        # since this wraps a potential result builder, expose the input types of the wrapped
        # result builder doesn't make sense.
        return [Any]

    def output_type(self) -> Type:
        """Returns the output type of this result builder
        :return: the type that this creates
        """
        if self.result_builder:
            return self.result_builder.output_type()
        return Any

    def do_remote_execute(
        self,
        *,
        execute_lifecycle_for_node: Callable,
        node: node.Node,
        **kwargs: Dict[str, Any],
    ) -> Any:
        """Function that submits the passed in function to the ThreadPoolExecutor to be executed
        after wrapping it with the _new_fn function.

        :param node: Node that is being executed
        :param execute_lifecycle_for_node: Function executing lifecycle_hooks and lifecycle_methods
        :param kwargs: Keyword arguments that are being passed into the function
        """
        return self.executor.submit(_new_fn, execute_lifecycle_for_node, **kwargs)

    def build_result(self, **outputs: Any) -> Any:
        """Given a set of outputs, build the result.

        This function will block until all futures are resolved.

        :param outputs: the outputs from the execution of the graph.
        :return: the result of the execution of the graph.
        """
        for k, v in outputs.items():
            if isinstance(v, Future):
                outputs[k] = v.result()
        if self.result_builder:
            return self.result_builder.build_result(**outputs)
        return outputs
