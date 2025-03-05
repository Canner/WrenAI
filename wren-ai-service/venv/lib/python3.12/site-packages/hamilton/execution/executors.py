import abc
import dataclasses
import functools
import logging
from concurrent.futures import Executor, Future, ProcessPoolExecutor, ThreadPoolExecutor
from typing import Any, Callable, Dict, List

from hamilton import node
from hamilton.execution.graph_functions import execute_subdag
from hamilton.execution.grouping import NodeGroupPurpose, TaskImplementation
from hamilton.execution.state import ExecutionState, GraphState, TaskState

logger = logging.getLogger(__name__)


@dataclasses.dataclass
class TaskFuture:
    """Simple representation of a future. TODO -- add cancel().
    This a clean wrapper over a python future, and we may end up just using that at some point."""

    get_state: Callable[[], TaskState]
    get_result: Callable[[], Any]


class TaskExecutor(abc.ABC):
    """Abstract class for a task executor. All this does is submit a task and return a future.
    It also tells us if it can do that"""

    @abc.abstractmethod
    def init(self):
        """Initializes the task executor, provisioning any necessary resources."""
        pass

    @abc.abstractmethod
    def finalize(self):
        """Tears down the task executor, freeing up any provisioned resources.
        Will be called in a finally block."""
        pass

    @abc.abstractmethod
    def submit_task(self, task: TaskImplementation) -> TaskFuture:
        """Submits a task to the executor. Returns a task ID that can be used to query the status.
        Effectively a future.

        :param task: Task implementation (bound with arguments) to submit
        :return: The future representing the task's computation.
        """
        pass

    @abc.abstractmethod
    def can_submit_task(self) -> bool:
        """Returns whether or not we can submit a task to the executor.
        For instance, if the maximum parallelism is reached, we may not be able to submit a task.

        TODO -- consider if this should be a "parallelism" value instead of a boolean, forcing
        the ExecutionState to store the state prior to executing a task.

        :return: whether or not we can submit a task.
        """
        pass


def new_callable(*args, _callable=None, **kwargs):
    return list(_callable(*args, **kwargs))


def _modify_callable(node_source: node.NodeType, callabl: Callable):
    """This is a bit of a shortcut -- we modify the callable here as
    we want to allow `Parallelizable[]` nodes to return a generator

    :param node_source:
    :param callabl:
    :return:
    """
    if node_source == node.NodeType.EXPAND:
        return functools.partial(new_callable, _callable=callabl)
    return callabl


def base_execute_task(task: TaskImplementation) -> Dict[str, Any]:
    """This is a utility function to execute a base task. In an ideal world this would be recursive,
    (as in we can use the same task execution/management system as we would otherwise)
    but for now we just call out to good old DFS. Note that this only returns the result that
    a task is required to output, and does not return anything else. It also returns
    any overrides.

    We should probably have a simple way of doing this for single-node tasks, as they're
    going to be common.

    :param task: task to execute.
    :return: a diciontary of the results of all the nodes in that task's nodes to compute.
    """
    # We do this as an edge case to force the callable to return a list if it is an expand,
    # and would normally return a generator. That said, we will likely remove this in the future --
    # its an implementation detail, and a true queuing system between nodes/controller would mean
    # we wouldn't need to do this, and instead could just use the generator aspect.
    # Furthermore, in most cases the user wouldn't be calling an expand on a "remote" node,
    # but it is a supported use-case.
    for node_ in task.nodes:
        if not getattr(node_, "callable_modified", False):
            node_._callable = _modify_callable(node_.node_role, node_.callable)
        node_.callable_modified = True
    if task.adapter.does_hook("pre_task_execute", is_async=False):
        task.adapter.call_all_lifecycle_hooks_sync(
            "pre_task_execute",
            run_id=task.run_id,
            task_id=task.task_id,
            nodes=task.nodes,
            inputs=task.dynamic_inputs,
            overrides=task.overrides,
        )
    error = None
    success = True
    results = None
    try:
        results = execute_subdag(
            nodes=task.nodes,
            inputs=task.dynamic_inputs,
            adapter=task.adapter,
            overrides={**task.dynamic_inputs, **task.overrides},
            run_id=task.run_id,
            task_id=task.task_id,
        )
    except Exception as e:
        logger.exception(task.task_id)
        error = e
        success = False
        logger.exception(
            f"Exception executing task {task.task_id}, with nodes: {[item.name for item in task.nodes]}"
        )
        raise e
    finally:
        if task.adapter.does_hook("post_task_execute", is_async=False):
            task.adapter.call_all_lifecycle_hooks_sync(
                "post_task_execute",
                run_id=task.run_id,
                task_id=task.task_id,
                nodes=task.nodes,
                results=results,
                success=success,
                error=error,
            )
    # This selection is for GC
    # We also need to get the override values
    # This way if its overridden we can ensure it gets passed to the right one
    final_retval = {
        key: value
        for key, value in results.items()
        if key in task.outputs_to_compute or key in task.overrides
    }
    return final_retval


