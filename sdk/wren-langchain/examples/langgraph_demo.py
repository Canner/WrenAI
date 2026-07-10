"""LangGraph demo: build a Wren-aware ReAct agent from primitives.

The companion ``langchain_demo.py`` calls ``langchain.agents.create_agent``,
which is the high-level factory that hides the agent loop. This demo
hand-builds the same loop with LangGraph primitives so you can customize:

  - Routing — decide between tool execution and finishing per turn.
  - State — add fields beyond messages (e.g. ``user_id``, ``session_meta``).
  - Streaming — yield intermediate node outputs to a UI as the agent works.
  - Per-turn middleware — logging, telemetry, retry, approval gates.

The graph topology is the standard ReAct pattern::

         ┌──────────┐
         │  START   │
         └────┬─────┘
              ▼
         ┌──────────┐         ┌────────────┐
         │  agent   │ ──────► │  has tool  │ ── no ──► END
         │ (model)  │         │  calls?    │
         └──────────┘         └─────┬──────┘
              ▲                     │ yes
              │                     ▼
              │              ┌──────────────┐
              └──────────────│    tools     │
                             │  (ToolNode)  │
                             └──────────────┘

Prereqs match ``langchain_demo.py``: a CLI-prepared Wren project, OPENAI_API_KEY,
and ``langchain-openai`` installed.

Usage
=====
    export OPENAI_API_KEY=sk-...
    export PROJECT_PATH=/path/to/your-wren-project
    python examples/langgraph_demo.py

    # Custom question + streaming view:
    QUESTION="..." STREAM=1 python examples/langgraph_demo.py
"""

from __future__ import annotations

import os
import sys
from collections import Counter
from typing import Annotated, TypedDict

try:
    from langchain_openai import ChatOpenAI
except ImportError:
    sys.exit("langchain-openai is not installed.\nRun: uv pip install langchain-openai")

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode

from wren_langchain import WrenToolkit


class AgentState(TypedDict):
    """Conversation state. ``add_messages`` appends new messages instead of
    replacing the list — this is what makes the ReAct loop accumulate context.

    Add your own keys here (e.g. ``user_id: str``, ``trace: list[dict]``,
    ``approved: bool``) when you need state beyond the conversation history.
    """

    messages: Annotated[list[BaseMessage], add_messages]


def build_app(toolkit: WrenToolkit, model_name: str = "gpt-4o"):
    """Compile a ReAct graph that uses Wren tools."""
    tools = toolkit.get_tools()
    system_prompt = toolkit.system_prompt()
    model_with_tools = ChatOpenAI(model=model_name, temperature=0).bind_tools(tools)

    def agent_node(state: AgentState) -> dict:
        """Call the model. Inject the Wren system prompt only on the first turn."""
        messages = state["messages"]
        if not messages or not isinstance(messages[0], SystemMessage):
            messages = [SystemMessage(content=system_prompt), *messages]
        response = model_with_tools.invoke(messages)
        return {"messages": [response]}

    def should_continue(state: AgentState) -> str:
        """If the last AIMessage requested tool calls, run them; otherwise finish."""
        last = state["messages"][-1]
        if isinstance(last, AIMessage) and last.tool_calls:
            return "tools"
        return END

    graph = StateGraph(AgentState)
    graph.add_node("agent", agent_node)
    graph.add_node("tools", ToolNode(tools))
    graph.add_edge(START, "agent")
    graph.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
    graph.add_edge("tools", "agent")  # loop back after tool execution
    return graph.compile()


def _print_message(msg: BaseMessage) -> Counter[str]:
    """Pretty-print a single message; return a counter of any tool calls it made."""
    counts: Counter[str] = Counter()
    kind = type(msg).__name__
    content = (getattr(msg, "content", None) or "").strip()
    print(f"--- {kind} ---")
    if content:
        print(content)
    for tc in getattr(msg, "tool_calls", None) or []:
        counts[tc["name"]] += 1
        print(f"  -> {tc['name']}({tc['args']})")
    if isinstance(msg, ToolMessage):
        # ToolMessage has its own name / tool_call_id worth surfacing.
        print(f"  (tool: {msg.name}, id: {msg.tool_call_id})")
    print()
    return counts


def main() -> None:
    project_path = os.environ.get("PROJECT_PATH")
    if not project_path:
        sys.exit(
            "PROJECT_PATH is required. Example:\n"
            "  PROJECT_PATH=/Users/you/my-wren-project python examples/langgraph_demo.py"
        )
    if not os.environ.get("OPENAI_API_KEY"):
        sys.exit("OPENAI_API_KEY is required.")

    question = os.environ.get(
        "QUESTION",
        "List the models in this project and pick one to summarize.",
    )
    stream_mode = os.environ.get("STREAM") not in (None, "", "0")

    toolkit = WrenToolkit.from_project(project_path)
    print(f"Project:        {project_path}")
    print(f"Memory enabled: {toolkit._memory.enabled}")
    print(f"Tools exposed:  {[t.name for t in toolkit.get_tools()]}")
    print(f"Question:       {question}")
    print(f"Stream mode:    {stream_mode}")
    print()

    app = build_app(toolkit)
    initial_state: AgentState = {"messages": [HumanMessage(content=question)]}

    bar = "=" * 64
    print(bar)
    print("Conversation")
    print(bar)

    tool_count: Counter[str] = Counter()

    if stream_mode:
        # ``stream(..., stream_mode="updates")`` yields one dict per node
        # invocation, where the dict is ``{node_name: state_update}``. This
        # is the natural place to push events into a UI / log / telemetry.
        for event in app.stream(initial_state, stream_mode="updates"):
            for node_name, update in event.items():
                print(f"[node: {node_name}]")
                for msg in update.get("messages", []):
                    tool_count.update(_print_message(msg))
    else:
        # ``invoke`` returns the final state after the loop terminates.
        final_state = app.invoke(initial_state)
        for msg in final_state["messages"]:
            tool_count.update(_print_message(msg))

    print(bar)
    print("Tool call summary")
    print(bar)
    if tool_count:
        for name in sorted(tool_count):
            print(f"  {name:25s} called {tool_count[name]}x")
    else:
        print("  (no tool calls — model answered directly)")


if __name__ == "__main__":
    main()
