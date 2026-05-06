
<p align="center" id="top">
  <a href="https://getwren.ai/?utm_source=github&utm_medium=title&utm_campaign=readme">
    <picture>
      <source media="(prefers-color-scheme: light)" srcset="./misc/wrenai_logo.png">
      <img src="./misc/wrenai_logo_white.png" width="300px">
    </picture>
    <h1 align="center">WrenAI — Open Context Layer for AI Agents</h1>
  </a>
</p>

<p align="center">
  <a aria-label="Follow us on X" href="https://x.com/getwrenai">
    <img alt="" src="https://img.shields.io/badge/-@getwrenai-blue?style=for-the-badge&logo=x&logoColor=white&labelColor=gray&logoWidth=20">
  </a>
  <a aria-label="Releases" href="https://github.com/canner/WrenAI/releases">
    <img alt="" src="https://img.shields.io/github/v/release/canner/WrenAI?logo=github&label=GitHub%20Release&color=blue&style=for-the-badge">
  </a>
  <a aria-label="License" href="https://github.com/Canner/WrenAI/blob/main/LICENSE">
    <img alt="" src="https://img.shields.io/github/license/canner/WrenAI?color=blue&style=for-the-badge">
  </a>
  <a aria-label="GitHub Stars" href="https://github.com/Canner/WrenAI/stargazers">
    <img alt="" src="https://img.shields.io/github/stars/canner/WrenAI?style=for-the-badge&logo=github&color=blue&label=Stars">
  </a>
  <a href="https://docs.getwren.ai">
    <img src="https://img.shields.io/badge/docs-online-brightgreen?style=for-the-badge" alt="Docs">
  </a>
  <a aria-label="Join the community on GitHub" href="https://discord.gg/5DvshJqG8Z">
    <img alt="" src="https://img.shields.io/badge/-JOIN%20THE%20COMMUNITY-blue?style=for-the-badge&logo=discord&logoColor=white&labelColor=grey&logoWidth=20">
  </a>
  <a aria-label="Canner" href="https://cannerdata.com/?utm_source=github&utm_medium=badge&utm_campaign=readme">
    <img src="https://img.shields.io/badge/%F0%9F%A7%A1-Made%20by%20Canner-blue?style=for-the-badge">
  </a>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/9263" target="_blank"><img src="https://trendshift.io/api/badge/repositories/9263" alt="Canner%2FWrenAI | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

> 📣 **2026-05-07** — Wren Engine has merged into this repo under [`core/`](./core). The previous `Canner/wren-engine` repo is archived. The previous WrenAI GenBI app is preserved on the [`legacy/v1`](https://github.com/Canner/WrenAI/tree/legacy/v1) branch (tag `v1-final`). [Read the announcement →](https://github.com/Canner/WrenAI/discussions/2205)
---

## Why WrenAI?

AI agents fail on business data not because they can't write SQL — they fail because they don't know what your warehouse means. Overlapping tables, inconsistent naming, metric definitions scattered across dashboards and SQL files: an LLM with raw database access guesses just as badly as a new hire on day one.

WrenAI is the open context layer that fills that gap. You model your business in **[MDL](./core/wren-mdl/)** (Modeling Definition Language) — entities, relationships, calculations, governed access patterns — and any agent (Claude, Cursor, ChatGPT, internal copilots, customer-facing apps) queries through the same layer your analysts already use.

A Rust engine powered by [Apache DataFusion](https://datafusion.apache.org/) translates the modeled SQL and runs it against 20+ data sources (PostgreSQL, BigQuery, Snowflake, Spark, etc.). Use it as a Python SDK, a CLI, a WASM module in the browser, or as building blocks for agent skills.

## Quick start

The fastest path is to let an AI coding agent (Claude Code, Cursor, Aider, etc.) drive the install:

```bash
# Install WrenAI skills into your AI agent
npx skills add Canner/WrenAI --skill '*'
```

Start a new agent session and ask:

> Use the `wren-onboarding` skill to install and set up Wren AI Core.

The `wren-onboarding` skill walks the agent through environment checks, package install, project scaffolding, the first data source connection, and a first query.

Full CLI guide and manual install steps: [`core/wren/README.md`](./core/wren/README.md). Installable extras for each connector are listed there.


## Supported Data Sources

Wren Engine is built to work across modern data stacks, including warehouses, databases, and file-based sources.

Current open source support includes connectors such as:

- Amazon S3
- Apache Spark
- Apache Doris
- Athena
- BigQuery
- ClickHouse
- Databricks
- DuckDB
- Google Cloud Storage
- Local files
- MinIO
- MySQL
- Oracle
- PostgreSQL
- Redshift
- SQL Server
- Snowflake
- Trino

See the connector API docs in the project documentation for the latest connection schemas and capabilities.

## Repository map

| Path | What's there |
|---|---|
| [`core/`](./core) | Rust engine + Python/WASM bindings + CLI. The context layer's core machinery. |
| &nbsp;&nbsp;[`core/wren-core/`](./core/wren-core) | Rust semantic engine (Cargo workspace). |
| &nbsp;&nbsp;[`core/wren-core-base/`](./core/wren-core-base) | Manifest types (`Model`, `Column`, `Cube`, `Relationship`, `View`). |
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

## Our Contributors
<a href="https://github.com/canner/wrenAI/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Canner/WrenAI" />
</a>

<p align="right">
  <a href="#top">⬆️ Back to Top</a>
</p>
