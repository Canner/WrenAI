import json
import logging
from contextvars import ContextVar
from typing import Any, Collection, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


try:
    from opentelemetry import context, trace
    from opentelemetry.sdk.trace import Span
except ImportError as e:
    raise ImportError(
        "Failed to import `opentelemetry` "
        "Use `pip install sf-hamilton[opentelemetry]` to install "
        "dependencies for the `h_opentelemetry` plugin."
    ) from e

from hamilton.graph_types import HamiltonGraph, HamiltonNode
from hamilton.lifecycle import GraphExecutionHook, NodeExecutionHook, TaskExecutionHook

# We have to keep track of tokens for the span
# As OpenTel has some weird behavior around context managers, we have to account for the latest ones we started
# This way we can pop one off and know where to set the current one (as the parent, when the next one ends)
token_stack = ContextVar[Optional[List[Tuple[object, Span]]]]("token_stack", default=None)


def _exit_span(exc: Optional[Exception] = None):
    """Ditto with _enter_span, but for exiting the span. Pops the token off the stack and detaches the context."""
    stack = token_stack.get()[:]
    token, span = stack.pop()
    token_stack.set(stack)
    context.detach(token)
    if exc:
        span.set_status(trace.Status(trace.StatusCode.ERROR, str(exc)))
    else:
        span.set_status(trace.Status(trace.StatusCode.OK))
    span.end()
    return span


def _enter_span(name: str, tracer: trace.Tracer):
    """Utility function to enter a span. Starts, sets the current context, and adds it to the token stack.

    See this for some background on why start_span doesn't really work. We could use start_as_current_span,
    but this is a bit more explicit.
    """
    span = tracer.start_span(
        name=name,
        record_exception=False,  # we'll handle this ourselves
        set_status_on_exception=False,
    )
    ctx = trace.set_span_in_context(span)
    token = context.attach(ctx)
    stack = (token_stack.get() or [])[:]
    stack.append((token, span))
    token_stack.set(stack)
    return span


class OpenTelemetryTracer(NodeExecutionHook, GraphExecutionHook, TaskExecutionHook):
    """Adapter to log Hamilton execution to OpenTelemetry. At a high level, this works as follows:
    1. On any of the start/pre hooks (run_before_graph, run_before_node, run_before_task), we start a new span
    2. On any of the post ones we exit the span, accounting for the error (setting it if needed)

    This works by logging to OpenTelemetry, and setting the span processor to be the right one (that knows about the tracker).
    """

    def __init__(self, tracer_name: Optional[str] = None, tracer: Optional[trace.Tracer] = None):
        if tracer_name and tracer:
            raise ValueError(
                f"Only pass in one of tracer_name or tracer, not both, got: tracer_name={tracer_name} and tracer={tracer}"
            )

        if tracer:
            self.tracer = tracer
        elif tracer_name:
            self.tracer = trace.get_tracer(tracer_name)
        else:
            self.tracer = trace.get_tracer(__name__)

        self.graph = None

    def run_before_graph_execution(
        self,
        *,
        graph: HamiltonGraph,
        final_vars: List[str],
        inputs: dict,
        overrides: dict,
        execution_path: Collection[str],
        run_id: str,
        **kwargs,
    ):
        self.graph = graph

        attributes = {
            "graph_version": graph.version,
            "final_vars": final_vars,
            "inputs": list(inputs.keys()) if inputs else [],
            "overrides": list(overrides.keys()) if overrides else [],
            "execution_path": list(execution_path),
        }

        graph_span = _enter_span(run_id, self.tracer)
        graph_span.set_attributes(attributes)

    def run_before_node_execution(
        self,
        *,
        node_name: str,
        node_tags: dict,
        node_return_type: type,
        **kwargs: Any,
    ):
        attributes = {
            "type": str(node_return_type),
            "node_version": self.graph[node_name].version,
            "tags": json.dumps(node_tags),
        }

        node_span = _enter_span(node_name, self.tracer)
        node_span.set_attributes(attributes)

    def run_before_task_execution(
        self,
        *,
        task_id: str,
        nodes: List[HamiltonNode],
        inputs: Dict[str, Any],
        overrides: Dict[str, Any],
        **kwargs,
    ):
        attributes = {
            "nodes": [n.name for n in nodes],
            "inputs": list(inputs.keys()) if inputs else [],
            "overrides": list(overrides.keys()) if overrides else [],
        }
        task_span = _enter_span(task_id, self.tracer)
        task_span.set_attributes(attributes)

    def run_after_task_execution(self, *, error: Optional[Exception], **kwargs):
        _exit_span(error)

    def run_after_node_execution(self, *, error: Optional[Exception], **kwargs):
        _exit_span(error)

    def run_after_graph_execution(self, *, error: Optional[Exception], **kwargs):
        _exit_span(error)
