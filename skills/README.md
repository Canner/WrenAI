# Wren Engine CLI Skills

This directory contains AI agent skills for working with the Wren Engine CLI (`wren`). Skills are instruction files that teach AI agents how to query data, generate MDL projects, and manage semantic layers using the `wren` CLI — no Docker or MCP server required.

## Installation

### Option 1 — Claude Code Plugin

Add the marketplace and install:
```
/plugin marketplace add Canner/WrenAI --path skills
/plugin install wren@wren
```

Or test locally during development:
```bash
claude --plugin-dir ./skills
```

Skills are namespaced as `/wren:<skill>` (e.g., `/wren:wren-generate-mdl`, `/wren:wren-usage`).

### Option 2 — npx skills

Install all skills:
```bash
npx skills add Canner/WrenAI --skill '*'
```

The CLI auto-detects your installed agent. To target a specific one, add `--agent <name>` (e.g., `claude-code`, `cursor`, `windsurf`, `cline`).

### Option 3 — install script (from a local clone)

```bash
bash skills/install.sh                    # all skills
bash skills/install.sh wren-usage         # specific skill (auto-installs dependencies)
bash skills/install.sh --force wren-usage # overwrite existing
```

### Option 4 — manual copy

```bash
cp -r skills/wren-usage skills/wren-generate-mdl ~/.claude/skills/
```

Once installed, invoke a skill by name in your conversation:

```text
/wren-usage
/wren-generate-mdl
```

> **Tip:** Use `--skill '*'` to install all skills at once, or specify individual skills.

## Available Skills

| Skill | Description |
|-------|-------------|
| [wren-usage](wren-usage/SKILL.md) | **Primary skill** — CLI workflow guide: query data via `wren --sql`, gather schema context with `wren memory`, store/recall queries, handle errors |
| [wren-generate-mdl](wren-generate-mdl/SKILL.md) | Generate a Wren MDL project from a live database — schema discovery, type normalization, YAML generation |
| [wren-dlt-connector](wren-dlt-connector/SKILL.md) | Connect SaaS data (HubSpot, Stripe, Salesforce, etc.) via dlt pipelines into DuckDB, then auto-generate a Wren project |

### wren-usage reference files

| File | Topic |
|------|-------|
| [references/memory.md](wren-usage/references/memory.md) | When to index, fetch, store, and recall |
| [references/wren-sql.md](wren-usage/references/wren-sql.md) | CTE rewrite pipeline, SQL rules, error diagnosis |

## Updating Skills

Each skill automatically checks for updates when invoked. To update manually:

```bash
# Re-add to reinstall the latest version
npx skills add Canner/WrenAI --skill '*'

# Or reinstall from a local clone
bash skills/install.sh --force
```

## Releasing a New Skill Version

When updating a skill, three files must be kept in sync:

1. Update `version` in the skill's `SKILL.md` frontmatter
2. Update the matching entry in [`versions.json`](versions.json)
3. Update the matching entry in [`index.json`](index.json)

Run `bash skills/check-versions.sh` to verify parity before merging.

## Requirements

- `wren` CLI installed (`pip install wren-engine` or `pip install wren-engine[<datasource>]`)
- A database connection (configured via `wren profile add` or `~/.wren/connection_info.json`)
- An AI client that supports skills (Claude Code, Cline, Cursor, etc.)

## Archived Skills (MCP-based)

The previous MCP server-based skills are preserved in [`skills-archive/`](../skills-archive/). Those skills require a running ibis-server and MCP server. The CLI skills in this directory replace that workflow with the standalone `wren` CLI.
