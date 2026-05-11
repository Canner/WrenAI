# wren-langchain

LangChain and LangGraph integration for Wren AI Core. Attach a CLI-prepared Wren project to your agent as a toolkit, with the semantic layer doing schema resolution, memory recall, and SQL execution.

**Use this SDK when**: you're building a LangChain or LangGraph agent that needs to answer data questions against a Wren project. For one-shot CLI use, the `wren` command is fine on its own.

---

## Prerequisites

> ⚠️ **Caution — Wren CLI required first.** This SDK is a thin adapter over a Wren project that the `wren` CLI has already prepared (profile + MDL + optional memory index). Without those, `WrenToolkit.from_project()` has nothing to attach to and will fail at construction. Follow the [install guide](https://docs.getwren.ai/oss/get_started/installation) before installing this package.

Minimum CLI bootstrap:

```bash
wren profile add my_project --datasource postgres   # or mysql, duckdb, ...
wren context init
wren context set-profile my_project                  # binds profile to project
wren context build                                   # produces target/mdl.json
wren memory index                                    # optional but recommended
```

---

## Installation

Pick the datasource extra that matches your project's `data_source`:

```bash
pip install "wren-langchain[postgres,memory]"   # or mysql, bigquery, ...
```

| Extra | Purpose |
|---|---|
| `postgres` / `mysql` / `bigquery` / `snowflake` / `clickhouse` / `trino` / `mssql` / `databricks` / `redshift` / `spark` / `athena` / `oracle` | Datasource pass-through (DuckDB needs no extra) |
| `memory` | Enables the 3 memory tools (`wren_fetch_context`, `wren_recall_queries`, `wren_store_query`) |
| `all` | All datasources at once — useful for experimentation, heavy for production |

If `wren-engine` is already installed (e.g. you use the CLI), the bare `pip install wren-langchain` is enough — your existing extras carry over.

---

## Quickstart

```python
from wren_langchain import WrenToolkit
from langchain.agents import create_agent

toolkit = WrenToolkit.from_project("<path_to_project>")

agent = create_agent(
    model="openai:gpt-4o",
    tools=toolkit.get_tools(),
    system_prompt=toolkit.system_prompt(),
)

result = agent.invoke({"messages": [
    {"role": "user", "content": "Top 5 customers by revenue last quarter?"}
]})
print(result["messages"][-1].content)
```

That's it. The toolkit reads your project's MDL, connection profile, and `instructions.md`; the system prompt teaches the agent the recommended workflow (fetch context → recall similar queries → write SQL → store the result).

---

## API Reference

### `WrenToolkit.from_project(path, *, profile=None)`

Build a toolkit from a CLI-prepared Wren project directory.

| Parameter | Type | Description |
|---|---|---|
| `path` | `str \| Path` | Project root (the directory containing `wren_project.yml`) |
| `profile` | `str \| None` | Optional profile name. Resolution order: this kwarg → `profile:` field in `wren_project.yml` → globally active profile |

Memory tools are auto-detected: present `<path>/.wren/memory/` exposes 3 memory tools alongside 3 runtime tools; absent → only runtime tools.

### `toolkit.get_tools(*, include_memory_write=True, raise_on_error=False)`

Return LangChain-compatible tools bound to this toolkit.

| Parameter | Default | Description |
|---|---|---|
| `include_memory_write` | `True` | Set `False` to expose memory as read-only (drops `wren_store_query`) |
| `raise_on_error` | `False` | Set `True` to surface exceptions to LangChain's retry logic instead of returning an error envelope |

Returns: list of 3 runtime tools + 0/2/3 memory tools depending on memory state and `include_memory_write`.

### `toolkit.system_prompt(*, tools=None)`

Wren-aware system prompt that adapts to enabled tools and includes your project's `instructions.md` when present. Pass the same `tools` list you give to `create_agent` if you customized it (e.g. `include_memory_write=False`) so the workflow drops the persistence step instead of instructing the agent to call a tool that doesn't exist.

### Tools (LLM-facing)

| Tool | Purpose |
|---|---|
| `wren_query` | Execute SQL through Wren's semantic layer; returns rows (capped at 1000) |
| `wren_dry_plan` | Plan SQL without execution; verifies it targets MDL models correctly |
| `wren_list_models` | List project models with column counts and descriptions |
| `wren_fetch_context` | Retrieve schema and business context for a natural-language question |
| `wren_recall_queries` | Surface similar past NL→SQL pairs as few-shot examples |
| `wren_store_query` | Persist a confirmed NL→SQL pair for future recall |

### Direct Python API

When you want to call Wren outside an agent loop:

```python
toolkit.query("SELECT ...")           # → pyarrow.Table
toolkit.dry_plan("SELECT ...")        # → str (target-dialect SQL)
toolkit.dry_run("SELECT ...")         # → None (validates without execution)

toolkit.memory.fetch("revenue trends")
toolkit.memory.recall("top customers", limit=3)
toolkit.memory.store(nl="...", sql="...", tags=["revenue"])
```

---

## Integration patterns

### Read-only memory (shared / curated projects)

Use `include_memory_write=False` when you want the agent to learn from past queries but not pollute the memory store:

```python
tools = toolkit.get_tools(include_memory_write=False)
agent = create_agent(
    model="openai:gpt-4o",
    tools=tools,
    system_prompt=toolkit.system_prompt(tools=tools),  # important: keep prompt in sync
)
```

Passing `tools=` to `system_prompt()` ensures the workflow drops the "store the query" step instead of instructing the agent to call a tool that no longer exists.

### LangGraph custom loop

When you need custom routing, state, or streaming, build the ReAct loop from LangGraph primitives:

```python
from langgraph.graph import StateGraph, START, END, MessagesState
from langgraph.prebuilt import ToolNode, tools_condition
from langchain.chat_models import init_chat_model

tools = toolkit.get_tools()
llm = init_chat_model("openai:gpt-4o").bind_tools(tools)

def chatbot(state: MessagesState) -> dict:
    return {"messages": [llm.invoke(state["messages"])]}

graph = StateGraph(MessagesState)
graph.add_node("chatbot", chatbot)
graph.add_node("tools", ToolNode(tools))
graph.add_edge(START, "chatbot")
graph.add_conditional_edges("chatbot", tools_condition)
graph.add_edge("tools", "chatbot")
app = graph.compile()
```

See [`examples/langgraph_demo.py`](https://github.com/Canner/WrenAI/blob/main/sdk/wren-langchain/examples/langgraph_demo.py) for a runnable version.

### Multiple projects, one program

One toolkit binds to one project. To query multiple Wren projects, build separate toolkits and use Python to coordinate between them:

```python
loans = WrenToolkit.from_project("./loans_proj")
events = WrenToolkit.from_project("./events_proj")

# Two agents, each scoped to its own project's tools / memory.
loans_agent = create_agent(model=..., tools=loans.get_tools(), system_prompt=loans.system_prompt())
events_agent = create_agent(model=..., tools=events.get_tools(), system_prompt=events.system_prompt())

# Federate in Python — pass IDs / aggregates between agents.
```

Cross-project joins must happen in Python, not in SQL — each project has its own MDL and connection.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `table 'wren.<schema>.<x>' not found` at SQL_PLANNING | Agent wrote `schema.table` instead of MDL model name | Tighten the system prompt to forbid physical names; or call `wren_list_models` first |
| Connection goes to the wrong database | Project has no `profile:` pin → falls back to global active | Run `wren context set-profile <name>` to pin the binding |
| `MissingSecretError` | `${VAR}` in profile not resolved | Fill the matching key in `<project>/.env` |
| `wren_query` returns capped row count | Hard cap at 1000 rows per tool call | Add `LIMIT` to your SQL, or use the direct API (`toolkit.query`) for larger pulls |

---

## Compatibility

| `wren-langchain` | `wren-engine` | `langchain` | `langgraph` |
|---|---|---|---|
| 0.2.x | >= 0.5.0 | >= 1.0 | >= 1.0 |

---

## Limitations

- **Synchronous tools only.** LangChain auto-bridges to a thread pool when tools run in async LangGraph; multi-tenant servers serving >32 concurrent users may exhaust the default executor.
- **One toolkit per agent.** For multiple Wren projects, build separate toolkits + agents and federate in Python.
- **No hot reload.** `target/mdl.json` is re-read per tool call so `wren context build` updates are picked up live; profile changes require constructing a new toolkit.
- **Don't run `wren memory index` while an agent is using the same project.** The index operation drops and recreates the LanceDB schema table; concurrent reads may transiently fail.
