---
sidebar_label: Junie
---

# Install Wren AI with Junie

JetBrains Junie.

## Prerequisites

- [Junie](https://www.jetbrains.com/junie) installed and authenticated.
- A JetBrains IDE is required.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent junie
```

## Run onboarding

Open your project in a JetBrains IDE with the Junie plugin installed, then open the Junie tool window from the right sidebar.

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
