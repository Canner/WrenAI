---
sidebar_label: Devin for Terminal
---

# Install Wren AI with Devin for Terminal

Cognition Devin CLI.

## Prerequisites

- [Devin for Terminal](https://devin.ai) installed and authenticated.
- A Devin subscription is required.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent devin
```

## Run onboarding

```bash
devin
```

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
