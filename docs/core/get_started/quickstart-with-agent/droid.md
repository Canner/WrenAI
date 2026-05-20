---
sidebar_label: Droid
---

# Install Wren AI with Droid

Factory AI Droid CLI.

## Prerequisites

- [Droid](https://docs.factory.ai/cli) installed and authenticated.
- Factory login required.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent droid
```

## Run onboarding

```bash
droid
```

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
