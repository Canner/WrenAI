# wren-pydantic

Pydantic AI integration for Wren AI Core. Attach a CLI-prepared Wren project to your agent as a toolkit, with the semantic layer doing schema resolution, memory recall, and SQL execution.

**Use this SDK when**: you're building a [Pydantic AI](https://ai.pydantic.dev) agent that needs to answer data questions against a Wren project. For one-shot CLI use, the `wren` command is fine on its own.

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

See [Connect Your Database](../get_started/connect.md) for the full CLI setup walkthrough including `.env` configuration and per-datasource notes.

---

## Installation

Pick the datasource extra that matches your project's `data_source`:

```bash
pip install "wren-pydantic[postgres,memory]"   # or mysql, bigquery, ...
```

| Extra | Purpose |
|---|---|
| `postgres` / `mysql` / `bigquery` / `snowflake` / `clickhouse` / `trino` / `mssql` / `databricks` / `redshift` / `spark` / `athena` / `oracle` | Datasource pass-through (DuckDB needs no extra) |
| `memory` | Enables the 3 memory tools (`wren_fetch_context`, `wren_recall_queries`, `wren_store_query`) |
| `all` | All datasources at once — useful for experimentation, heavy for production |

If `wren-engine` is already installed (e.g. you use the CLI), the bare `pip install wren-pydantic` is enough — your existing extras carry over.

---

## Quickstart

```python
from wren_pydantic import WrenToolkit
from pydantic_ai import Agent

toolkit = WrenToolkit.from_project("./analytics_db")

agent = Agent(
    "openai:gpt-4o",
    instructions=toolkit.instructions(),
    toolsets=[toolkit.toolset()],
)

result = agent.run_sync("Top 5 customers by revenue last quarter?")
print(result.output)
```

The toolkit reads your project's MDL, connection profile, and `instructions.md`; the instructions string teaches the agent the recommended workflow (recall → fetch context → write SQL → store the result).

---

## API Reference

### `WrenToolkit.from_project(path, *, profile=None)`

Build a toolkit from a CLI-prepared Wren project directory.

| Parameter | Type | Description |
|---|---|---|
| `path` | `str \| Path` | Project root (the directory containing `wren_project.yml`) |
| `profile` | `str \| None` | Optional profile name. Resolution order: this kwarg → `profile:` field in `wren_project.yml` → globally active profile |

Memory tools are auto-detected: present `<path>/.wren/memory/` exposes 3 memory tools alongside 3 runtime tools; absent → only runtime tools.

### `toolkit.toolset(*, include_memory_write=True, takes_ctx=False)`

Return a Pydantic AI `FunctionToolset` bound to this toolkit.

| Parameter | Default | Description |
|---|---|---|
| `include_memory_write` | `True` | Set `False` to expose memory as read-only (drops `wren_store_query`) |
| `takes_ctx` | `False` | Set `True` to inject `ctx: RunContext` as the first parameter of every tool — for mixing with `deps_type=`-typed tools |

Returns a `FunctionToolset` with 3 runtime tools + 0/2/3 memory tools depending on memory state and `include_memory_write`.

### `toolkit.instructions(*, toolset=None)`

Wren-aware instructions string that adapts to enabled tools and includes your project's `instructions.md` when present. Pass the same `toolset` you give to `Agent` if you customized it (e.g. `include_memory_write=False`) so the workflow drops the persistence step instead of instructing the agent to call a tool that doesn't exist.

### Tools (LLM-facing)

