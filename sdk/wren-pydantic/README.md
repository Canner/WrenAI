# wren-pydantic

Pydantic AI integration for [Wren AI Core](https://github.com/Canner/WrenAI).

Attach a CLI-prepared Wren project to a Pydantic AI agent in three lines:

```python
from wren_pydantic import WrenToolkit
from pydantic_ai import Agent

toolkit = WrenToolkit.from_project("./analytics_db")
agent = Agent(
    "openai:gpt-4o",
    instructions=toolkit.instructions(),
    toolsets=[toolkit.toolset()],
)
result = agent.run_sync("How many enterprise customers do we have?")
print(result.output)
```

> ⚠️ **Wren CLI required first.** This SDK is a thin adapter over a Wren
> project that the `wren` CLI has already prepared (profile + MDL + optional
> memory index). Follow the [install guide](https://docs.getwren.ai/oss/get_started/installation)
> before installing this package.

Runnable demos:

- [`examples/pydantic_ai_demo.py`](./examples/pydantic_ai_demo.py) — sync
  3-line quickstart. Smallest amount of code; recommended starting point.
- [`examples/pydantic_ai_structured_demo.py`](./examples/pydantic_ai_structured_demo.py) —
  same shape with `output_type=` for structured / validated agent output.

## Prerequisites

This package assumes you have already used the Wren CLI to prepare a project:

```bash
wren profile add my_project --datasource duckdb   # or mysql, postgres, ...
wren context init
wren context set-profile my_project               # binds profile to project
wren context build                                # produces target/mdl.json
wren memory index                                 # optional but recommended
```

If you haven't installed the CLI yet, install `wren-engine` first:

```bash
pip install "wren-engine[memory,postgres]"
```

## Installation

`wren-pydantic` exposes datasource and memory extras that pass through to the
matching `wren-engine` extras, so you only have to install once:

```bash
# Match the datasource your wren_project.yml uses (DuckDB needs no extra):
pip install "wren-pydantic[mysql]"
pip install "wren-pydantic[postgres,memory]"
pip install "wren-pydantic[bigquery,memory]"

# Available datasource extras: postgres, mysql, bigquery, snowflake,
# clickhouse, trino, mssql, databricks, redshift, spark, athena, oracle.

# `memory` extra enables the three memory tools (wren_fetch_context,
# wren_recall_queries, wren_store_query). Without it the toolkit exposes
# only the three runtime tools.

# Install everything for experimentation:
pip install "wren-pydantic[all,memory]"
```

If `wren-engine` is already installed (e.g. you use the CLI), the bare
`pip install wren-pydantic` is enough — your existing extras carry over.

## What you get

`WrenToolkit.from_project(path)` exposes:

- **6 LLM-facing tools** (3 runtime + 3 memory when `.wren/memory/` exists):
  - `wren_query` — execute SQL through Wren's semantic layer, returns
    a `WrenQueryResult` (typed Pydantic model)
  - `wren_dry_plan` — plan SQL without execution; verifies it targets MDL
    models correctly
  - `wren_list_models` — list project models with column counts and
    descriptions
  - `wren_fetch_context` — retrieve schema/business context for a question
  - `wren_recall_queries` — surface similar past NL→SQL pairs as few-shot
    examples
  - `wren_store_query` — persist a confirmed NL→SQL pair for future recall
    (`retries=0` — write failures don't loop)
- **Direct Python API** (sync; no async wrappers — see `docs/core/sdk/pydantic.md`
  for why):
  ```python
  toolkit.query("SELECT ...")              # → pyarrow.Table
  toolkit.dry_plan("SELECT ...")            # → str (target-dialect SQL)
  toolkit.dry_run("SELECT ...")             # → None (validates without exec)
  toolkit.memory.fetch("revenue trends")
  toolkit.memory.recall("top customers")
  toolkit.memory.store(nl="...", sql="...", tags=["..."])
  ```
- **`toolkit.instructions()`** — Pydantic-AI-aware instructions string
  that adapts to enabled tools and includes your project's
  `instructions.md` when present.

Errors from the engine are converted into Pydantic AI's `ModelRetry`
with phase-aware framing — the agent can self-correct on SQL or
metadata errors. Infrastructure errors (connection failures, missing
DuckDB files) propagate as `WrenError` for outer code to handle.

## Configuration

```python
WrenToolkit.from_project(
    path,                # required — path to your prepared Wren project
    profile="prod",      # optional — picks a named profile (default: active)
)

toolkit.toolset(
    include_memory_write=True,   # set False to keep memory read-only
    takes_ctx=False,             # set True if mixing with deps_type= tools
)

toolkit.instructions(toolset=toolset)  # pass same toolset for prompt sync
```

Memory is **auto-detected** from the project: present `<path>/.wren/memory/`
exposes the 3 memory tools alongside the 3 runtime tools; absent → only the
runtime tools. To enable, run `wren memory index` from the project root; to
disable, delete the directory. There is no override kwarg.

`include_memory_write=False` removes `wren_store_query` from the toolset
while keeping `wren_fetch_context` and `wren_recall_queries`. Use this for
shared / curated memory stores.

`takes_ctx=True` exposes `ctx: RunContext` as the first parameter of every
tool. Use this when mixing wren tools with your own `deps_type=`-typed
tools in the same agent. The context is ignored internally — the toolkit
already captures its own state.

## Compatibility matrix

| `wren-pydantic` | `wren-engine` | `pydantic-ai` |
|---|---|---|
| 0.1.x | >= 0.5.0 | >= 1.0, < 2.0 |

## Known limitations (v0.1)

- **Sync direct API only.** `aquery` / `adry_plan` etc. are not provided —
  Pydantic AI auto-bridges sync tools to its async run loop, and the
  underlying `WrenEngine` is sync I/O so an async wrapper would be fake-async
  with no real concurrency benefit. Revisit when Core ships an async-native
  engine.
- **One toolkit per agent.** If you need to query multiple Wren projects,
  build separate toolkits + agents and federate in Python.
- **Memory is auto-detected** from `.wren/memory/` and there is no kwarg to
  override. To enable, run `wren memory index`; to disable, delete the
  directory.
- **No hot reload mechanism.** `target/mdl.json` is re-read on every tool
  call so `wren context build` updates are picked up automatically. Profile
  changes require constructing a new toolkit.
- **Don't run `wren memory index` while an agent is using the same project.**
  The index operation drops and recreates the LanceDB schema table;
  concurrent reads may transiently fail.

## License

Apache License 2.0. See [LICENSE](./LICENSE) for the full text.

The names "Wren", "WrenAI", and the project's logos are trademarks of
Canner, Inc. and are not licensed under Apache 2.0; their use is governed
separately.
