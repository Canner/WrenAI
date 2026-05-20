---
sidebar_label: Kilo Code
---

# Install Wren AI with Kilo Code

VS Code coding agent (fork of Roo Code).

## Prerequisites

- [Kilo Code](https://kilocode.ai) installed and authenticated.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent kilo
```

## Run onboarding

Open your project folder in VS Code with the Kilo Code extension installed, then click the Kilo icon in the Activity Bar. Or use the CLI:

```bash
kilo
```

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
