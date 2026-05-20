---
sidebar_label: Command Code
---

# Install Wren AI with Command Code

Command Code agent.

## Prerequisites

- [Command Code](https://commandcode.ai) installed and authenticated.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent command-code
```

## Run onboarding

```bash
cmd
```

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
