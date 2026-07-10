"""End-to-end LangChain agent demo using wren-langchain.

Shows the minimum viable flow:
  1. Build a toolkit from a CLI-prepared Wren project.
  2. Pass its tools and system prompt straight into a LangChain agent.
  3. Ask a data question and let the agent decide which Wren tools to call.

The agent picks up the full Wren workflow from ``toolkit.system_prompt()``:
recall past pairs → fetch context → write SQL → dry_plan if complex →
execute → store the NL/SQL pair. Memory tools are auto-enabled when
``.wren/memory/`` exists; otherwise the agent runs with the 3 runtime
tools only.

Prerequisites
=============
  - A CLI-prepared Wren project. Either follow the README quickstart, or
    see ``temp-docs/v0.1-langchain-langgraph-sdk-local-testing-guide.md`` §3
    for a one-shot DuckDB-backed demo project.
  - ``langchain-openai`` installed in the active venv:
        uv pip install langchain-openai
  - ``OPENAI_API_KEY`` set in the environment.

Usage
=====
    export OPENAI_API_KEY=sk-...
    export PROJECT_PATH=/path/to/your-wren-project
    python examples/langchain_demo.py

    # Custom question:
    QUESTION="What's the gender distribution of users?" \\
        python examples/langchain_demo.py

A note on the agent factory
===========================
This demo uses ``langchain.agents.create_agent`` (the langgraph 1.0+
recommended entrypoint). The older ``langgraph.prebuilt.create_react_agent``
still works but is scheduled for removal in langgraph 2.0.
"""

from __future__ import annotations

import os
import sys
from collections import Counter

try:
    from langchain_openai import ChatOpenAI
except ImportError:
    sys.exit(
        "langchain-openai is not installed.\n"
        "Run: uv pip install langchain-openai\n"
        "(or substitute any other LangChain-compatible chat model below)."
    )

try:
    from langchain.agents import create_agent
except ImportError:
    sys.exit(
        "langchain (>= 1.0) is not installed in this venv.\n"
        "It is declared as a dependency of wren-langchain, but if you used an\n"
        "editable install before that pin was added, you need to re-sync deps:\n"
        '  uv pip install -e ".[dev]"'
    )

from wren_langchain import WrenToolkit


def main() -> None:
    project_path = os.environ.get("PROJECT_PATH")
    if not project_path:
        sys.exit(
            "PROJECT_PATH is required. Example:\n"
            "  PROJECT_PATH=/Users/you/my-wren-project python examples/langchain_demo.py"
        )
    if not os.environ.get("OPENAI_API_KEY"):
        sys.exit("OPENAI_API_KEY is required.")

    question = os.environ.get(
        "QUESTION",
        "List the models available in this project and summarize what each one tracks.",
    )

    # 1) Build the toolkit. ``from_project`` validates prerequisites eagerly:
    #    wren_project.yml + target/mdl.json must exist, profile must resolve,
    #    project-local .env is loaded automatically. Memory is auto-detected
    #    from .wren/memory/.
    toolkit = WrenToolkit.from_project(project_path)
    tools = toolkit.get_tools()
    prompt = toolkit.system_prompt()

    print(f"Project:        {project_path}")
    print(f"Memory enabled: {toolkit._memory.enabled}")
    print(f"Tools exposed:  {[t.name for t in tools]}")
    print(f"Question:       {question}")
    print()

    # 2) Build the agent. Any LangChain-compatible chat model works here.
    agent = create_agent(
        model=ChatOpenAI(model="gpt-4o", temperature=0),
        tools=tools,
        system_prompt=prompt,
    )

    # 3) Run and print the conversation. The agent decides which Wren tools
    #    to call based on the system prompt's workflow rules.
    response = agent.invoke({"messages": [{"role": "user", "content": question}]})

    bar = "=" * 64
    print(bar)
    print("Conversation")
    print(bar)

    tool_count: Counter[str] = Counter()
    for msg in response["messages"]:
        kind = type(msg).__name__
        content = (getattr(msg, "content", None) or "").strip()
        tool_calls = getattr(msg, "tool_calls", None) or []

        print(f"--- {kind} ---")
        if content:
            print(content)
        for tc in tool_calls:
            tool_count[tc["name"]] += 1
            print(f"  -> {tc['name']}({tc['args']})")
        print()

    print(bar)
    print("Tool call summary")
    print(bar)
    if tool_count:
        for name in sorted(tool_count):
            print(f"  {name:25s} called {tool_count[name]}x")
    else:
        print("  (no tool calls — the agent answered from prior knowledge only)")


if __name__ == "__main__":
    main()
