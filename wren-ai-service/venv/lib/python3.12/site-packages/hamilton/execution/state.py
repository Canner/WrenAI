import abc
import collections
import enum
import logging
from typing import Any, Dict, List, Optional

from hamilton.execution.grouping import NodeGroupPurpose, TaskImplementation, TaskSpec

logger = logging.getLogger(__name__)


class TaskState(enum.Enum):
    QUEUED = "queued"
    UNINITIALIZED = "uninitialized"
    INITIALIZED = "initialized"
    RUNNING = "running"
    SUCCESSFUL = "successful"
    FAILED = "failed"

    @staticmethod
    def is_terminal(task_state: "TaskState") -> bool:
        return task_state in [TaskState.SUCCESSFUL, TaskState.FAILED]


# TODO -- determine a better set of states for the graph
GraphState = TaskState


class ResultCache(abc.ABC):
    """Cache of intermediate results. Will likely want to add pruning to this..."""

    @abc.abstractmethod
    def write(
        self,
        results: Dict[str, Any],
        group_id: Optional[str] = None,
        spawning_task_id: Optional[str] = None,
    ):
        """Writes results to the cache. This is called after a task is run.

        :param results:  Results to write
        :param task_type: Task type to write -- this is inclucded in case a task returns generators
        """
        pass

    @abc.abstractmethod
    def read(
        self,
        keys: List[str],
        group_id: Optional[str] = None,
        spawning_task_id: Optional[str] = None,
        optional: bool = False,
    ) -> Dict[str, Any]:
        """Reads results in bulk from the cache.

        :param spawning_task_id: Task ID of the task that spawned the task
        whose results you wish to query
        :param group_id: Group ID of the task whose results you wish to query
        :param keys: Keys to access
        :param optional: If true, will allow keys not to be present
        :return: Dictionary of key -> result
        """
        pass


class DictBasedResultCache(ResultCache):
    """Cache of intermediate results. Will likely want to add pruning to this..."""

    def __init__(self, cache: Dict[str, Any]):
        self.cache = cache

    def _format_key(
        self, group_id: Optional[str], spawning_task_id: Optional[str], key: str
    ) -> str:
        return ":".join([item for item in [spawning_task_id, group_id, key] if item is not None])

    def write(
        self,
        results: Dict[str, Any],
        group_id: Optional[str] = None,
        spawning_task_id: Optional[str] = None,
    ):
        results_with_key_assigned = {
            self._format_key(group_id, spawning_task_id, key): value
            for key, value in results.items()
        }
        self.cache.update(results_with_key_assigned)

    def read(
        self,
        keys: List[str],
        group_id: Optional[str] = None,
        spawning_task_id: Optional[str] = None,
        optional: bool = False,
    ) -> Dict[str, Any]:
        """Reads results in bulk from the cache. If its optional, we don't mind if its not there.

        :param keys: Keys to read
        :param group_id: ID of the group (namespace) under which this key will be stored
        :param spawning_task_id: ID of the spawning task (other part of the namespace) under which this
        key will be stored
        :param optional: If true, we don't mind if the key is not there
        :return:  Dictionary of key -> result
        """

        out = {}
        for key in keys:
            formatted_key = self._format_key(group_id, spawning_task_id, key)
            if formatted_key not in self.cache:
                if optional:
                    continue
                else:
                    raise KeyError(f"Key {formatted_key} not found in cache")  # noqa E713
            out[key] = self.cache[formatted_key]
        return out


