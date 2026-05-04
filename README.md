# WrenAI — Open Context Engine for AI Agents

> 📣 **2026-05-07** — Wren Engine has merged into this repo under [`core/`](./core). The previous `Canner/wren-engine` repo is archived. The previous WrenAI GenBI app is preserved on the [`legacy/v1`](https://github.com/Canner/WrenAI/tree/legacy/v1) branch (tag `v1-final`). [Read the announcement →](https://github.com/Canner/WrenAI/discussions/2205)
>
> 📣 **2026-05-07** — Wren Engine 已併入本 repo 的 [`core/`](./core) 目錄；原 `Canner/wren-engine` repo 已封存。原 WrenAI GenBI app 保留在 [`legacy/v1`](https://github.com/Canner/WrenAI/tree/legacy/v1) branch（tag `v1-final`）。[完整公告 →](https://github.com/Canner/WrenAI/discussions/2205)

---

WrenAI is an open-source semantic engine for MCP clients and AI agents. It translates SQL queries through a semantic layer ([MDL](./core/wren-mdl/) — Modeling Definition Language) and executes them against 20+ data sources (PostgreSQL, BigQuery, Snowflake, Spark, etc.). The Rust engine is powered by [Apache DataFusion](https://datafusion.apache.org/) (Canner fork). Use it as a Python SDK, a CLI, a WASM module in the browser, or as building blocks for AI-agent skills.

## Quick start

```bash
pip install wren-engine

mkdir my-project && cd my-project
wren context init

# add a connection profile (interactive)
wren profile add my-db

# ask a question through a skill (or call the SDK)
wren ask "what were the top 5 customers by revenue last month?"
```

Full CLI guide: [`core/wren/README.md`](./core/wren/README.md). Installable extras for each connector are listed there.

## Repository map

| Path | What's there |
|---|---|
| [`core/`](./core) | Rust engine + Python/WASM bindings + CLI. The semantic SQL machinery. |
| &nbsp;&nbsp;[`core/wren-core/`](./core/wren-core) | Rust semantic engine (Cargo workspace). |
| &nbsp;&nbsp;[`core/wren-core-base/`](./core/wren-core-base) | Manifest types (`Model`, `Column`, `Metric`, `Relationship`, `View`). |
| &nbsp;&nbsp;[`core/wren-core-py/`](./core/wren-core-py) | PyO3 bindings (PyPI: `wren-core`). |
| &nbsp;&nbsp;[`core/wren-core-wasm/`](./core/wren-core-wasm) | WebAssembly build for in-browser semantic SQL (npm: `wren-core-wasm`). |
| &nbsp;&nbsp;[`core/wren/`](./core/wren) | Python SDK + `wren` CLI (PyPI: `wren-engine`). |
| &nbsp;&nbsp;[`core/wren-mdl/`](./core/wren-mdl) | MDL JSON schema. |
| [`skills/`](./skills) | CLI-based agent skills (`wren-generate-mdl`, `wren-usage`, `wren-dlt-connector`, `wren-onboarding`). |
| [`sdks/integrations/`](./sdks) | Framework integrations (LangChain, CrewAI, Pydantic-AI, Goose, LlamaIndex, Mastra) — _coming soon_. |
| [`examples/`](./examples) | End-to-end example projects — _coming soon_. |
| [`docs/core/`](./docs/core) | Module documentation. |

## Community

- **Discussions**: [github.com/Canner/WrenAI/discussions](https://github.com/Canner/WrenAI/discussions)
- **Issues**: [github.com/Canner/WrenAI/issues](https://github.com/Canner/WrenAI/issues)
- **Discord**: [discord.gg/canner](https://discord.gg/canner)
- **Docs site**: [docs.getwren.ai](https://docs.getwren.ai)

## License

WrenAI is multi-licensed:

- **`core/**`, `skills/**`, `sdks/integrations/**`, `examples/**`, root-level files** — [Apache License 2.0](LICENSE-APACHE-2.0)
- **`docs/**`** — [Creative Commons Attribution 4.0 International (CC BY 4.0)](LICENSE-CC-BY-4.0)

Future modules may be introduced under [GNU Affero General Public License v3.0](LICENSE-AGPL-3.0); the full text is committed here pre-emptively. See [LICENSE](LICENSE) for the authoritative path-to-license map.

Published packages declare their effective license in their package manifest (`Cargo.toml`, `pyproject.toml`, `package.json`).
