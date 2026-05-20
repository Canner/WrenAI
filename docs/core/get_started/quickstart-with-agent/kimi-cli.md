---
sidebar_label: Kimi Code CLI
---

# Install Wren AI with Kimi Code CLI

Moonshot Kimi CLI. Uses the shared `.agents/skills/` directory.

## Prerequisites

- [Kimi Code CLI](https://moonshotai.github.io/kimi-cli) installed and authenticated.
- Moonshot API key required.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent kimi-cli
```

## Run onboarding

```bash
kimi
```

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
