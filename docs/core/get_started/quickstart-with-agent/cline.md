---
sidebar_label: Cline
---

# Install Wren AI with Cline

Open-source autonomous coding agent for VS Code.

## Prerequisites

- [Cline](https://cline.bot) installed and authenticated.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent cline
```

## Run onboarding

Open your project folder in VS Code with the Cline extension installed, then click the Cline icon in the Activity Bar to open the chat panel.

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
