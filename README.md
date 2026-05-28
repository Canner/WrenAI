<div align="center" id="top">
<a href="https://getwren.ai">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./misc/wrenai_logo_white.png">
    <img src="./misc/wrenai_logo.png" width="300px" alt="WrenAI">
  </picture>
</a>

### The open context layer for AI agents over business data.

*Your agent doesn't know what your data means. We fix that.*

[Docs](https://docs.getwren.ai) · [Discord](https://discord.gg/5DvshJqG8Z) · [Vision](https://www.getwren.ai/post/the-missing-context-layer-for-ai-agents-over-business-data) · [Blog](https://www.getwren.ai/blog)

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![PyPI](https://img.shields.io/pypi/v/wrenai?label=wrenai)](https://pypi.org/project/wrenai/)
[![GitHub Release](https://img.shields.io/github/v/release/Canner/WrenAI?logo=github&label=release)](https://github.com/Canner/WrenAI/releases)
[![Discord](https://img.shields.io/discord/1227143286951514152?logo=discord&label=Discord)](https://discord.gg/5DvshJqG8Z)
[![Last commit](https://img.shields.io/github/last-commit/Canner/WrenAI)](https://github.com/Canner/WrenAI/commits/main)
[![Follow on X](https://img.shields.io/badge/follow-@getwrenai-blue?logo=x&logoColor=white)](https://x.com/getwrenai)
[![Made by Canner](https://img.shields.io/badge/made_by-Canner-blue)](https://cannerdata.com)
![Stars](https://img.shields.io/github/stars/Canner/WrenAI?style=social)

<a href="https://trendshift.io/repositories/9263" target="_blank"><img src="https://trendshift.io/api/badge/repositories/9263" alt="Canner/WrenAI | Trendshift" width="250" height="55" /></a>

</div>

> 📣 **2026-05-07** — Wren Engine has merged into this repo under [`core/`](./core). The previous `Canner/wren-engine` repo is archived. The previous WrenAI GenBI app is preserved on the [`legacy/v1`](https://github.com/Canner/WrenAI/tree/legacy/v1) branch (tag `v1-final`). [Read the announcement →](https://github.com/Canner/WrenAI/discussions/2205)

<!--
  📺 HERO DEMO (place here)
  ─────────────────────────
  Suggested: a 5–10 second silent loop showing:
    1. Terminal: `wren skills get onboarding` (agent fetches the workflow guide from the CLI)
    2. Agent walks the user through setup, then writes SQL via `wren query` — visible reasoning trace
    3. Final result table
  Format: .gif (≤2 MB) or .mp4 (autoplay-muted).
  Save under  /assets/wrenai-demo.gif  and use the line below:

  <img src="./assets/wrenai-demo.gif" alt="Wren AI in action" width="820" />
-->

---

## What WrenAI is

WrenAI is the **open context layer** that gives your agents what schemas don't: business semantics, examples, memory, governance, and — soon — the unstructured corporate knowledge that lives in your docs, wikis, and chat threads. Built for the agent frameworks you already use. 

![Wren AI architecture](./misc/wren-ai-architecture.png)

## Why agent builders pick WrenAI

- **Open by default** — Open-sourced core, SDK, and skills through Apache-2.0 license.
- **Built for AI agents** — Skills, agentic architecture, context retrieval are first-class. Ships as SDKs for the agent frameworks that engineers already use.
- **Correctness as primitives** — rich schema retrieval, dry-plan validation, structured errors with hints, value profiling, eval runner. The agent orchestrates; the trace lives in the agent's reasoning.
- **Reviewable, reproducible context** — every definition, example, and mapping is versionable and evidence-linked. Git-friendly.
- **Sits on top of your existing stack** — warehouse, transformation pipelines, your existing semantic layer. Not another tool to maintain.

## With & Without Wren AI

Agents are everywhere. Claude Code, Cursor, ChatGPT, Aider, LangChain pipelines, Pydantic AI flows, in-house copilots, customer-facing apps. None of them should have to rediscover your business logic from scratch. With Wren AI, "the context layer," they query through a standalone, shared interface usable by every agent and person, not gated behind a single vendor's UI and architecture.

<img width="1445" height="758" alt="before & after" src="https://github.com/user-attachments/assets/d6ef8b73-b844-4e11-9586-b4f7ab6ae9dc" />

## Quickstart

WrenAI is **agent-driven by design**: install the CLI, install a one-file
discovery stub for your AI client, then let your AI agent drive the rest.
Workflow guides live inside the CLI itself and are served on demand, so
content always matches the installed version.

### 1. Install the CLI

```bash
pip install wrenai                      # core (DuckDB included)
pip install "wrenai[postgres,memory]"   # add per-datasource and memory extras as needed
```

### 2. Install the discovery stub for your AI client

```bash
npx skills add Canner/WrenAI            # auto-detects Claude Code, Cursor, Cline, Codex, …
```

The stub is ~50 lines. It teaches your agent to fetch workflow guides via
`wren skills get <name>`, reference docs via `wren docs get <reference>`,
and shaped prompts via `wren ask "<question>" --guided|--direct` —
everything else lives in the CLI.

### 3. Ask your agent to set things up

Open your agent in a project directory and say something like:

> "Use Wren to set up my Postgres database."

The agent runs `wren skills get onboarding`, follows the guide step-by-step,
checks your environment, creates a connection profile, scaffolds the project,
and runs a first query.

### 4. (Optional) Enrich the project

Once onboarding finishes, ask:

> "Enrich my Wren project with the business context in `raw/`."

The agent runs `wren skills get enrich-context` and follows the guide in
**grill** mode (one question at a time) or **auto-pilot** mode (agent reads
`<project>/raw/` and proposes). Both modes write to MDL, instructions,
queries, and memory — all reviewable, all Git-friendly.

### 5. Ask questions

> "Who are our top 10 customers by sales this quarter?"

Your agent fetches MDL context, recalls similar past queries, writes
governed SQL, and executes via `wren query`.

**Want to try it without your own database?** Ask your agent to use the
bundled `jaffle_shop` sample dataset — same flow, querying a real warehouse
end-to-end in a couple of minutes.

## Two beats: scaffold fast, enrich deep

```bash
# Day 1 — agent-driven
wren skills get onboarding         # workflow guide: set up project + first query
wren skills get enrich-context     # workflow guide: add business context (cubes, units, enums)

# Day-to-day
wren query --sql '...'             # query through the MDL semantic layer
wren ask "<question>" --guided     # wrap a question for a weaker agent
wren ask "<question>" --direct     # wrap a question for a stronger agent
```

Fast at first. Deep when you need it. Always reviewable and Git-friendly.

<!--
  📷 OPTIONAL: 2-up screenshot showing grill mode (left) vs auto-pilot mode (right).
  Save under  /assets/two-beats.png
-->

## What's Included

- **Modeling Definition Language (MDL)** — models, columns, relationships, views, cubes, metrics, row-level / column-level access control (RLAC / CLAC)
- **Engine** — Apache DataFusion based, 22+ data sources
- **Memory & examples** — LanceDB-backed, hybrid retrieval, versionable
- **Agent SDK** — `wren-langchain` (LangChain / LangGraph), `wren-pydantic`; reference Python integration for other stacks
- **Governed execution primitives** — functions, dry-plan, row limits, access control

## What's next

- **Context enrichment skill** — `/wren-enrich-context` (grill + auto-pilot modes) hardened across MDL, instructions, queries, and memory
- **End-to-end correctness primitives** — value profiling, rich retrieval, structured errors, golden eval runner
- **Agent-native distribution** — first-class SDKs across major agent frameworks; see [GitHub Discussions](https://github.com/Canner/WrenAI/discussions) for what's prioritized next
- **Full governed execution** — audit logs, rate limits, approval workflow, data-flow inspector

<!-- TODO: vision_paper_en.md is currently at .tmp/roadmap-discuss/vision_paper_en.md — move to a published path (e.g. docs/vision-paper.md or repo root) and update this link before publishing. -->
Full roadmap and design notes: see the [vision paper](https://docs.getwren.ai/oss/introduction).

## Documentation

- [Quickstart](https://docs.getwren.ai/oss/get_started/quickstart) — from skill install to first answer
- [Concepts](https://docs.getwren.ai/oss/concepts/what_is_context) — what context is, what MDL is, how memory works
- [Connect a database](https://docs.getwren.ai/oss/guides/connect/overview) — Postgres, BigQuery, Snowflake, DuckDB, and more
- [Agent SDKs](https://docs.getwren.ai/oss/sdk/overview) — what's shipping today, what's next

## Community

- 💬 [Discord](https://discord.gg/5DvshJqG8Z) — chat with the team and other builders
- 🐙 [GitHub Discussions](https://github.com/Canner/WrenAI/discussions) — design conversations, RFCs, longer threads
- 🐦 [Twitter / X](https://x.com/getwrenai) — release notes and short updates
- 🗞 [Blog](https://www.getwren.ai/blog) — vision, post-mortems, deep dives

## Contributing

We build in the open. Issues, PRs, connector contributions, SDK integrations, docs fixes — all welcome.

- [Contributor guide](./CONTRIBUTING.md)
- [Connector ecosystem program](./docs/contributing-a-connector.md) — three-tier ownership: official, community-blessed, community-owned
- [Architecture map](./docs/architecture.md) — find the right place to land your change
- Looking for somewhere to start? Try the [`good first issue`](https://github.com/Canner/WrenAI/labels/good%20first%20issue) label.

<details>
<summary><strong>Project structure</strong> — click to expand</summary>

```
core/
  wren-core/         Rust semantic engine (Apache DataFusion)
  wren-core-base/    Shared manifest types + MDL builder
  wren-core-py/      Python bindings (PyPI: wren-core)
  wren-core-wasm/    WebAssembly build (npm: wren-core-wasm)
  wren/              Python SDK and CLI (PyPI: wrenai)
  wren-mdl/          MDL JSON schema
sdk/
  wren-langchain/    Reference agent SDK integration
skills/              Agent skills for context authoring
docs/                Module documentation
examples/            Example projects
```

</details>

## Contributors

<a href="https://github.com/Canner/WrenAI/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Canner/WrenAI" alt="WrenAI contributors" />
</a>

## License

Apache 2.0. See [LICENSE](./LICENSE).

---

<div align="center">

*Come build the context layer with us.*

**If WrenAI helps you, drop a ⭐ — it genuinely helps us grow!**

<p><a href="#top">⬆️ Back to top</a></p>

</div>
