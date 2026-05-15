# SDKs & Integrations

Wren AI Core integrates with popular AI agent frameworks. Each SDK exposes a CLI-prepared Wren project to your framework as a toolkit, so your agent gets schema resolution, memory recall, and governed SQL execution without re-implementing the semantic layer.

## Available

- **[LangChain / LangGraph](./langchain.md)** — `wren-langchain` on PyPI
- **[Pydantic AI](./pydantic.md)** — `wren-pydantic` on PyPI
- **[Browser / WebAssembly](./wasm.md)** — `@wrenai/wren-core-wasm` on npm. Runs the semantic engine entirely in the browser; no server, no CLI bootstrap.

## Other access modes

If you are not using one of the supported agent frameworks, Wren AI Core is also usable directly:

- **CLI** — see [CLI Reference](../reference/cli.md)
- **Skills** — workflow guides for AI coding agents (Claude Code, Cursor, etc.); see [Skills Reference](../reference/skills.md)
- **MCP** — the skills under [`Canner/WrenAI/skills`](https://github.com/Canner/WrenAI/tree/main/skills) are MCP-compatible
