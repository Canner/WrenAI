---
sidebar_label: Crush
---

# Install Wren AI with Crush

Charm's TUI coding agent.

## Prerequisites

- [Crush](https://github.com/charmbracelet/crush) installed and authenticated.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent crush
```

## Run onboarding

```bash
crush
```

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
