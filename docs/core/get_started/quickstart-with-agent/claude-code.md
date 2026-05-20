---
sidebar_label: Claude Code
---

# Install Wren AI with Claude Code

Anthropic's official terminal coding assistant.

## Prerequisites

- [Claude Code](https://claude.com/code) installed and authenticated.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent claude-code
```

## Run onboarding

```bash
claude
```

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
