# Wren AI Core Documentation

This directory is the **single source of truth** for Wren AI Core docs published at [docs.getwren.ai](https://docs.getwren.ai/oss/introduction).

Changes merged to `main` are automatically synced to the doc website via GitHub Actions (`.github/workflows/sync-docs.yml`). The sync is **additive overlay** — files are copied and overwritten, but nothing is deleted automatically; stale files left behind by source-side renames or deletions must be cleaned up manually in the docs site repo.

## Overview

- [Introduction](introduction.mdx) — what Wren AI Core is, problem it solves, core ideas

## Get Started

- [Installation](get_started/installation.md) — agent-driven or manual CLI install
- [Quickstart](get_started/quickstart.md) — try the bundled `jaffle_shop` demo
- [Connect Your Database](get_started/connect.md)

## Concepts

- [What is Context?](concepts/what_is_context.md)
- [What is MDL?](concepts/what_is_mdl.md)
- [Benefits for LLMs](concepts/benefits_llm.md)
- [Architecture](concepts/architecture.md)

## Guides

- [Data Modeling Overview](guides/modeling/overview.md)
- [Wren Project Structure](guides/modeling/wren_project.md)
- [Models](guides/modeling/model.md)
- [Relations](guides/modeling/relation.md)
- [Views](guides/modeling/view.md)
- [Memory](guides/memory.md)
- [Profiles](guides/profiles.md)

## Reference

- [CLI Reference](reference/cli.md)
- [Skills](reference/skills.md)

## Sync configuration

- [`.sync.yml`](.sync.yml) — declares which files/folders this directory contributes to the docs site
- [`.github/workflows/sync-docs.yml`](../../.github/workflows/sync-docs.yml) — the GitHub Actions workflow that performs the sync

## Not synced

- `README.md` — this file
- `.sync.yml` — sync configuration
