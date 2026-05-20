---
sidebar_label: iFlow CLI
---

# Install Wren AI with iFlow CLI

iFlow CLI agent.

## Prerequisites

- [iFlow CLI](https://platform.iflow.cn) installed and authenticated.
- iFlow account required.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent iflow-cli
```

## Run onboarding

```bash
iflow
```

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