class ExecutionState:
    """Stores the basic execution state of a DAG. This is responsible for two things:
    1. Be the source of truth of the execution state
    2. Tell us what task to run next
    3. Prep the task for execution (give it the results it needs)
    """

    def __init__(self, tasks: List[TaskSpec], result_cache: ResultCache, run_id: str):
        """Initializes an ExecutionState to all uninitialized. TBD if we want to add in an initialization
        step that can, say, read from a db.


        :param task_graph: Graph of tasks to run.
        :param results_cache:  Cache of results
        """
        # Pool of available tasks. Note these get added dynamically as
        # tasks are run, in case we want to split out
        self.result_cache = result_cache
        self.run_id = run_id
        self.task_states = collections.defaultdict(lambda: TaskState.UNINITIALIZED)
        self.task_pool = {}
        self._initialize_task_pool(tasks)
        self.base_task_pool = {}
        self._initialize_base_task_pool(tasks)
        self.task_queue = collections.deque()
        self._initialize_task_queue()
        self.is_initialized = True
        self.base_reverse_dependencies = self.compute_reverse_dependencies(tasks)

    @staticmethod
    def compute_reverse_dependencies(tasks: List[TaskSpec]) -> Dict[str, List[TaskSpec]]:
        """Computes dependencies in reverse order, E.G. what tasks depend on this task.

        :param tasks:
        :return:
        """
        reverse_dependencies = {task.base_id: [] for task in tasks}
        for task in tasks:
            for dependency in task.base_dependencies:
                reverse_dependencies[dependency].append(task)
        return reverse_dependencies

    def _initialize_task_pool(self, tasks: List[TaskSpec]):
        """Initializes the task pool to all nodes that have no dependencies.

        :param tasks:
        :return:
        """
        for task in tasks:
            # Note that this will break with nested tasks...
            # We want to add every task that is initially spawned and "static"
            # We want to add dynamic tasks later
            if len(task.base_dependencies) == 0:
                self.realize_task(task, None, None, None)

    def _initialize_base_task_pool(self, tasks: List[TaskSpec]):
        """Initializes the base task pool to all nodes.

        :param tasks:
        :return:
        """
        for task in tasks:
            self.base_task_pool[task.base_id] = task

    def _initialize_task_queue(self):
        """Initializes the task queue to all nodes that have no dependencies.

        :param tasks:
        :return:
        """
        for task in self.task_pool.values():
            if len(task.base_dependencies) == 0:
                self.task_queue.append(task)
                self.task_states[task.task_id] = TaskState.QUEUED

    def realize_task(
        self,
        task_spec: TaskSpec,
        spawning_task: Optional[str],
        group_id: Optional[str],
        dependencies: Dict[str, List[str]] = None,
        bind: Dict[str, Any] = None,
    ):
        """Creates a task and enqueues it to the internal queue. This takes a task in "Plan" state
        (E.G. a TaskSpec), and trasnforms it into execution-ready state, freezing the dependencies.

        You can think of a TaskSpec/plan as a function (or class), and an TaskImplementation as
        an instance of that function/class.

        :param base_task:
        :return:
        """

        realized_dependencies = (
            dependencies
            if dependencies is not None
            else {task_dep: [task_dep] for task_dep in task_spec.base_dependencies}
        )
        task_implementation = TaskImplementation(
            spawning_task_base_id=spawning_task,
            base_id=task_spec.base_id,
            nodes=task_spec.nodes,
            purpose=task_spec.purpose,
            outputs_to_compute=task_spec.outputs_to_compute,
            overrides=task_spec.overrides,
            adapter=task_spec.adapter,
            base_dependencies=task_spec.base_dependencies,
            spawning_task_id=spawning_task,
            group_id=group_id,
            # TODO -- actually get these correct...
            # This just assigns the realized dependencies to be the base dependencies
            realized_dependencies=realized_dependencies,
            run_id=self.run_id,
        )
        if bind is not None:
            task_implementation = task_implementation.bind(bind)
        self.task_pool[task_implementation.task_id] = task_implementation
        self.task_states[task_implementation.task_id] = TaskState.INITIALIZED
        return task_implementation

    def realize_parameterized_group(
        self,
        spawning_task_id: str,
        parameterizations: Dict[str, Any],
        input_to_parameterize: str,
    ) -> List[TaskImplementation]:
        """Parameterizes an unordered expand group. These are tasks that are all part of the same
        group. For every result in the list, the input of the next task gets the result.

        :param task:
        :param results:
        :return:
        """
        # first we get all future nodes in the group
        out = []
        tasks_to_repeat = [
            task
            for task in self.base_task_pool.values()
            if task.spawning_task_base_id == spawning_task_id
            and not task.purpose.is_expander()
            and not task.purpose.is_gatherer()
        ]
        task_names_in_group = [task.base_id for task in tasks_to_repeat]
        # Then we parameterize them, making the following changes:
        # 1. We replace base dependencies with the actual task ids
        # 2. We replace the inputs of the first task with the results
        # 3. We replace the inputs of the collect task with the outputs of the other tasks, grouped
        # expander_node = completed_task.get_expander_node()
        # # This should be a list of all the parameterizations
        # results_to_bind = list(result_cache.read([expander_node.name]))
        # For every result in the list, we create a new set of tasks
        name_maps = {}
        # Go through every task we need to repeat
        for group_name, result in parameterizations.items():
            new_tasks = []
            # We create a new set of tasks, and add them to the task pool
            name_map = {}
            for task in tasks_to_repeat:
                # We create a new task, with the result bound to the input
                new_task = self.realize_task(
                    task, spawning_task_id, group_name, bind={input_to_parameterize: result}
                )
                # new_task = new_task.bind({expander_node.name: result})
                # should bind...
                name_map[task.base_id] = new_task.task_id
                new_tasks.append(new_task)
            for new_task in new_tasks:
                # We replace the dependencies with the new task ids
                new_task.realized_dependencies = {
                    dependency: name_map[dependency] if dependency in name_map else [dependency]
                    for dependency in new_task.base_dependencies
                }
                # We add the new tasks to the task pool
                out.append(new_task)
            name_maps[group_name] = name_map
        collector_tasks = [
            task
            for task in self.base_task_pool.values()
            if task.purpose.is_gatherer() and task.spawning_task_base_id == spawning_task_id
        ]

        # Go through every task we need to collect those
        for collector_task in collector_tasks:
            # collector_node = completed_task.get_collector_node()
            # collect_input = collector_node.collect_dependency
            # We create it with no spawning tasks as we don't want to name it differently
            # We should really give it a better unique ID? This is a little hacky
            new_task = self.realize_task(collector_task, None, None)
            new_dependencies = {}
            for dependency in new_task.base_dependencies:
                new_dependencies[dependency] = []
                if dependency in task_names_in_group:
                    for _group_name, name_map in name_maps.items():
                        new_dependencies[dependency].append(name_map[dependency])
                else:
                    new_dependencies[dependency].append(dependency)
            new_task.realized_dependencies = new_dependencies
            out.append(new_task)
        return out

    def write_task_results(self, writer: TaskImplementation, results: Dict[str, Any]):
        results_to_write = results
        if writer.purpose.is_expander():
            # In this case we need to write each result individually
            result_name_for_expansion = writer.get_expander_node().name
            result_for_expansion = list(results_to_write.pop(result_name_for_expansion))
            self.result_cache.write({result_name_for_expansion: result_for_expansion}, None, None)
        # write the rest with the appropriate namespace
        self.result_cache.write(results_to_write, writer.group_id, writer.spawning_task_id)

    def update_task_state(
        self, task_id: str, new_state: TaskState, results: Optional[Dict[str, Any]]
    ):
        """Updates the state of a task based on an external push.
        This also determines which tasks to create/enqueue next. If the node finished succesfully,
        this has two steps:

        Node Creation (turning a TaskSpec into a TaskImplementation)
        1. If its a "expand" node, we first create the children tasks, then the collect that depends
        on them
        2. Else, we create subsequent tasks (unless they are a "collect" node, in which case they
            should be created by the expand node that spawns them)

        Node Enqueuing (putting the task into the queue)
        We then enqueue all tasks that (a) depend on them and (b) only have dependencies that are
        now complete.
        :param task_id: ID of task to update state of
        :param new_state: New state to update to.
        """

        self.task_states[task_id] = new_state
        if not TaskState.is_terminal(new_state):
            return
        logger.debug(
            f"Received update for task {task_id} with state {new_state.value}, "
            f"current queue is {self._format_task_queue()}"
        )
        for item in self.task_queue:
            assert self.task_states[item.task_id] == TaskState.QUEUED, (
                f"Task {item.task_id} is in the queue but not queued, "
                f"state is {self.task_states[item.task_id].value}"
            )
        # Creating task implementations
        task_to_update = self.task_pool[task_id]
        if new_state == TaskState.SUCCESSFUL:
            self.write_task_results(task_to_update, results)
            completed_task: TaskImplementation = self.task_pool[task_id]  # First look up the task
            if completed_task.purpose == NodeGroupPurpose.EXPAND_UNORDERED:
                # In this case we need to extract all the tasks we need to spawn
                # This involves the following:
                #    1. For each node, spawn the task, and bind the result to that node
                #    2. Spawn the collect task to depend on all of them that it depends on)
                input_to_parameterize = completed_task.get_expander_node().name
                # We do realization here, which is not ideal, as it outputs a generator The task
                # executor should be able to handle this I think... Likely we want the executor
                # to be able to write its own result cache? In case it has an internal buffer?
                parameterization_results = self.result_cache.read([input_to_parameterize])[
                    input_to_parameterize
                ]
                parameterization_values = {
                    str(i): item for i, item in enumerate(parameterization_results)
                }
                logger.debug(
                    f"Completed an expand step, parameterizing: {input_to_parameterize} "
                    f"over values : {parameterization_values}"
                )
                self.realize_parameterized_group(
                    completed_task.task_id, parameterization_values, input_to_parameterize
                )
            else:
                for candidate_task in self.base_reverse_dependencies[completed_task.base_id]:
                    # This means its not spawned by another task, or a node spawning group itself
                    if (
                        candidate_task.spawning_task_base_id is None
                        or candidate_task.purpose.is_expander()
                    ):
                        # Then we need to spawn it
                        # In this case it will have no namespace/group (just standard)
                        new_task_id = candidate_task.base_id
                        if new_task_id not in self.task_pool:
                            # Then we need to create it
                            self.realize_task(candidate_task, None, None)
            # TODO -- make this more efficient
            # We need reverse dependencies, but there are ways to do this cleanly
            # For now we'll just loop through

            tasks_to_enqueue = []
            # not efficient, TODO -- use a reverse dependency map
            for _key, task in self.task_pool.items():
                if self.task_states[task.task_id] == TaskState.INITIALIZED:
                    should_launch = True
                    for _base_dep_name, realized_dep_list in task.realized_dependencies.items():
                        for dep in realized_dep_list:
                            if self.task_states[dep] != TaskState.SUCCESSFUL:
                                should_launch = False
                    if should_launch:
                        tasks_to_enqueue.append(task)
            task_names = [task.task_id for task in tasks_to_enqueue]
            if len(task_names) > 0:
                logger.info(
                    f"Enqueuing {len(task_names)} task{'s' if len(task_names) > 1 else ''}: "
                    f"{', '.join(task_names[:2] + (['...'] if len(task_names) > 2 else []))}"
                )
            for task_to_enqueue in tasks_to_enqueue:
                self.task_queue.append(task_to_enqueue)
                self.task_states[task_to_enqueue.task_id] = TaskState.QUEUED

    def _format_task_queue(self, verbose: bool = False) -> str:
        if verbose:
            return str([item.task_id for item in self.task_queue])
        state_counts = collections.Counter(
            [self.task_states[item.task_id].value for item in self.task_queue]
        )
        return str(dict(state_counts))

    def get_graph_state(self) -> GraphState:
        """Gives the state of the graph, which can be derived from the state of the tasks.

        :return: State of the graph
        """
        if not self.is_initialized:
            return GraphState.UNINITIALIZED
        elif len(self.task_states) == 0 or all(
            [state == TaskState.INITIALIZED for state in self.task_states.values()]
        ):
            return GraphState.INITIALIZED
        elif all([state == TaskState.SUCCESSFUL for state in self.task_states.values()]):
            return GraphState.SUCCESSFUL
        elif any([state == TaskState.FAILED for state in self.task_states.values()]):
            # if we want to execute until completion, then we should return RUNNING here
            # Unless they're all terminal, in which case we should return FAILED
            return GraphState.FAILED
        else:
            return GraphState.RUNNING

    def bind_task(self, task: TaskImplementation):
        required_input_vars, optional_input_vars = task.get_input_vars()
        dynamic_inputs = task.overrides.copy()
        if task.purpose.is_gatherer():
            # We need to intelligently bind the arguments from its dependencies
            collector_node = task.get_collector_node()
            collector_arg = collector_node.collect_dependency
            dynamic_inputs = {collector_arg: []}
            for dependency_base, dependencies in task.realized_dependencies.copy().items():
                # We know that if one has the collector node, they all will
                # As that's how we run it
                if len(dependencies) == 0:
                    # This is a parameterized task, so we'll just end up passing an empty array, and not computing anything from it
                    continue
                produces_collector_arg = self.task_pool[dependencies[0]].produces(collector_arg)
                if produces_collector_arg:
                    for dependency in dependencies:
                        dependent_task = self.task_pool[dependency]
                        dynamic_inputs[collector_arg].append(
                            self.result_cache.read(
                                [collector_arg],
                                dependent_task.group_id,
                                dependent_task.spawning_task_id,
                            )[collector_arg]
                        )
                    del task.realized_dependencies[dependency_base]
        # Then we go through the rest -- these just fill in the other args
        input_vars_to_read = [
            item
            for item in required_input_vars
            if item not in dynamic_inputs and item not in task.overrides
        ]
        dynamic_inputs = {**dynamic_inputs, **self.result_cache.read(input_vars_to_read)}
        dynamic_inputs = {
            **dynamic_inputs,
            **self.result_cache.read(optional_input_vars, optional=True),
        }
        return task.bind(dynamic_inputs)

    def release_next_task(self) -> Optional[TaskImplementation]:
        """Gives the next task to run, and inserts inputs it needs to run.
        Note that this can return None, which means there is nothing to run. That indicates that,
        either:

            1. The graph is done computing
            2. All tasks are currently blocked

        The caller is responsible for no longer calling this when get_graph_state() is in a
        terminal position.

        TODO -- consider finalizing (not binding) a task to save compute/external resources.

        :return: None if there is no task
        """
        if len(self.task_queue) == 0:
            return None
        return self.bind_task(self.task_queue.popleft())

    def reject_task(self, task_to_reject: TaskImplementation):
        """If the task just released is not accepted, we're just going to place
        it back on the front of the queue. We'll likely want to redo these, but
        for now this will be OK.

        :param task_to_reject: Task we got from release_next_task that we're rejecting.
        """
        self.task_queue.appendleft(task_to_reject)
