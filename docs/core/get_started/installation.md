---
sidebar_label: Installation
---

# Installation

Get Wren AI running. Your AI coding agent does the rest.

## 1. Install the skill bundle

Skills are workflow guides that teach AI coding agents (Claude Code, Openclaw, Hermes, Codex, etc.) how to drive the Wren CLI for you:

```bash
npx skills add Canner/WrenAI --skill '*'
```

Have multiple AI coding agents installed and want the skills available in all of them? Pass `--agent '*'`:

```bash
npx skills add Canner/WrenAI --skill '*' --agent '*'
```

Or via the install script:

```bash
curl -fsSL https://raw.githubusercontent.com/Canner/WrenAI/main/skills/install.sh | bash
```

> See the [Skills reference](/oss/reference/skills) for the full list of skills installed and what each one does.

## 2. Ask your agent to set things up

**Start a new agent session** (skills load at session start), open your project directory, and ask:

```text
Use the wren-onboarding skill to install and set up Wren AI.
```

The agent will check your environment, install Python dependencies, create a connection profile for your data source, scaffold the project, and run a first query — all in one flow.

## 3. Start asking questions

Once onboarding finishes, just ask your agent business questions in natural language. The agent uses Wren AI's semantic layer to resolve schema, recall similar past queries, and generate accurate SQL.

```text
How many customers placed more than one order this month?
```

```text
What are the top 5 products by total revenue?
```

## What's next

- [Quickstart](./quickstart.md) — walk through a full example with the bundled `jaffle_shop` sample dataset
- [Connect your database](/oss/guides/connect) — connect a profile to a real data source
- [Skills reference](/oss/reference/skills) — what each skill does in detail
