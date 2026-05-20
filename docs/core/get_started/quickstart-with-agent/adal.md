---
sidebar_label: AdaL
---

# Install Wren AI with AdaL

A lightweight coding agent.

## Prerequisites

- [AdaL](https://github.com/vercel-labs/skills) installed and authenticated.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent adal
```

## Run onboarding

Open your project folder in AdaL, then start a new chat session.

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
