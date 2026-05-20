---
sidebar_label: Antigravity
---

# Install Wren AI with Antigravity

Google's AI development workspace.

## Prerequisites

- [Antigravity](https://antigravity.google) installed and authenticated.
- A Google account login is required.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent antigravity
```

## Run onboarding

Open your project folder in Antigravity, then start a new agent session.

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
