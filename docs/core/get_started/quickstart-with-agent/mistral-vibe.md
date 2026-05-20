---
sidebar_label: Mistral Vibe
---

# Install Wren AI with Mistral Vibe

Mistral's Vibe coding agent.

## Prerequisites

- [Mistral Vibe](https://mistral.ai) installed and authenticated.
- Mistral account login required.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent mistral-vibe
```

## Run onboarding

```bash
vibe
```

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