class SynchronousLocalTaskExecutor(TaskExecutor):
    """Basic synchronous/local task executor that runs tasks
    in the same process, at submit time."""

    def submit_task(self, task: TaskImplementation) -> TaskFuture:
        """Submitting a task is literally just running it.

        :param task: Task to submit
        :return: Future associated with this task
        """
        # No error management for now
        result = base_execute_task(task)
        return TaskFuture(get_state=lambda: TaskState.SUCCESSFUL, get_result=lambda: result)

    def can_submit_task(self) -> bool:
        """We can always submit a task as the task submission is blocking!

        :return: True
        """
        return True

    def init(self):
        pass

    def finalize(self):
        pass


class TaskFutureWrappingPythonFuture(TaskFuture):
    """Wraps a python future in a TaskFuture"""

    def __init__(self, future: Future):
        self.future = future

    def get_state(self):
        """Gets the state. This is non-blocking."""

        if self.future.done():
            try:
                self.future.result()
            except Exception:
                logger.exception("Task failed")
                return TaskState.FAILED
            return TaskState.SUCCESSFUL
        else:
            return TaskState.RUNNING

    def get_result(self):
        """Gets the result. This is non-blocking.

        :return: None if there is no result, else the result
        """
        if not self.future.done():
            return None
        out = self.future.result()
        return out


class PoolExecutor(TaskExecutor, abc.ABC):
    """Base class for a pool-based executor (threadpool executor/multiprocessing executor).
    Handles common logic, stores active future, and manages max tasks.
    """

    def __init__(self, max_tasks: int):
        self.active_futures = []
        self.initialized = False
        self.pool = None
        self.max_tasks = max_tasks  # TODO -- allow infinite/no max.

    def _prune_active_futures(self):
        self.active_futures = [f for f in self.active_futures if not f.done()]

    @abc.abstractmethod
    def create_pool(self) -> Executor:
        """Creates a pool to submit tasks to.

        :return: The executor to handle all the tasks in the pool
        """
        pass

    def init(self):
        """Creates/initializes pool"""
        if not self.initialized:
            self.pool = self.create_pool()
            self.initialized = True
        else:
            raise RuntimeError("Cannot initialize an already initialized executor")

    def finalize(self):
        """Finalizes pool, freeing up resources"""
        if self.initialized:
            self.pool.shutdown()
            self.initialized = False
        else:
            raise RuntimeError("Cannot finalize an uninitialized executor")

    def submit_task(self, task: TaskImplementation) -> TaskFuture:
        """Submitting a task is literally just running it.

        :param task: Task to submit
        :return: The future associated with the task
        """
        # First submit it
        # Then we need to wrap it in a future
        future = self.pool.submit(base_execute_task, task)
        self.active_futures.append(future)
        return TaskFutureWrappingPythonFuture(future)

    def can_submit_task(self) -> bool:
        """Tells if the pool is full or not.

        :return:
        """

        self._prune_active_futures()
        return len(self.active_futures) < self.max_tasks


class MultiThreadingExecutor(PoolExecutor):
    """Basic synchronous/local task executor that runs tasks
    in the same process, at submit time."""

    def create_pool(self) -> ThreadPoolExecutor:
        return ThreadPoolExecutor(max_workers=self.max_tasks)


