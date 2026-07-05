---
sidebar_label: Serve an MCP server
---

# Serve an MCP server

`wren serve mcp` exposes a Wren project's query, schema, and business-knowledge
tools to any MCP client — Claude Desktop, Claude Code, Cursor, or another IDE.
The server runs in-process against the compiled MDL and the active connection
profile: no ibis-server, no separate backend, just the CLI you already have
installed.

## Before you start

- A Wren project with `target/mdl.json` built (`wren context build`).
- A connection profile bound (`wren profile add` / `wren context set-profile`),
  unless you only need the schema/transpile tools (`--no-connect`).
- The `mcp` extra: `pip install 'wrenai[mcp]'` (working from a `core/wren`
  checkout: `just install-extra mcp`).

## Start the server

```bash
cd my-project
wren serve mcp
```

Runs `stdio` by default — the mode a client that spawns `wren` as a child
process expects. Use `--transport http` for a local server other tools
connect to instead:

```bash
wren serve mcp --transport http --host 127.0.0.1 --port 8080
```

Add `--allow-write` to enable `store_query` (off by default — the server is
otherwise read-only), or `--no-connect` for a transpile-only server that never
touches the database (`run_sql` / `dry_run` / `query_cube` are disabled).

## Wire it into a client

Most desktop/IDE MCP clients take a JSON config that spawns the server over
stdio:

```json
{
  "mcpServers": {
    "wren": {
      "command": "wren",
      "args": ["serve", "mcp"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

`cwd` must be inside the project (or pass `--project /path/to/project` in
`args` instead). Restart the client after adding the config.

For a server other machines/processes connect to, run
`wren serve mcp --transport http --port 8080` and point the client at the
Streamable HTTP endpoint on that host/port instead of spawning a process.
HTTP binds to `127.0.0.1` by default and ships no bearer-token auth in this
version — keep it local.

## What the client gets

- **Query tools** — `run_sql`, `dry_run`, `dry_plan`, `query_cube`
- **Schema tools** — `get_mdl`, `list_models`, `describe_model`,
  `get_data_source`, `list_cubes`, `describe_cube`, `list_functions`
- **Knowledge tools** — `get_instructions`, `recall_queries`, `get_context`,
  `describe_schema`, `list_stored_queries`, `list_knowledge`, and
  (behind `--allow-write`) `store_query`
- **Resources** — `wren://mdl`, `wren://instructions`, `wren://project`,
  `wren://agents`, `wren://knowledge/{path}`
- **Prompt** — `wren_workflow`, a ready-made SOP for schema → instructions →
  recall → dry-run → run → store

`get_context` and `list_stored_queries` prefer the `memory` extra (embedding
search, full query history) but fall back to dependency-free reads over
`knowledge/` when it isn't installed — the same degradation `recall_queries`
already does. `describe_schema` needs no extra at all: it's the plain-text
counterpart to `get_mdl`, sized for pasting into an LLM prompt.

See the [CLI reference](../reference/cli.md#wren-serve--mcp-server) for every
flag and tool signature.

## Security notes

Connection credentials are resolved from the profile once at startup and stay
server-side — only SQL text, query results, and metadata cross the MCP
boundary. The server never auto-builds the MDL; if project source files are
newer than `target/mdl.json` it logs a staleness warning but keeps serving the
existing manifest, so re-run `wren context build` after model changes.

The `wren://knowledge/{path}` resource resolves the requested path and
verifies it stays inside the project's `knowledge/` directory before reading
it — a path that would escape (e.g. `../wren_project.yml`) is rejected.

## See also

- [CLI reference — `wren serve`](../reference/cli.md#wren-serve--mcp-server)
- [Manage project](manage_project.md) — project layout and `target/mdl.json`
- [Connect your database](connect.md) — set up the profile the server queries through
