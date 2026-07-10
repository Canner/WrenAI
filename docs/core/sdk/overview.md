# SDKs & Integrations

Wren AI is agent-native: the same CLI-prepared project (MDL, `knowledge/`, memory) can be driven through several access modes. Whichever mode you pick, schema resolution, memory recall, and governed SQL execution come from the same context layer — so every agent, script, and app gets the same trusted answer.

This page helps you pick the right mode.

## Which access mode should I use?

| If you are… | Use | Package / install |
|---|---|---|
| Working with an **AI coding agent** (Claude Code, Cursor, Codex, …) | [Skills](/oss/reference/skills) — workflow guides the agent fetches from the CLI on demand | `npx skills add Canner/WrenAI` |
| Querying from the **terminal, scripts, or CI** yourself | [CLI](/oss/reference/cli) — plan, validate, execute, and manage memory directly | `wrenai` on PyPI |
| Building an agent on **LangChain / LangGraph** | [LangChain toolkit](./langchain.md) — exposes the project as agent tools | `wren-langchain` on PyPI |
| Building an agent on **Pydantic AI** | [Pydantic AI toolkit](./pydantic.md) — exposes the project as agent tools | `wren-pydantic` on PyPI |
| Embedding MDL-aware queries or **GenBI dashboards in the browser** | [WebAssembly engine](./wasm.md) — runs fully client-side; no server, no CLI bootstrap | `@wrenai/wren-core-wasm` on npm |

A few rules of thumb:

- **Start with skills + CLI.** If your day-to-day driver is a coding agent, you get the full workflow (scaffold, enrich, query, store) with one install and nothing to build.
- **Reach for a framework SDK** when you are shipping your own agent or application and want Wren's context layer as a toolkit inside it, instead of shelling out to the CLI.
- **Reach for wasm** when the consumer is a browser: GenBI dashboards use it under the hood, and you can use it directly to run modeled SQL client-side.

## How the pieces relate

The framework SDKs and the wasm engine do not replace the CLI — they consume the project it prepares. The typical split:

1. **Author-time (CLI + skills):** connect a profile, scaffold and enrich MDL, build `target/mdl.json`, index memory.
2. **Run-time (your pick above):** the CLI, an SDK toolkit, or the wasm engine plans and executes queries through that compiled context.

See [Manage project](/oss/guides/manage_project) for the project lifecycle that all modes share.
