---
sidebar_label: Pi
---

# Install Wren AI with Pi

Pi Mono coding agent.

## Prerequisites

- [Pi](https://github.com/badlogic/pi-mono) installed and authenticated.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --agent pi
```

## Run onboarding

```bash
pi
```

Then ask:

```text
Use the /wren skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
