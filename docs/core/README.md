# Wren AI Core Documentation

This directory is the **single source of truth** for Wren AI Core docs published at [docs.getwren.ai](https://docs.getwren.ai/oss/introduction).

Changes merged to `main` are automatically synced to the doc website via GitHub Actions (`.github/workflows/sync-docs.yml`). The sync is **additive overlay** — files are copied and overwritten, but nothing is deleted automatically; stale files left behind by source-side renames or deletions must be cleaned up manually in the docs site repo.

## Overview

- [Introduction](introduction.mdx) — what Wren AI Core is, problem it solves, core ideas

## Get Started

- [Installation](get_started/installation.md) — agent-driven or manual CLI install
- [Quickstart](get_started/quickstart.md) — try the bundled `jaffle_shop` demo
- [Quickstart with your agent](get_started/quickstart-with-agent/) — per-agent setup pages (Claude Code, Cursor, Codex, …)

## Concepts

- [Why Wren?](concepts/why_wren.md)
- [What is Context?](concepts/what_is_context.md)
- [What is MDL?](concepts/what_is_mdl.md)
- [How the Agent Learns](concepts/agent_learning.md)
- [The Memory System](concepts/memory_system.md)
- [Correctness](concepts/correctness.md)
- [Where Wren Sits in Your Stack](concepts/stack_position.md)
- [Open Source vs Commercial](concepts/oss_vs_commercial.md)

## Guides

- [Connect Your Database](guides/connect.md) — profiles and data sources
- [Model Your Business](guides/model.md)
- [Manage Project](guides/manage_project.md) — project layout, profiles, multi-environment setup
- [Refine Answer Quality](guides/refine.md)
- [Pre-aggregate with Cubes](guides/cubes.md)
- [Serve an MCP Server](guides/mcp.md)
- [dbt Integration](guides/dbt-integration.md)
- [OpenMetadata Integration](guides/openmetadata-integration.md)
- [Apache Ossie Semantic Models](guides/ossie.md)
- [Build & deploy a GenBI app](guides/genbi.md)

## Reference

- [Architecture](reference/architecture.md)
- [CLI Reference](reference/cli.md)
- [MDL Schema Reference](reference/mdl.md) — models, relationships, views, cubes
- [Skills](reference/skills.md)
- [Operational Reference](reference/operational.md) — environment variables, profile and `.env` resolution
- [Migration](reference/migration.md)

## SDKs

- [SDKs & Integrations](sdk/overview.md)
- [wren-langchain](sdk/langchain.md)
- [wren-pydantic](sdk/pydantic.md)
- [wren-core-wasm](sdk/wasm.md)

## Sync configuration

- [`.sync.yml`](.sync.yml) — declares which files/folders this directory contributes to the docs site
- [`.github/workflows/sync-docs.yml`](../../.github/workflows/sync-docs.yml) — the GitHub Actions workflow that performs the sync

## Not synced

- `README.md` — this file
- `.sync.yml` — sync configuration
- [`internals/`](internals/README.md) — internal engineering docs
