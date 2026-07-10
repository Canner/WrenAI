"""LangGraph integration: WrenToolkit tools work inside a compiled graph.

This is a structural smoke test — no real LLM. It builds a minimal
``StateGraph`` containing a ``ToolNode`` over the toolkit's tools, then
hand-constructs an ``AIMessage`` with ``tool_calls`` (the shape an LLM
would emit) and verifies the graph routes the call to our tool and
produces a ``ToolMessage`` with the envelope content.

Note on langgraph 1.0+: ``ToolNode`` can no longer be invoked standalone —
it must run inside a compiled ``StateGraph`` (or be reached via
``langchain.agents.create_agent`` which sets that up internally).
"""

from __future__ import annotations

from langchain_core.messages import AIMessage, ToolMessage
from langgraph.graph import START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode

from wren_langchain import WrenToolkit


def _build_graph(tools):
    graph = StateGraph(MessagesState)
    graph.add_node("tools", ToolNode(tools))
    graph.add_edge(START, "tools")
    return graph.compile()


def test_toolnode_invokes_wren_query_via_simulated_llm_tool_call(duckdb_project):
    """A simulated LLM tool_call against a real DuckDB project flows through ToolNode."""
    toolkit = WrenToolkit.from_project(duckdb_project)
    app = _build_graph(toolkit.get_tools())

    ai_message = AIMessage(
        content="",
        tool_calls=[
            {
                "name": "wren_query",
                "args": {"sql": "SELECT id, name FROM customers ORDER BY id"},
                "id": "call_1",
                "type": "tool_call",
            }
        ],
    )

    state = app.invoke({"messages": [ai_message]})

    tool_messages = [m for m in state["messages"] if isinstance(m, ToolMessage)]
    assert len(tool_messages) == 1
    assert tool_messages[0].tool_call_id == "call_1"
    assert "Acme" in tool_messages[0].content
    assert "Globex" in tool_messages[0].content


def test_toolnode_invokes_wren_list_models(duckdb_project):
    """No-arg tool also works through ToolNode-in-graph."""
    toolkit = WrenToolkit.from_project(duckdb_project)
    app = _build_graph(toolkit.get_tools())

    ai_message = AIMessage(
        content="",
        tool_calls=[
            {
                "name": "wren_list_models",
                "args": {},
                "id": "call_2",
                "type": "tool_call",
            }
        ],
    )

    state = app.invoke({"messages": [ai_message]})
    tool_messages = [m for m in state["messages"] if isinstance(m, ToolMessage)]
    assert len(tool_messages) == 1
    assert "customers" in tool_messages[0].content