class MultiProcessingExecutor(PoolExecutor):
    """Basic synchronous/local task executor that runs tasks
    in the same process, at submit time. Note that this is
    not yet augmented to handle the right serialization,
    so use at your own risk. We will be fixing shortly,
    but the dask/ray parallelism and the multithreading
    parallelism executors serialize correctly."""

    def create_pool(self) -> ProcessPoolExecutor:
        return ProcessPoolExecutor(max_workers=self.max_tasks)


class ExecutionManager(abc.ABC):
    """Manages execution per task. This enables you to have different executors for different
    tasks/task types. Note that, currently, it just uses the task information, but we could
    theoretically add metadata in a task as well.
    """

    def __init__(self, executors: List[TaskExecutor]):
        """Initializes the execution manager. Note this does not start it up/claim resources --
        you need to call init() to do that.

        :param executors:
        """
        self.executors = executors

    def init(self):
        """Initializes each of the executors."""
        for executor in self.executors:
            executor.init()

    def finalize(self):
        """Finalizes each of the executors."""
        for executor in self.executors:
            executor.finalize()

    @abc.abstractmethod
    def get_executor_for_task(self, task: TaskImplementation) -> TaskExecutor:
        """Selects the executor for the task. This enables us to set the appropriate executor
        for specific tasks (so that we can run some locally, some remotely, etc...).

        Note that this is the power-user case -- in all likelihood, people will use the default
        ExecutionManager.

        :param task:  Task to choose execution manager for
        :return: The executor to use for this task
        """
        pass


class DefaultExecutionManager(ExecutionManager):
    def __init__(self, local_executor=None, remote_executor=None):
        """Instantiates a BasicExecutionManager with a local/remote executor.
        These enable us to run certain tasks locally (simple transformations, generating sets of files),
        and certain tasks remotely (processing files in large datasets, etc...)

        :param local_executor: Executor to use for running tasks locally
        :param remote_executor:  Executor to use for running tasks remotely
        """
        if local_executor is None:
            local_executor = SynchronousLocalTaskExecutor()
        if remote_executor is None:
            remote_executor = MultiProcessingExecutor(max_tasks=5)
        super().__init__([local_executor, remote_executor])
        self.local_executor = local_executor
        self.remote_executor = remote_executor

    def get_executor_for_task(self, task: TaskImplementation) -> TaskExecutor:
        """Simple implementation that returns the local executor for single task executions,

        :param task: Task to get executor for
        :return: A local task if this is a "single-node" task, a remote task otherwise
        """

        if task.purpose == NodeGroupPurpose.EXECUTE_BLOCK:
            return self.remote_executor
        return self.local_executor


def run_graph_to_completion(
    execution_state: ExecutionState,
    execution_manager: ExecutionManager,
):
    """Blocking call to run the graph until it is complete. Note that this employs a while loop.
    With the way we handle futures, we should be able to have this event-driven, allowing us
    to only query when the state is updated, and use that to trigger a new update.

    For now, the while loop is fine.

    :return: Nothing, the execution state/result cache can give us the data
    """
    task_futures = {}
    execution_manager.init()
    try:
        while not GraphState.is_terminal(execution_state.get_graph_state()):
            # get the next task from the queue
            next_task = execution_state.release_next_task()
            if next_task is not None:
                task_executor = execution_manager.get_executor_for_task(next_task)
                if task_executor.can_submit_task():
                    try:
                        submitted = task_executor.submit_task(next_task)
                    except Exception as e:
                        logger.exception(
                            f"Exception submitting task {next_task.task_id}, with nodes: "
                            f"{[item.name for item in next_task.nodes]}"
                        )
                        raise e
                    task_futures[next_task.task_id] = submitted
                else:
                    # Whoops, back on the queue
                    # We should probably wait a bit here, but for now we're going to keep
                    # burning through
                    execution_state.reject_task(task_to_reject=next_task)
            # update all the tasks in flight
            # copy so we can modify
            for task_name, task_future in task_futures.copy().items():
                state = task_future.get_state()
                result = task_future.get_result()
                execution_state.update_task_state(task_name, state, result)
                if TaskState.is_terminal(state):
                    del task_futures[task_name]
        logger.info(f"Graph is done, graph state is {execution_state.get_graph_state()}")
    finally:
        execution_manager.finalize()