| Tool | Returns | Purpose |
|---|---|---|
| `wren_query` | `WrenQueryResult` | Execute SQL through Wren's semantic layer; capped at 1000 rows |
| `wren_dry_plan` | `str` | Plan SQL without execution; verifies it targets MDL models correctly |
| `wren_list_models` | `list[ModelSummary]` | List project models with column counts and descriptions |
| `wren_fetch_context` | `FetchContextResult` | Retrieve schema and business context for a natural-language question |
| `wren_recall_queries` | `list[RecalledPair]` | Surface similar past NL→SQL pairs as few-shot examples |
| `wren_store_query` | `str` | Persist a confirmed NL→SQL pair (registered with `retries=0` — write failures don't loop) |

Each tool is registered with `retries=2` so the LLM gets two chances to self-correct on SQL or metadata errors. Errors classified as infrastructure (connection failures, missing files) propagate as `WrenError` instead of becoming `ModelRetry`.

### Direct Python API

When you want to call Wren outside an agent loop:

```python
toolkit.query("SELECT ...")            # → pyarrow.Table
toolkit.dry_plan("SELECT ...")          # → str (target-dialect SQL)
toolkit.dry_run("SELECT ...")           # → None (validates without execution)

toolkit.memory.fetch("revenue trends")
toolkit.memory.recall("top customers", limit=3)
toolkit.memory.store(nl="...", sql="...", tags=["revenue"])
```

Sync only — no `aquery` / `afetch` variants. The underlying engine is sync I/O; Pydantic AI auto-bridges sync tools to its async run loop, so wrapping them in `asyncio.to_thread` would be fake-async with no real concurrency benefit. Revisit when Core ships an async-native engine.

---

## Integration patterns

### Structured output via `output_type=`

Pydantic AI's killer feature: ask the model to return its answer as a typed Pydantic instance, validated by the framework. Works out of the box with our toolset:

```python
from pydantic import BaseModel

class TopCustomers(BaseModel):
    period: str
    customers: list[str]

agent = Agent(
    "openai:gpt-4o",
    instructions=toolkit.instructions(),
    toolsets=[toolkit.toolset()],
    output_type=TopCustomers,    # ← framework validates output into this type
)
result = agent.run_sync("Top 5 customers last quarter?")
print(result.output.customers)  # already a list[str], no parsing needed
```

See [`examples/pydantic_ai_structured_demo.py`](https://github.com/Canner/WrenAI/blob/main/sdk/wren-pydantic/examples/pydantic_ai_structured_demo.py) for the runnable version.

### Read-only memory (shared / curated projects)

Use `include_memory_write=False` when the agent should learn from past queries but not pollute the memory store:

```python
toolset = toolkit.toolset(include_memory_write=False)
agent = Agent(
    "openai:gpt-4o",
    instructions=toolkit.instructions(toolset=toolset),  # keep prompt in sync
    toolsets=[toolset],
)
```

Passing `toolset=` to `instructions()` ensures the workflow drops the "store the query" step instead of instructing the agent to call a tool that no longer exists.

### Mixing with `deps_type=` tools

When you want to combine Wren tools with your own dependency-injected tools in the same agent, opt into `takes_ctx=True`:

```python
@dataclass
class MyDeps:
    api_client: ApiClient

agent = Agent(
    "openai:gpt-4o",
    deps_type=MyDeps,
    toolsets=[toolkit.toolset(takes_ctx=True)],   # ← required when deps_type is set
)

# Your own tool that uses deps:
@agent.tool
def lookup_external(ctx: RunContext[MyDeps], id: str) -> str:
    return ctx.deps.api_client.fetch(id)
```

Wren tools ignore the context internally (the toolkit captures its own state) — `takes_ctx=True` just adds the parameter so the signature is compatible with Pydantic AI's deps-typed registration.

### Multiple projects, one program

One toolkit binds to one project. To query multiple Wren projects, build separate toolkits and coordinate in Python:

```python
loans = WrenToolkit.from_project("./loans_proj")
events = WrenToolkit.from_project("./events_proj")

loans_agent = Agent(model=..., toolsets=[loans.toolset()], instructions=loans.instructions())
events_agent = Agent(model=..., toolsets=[events.toolset()], instructions=events.instructions())
```

Cross-project joins must happen in Python, not in SQL — each project has its own MDL and connection.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `table 'wren.<schema>.<x>' not found` at SQL_PLANNING | Agent wrote `schema.table` instead of MDL model name | Tighten instructions to forbid physical names; or have the agent call `wren_list_models` first |
| Connection goes to the wrong database | Project has no `profile:` pin → falls back to global active | Run `wren context set-profile <name>` to pin the binding |
| `MissingSecretError` | `${VAR}` in profile not resolved | Fill the matching key in `<project>/.env` |
| `wren_query` returns capped row count | Hard cap at 1000 rows per tool call | Add `LIMIT` to your SQL, or use the direct API (`toolkit.query`) for larger pulls |

---

## Compatibility

| `wren-pydantic` | `wren-engine` | `pydantic-ai` |
|---|---|---|
| 0.1.x | >= 0.5.0 | >= 1.0, < 2.0 |

---

## Limitations

- **Sync direct API only.** See API Reference for the rationale.
- **One toolkit per agent.** For multiple Wren projects, build separate toolkits + agents and federate in Python.
- **No hot reload.** `target/mdl.json` is re-read per tool call so `wren context build` updates are picked up live; profile changes require constructing a new toolkit.
- **Don't run `wren memory index` while an agent is using the same project.** The index operation drops and recreates the LanceDB schema table; concurrent reads may transiently fail.
