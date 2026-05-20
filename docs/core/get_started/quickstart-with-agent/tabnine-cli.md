---
sidebar_label: Tabnine CLI
---

# Install Wren AI with Tabnine CLI

Tabnine CLI coding agent.

## Prerequisites

- [Tabnine CLI](https://www.tabnine.com) installed and authenticated.
- A Tabnine subscription is required.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent tabnine-cli
```

## Run onboarding

```bash
tabnine
```

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
