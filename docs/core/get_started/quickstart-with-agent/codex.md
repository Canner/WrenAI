---
sidebar_label: Codex
---

# Install Wren AI with Codex

OpenAI Codex CLI.

## Prerequisites

- [Codex](https://developers.openai.com/codex) installed and authenticated.
- OpenAI account login required.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent codex
```

## Run onboarding

```bash
codex
```

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
